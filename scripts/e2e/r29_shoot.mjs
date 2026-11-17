// 正确翻页截图：View 标签 → 下一页按钮（或缩略图）逐页截图
import { chromium } from 'playwright'
import fs from 'fs'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
fs.rmSync('/tmp/ppt_sam_pages', { recursive: true, force: true })
fs.mkdirSync('/tmp/ppt_sam_pages', { recursive: true })
// 切到 View 标签（下一页按钮在此）
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(600)
const clickNext = () => p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const nb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))
  nb?.click()
  return !!nb
})
for (let i = 0; i < 16; i++) {
  const canvas = await p.evaluate(() => {
    const c = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width || 0), h: Math.round(r.height || 0) }
  })
  if (canvas && canvas.w > 100 && canvas.h > 50) {
    await p.screenshot({ path: `/tmp/ppt_sam_pages/p${String(i + 1).padStart(2, '0')}.png`, clip: { x: canvas.x, y: canvas.y, width: canvas.w, height: canvas.h } })
  } else {
    console.log(`页 ${i + 1}: canvas 无效，全屏`)
    await p.screenshot({ path: `/tmp/ppt_sam_pages/p${String(i + 1).padStart(2, '0')}.png` })
  }
  if (i < 15) { await clickNext(); await p.waitForTimeout(600) }
}
console.log('已截图:', fs.readdirSync('/tmp/ppt_sam_pages').length, '页')
await b.close()
