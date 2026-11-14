const fs = require('fs')
const path = require('path')
const { tablesToSheets } = require('./.openroute-build/openroute.js')
console.log('dir=', __dirname)
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fontcheck.udm.json'), 'utf8'))
const sheets = tablesToSheets(doc)
const cells = sheets[0].cells

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let rows = ''
for (let r = 0; r <= 2; r++) {
  let tds = ''
  for (let c = 0; c <= 1; c++) {
    const cell = cells[`${r}-${c}`] || { value: '' }
    const deco = [cell.under ? 'underline' : '', cell.strike ? 'line-through' : ''].filter(Boolean).join(' ')
    const style = [
      `color:${cell.color || 'inherit'}`,
      `font-weight:${cell.bold ? 700 : 400}`,
      `font-style:${cell.italic ? 'italic' : 'normal'}`,
      `text-align:${cell.align || 'left'}`,
      `text-decoration:${deco || 'none'}`,
      `font-size:${cell.fontSize ? cell.fontSize + 'px' : 'inherit'}`,
      `font-family:${cell.fontFamily ? `"${cell.fontFamily}", serif` : 'inherit'}`,
      `background:${cell.bg || 'transparent'}`,
      `border:1px solid #d8dee9`,
      `padding:6px 8px`,
      `min-width:160px`,
    ].join(';')
    tds += `<td style="${style}">${escape(cell.value || '')}</td>`
  }
  rows += `<tr>${tds}</tr>`
}

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<body style="font-family:system-ui,sans-serif">
<h3>Excel 单元格真实渲染（样式已应用到 DOM style）</h3>
<table style="border-collapse:collapse"><tbody>${rows}</tbody></table>
<p style="color:#070;font-size:12px">A1 宋体红字加粗黄底 / B1 微软雅黑斜体绿底 / A2 宋体下划线红字右对齐 / B2 等线删除线 / A3 黑体大字号黄底 / B3 Calibri —— 即证明字体/样式已修复。</p>
</body></html>`

const out = path.join(__dirname, 'excel-render-demo.html')
fs.writeFileSync(out, html)
console.log('written', out, 'exists=', fs.existsSync(out))
