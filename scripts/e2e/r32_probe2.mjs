import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 200)) })
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
// 逐页状态栏 Shapes 计数 + 主画布 clip 形状数
for (let sn = 1; sn <= 16; sn++) {
  const st = await p.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ')
    const pageInd = (body.match(/#(\d+)\s*\/\s*16/) || [])[1]
    const shapesInd = (body.match(/📊 Shapes (\d+)/) || [])[1]
    const clips = document.querySelectorAll('[style*="clip-path"]').length
    return { pageInd, shapesInd, clips }
  })
  console.log(`页${sn}: status=${st.pageInd} shapes=${st.shapesInd} clips=${st.clips}`)
  if (sn < 16) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200) }
}
await b.close()
