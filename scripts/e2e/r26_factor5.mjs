// 与挂载代数无关。静态回放活了但应用死 —— 回放少了什么？
// 回放只拷了 editorScroll 子树 + <style>。应用里还有：
// 1) <html> 上的属性（data-theme 等）2) 全局字体 3) #root 的 React
// 4) **vite 客户端注入的 HMR 脚本 / react-refresh overlay**
// 5) **@vite/client 的 error overlay DOM**
// 6) 字体文件！<link> 样式里引用的字体在 about:blank 加载失败（跨源），
//    应用里正常加载 —— 【字体加载】改变文本布局 → 也许正好绕开 bug！
//    也就是说回放页的"活"可能只是字体缺失去 layout 差异 —— 假 ALIVE！
// 验证：应用页面里禁用字体（document.fonts.delete / font-display swap
// 不行）—— 用 CSS * { font-family: monospace !important } 改字体 → 若活，
// 则【字体】是因子（bug 绑定字体度量！）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const test = async (name, css) => {
  await p.evaluate((c) => {
    const st = document.getElementById('tp') || (() => { const s = document.createElement('style'); s.id = 'tp'; document.head.appendChild(s); return s })()
    st.textContent = c
  }, css)
  await p.waitForTimeout(400)
  await p.evaluate(() => { window.__e = 0; window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__e)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', '')
await test('全局换字体 monospace', '*, .ProseMirror { font-family: monospace !important }')
await test('仅 PM 换字体', '.ProseMirror { font-family: monospace !important }')
await test('字号 14px', '.ProseMirror { font-size: 14px !important }')
await test('line-height 1.79', '.ProseMirror { line-height: 1.79 !important }')
await b.close()
