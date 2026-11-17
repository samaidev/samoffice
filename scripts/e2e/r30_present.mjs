// round30 E2E：打开 pptx →
// 1) 编辑态截图第 1 页（画布 clip）
// 2) 进入放映（View → 放映按钮/F5?）→ 键盘 →/回车 翻页 → 截图第 1/2 页
// 3) 像素对比：编辑 vs 放映第 1 页应高度一致（同构渲染）
// 4) 键盘切页验证：放映态按 → 后 pager 变化；编辑态按 ←/→ 后 pager 变化
import { chromium } from 'playwright'
import fs from 'fs'
const FILE_FETCH = '/upload-test.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)

const findCanvas = () => p.evaluate(() => {
  let c = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  if (!c) c = [...document.querySelectorAll('div')].find(d => { const r = d.getBoundingClientRect(); return Math.round(r.width) === 808 && r.height > 500 })
  if (!c) return null
  const r = c.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})
const pager = () => p.evaluate(() => {
  const m = (document.body.textContent || '').match(/(\d+) \/ (\d+)/)
  return m ? m[1] : null
})

// ---------- 1) 编辑态第 1 页截图 ----------
const c1 = await findCanvas()
if (c1 && c1.w > 100) {
  await p.screenshot({ path: '/tmp/r30_edit_p1.png', clip: { x: c1.x, y: c1.y, width: c1.w, height: c1.h } })
} else {
  console.log('编辑态画布丢失:', JSON.stringify(c1))
  await p.screenshot({ path: '/tmp/r30_edit_p1.png' })
}
console.log('编辑态画布:', JSON.stringify(c1))

// ---------- 2) 键盘切页（编辑模式）----------
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(600)
const pagerAfterArrow = await pager()
console.log('编辑态按 → 后 pager:', pagerAfterArrow, pagerAfterArrow === '2' ? '✓' : '✗')
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(600)
const pagerBack = await pager()
console.log('编辑态按 ← 后 pager:', pagerBack, pagerBack === '1' ? '✓' : '✗')

// ---------- 3) 进入放映 ----------
// View 标签下的放映按钮（找 Slide Show / 放映 文本）
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(500)
const started = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const sb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))
  if (sb) { sb.click(); return sb.textContent.slice(0, 15) }
  return null
})
console.log('放映按钮:', JSON.stringify(started))
await p.waitForTimeout(1500)

// 放映态截图第 1 页（找到 scale 容器内的 808 宽幻灯片）
const present1 = await p.evaluate(() => {
  const cands = [...document.querySelectorAll('div')].filter(d => { const r = d.getBoundingClientRect(); return Math.round(r.width) >= 700 && Math.round(r.width) <= 900 && r.height > 500 })
  const c = cands[cands.length - 1]
  if (!c) return null
  const r = c.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(c).backgroundColor }
})
console.log('放映态画布:', JSON.stringify(present1))
if (present1 && present1.w > 100) {
  await p.screenshot({ path: '/tmp/r30_present_p1.png', clip: { x: present1.x, y: present1.y, width: present1.w, height: present1.h } })
} else {
  console.log('放映态画布丢失:', JSON.stringify(present1))
}

// ---------- 4) 放映态键盘导航 ----------
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(800)
const pPager1 = await p.evaluate(() => {
  const els = [...document.querySelectorAll('span')].filter(s => /^\d+ \/ \d+$/.test((s.textContent || '').trim()) && s.offsetParent !== null)
  return els.length ? els[els.length - 1].textContent.trim() : null
})
console.log('放映态按 → 后:', pPager1)
await p.keyboard.press('Enter')
await p.waitForTimeout(800)
const pPager2 = await p.evaluate(() => {
  const els = [...document.querySelectorAll('span')].filter(s => /^\d+ \/ \d+$/.test((s.textContent || '').trim()) && s.offsetParent !== null)
  return els.length ? els[els.length - 1].textContent.trim() : null
})
console.log('放映态按回车后:', pPager2)
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(800)
const pPager3 = await p.evaluate(() => {
  const els = [...document.querySelectorAll('span')].filter(s => /^\d+ \/ \d+$/.test((s.textContent || '').trim()) && s.offsetParent !== null)
  return els.length ? els[els.length - 1].textContent.trim() : null
})
console.log('放映态按 ← 后:', pPager3)
await p.keyboard.press('Escape')
await p.waitForTimeout(800)
const exited = await p.evaluate(() => !document.querySelector('.fixed.inset-0'))
console.log('Esc 退出放映:', exited ? '✓' : '✗')
await b.close()
console.log('DONE')
