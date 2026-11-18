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
const setup = await p.evaluate(() => {
  window.__hit = {}
  const wrap = document.querySelector('.tableWrapper')
  const clone = wrap.cloneNode(true)
  // 标记克隆
  clone.classList.add('r34-clone')
  Object.assign(clone.style, { position: 'fixed', left: '60px', width: '400px', height: '150px', overflow: 'hidden', background: '#ffd', zIndex: 2000, top: '120px' })
  // 找链上各层
  const chain = []
  let cur = wrap.parentElement
  while (cur && cur !== document.body) { chain.push(cur); cur = cur.parentElement }
  // chain = [ProseMirror, width100%, flex, z1, 794, mx-auto, ...]（近→远）
  // 目标宿主：z1 层（chain[3]）和 mx-auto 层（chain[5]）
  const hosts = []
  const addHost = (el, id) => { const c2 = clone.cloneNode(true); c2.dataset.host = id; Object.assign(c2.style, { position: 'absolute', left: '20px', top: '20px' }); el.appendChild(c2); hosts.push({ id, top: el.getBoundingClientRect().top + 20 }) }
  return { chainNames: chain.map(c => c.tagName + '.' + (typeof c.className === 'string' ? c.className.split(' ')[0] : '')) }
})
console.log('链:', JSON.stringify(setup.chainNames))
await b.close()
