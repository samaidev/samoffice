// 静态+监听器都活。剩下唯一差异：【React 应用真在跑】—— 具体是 React 的
// 状态更新/重渲染发生在【点击前】。新嫌疑：React 的 onScroll（editorScroll
// 有 onScroll={syncScroll}）在滚动时 setState → 重渲染 → …… 但静置后也死。
// ★ 更深嫌疑：PM dom 的属性集合 —— PM 挂载时会给 dom 设置一大堆属性
//（translate=no、spellcheck、autocorrect、role=textbox 等）。
// outerHTML 拷贝会带上这些 —— 已包含！
// ★★ 那只剩「DOM 被替换过」：React StrictMode 双挂载 PM view.destroy()
// 后重建 —— 最终 DOM 是第二代。而 outerHTML 是二代快照 —— 也一致。
// ★★★ 换终极对照：同一页面，__setDocForTest 前先点击表格 —— App 初始
// 打开的是「关于页」（无编辑器）。激活 e2e 窗口后编辑器【新挂载】。
// 试试第二次 __setDocForTest（触发 document prop 替换 → PM updateState）后
// 点击是否变活/死 —— 如果每次都死，说明与挂载代数无关。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const doc1 = { meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }
const doc2 = { meta: { title: 't2' }, blocks: [
  { type: 'p', inline: [{ text: '第二份文档' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'C1' }] }, { inline: [{ text: 'D1' }] }]] },
] }
const clickTd = async () => {
  await p.evaluate(() => { window.__e = 0; window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__e)) > 0
}
await p.evaluate(d => window.__setDocForTest(d), doc1)
await p.waitForTimeout(2500)
console.log('第1次挂载:', await clickTd() ? 'ALIVE' : 'DEAD')
// 同一窗口内替换 document（走 useEffect [document] → updateState）
await p.evaluate(d => window.__setDocForTest(d), doc2)
await p.waitForTimeout(2500)
console.log('第2次(内容替换):', await clickTd() ? 'ALIVE' : 'DEAD')
// 再来第三次
await p.evaluate(d => window.__setDocForTest(d), doc1)
await p.waitForTimeout(2500)
console.log('第3次(切回):', await clickTd() ? 'ALIVE' : 'DEAD')
await b.close()
