// round31 探针：打开合同 docx，检查批注链路 + 表格点击光标 + 预览对齐 + 分页
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const FILE = '/test31.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async (fileUrl) => {
  const r = await fetch(fileUrl)
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
}, FILE)
await p.waitForTimeout(7000)

// ---------- 1) 批注探针 ----------
const probe = await p.evaluate(() => {
  const marks = [...document.querySelectorAll('.comment-mark')]
  const pane = document.querySelector('.comments-pane')
  const cards = document.querySelectorAll('.comment-card')
  return {
    marks: marks.length,
    firstMark: marks[0] ? { id: marks[0].getAttribute('data-comment-id'), author: marks[0].getAttribute('data-author'), text: (marks[0].getAttribute('data-text') || '').slice(0, 30), visible: marks[0].offsetParent !== null, w: marks[0].getBoundingClientRect().width } : null,
    paneExists: !!pane,
    paneVisible: pane ? pane.offsetParent !== null : false,
    cards: cards.length,
    firstCard: cards[0] ? (cards[0].textContent || '').slice(0, 50) : null,
  }
})
console.log('批注探针:', JSON.stringify(probe, null, 1))

// ---------- 2) 表格点击光标探针 ----------
const tblProbe = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const table = pm?.querySelector('table')
  if (!table) return { err: 'no table' }
  // 找一个多文字的单元格：第 2 行第 1 列（参数名）
  const cell = table.querySelectorAll('tr')[1]?.querySelectorAll('td,th')[0]
  if (!cell) return { err: 'no cell' }
  const txt = cell.textContent || ''
  // 该单元格第一个 text node 的长度
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  return { cellText: txt.slice(0, 40), firstLen: first ? first.textContent.length : 0 }
})
console.log('表格探针:', JSON.stringify(tblProbe))
await b.close()
console.log('DONE')
