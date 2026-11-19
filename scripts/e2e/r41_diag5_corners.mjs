// r41 诊断5：激活显示标记 → 对照四角直角位置 vs 真实内容区（PM rect vs 纸页+边距）
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?r41d5=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4500)

// 激活显示标记
await p.evaluate(() => {
  localStorage.setItem('samoffice_show_marks', '1')
  location.reload()
})
await p.waitForTimeout(1500)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(5000)
console.log('显示标记:', await p.evaluate(() => localStorage.getItem('samoffice_show_marks')))

const out = await p.evaluate(() => {
  const papers = [...document.querySelectorAll('.pg-paper')]
  const pm = document.querySelector('.ProseMirror')
  const pr = pm.getBoundingClientRect()
  const p0 = papers[0].getBoundingClientRect()
  const p1 = papers[1] ? papers[1].getBoundingClientRect() : null
  // 四角直角 span（显示标记激活后渲染）
  const corners = [...papers[0].querySelectorAll('span')].filter(s => s.style.borderTopWidth || s.style.borderBottomWidth)
  const cRects = corners.map(c => {
    const r = c.getBoundingClientRect()
    return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), pos: c.style.top || ('b:' + c.style.bottom) }
  })
  // PM 内容区（首屏可视部分）：pm 是流式长条 —— 内容区 x 范围恒定，y 每页重复
  // 直角每页一组 —— 取纸页 0 的角标 vs pm 内容列范围
  return {
    pmRect: { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), width: Math.round(pr.width) },
    paper0: { left: Math.round(p0.left), right: Math.round(p0.right), top: Math.round(p0.top), bottom: Math.round(p0.bottom) },
    paper1: p1 ? { top: Math.round(p1.top), bottom: Math.round(p1.bottom) } : null,
    corners: cRects,
    marksClass: document.querySelector('.show-marks') != null,
  }
})
console.log(JSON.stringify(out, null, 1))
console.log('pageerror:', errs.length)
await b.close()
