// z=7 生效、applySel 已服务 —— 但 final3 的点击没触发 handler。
// t27 的 HIT 是【同页面【手动 evaluate 改 z 后】点 td*0.6】。
// final3 也是 td*0.6 —— 应该 HIT…… 差异：t27 页面 proxy 由
// 【产品建（z6）→ evaluate 改 z7】；final3 是【产品直接建 z7】！
// ★★★ 也就是说：z6 建的层后来改 z7 = 活；直接建 z7 = 死？！
// 不合理 —— 但值得立即验证（跟 fv22 的「改名救活」矛盾 —— 那个死了）。
// 更可能的差异：t27 页面等了 5s（4s channel 波次）；final3 等 2.6s
//（只有 2s 波次建层，4s 波次还没跑）。2s 波次建的层死、4s 波次的活？
// —— 之前 t19 用 2s/4s 双波次还是死（当时 z6）。
// ◆ 矩阵：{2s建的z7, 4s建的z7, 2s建z6后改z7} × 点击
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const mk = async (waitMs, patch) => {
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
  await p.waitForTimeout(3000)
  const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
  await p.mouse.click(pb.x, pb.y)
  await p.waitForTimeout(waitMs)
  if (patch) await p.evaluate(patch)
  await p.evaluate(() => { window.__h = ''; document.querySelector('.pm-table-clickproxy')?.addEventListener('mousedown', () => { window.__h = 'HIT' }, true) })
  const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(400)
  const h = await p.evaluate(() => window.__h)
  await p.close()
  return h || '无'
}
console.log('A 等2.6s(z7产品):', await mk(2600, null))
console.log('B 等4.6s(z7产品):', await mk(4600, null))
console.log('C 等2.6s(改display:none→block):', await mk(2600, () => { const pr = document.querySelector('.pm-table-clickproxy'); pr.style.display = 'none'; setTimeout(() => { pr.style.display = 'block' }, 50) }))
await b.close()
