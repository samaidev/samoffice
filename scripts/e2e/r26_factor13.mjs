// ★★★ 链上任意层 + absolute holder = 全 ALIVE！
// 对比 probe44（同样位置 fixed 表）全 DEAD —— 唯一差异：probe44 是
// 【新建的表】，这次是【转移原 wrapper 节点】！
// → 新建元素死、原有元素转移活 → 死的不是「位置」而是【新建元素】
// 在该上下文不被合成器登记？！
// 顿悟：**合成器层列表里没有这些新元素 —— hit-test 走的是旧的层快照**。
// 转移的 wrapper 早已在合成器登记（初始布局时）→ 活。
// 也就是说：这个页面在某个时刻后【新渲染的内容不进合成器 hit-test】。
// 表格为什么在列表外？—— 表格是 __setDocForTest 后 PM 新建渲染的！
// 段落也是新建的但活 —— 因为段落【重排版进了既有层】，而 tableWrapper
// 是 NodeView 独立子树，PM 直接 appendChild —— 也许触发了不同的合成路径。
// ★ 工程解法浮出水面：**让 wrapper 在渲染后强制进合成器 —— 
// 一次性 translateZ(0) 或 contain:strict 已试过（当时挂在 CSS 规则上、
// 装饰阶段可能没触发重绘）。这次在 __setDocForTest 后【动态给 wrapper
// 加内联 transform 再移除】，或更直接：给 wrapper 永久 contain:layout
// （无副作用）或强制 break 一次性 reflow。
// 先验证：点击死区时，给 wrapper 加内联 transform:translateZ(0)（保留）→ 点
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
const test = async (name, apply) => {
  await p.evaluate((src) => { const fn = new Function(src); fn() }, apply.toString())
  await p.waitForTimeout(350)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
// A: 永久内联 translateZ
await test('wrapper 内联 translateZ(0)', () => { document.querySelector('.tableWrapper').style.transform = 'translateZ(0)' })
// B: 移除后再点（验证是否复位死）
await test('移除 transform 后', () => { document.querySelector('.tableWrapper').style.transform = '' })
// C: contain:layout inline
await test('wrapper contain:layout', () => { document.querySelector('.tableWrapper').style.contain = 'layout' })
await b.close()
