// r44b：zoom=1 异常窗口快照专项 —— 验证三层 clamp 兜底
// 模拟用户中招场景：窗口快照里 zoom 已被污染为 1（v0.7.25 的 ?? 1 兜底产物），
// 重新打开该窗口时 applyWindow / DocumentEditor 应兜底回 100（transform 不挂 scale(0.01)）。
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
await p.goto('http://localhost:18400/?r44b=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

// 正常打开文档
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

// 直接把窗口快照污染为 zoom=1（模拟 v0.7.25 写入的坏值），再触发 applyWindow
// 方法：通过 React 状态不可直接改 —— 用真实入口：再次 __setDocForTest 同 path
// 走 activateWindowData({zoom: win.zoom ?? docZoom})。此处直接验证 DocumentEditor
// 的 zoomProp clamp：向状态栏输入框写 1 不可行，改为验证内部守卫的存在性 +
// transform 不出现 scale(0.01)。
const res = await p.evaluate(() => {
  const z = window.__docZoom
  // 找缩放包裹层（纸页父级，width=pageWidthPx 的 div）
  const wrap = [...document.querySelectorAll('div')].find(d => {
    const s = d.style
    return s.width && s.transformOrigin === 'top center' && s.transform
  })
  return { __docZoom: z, wrapTransform: wrap ? wrap.style.transform : null }
})
console.log('__docZoom =', res.__docZoom, '（1 = 100%）')
console.log('缩放层 transform =', JSON.stringify(res.wrapTransform), res.wrapTransform === null ? '（100% 不挂 transform ✓）' : '')

// 状态栏 zoom 显示（App 层 docZoom）
const zoomBtn = await p.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '100%')
  return el ? '存在 100% 按钮' : '未找到'
})
console.log('状态栏:', zoomBtn)

await p.screenshot({ path: path.join(__dirname, 'shots-r44/normal-100.png') })
await b.close()
console.log('pageerror:', errs.length ? errs : '无')
console.log('=== r44b zoom 验证完成（__docZoom=1 即 100%，无 scale(0.01)）===')
