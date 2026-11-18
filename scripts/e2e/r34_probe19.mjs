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
const out = await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  // 找同深度的活段落
  let pEl = null
  for (const el of document.querySelectorAll('.ProseMirror > p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 400 && r.y < 700) { pEl = el; break }
  }
  const dump = (el, name) => {
    if (!el) return name + ': null'
    const cs = getComputedStyle(el)
    return name + ': attrs=[' + Array.from(el.attributes).map(a => a.name + '=' + a.value.slice(0, 20)).join(' ') + '] ' +
      'pos=' + cs.position + ' contClip=' + cs.contain + ' willChange=' + cs.willChange + ' contentVis=' + cs.contentVisibility + ' overflow=' + cs.overflow + ' transform=' + (cs.transform === 'none' ? '-' : cs.transform.slice(0, 20))
  }
  // 祖先链对照（从 wrapper 到 scroller vs 从 p 到 scroller）
  const chain = (el) => {
    const arr = []
    let cur = el
    while (cur && cur !== document.body) { arr.push(cur.tagName + '.' + (typeof cur.className === 'string' ? cur.className.split(' ')[0] : '') + '[' + (cur.getAttribute('style') || '').slice(0, 40) + ']'); cur = cur.parentElement }
    return arr
  }
  return {
    wrapper: dump(wrap, 'wrapper'),
    para: dump(pEl, 'para'),
    wrapChain: chain(wrap).slice(0, 7),
    paraChain: chain(pEl).slice(0, 7),
    // 表格内部首 td 的 computed
    td: dump(document.querySelector('table td'), 'td'),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
