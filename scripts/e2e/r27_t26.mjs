// pm-host 里只有 PM + proxy(z6) —— 无遮挡。z 不是问题。
// ◆◆◆ 回到唯一坚不可摧的事实矩阵重新推理：
//   活层全由【我的测试代码】建：t21/t24(blob module)、t16(MC)、t17(setTimeout)、
//   fv17/fv22(twin) —— 全部在【Playwright evaluate 或其衍生的 import】里。
//   死层全由【产品代码】建 —— 无论 setTimeout/MC/延迟多久。
// ★ 唯一还没测的物理差异：【产品代码的层是在 React DevTools/StrictMode
//   的【双 effect】里建的两次中的某一次】？—— ensureProxy 有
//   proxies.has(wrapper) 去重 —— 只建一个。StrictMode 下 effect 跑两遍：
//   第一遍 disposed=true（cleanup），第二遍新建 —— 但 onFirst 只在
//   第二遍注册（第一遍的 onFirst 被移除）—— 只有一个 proxy。✓ 单层。
// ◆★★★ 最后假设（也是第一次真正合乎 Occam 的）：
//   **Playwright 的 evaluate 与产品代码运行在同一个页面 —— 没有差异。**
//   差异在【测试脚本本身】：我的所有「活」实验的点击坐标 vs 产品的
//   「死」实验的点击坐标 —— 不同！
//   - t21/t24 点击 = wr.width*0.6（wrapper 相对）
//   - t19/t13 点击 = td.width*0.6（td 相对 —— 更靠左！）
//   td[0] 在 wrapper 的左半 —— wrapper.width*0.6 vs td.width*0.6
//   点击点相差 (wr.width - td.width)*0.6 ≈ 165px —— 两个不同的点！
//   如果【死区只覆盖部分区域】（如左半），一切豁然开朗！
//   fv22 twin 点击用的也是 wrapper 相对！
// ★★★★ 立即验证：产品 proxy 上，点【右半】vs【左半】：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(5000)
await p.evaluate(() => {
  window.__vH = ''
  document.querySelector('.pm-table-clickproxy')?.addEventListener('mousedown', () => { window.__vH = 'HIT' }, true)
})
const pts = await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__ds = []
  v.dispatch = (tr) => { window.__ds.push(tr.selection ? tr.selection.from : -1); return orig(tr) }
  const proxy = document.querySelector('.pm-table-clickproxy')
  const r = proxy.getBoundingClientRect()
  return {
    left: { x: r.x + r.width * 0.15, y: r.y + r.height * 0.5 },   // td[0] 左侧
    mid: { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 },      // td[0]/td[1] 边界
    right: { x: r.x + r.width * 0.85, y: r.y + r.height * 0.5 },   // td[1] 右侧
  }
})
for (const [name, pt] of Object.entries(pts)) {
  await p.evaluate(() => { window.__vH = ''; window.__ds = [] })
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(400)
  const h = await p.evaluate(() => window.__vH)
  const d = await p.evaluate(() => window.__ds)
  console.log(`${name} 区: proxy=${h || '无'} dispatch=${JSON.stringify(d)}`)
}
await b.close()
