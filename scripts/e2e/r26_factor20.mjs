// ★★★★★★ 巨大反转！这次点击命中了 DIV:tableWrapper（原节点在 body holder 里 ALIVE）！
// factor17 的失败是因为 holder 位置计算 bug（m0 公式把 holder 放到视口外或重叠）。
// 现在结论稳定了：
//   - 原 wrapper 节点：PM 内 DEAD → 移出 PM 到 body ALIVE ✅
//   - factor12（absolute holder 在链内）ALIVE 一致：holder 挂 root（PM 外）
//   - factor16 全 DEAD 的原因是那轮 holder 挂 root 但【原位】坐标系被
//     之前的转移搞乱 + relative/static 变体布局掉了 —— 不可信。
// 最终结论：死区绑定【.ProseMirror 内部的 tableWrapper】。
// PM 内段落活、PM 内表格死、表格移出 PM 活。
// → 触发条件 = PM 管理的 NodeView 子树。
// ★ 修复方向明确：让 wrapper 在 PM 内也活 —— PM 的 NodeView 有个致命差异：
//   **PM 在 NodeView dom 上设置了 contenteditable="false"？** —— 没有（attrs 只有 class）。
//   PM 的 ViewDesc 会 updateChildren 时【反复替换】wrapper 吗？
//   ◆ 试「表格 NodeView 加 ignoreMutation + 停止 PM 重建」做不到。
//   ◆ 务实修法：**CSS 层面把 .ProseMirror .tableWrapper 提升 stacking：
//   position:relative + z-index:1**（建立独立 stacking context）—— 
//   z-index 已试（factor13 transform 不行），但 z-index+isolation 未试全。
//   或者最猛的：**给 wrapper 加 isolation:isolate + position:absolute
//   包一层**。先快速跑一轮针对性 CSS：
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
  await p.waitForTimeout(350)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', '')
await test('wrapper isolation:isolate', '.ProseMirror .tableWrapper { isolation: isolate }')
await test('wrapper z-index:1', '.ProseMirror .tableWrapper { position: relative; z-index: 1 }')
await test('wrapper translateZ 保留', '.ProseMirror .tableWrapper { transform: translateZ(0.1px) }')
await test('table position:static!important', '.ProseMirror .tableWrapper table { position: static !important }')
await test('td position:static!important', '.ProseMirror td { position: static !important }')
await b.close()
