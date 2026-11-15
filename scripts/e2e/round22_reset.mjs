// 监听 scrollTop 重置者：拦截 scrollTo/赋值 + MutationObserver
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
const info = await p.evaluate(() => {
  const pm = window.__pmView.dom
  let sc = null
  let n = pm.parentElement
  while (n) {
    const s = getComputedStyle(n)
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll')) { sc = n; break }
    n = n.parentElement
  }
  // hook scrollTop setter
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  window.__scResets = []
  Object.defineProperty(sc, 'scrollTop', {
    get() { return desc.get.call(this) },
    set(v) {
      const cur = desc.get.call(this)
      if (Math.abs(v - cur) > 50 && window.__scResets.length < 12) {
        window.__scResets.push({ to: Math.round(v), from: Math.round(cur), stack: new Error().stack.split('\n').slice(1, 5).join(' | ').slice(0, 260) })
      }
      return desc.set.call(this, v)
    },
    configurable: true,
  })
  // scrollTo 也拦
  const origST = sc.scrollTo.bind(sc)
  sc.scrollTo = (...args) => {
    const y = typeof args[0] === 'object' ? args[0].top : args[1]
    if (window.__scResets.length < 12) window.__scResets.push({ to: y, via: 'scrollTo', stack: new Error().stack.split('\n').slice(1, 4).join(' | ').slice(0, 200) })
    return origST(...args)
  }
  window.__realSc = sc
  return { found: !!sc, cls: sc ? String(sc.className) : null }
})
console.log('真实滚动容器:', JSON.stringify(info))
await p.evaluate(() => window.__realSc.scrollTo({ top: 10230 }))
await p.waitForTimeout(3000)
const resets = await p.evaluate(() => window.__scResets.slice())
console.log('滚动操作记录:')
resets.forEach(r2 => console.log('  ', JSON.stringify(r2)))
const final = await p.evaluate(() => ({ st: window.__realSc.scrollTop }))
console.log('最终 scrollTop:', JSON.stringify(final))
await b.close()
