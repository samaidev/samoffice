// 观察 pagination 振荡：连续记录每次 dispatch 的签名差
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(6000)
await p.evaluate(() => {
  window.__pgSigs = []
  const pm = window.__pmView
  const orig = pm.dispatch.bind(pm)
  pm.dispatch = (tr) => {
    if (tr.meta && 'pagination$' in tr.meta) {
      // 记录签名（装饰数量）
      const decos = tr.meta['pagination$']
      try {
        const found = decos.find()
        const styles = found.map(d => (d.type?.attrs?.style || d.type?.spec?.style || '')).slice(0, 5)
        window.__pgSigs.push({ n: found.length, styles: styles.join('§').slice(0, 200) })
      } catch { window.__pgSigs.push({ err: 1 }) }
    }
    return orig(tr)
  }
})
const pt = await p.evaluate(() => {
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 300 && r.y < 600 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
  }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(400)
await p.evaluate(() => { window.__pgSigs = [] })
await p.keyboard.type('a', { delay: 100 })
await p.waitForTimeout(2500)
const sigs = await p.evaluate(() => window.__pgSigs.slice(0, 6))
console.log('单键 pagination dispatch 数:', sigs.length)
console.log('前 6 次签名（看差异源）:')
sigs.forEach((s, i) => console.log(`  #${i}: n=${s.n} styles=${(s.styles||'').slice(0,120)}`))
await b.close()
