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
const cdp = await p.context().newCDPSession(p)
// 采集合成层树：谁覆盖点击点
await cdp.send('LayerTree.enable')
const { layers } = await cdp.send('LayerTree.getLayerTree')
const cell = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
// Layer 坐标是渲染像素（无 DPR 时=CSS px）
const hits = (layers || []).filter((l) => {
  if (!l.bounds) return false
  const [x, y, w, h] = l.bounds
  return cell.x >= x && cell.x <= x + w && cell.y >= y && cell.y <= y + h && w > 50 && h > 20
}).map((l) => ({
  id: l.layerId, bounds: l.bounds, compositing: l.compositingReasons?.slice(0, 3),
  backend: l.backendNodeId ? String(l.backendNodeId).slice(0, 8) : '-',
}))
console.log('覆盖点击点的合成层:', JSON.stringify(hits, null, 1).slice(0, 1500))
console.log('总层数:', (layers || []).length)
await b.close()
