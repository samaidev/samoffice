// td[6]/td[8] 点击进格 ✓ 但 td[8] 点击后 jump:true（页面跳）且 td[5] skip
//（跳走后表格移出视口）—— 「跳」的原因：我们的 applySel dispatch 用了
// scrollIntoView？查 tablePlugins 里的 dispatch —— 行拖拽才有 scrollIntoView。
// 点击代理的 applySel：v.dispatch(tr.setSelection(...)) 无 scrollIntoView
// —— 但补刀后 focus() → PM 对 focus 的默认处理可能滚到 selection —— 
// 若 selection 格在视口边缘（表格下缘的 td[8]），PM 把它滚到视口内 ——
// 这是【合理】的滚动（光标可见性）—— 但用户感知为「页面移动」。
// 真正要修的：①td[5] skip 后点不到（跳走后表格出视口——用户得滚回来）
// ②确认跳的幅度。先量化 td[8] 的跳变与最终视口状态：
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
const click = async (idx) => {
  const box = await p.evaluate((i) => { const tds = [...document.querySelectorAll('td')]; const td = tds[i]; if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, vis: r.y > 40 && r.y < 870 } }, idx)
  if (!box || !box.vis) return { skip: true, reason: box ? 'offscreen' : 'noidx' }
  const before = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop }))
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(700)
  return await p.evaluate((bt) => {
    const top = document.querySelector('.overflow-auto').scrollTop
    const sel = window.__pmView.state.selection
    const $p = window.__pmView.state.doc.resolve(sel.from)
    let inCell = false
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'table_cell') { inCell = true; break }
    return { from: sel.from, inCell, before: bt, after: top, delta: top - bt }
  }, before.top)
}
console.log('td[6]:', JSON.stringify(await click(6)))
console.log('td[8]:', JSON.stringify(await click(8)))
console.log('td[8] 再点:', JSON.stringify(await click(8)))
console.log('td[5]:', JSON.stringify(await click(5)))
await b.close()
