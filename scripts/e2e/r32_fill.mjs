import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
const out = await p.evaluate(() => {
  // slide6: 跳 5 页
  return new Promise((resolve) => {
    let i = 0
    const iv = setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      i++
      if (i >= 5) { clearInterval(iv); setTimeout(() => {
        const host = [...document.querySelectorAll('div')]
          .filter(d => { const r = d.getBoundingClientRect(); return r.width >= 780 && r.width <= 830 && r.height > 400 })
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
        if (!host) { resolve({ err: 'no host' }); return }
        const shapes = [...host.querySelectorAll('[style*="clip-path"]')]
        resolve({
          shapeCount: shapes.length,
          styles: shapes.slice(0, 8).map(s => {
            const r = s.getBoundingClientRect()
            return { w: Math.round(r.width), h: Math.round(r.height), bg: (s.style.background || s.parentElement?.style?.background || '').slice(0, 40), clip: (s.style.clipPath || '').slice(0, 20), txt: (s.textContent || '').slice(0, 10) }
          }),
        })
      }, 800) }
    }, 250)
  })
})
console.log(JSON.stringify(out, null, 1))
await b.close()
