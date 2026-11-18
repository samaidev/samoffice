import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// z-index 阶梯：10 个 fixed div，z=1..10，都在死区 y、x 错开
await p.evaluate(() => {
  window.__zHits = {}
  for (let z = 1; z <= 10; z++) {
    const d = document.createElement('div')
    d.id = 'z' + z
    Object.assign(d.style, { position: 'fixed', left: (1000 + z * 30) + 'px', top: '585px', width: '26px', height: '26px', background: 'rgba(255,0,0,.25)', zIndex: String(z), border: '1px solid #333' })
    d.addEventListener('mousedown', () => { window.__zHits[z] = true })
    document.body.appendChild(d)
  }
})
await p.waitForTimeout(400)
for (let z = 1; z <= 10; z++) {
  await p.mouse.click(1000 + z * 30 + 13, 585 + 13)
  await p.waitForTimeout(80)
}
const hits = await p.evaluate(() => window.__zHits)
console.log('z 阶梯命中:', JSON.stringify(hits))
await b.close()
