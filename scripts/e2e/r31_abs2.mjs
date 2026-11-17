import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
// 页面度量 + Abstract 段行位置 + 断点装饰状态
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const paras = [...pm.querySelectorAll('p')]
  const abs = paras.find(x => (x.textContent || '').includes('Abstract'))
  // pm 的 padding-top（内容盒 vs 纸页坐标系检查）
  const cs = getComputedStyle(pm)
  // Abstract 段的行顶分布（文本 range 行）
  const walker = document.createTreeWalker(abs, NodeFilter.SHOW_TEXT)
  let n
  const lineTops = []
  while ((n = walker.nextNode())) {
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.width > 2 && r.height > 2) {
        const top = Math.round(r.top - pmr.top)
        if (!lineTops.includes(top)) lineTops.push(top)
      }
    }
  }
  lineTops.sort((a, b2) => a - b2)
  // 段内是否有 pg-linebreak widget
  const lbs = abs.querySelectorAll('.pg-linebreak')
  return {
    pmPaddingTop: cs.paddingTop, pmMarginTop: cs.marginTop,
    absTop: Math.round(abs.getBoundingClientRect().top - pmr.top),
    lineTops: lineTops.slice(0, 20),
    lineCount: lineTops.length,
    lbInAbs: lbs.length,
    lbStyles: [...lbs].map(l => l.style.marginTop),
    // 全局：pg-linebreak 总数
    lbTotal: pm.querySelectorAll('.pg-linebreak').length,
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
