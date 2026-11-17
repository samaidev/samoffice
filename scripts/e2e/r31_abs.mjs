import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(7000)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  // 找 Abstract 段落
  const paras = [...pm.querySelectorAll('p')]
  const abs = paras.find(x => (x.textContent || '').includes('Abstract'))
  if (!abs) return { err: 'no abstract' }
  const r = abs.getBoundingClientRect()
  // 段内行结构：文本节点行 + 内联子元素
  const kids = [...abs.querySelectorAll('*')].map(k => { const kr = k.getBoundingClientRect(); return { tag: k.tagName, cls: String(k.className).slice(0, 18), h: Math.round(kr.height), txt: (k.textContent || '').slice(0, 12) } }).filter(x => x.h > 0)
  // 段内文本行数（range rects）
  const walker = document.createTreeWalker(abs, NodeFilter.SHOW_TEXT)
  let n, lines = 0
  while ((n = walker.nextNode())) {
    const rg = document.createRange(); rg.selectNodeContents(n)
    lines += [...rg.getClientRects()].filter(x => x.width > 2 && x.height > 2).length
  }
  return {
    paraTop: Math.round(r.top - pmr.top), paraBottom: Math.round(r.bottom - pmr.top), paraH: Math.round(r.height),
    textLines: lines, inlineKids: kids.slice(0, 10),
    hasMath: !!abs.querySelector('.sam-math, svg, .math-inline'),
    hasImg: !!abs.querySelector('img'),
    hasFn: !!abs.querySelector('.footnote-ref, sup'),
    paraClass: String(abs.className).slice(0, 30),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
