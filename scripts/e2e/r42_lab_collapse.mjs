// r42 方案验证：断点 widget 防折叠手段的浏览器实测
// 候选A: padding-top（display:block height:0 —— padding 会不会被 height:0 压掉？）
// 候选B: border-top: Npx solid transparent（border 不折叠，天然 barrier）
// 候选C: margin-top + 父段 padding-top:0.02px barrier（侵入性最小）
// 实测每个方案：断点后内容是否精确位移 N px、自身是否引入额外高度、
// 段落行数是否不变（折叠是否被阻断）。
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?lab=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

const lab = await p.evaluate(() => {
  const results = {}
  const mkScene = (mode) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;font-size:14px;line-height:27px'
    // 模拟真实结构：前块 P（margin 12）+ 目标段 P（margin 12, 无 padding/border）
    const prev = document.createElement('p')
    prev.textContent = 'prev'
    prev.style.cssText = 'margin:12px 0'
    const para = document.createElement('p')
    para.style.cssText = 'margin:12px 0'
    const lb = document.createElement('span')
    lb.className = 'pg-linebreak'
    // 基础样式（对齐现有 CSS）
    lb.style.cssText = 'display:block;width:auto;height:0;min-height:0;margin-left:0;margin-right:0;padding:0;border:0;overflow:hidden;line-height:0;font-size:0;pointer-events:none'
    const line1 = document.createElement('span')
    line1.textContent = 'line-after-break'
    line1.style.cssText = 'font-size:14px;line-height:27px;display:block'
    para.appendChild(lb)
    para.appendChild(line1)
    host.appendChild(prev)
    host.appendChild(para)
    document.body.appendChild(host)
    // 注入推下量 200px
    if (mode === 'A') lb.style.paddingTop = '200px'
    else if (mode === 'B') lb.style.borderTop = '200px solid transparent'
    else if (mode === 'C') { lb.style.marginTop = '200px'; para.style.paddingTop = '0.02px' }
    else if (mode === 'base') lb.style.marginTop = '200px'
    const prevBottom = prev.getBoundingClientRect().bottom
    const lineTop = line1.getBoundingClientRect().top
    const paraTop = para.getBoundingClientRect().top
    const lbTop = lb.getBoundingClientRect().top
    const lbHeight = lb.getBoundingClientRect().height
    const r = { gap: Math.round(lineTop - prevBottom), paraTop: Math.round(paraTop - prevBottom), lbH: Math.round(lbHeight * 100) / 100 }
    host.remove()
    return r
  }
  for (const m of ['base', 'A', 'B', 'C']) results[m] = mkScene(m)
  return results
})
console.log('推下 200px 实测（gap=断点后行相对前块底的位移，期望精确 200+12margin=212 或 200）：')
for (const [m, r] of Object.entries(lab)) {
  console.log(`  ${m}: gap=${r.gap} paraTop=${r.paraTop} lbH=${r.lbH}`)
}
await b.close()
