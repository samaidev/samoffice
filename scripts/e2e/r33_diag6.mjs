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
await p.waitForTimeout(1000)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const proxy = document.querySelector('.pm-table-clickproxy')
  const host = proxy?.parentElement
  const wrapper = document.querySelector('.tableWrapper')
  const chain = []
  let cur = wrapper
  while (cur && chain.length < 8) {
    const cs = getComputedStyle(cur)
    chain.push({
      tag: cur.tagName, cls: (cur.className || '').toString().slice(0, 40),
      pos: cs.position, overflowY: cs.overflowY.slice(0, 12),
      h: Math.round(cur.getBoundingClientRect().height),
      scrollH: cur.scrollHeight, top: Math.round(cur.getBoundingClientRect().y),
    })
    cur = cur.parentElement
  }
  const proxyCs = host ? getComputedStyle(host) : null
  return {
    hostTag: host?.tagName, hostCls: (host?.className || '').toString().slice(0, 50),
    hostPos: proxyCs?.position, hostOverflow: proxyCs?.overflow,
    hostRect: host ? { y: Math.round(host.getBoundingClientRect().y), h: Math.round(host.getBoundingClientRect().height), scrollH: host.scrollHeight } : null,
    proxyIsChildOfHost: host?.contains(proxy),
    hostContainsPm: host?.contains(pm),
    wrapperChain: chain,
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
