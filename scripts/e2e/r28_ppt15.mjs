// ★ 画布有内容（shapes 绝对定位层）！"1 / 16" 对。缩略图 jpeg 是真渲染。
// 用户说「渲染格式完全不行」—— 不是空白，而是【格式错乱】。
// 拿视觉证据：全页截图存盘，对比 LibreOffice 真相同页。
// 我自己看不了图 —— 但可以【程序化对比】：像素差异 + 布局探针。
import { chromium } from 'playwright'
import fs from 'fs'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
// 逐页截图：点缩略图/翻页按钮遍历 16 页
fs.mkdirSync('/tmp/ppt_sam_pages', { recursive: true })
const pageCount = 16
for (let i = 0; i < pageCount; i++) {
  // 用键盘 PageDown 或点击页码输入？先看导航方式：Next 按钮
  const nav = await p.evaluate(() => {
    // 找下一页按钮（❯ 或箭头）
    const btns = [...document.querySelectorAll('button')]
    const next = btns.find(x => x.offsetParent !== null && /❯|→|Next/i.test(x.textContent || x.title || ''))
    return next ? 'btn' : 'none'
  })
  if (i > 0) {
    if (nav === 'btn') {
      await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && /❯|→|Next/i.test(x.textContent || x.title || ''))?.click() })
    } else {
      await p.keyboard.press('ArrowRight')
    }
    await p.waitForTimeout(700)
  }
  const canvas = await p.evaluate(() => {
    // eslint-disable-next-line
    const c = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width || 0), h: Math.round(r.height || 0) }
  })
  if (canvas && canvas.w > 100 && Number.isFinite(canvas.x) && canvas.h > 50) {
    await p.screenshot({ path: `/tmp/ppt_sam_pages/p${String(i+1).padStart(2,'0')}.png`, clip: { x: canvas.x, y: canvas.y, width: canvas.w, height: canvas.h } })
  } else {
    console.log(`页 ${i+1}: canvas 无效 ${JSON.stringify(canvas)}，全屏截图`)
    await p.screenshot({ path: `/tmp/ppt_sam_pages/p${String(i+1).padStart(2,'0')}.png` })
  }
  if (i === 0) console.log('nav方式:', nav, 'canvas:', JSON.stringify(canvas))
}
const files = fs.readdirSync('/tmp/ppt_sam_pages')
console.log('已截图页数:', files.length)
await b.close()
