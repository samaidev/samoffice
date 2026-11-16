// 逐项开关应用内元素，找出死区开关。在小文档上快测：
// 候选：Ruler(标尺)、ribbon、行号层(docLineNumbers)、页脚脚注区、比较栏
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 80)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const toggle = async (name, hide) => {
  const box = await p.evaluate((hideSrc) => {
    const h = new Function("return (" + hideSrc + ")")(); h() // 应用切换
    window.__e = 0
    window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true })
    const r = document.querySelector('.ProseMirror td').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, hide.toString())
  await p.waitForTimeout(400)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  console.log(`${name}:`, (await p.evaluate(() => window.__e)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await toggle('隐藏 .sam-ruler', () => { for (const r of document.querySelectorAll('.sam-ruler')) r.style.display = 'none' })
await toggle('隐藏 ribbon 区(两级)', () => {
  const root = document.querySelector('.flex.flex-col.h-full')
  for (const c of [...root.children]) if (!c.contains(window.__pmView.dom)) c.style.display = 'none'
})
await b.close()
