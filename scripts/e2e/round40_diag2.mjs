// round40 诊断2：点击后拖选是否失效（定位「点击污染拖选」）
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400/?sel2=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: {}, comments: [],
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', content: `第一段测试文本。${'这是用于测试拖选的正文内容，验证能否跨行选择文字。'.repeat(4)}` }] },
    { type: 'paragraph', inline: [{ type: 'text', content: `第二段测试文本。${'第二段的正文内容，用于跨段选择验证。'.repeat(4)}` }] },
  ],
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

const tryDrag = async (label) => {
  const box = await p.evaluate(() => {
    const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
    const r = ps[0].getBoundingClientRect()
    return { x1: Math.round(r.left + 100), y1: Math.round(r.top + r.height / 2), x2: Math.round(r.left + 200), y2: Math.round(r.top + r.height / 2 + 40) }
  })
  await p.mouse.move(box.x1, box.y1)
  await p.mouse.down()
  await p.mouse.move(box.x2, box.y2, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(250)
  const s = await p.evaluate(() => ({ sel: String(window.getSelection()), focus: document.activeElement?.closest('.ProseMirror') != null }))
  console.log(`${label}: 选区 ${s.sel.replace(/\n/g, '').length} 字 focus=${s.focus} "${s.sel.slice(0, 14)}"`)
  return s.sel.replace(/\n/g, '').length
}

// A. 直接拖选（基线，diag1 已验证成功）
await tryDrag('A 直接拖选')

// B. 点击正文一次后拖选
await p.mouse.click(523, 376)
await p.waitForTimeout(300)
await tryDrag('B 点击正文后拖选')

// C. 点击后再等 2s（分页稳定）后拖选
await p.mouse.click(523, 376)
await p.waitForTimeout(2000)
await tryDrag('C 点击+2s后拖选')

// D. 连点 10 次（模拟 round40 网格）后拖选
for (let i = 0; i < 10; i++) {
  await p.mouse.click(523 + i * 8, 376)
  await p.waitForTimeout(60)
}
await p.waitForTimeout(500)
await tryDrag('D 连点10次后拖选')

// E. 点击页边空白区（pageRef handler）后拖选
const blank = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const r = pm.getBoundingClientRect()
  return { x: Math.round(r.left - 30), y: Math.round(r.top + 300) }
})
await p.mouse.click(blank.x, blank.y)
await p.waitForTimeout(400)
await tryDrag('E 点空白后拖选')

console.log('pageerror:', errs.length, errs.slice(0, 3))
await b.close()
