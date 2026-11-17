// 完整用户流程：连续点击多个格 + 打字 + 滚动后点击（真实场景矩阵）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)

const clickCell = async (idx) => {
  const box = await p.evaluate((i) => { const tds = [...document.querySelectorAll('td')]; const td = tds[i]; if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, vis: r.y > 40 && r.y < 870 } }, idx)
  if (!box || !box.vis) return { skip: true }
  const before = await p.evaluate(() => document.querySelector('.overflow-auto').scrollTop)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(700)
  return await p.evaluate((beforeTop) => {
    const v = window.__pmView
    const sel = v.state.selection
    const $p = v.state.doc.resolve(sel.from)
    let inCell = false
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'table_cell') { inCell = true; break }
    const top = document.querySelector('.overflow-auto').scrollTop
    return { from: sel.from, inCell, jump: Math.abs(top - beforeTop) > 50 }
  }, before)
}
// 点击 td6 → td8 → td5（不同格）
console.log('点击 td[6]:', JSON.stringify(await clickCell(6)))
console.log('点击 td[8]:', JSON.stringify(await clickCell(8)))
console.log('点击 td[5]:', JSON.stringify(await clickCell(5)))
// 打字
await p.keyboard.type('Z9', { delay: 70 })
await p.waitForTimeout(500)
console.log('打字后 td[5]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][5]?.textContent?.slice(0, 20))))
console.log('doc 完整:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return { top: a.slice(0, 3), total: a.length, hasTable: a.includes('table') } })))
await b.close()
