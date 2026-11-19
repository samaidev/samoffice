// r42 诊断2：高频采样验证 heal×verifyPass 振荡假设
// 100ms 采样 12s：__pg 更新时间戳、图片段 top 轨迹、dispatch 活动、
// 页间空白带内块顶。另加"滚动到页13/14"（用户场景：跳到问题页观看）。
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400/?r42b=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => { localStorage.setItem('samoffice_show_marks', '1') })
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

// 找滚动容器并滚到页13（用户视角：跳到图片所在页）
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  let el = pm
  while (el && el.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) break; el = el.parentElement }
  // 页13 内容区顶 ≈ 13*1157=15041 布局 px
  el.scrollTo(0, 15041 - 100)
})
await p.waitForTimeout(500)

// 高频采样 12s（含滚动后的静止期）
const samples = []
for (let i = 0; i < 120; i++) {
  const snap = await p.evaluate(() => {
    const pg = (window).__pg
    const pm = document.querySelector('.ProseMirror')
    if (!pg || !pm) return null
    const pmTop = pm.getBoundingClientRect().top
    const kids = [...pm.children]
    const step = pg.pageStep, per = pg.per
    // 图片段轨迹
    const imgs = []
    kids.forEach((el, k) => {
      if (el.querySelector && el.querySelector('img')) {
        const r = el.getBoundingClientRect()
        imgs.push({ k, top: Math.round((r.top - pmTop) * 10) / 10, page: pg.blocks[k] ? pg.blocks[k].page : -1 })
      }
    })
    // 页间空白带内的块顶（heal 触发条件）
    const inBlank = []
    kids.forEach((el, k) => {
      const r = el.getBoundingClientRect()
      const bt = (r.top - pmTop) / 1
      const rr = bt % step
      if (rr > per + 0.5 && rr < step - 0.5) inBlank.push(k)
    })
    // pg-linebreak widget 数量（装饰是否在变）
    const wcount = pm.querySelectorAll('.pg-linebreak').length
    return { imgs, inBlank, wcount, lb: pg.lineBreaks, bb: pg.blockBreaks }
  })
  if (snap) samples.push(snap)
  await p.waitForTimeout(100)
}

// 分析：图片段轨迹是否有 >2px 的来回变化
console.log('采样数:', samples.length)
const sigs = samples.map(s => s.imgs.map(i => `${i.k}:${i.top}/${i.page}`).join(' '))
const uniq = new Set(sigs)
console.log('图片段状态唯一值数:', uniq.size, uniq.size > 1 ? '⚠️ 有变化' : '(完全稳定)')
if (uniq.size > 1) {
  console.log('\n轨迹明细（每 5 采样）:')
  for (let i = 0; i < samples.length; i += 5) console.log(' ', sigs[i])
}
// widget 数量/断点数变化
const ws = new Set(samples.map(s => s.wcount)), lbs = new Set(samples.map(s => s.lb)), bbs = new Set(samples.map(s => s.bb))
console.log('widget数集合:', [...ws].join(','), 'lineBreaks集合:', [...lbs].join(','), 'blockBreaks集合:', [...bbs].join(','))
// 空白带块
const blanks = new Set(samples.flatMap(s => s.inBlank))
console.log('曾落入页间空白带的块:', [...blanks].join(', ') || '(无)')
// heal 活动迹象：空白带块数随时间变化即 heal 在反复触发
const blankTraj = samples.map(s => s.inBlank.length).join('')
console.log('空白带块数轨迹:', blankTraj.replace(/(.)\1{9,}/g, m => m[0] + '×' + m.length))
console.log('pageerror:', errs.length)
await b.close()
