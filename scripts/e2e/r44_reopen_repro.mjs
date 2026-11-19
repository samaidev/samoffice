// r44：用户报告两 bug（保存后重开）
// ① 缩放变成 1%，必须手动调回 100%
// ② 页码双行：第一行"第 页"（footer.text 误收域两侧文本），第二行"第 x 页"
// 复现路径：__setDocForTest 模拟打开带 pageNumber+footer 的 UDM（= 保存→重开后的状态），
// 观察：缩放显示值、纸页内页脚行数。
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
await p.goto('http://localhost:18400/?r44=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

// 模拟"保存→重开"后的 UDM：带 pageNumber + footer.text="第  页"（v0.7.25 重开时的实际状态）
// 模拟【旧版污染过的历史文件】重开状态：footer.text 被误收 + zoom=1 的异常窗口快照
const REOPENED = {
  ...DOC,
  pageNumber: { enabled: true, format: '第 {n} 页', align: 'center' },
  footer: { text: '第  页', align: 'center', fontSize: 9 },
}
await p.evaluate(d => window.__setDocForTest(d), REOPENED)
await p.waitForTimeout(3500)

// ① 缩放值
const zoomVal = await p.evaluate(() => {
  const inp = document.querySelector('input[title*="缩放"], input.ranger, .zoom-input')
  const z = window.__docZoom
  return { docZoom: z, inputVal: inp ? inp.value : null }
})
console.log('① window.__docZoom =', zoomVal.docZoom, '(1 = 100%)；输入框 =', zoomVal.inputVal)

// ② 页脚双行
const footerLines = await p.evaluate(() => {
  // 只统计【自身直接文本】匹配页脚样式的 div（排除父容器拼接文本）
  const out = []
  document.querySelectorAll('div').forEach(d => {
    const direct = [...d.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    if (/^第\s*\d*\s*页$/.test(direct) && direct) out.push(direct)
  })
  return [...new Set(out)]
})
console.log('② 独立页脚行:', JSON.stringify(footerLines.slice(0, 3)), '（应为纯「第 x 页」单行）')
const dbl = footerLines.some(t => !/\d/.test(t))
console.log(dbl ? '★ 仍有无页码行（双行）' : '✓ 双行已修复：只剩带页码的单行')

// ③ localStorage 的 zoom 键
const ls = await p.evaluate(() => localStorage.getItem('samoffice_zoom'))
console.log('③ localStorage samoffice_zoom =', ls)

await p.screenshot({ path: path.join(__dirname, 'shots-r44/reopen-state.png'), fullPage: false })
await b.close()
console.log('pageerror:', errs.length ? errs : '无')
