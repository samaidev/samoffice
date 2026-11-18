// round38 诊断 v2：定位 B（编辑后不跟随）与 C（滚动后不对齐）的根因
// 疑点：
//  1. 锚点y=376 卡片y=337 —— 静态就差 39px？round35 为何过？（其对齐容差 80px 可能掩盖）
//  2. B：Enter 30 次可能没进入编辑器（焦点不在 PM）→ 锚点根本没动
//  3. C：滚动后 0/5 —— 布局 effect 是否根本没触发？还是 sticky 坐标系 bug？
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/comments_doc.udm.json'), 'utf-8'))
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))

await p.goto(BASE + '/?r38b=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

const probe = (pid) => p.evaluate(id => {
  const m = document.querySelector(`.comment-mark[data-comment-id="${id}"]`)
  const c = document.getElementById(`comment-card-${id}`)
  const pane = document.querySelector('.comments-pane')
  const svg = document.querySelector('.comment-links-layer')
  const pathEl = svg?.querySelector('path')
  return {
    markTop: m ? Math.round(m.getBoundingClientRect().top) : null,
    cardTop: c ? Math.round(c.getBoundingClientRect().top) : null,
    cardStyleTop: c ? c.style.top : null,
    paneScrollTop: pane ? Math.round(pane.scrollTop) : null,
    paneRectTop: pane ? Math.round(pane.getBoundingClientRect().top) : null,
    linkD: pathEl ? pathEl.getAttribute('d') : null,
  }
}, pid)

const p1 = await probe('c1')
console.log('稳态 c1:', JSON.stringify(p1))

// --- B: 点击 PM 获得真实焦点再 Enter（force：元素在动画/重排中不稳定）---
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(300)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(1800)
const p2 = await probe('c1')
console.log('Enter30 后 c1:', JSON.stringify(p2))
const moved = p2.markTop !== null && p1.markTop !== null && p2.markTop !== p1.markTop
console.log('B 锚点移动:', moved ? '是（真实编辑）' : '否（编辑未生效——焦点问题，非产品bug）')
if (moved) {
  const followed = p2.cardTop !== null && Math.abs(p2.markTop - p2.cardTop) < 80
  console.log('B 卡片跟随:', followed ? '✓' : `✗ (mark=${p2.markTop} card=${p2.cardTop})`)
}

// --- C: 滚动 —— 抓 scroll 事件期间 sticky 面板与锚点的联动 ---
const sc = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let el = pane?.parentElement
  while (el && el.tagName !== 'HTML') {
    const st = getComputedStyle(el)
    if (/(auto|scroll)/.test(st.overflowY)) return { found: true, cls: el.className, scrollable: el.scrollHeight > el.clientHeight + 4 }
    el = el.parentElement
  }
  return { found: false }
})
console.log('C 滚动容器:', JSON.stringify(sc))
const p3a = await probe('c7') // 最后一条（远页）
await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let el = pane?.parentElement
  while (el && el.tagName !== 'HTML') {
    const st = getComputedStyle(el)
    if (/(auto|scroll)/.test(st.overflowY)) { el.scrollTop += 600; break }
    el = el.parentElement
  }
})
await p.waitForTimeout(600)
const p3b = await probe('c7')
console.log('C 滚600后 c7:', JSON.stringify(p3b))
console.log('C 判定: mark移动', p3a.markTop !== p3b.markTop ? '✓' : '✗未动',
  '| card移动', p3a.cardTop !== p3b.cardTop ? '✓' : '✗未动',
  '| 对齐', p3b.markTop !== null && Math.abs(p3b.markTop - p3b.cardTop) < 80 ? '✓' : `✗(mark=${p3b.markTop} card=${p3b.cardTop})`)
await b.close()
