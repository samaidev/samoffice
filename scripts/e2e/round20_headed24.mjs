// 死区 ≈ 视口 y>230（scroller 顶 215 之下）—— 点段落 y=455 却 HIT！
// 除非那次也是 Playwright 自动滚动帮忙。检查段落试验的 y：headed6 beforePt y=455
// 且成功 —— 矛盾！唯一区别：段落 vs 表格 —— 不，st=0 时 tdY=410 是【表格】
// 但【下面没有别的内容】（单行表文档末尾）…… 
// 等等 —— st=0 tdY=410 MISS，但 headed6 点 y=455 段落 HIT。
// 410<455 —— 不是纯 y 阈值！重新想：
// st=0..150 MISS 时 tdY=410..260；st=200..400 HIT 时 tdY=210..10。
// HIT 的共同点：tdY < 215 ≈ scroller 顶！？不 —— td 在 scroller 内部，
// tdY 是视口坐标必须 >215（scroller 顶）才可见…… 但 tdY=10 <215？？?
// 说明 scrollTop=400 时 scroller 顶部本身【被滚上去了】？scroller 是
// flex-1 overflow-auto —— 它自己不滚。除非【外层 body 滚了】！
// tdY=10 → 表格在 scroller 顶上方？不可能。
// —— 直接 dump st=400 时的几何：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
const blocks = j.document.blocks
const tableIdx = blocks.findIndex(bl => bl.rows)
const oneRow = { ...j.document, blocks: [{ ...blocks[tableIdx], rows: [blocks[tableIdx].rows[0]] }] }
await p.evaluate(d => window.__setDocForTest(d), oneRow)
await p.waitForTimeout(2500)
for (const st of [0, 200, 400]) {
  await p.evaluate(v => { document.querySelector('.flex-1.overflow-auto').scrollTop = v }, st)
  await p.waitForTimeout(600)
  const geo = await p.evaluate(() => {
    const sc = document.querySelector('.flex-1.overflow-auto')
    const td = document.querySelector('.ProseMirror table td')
    return {
      scRect: (() => { const r = sc.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) } })(),
      tdY: Math.round(td.getBoundingClientRect().y),
      scScrollTop: sc.scrollTop,
      bodyScrollY: window.scrollY,
      // 关键：有没有第二个滚动容器在滚？
      otherScrollers: Array.from(document.querySelectorAll('*')).filter(el => el.scrollTop > 0).slice(0, 3).map(el => el.tagName + '.' + (el.className?.toString().slice(0, 20) || '') + ':' + el.scrollTop),
    }
  })
  console.log('st=' + st + ':', JSON.stringify(geo))
}
await b.close()
