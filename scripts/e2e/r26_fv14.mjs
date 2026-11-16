// 4s 也死！但 fv12 在【同一页面、删除后立即重建】就活 —— 
// 创建时机不是简单的时间窗口，而是「是否在【某个事件】之后」。
// fv12 的重建发生在【页面已接收过一次点击之后】？不 —— fv12 没先点击。
// fv12 与正式的差异重新列举：
//   fv12 层: mousedown handler = 计数器（无 preventDefault）
//   正式: mousedown = preventDefault + cellAtPoint + setTimeout + mouseup pd
// fv11 的 full-handler 变体（有 pd+setTimeout+mouseup pd）活了！
// —— 但 fv11 层创建于【evaluate 同步】（不是 setTimeout 链）！
// 正式链 = DocTableView constructor → setTimeout(4000) → setup()。
// fv11 = evaluate → 立即。fv3 = evaluate → setTimeout(400)。
// ◆ 都 setTimeout 过 —— fv3 活。
// ★ 最后差异：正式 setup 在 setTimeout 里还做了什么？——
// syncProxyGeometry()！它在 append 之前被调用？看代码顺序：
// host.appendChild(proxy) → this.proxyEl = proxy → syncProxyGeometry()
// —— 顺序对。但 syncProxyGeometry 里【proxy.style.display='block'】
// 且设置了 left/top/width/height —— 与 fv12 克隆相同值。
// ◆◆◆ 绝望之际 —— 直接读正式 setup 的真实执行：console 插桩 tablePlugins
// 不必 —— 用「Proxy 检测」：给正式 proxy 在【创建后立刻】（我们的
// evaluate 在 5s 检查到它）追加一个 capture 监听 —— fv9 已做 = []。
// ★★ 那就在【更早】（3.9s）抓它 —— 检查它创建后的头 100ms 内是否
// 活着，然后变死（被什么操作杀死）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 在 setDoc 前：每 200ms 轮询，一旦 proxy 出现立即插桩并点击测试
const results = await p.evaluate(async () => {
  window.__setDocForTest({ meta: { title: 't' }, blocks: [
    { type: 'p', inline: [{ content: '段落内容一' }] },
    { type: 'table', rows: [
      [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
      [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
    ] },
  ] })
  return 'ok'
})
await p.waitForTimeout(3900)
// 3.9s：proxy 马上要出现（4s）—— 轮询插桩
await p.evaluate(() => {
  window.__born = null
  const id = setInterval(() => {
    const proxy = document.querySelector('.pm-table-clickproxy')
    if (proxy && !window.__born) {
      window.__born = Date.now()
      proxy.addEventListener('mousedown', () => { window.__hitAt = Date.now() }, true)
    }
  }, 30)
  setTimeout(() => clearInterval(id), 3000)
})
// 在 4.05s / 4.5s / 5s / 6s 分别真实点击（Playwright 侧）
const clickAt = async (ms) => {
  await p.waitForTimeout(ms)
  const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  const hit = await p.evaluate(() => window.__hitAt || null)
  const born = await p.evaluate(() => window.__born || null)
  console.log(`t=${Math.round((hit ? (hit - born) / 1000 : -1))}s 命中=${!!hit} (born=${born ? 'yes' : 'no'})`)
  await p.evaluate(() => { window.__hitAt = null })
}
await clickAt(200)
await clickAt(500)
await clickAt(1000)
await clickAt(2000)
await b.close()
