// 滚动无效。冷启动系统性收尾前最后一组「有效形态」分析：
// 已知活形态 = ① wrapper 移到 body（脱离 PM 管理）
//            ② 重写 body（全部新节点 + 脱离 React/PM）
// ①的实质 = PM 不再管理 wrapper 的位置 —— PM DOMObserver 不再「回改」。
// ★ 回改！！所有 PM 内实验（重插/新父包裹/tbody 替换/display 切换）后，
// PM DOMObserver 都在 300ms 内把 DOM 改回/重建 —— 【改回时 Chromium 的
// 层缓存又回到坏状态】。而移到 body 后无回改 —— 修复保持！
// ◆◆◆◆ 修复方案成型：**让表格 NodeView 的 wrapper 位置由我们接管后，
// PM 无法回改** —— 不可能（PM 必须管理）。
// ◆ 但有个中间形态没试：wrapper 留在 PM 内，【PM 不需要回改的轻触】：
// 「把 wrapper 先 append 到 body（激活）→ PM 回改把它拉回 PM 原位」——
// 回改后是否回到死？factor19 holder 实验后 wrapper 留在 body（PM 回改？
// 实测 wInPM=false —— PM 没拉回！）。因为移出后 PM 的 desc 已解绑？
// ★ 最终验证链：移出（活）→ 强制 PM updateState（触发 updateChildren 重建
// wrapper）→ 新 wrapper 回到 PM → 点它 → 若活则「重建即修复」成立，
// 修复=DocTableView.update 里触发自重建：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const clickTd = async () => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// 模拟「DocTableView.update 自重建」：强制 PM 重建 NodeView
// （dispatch 一个 setNodeMarkup 同 attrs → PM 重建 NodeView desc）
await p.evaluate(() => {
  const v = window.__pmView
  const pos = (() => { let found = -1; v.state.doc.forEach((n, off) => { if (found < 0 && n.type.name === 'table') found = off }); return found })()
  if (pos >= 0) {
    const node = v.state.doc.nodeAt(pos)
    v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs }))
  }
})
await p.waitForTimeout(700)
console.log('setNodeMarkup 重建 NodeView 后:', await clickTd() ? 'ALIVE ✅✅✅' : 'DEAD')
// 若活：测稳定性（再点 + PM update 后）
await p.evaluate(() => { window.__pmView.updateState(window.__pmView.state) })
await p.waitForTimeout(500)
console.log('updateState 后:', await clickTd() ? '仍 ALIVE ✅' : '回 DEAD')
await b.close()
