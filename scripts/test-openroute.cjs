// 自动化测试：用真实解析器产出的 UDM JSON 跑 openroute 的路由逻辑（与 App 内同一份代码）。
// 目的：回归验证“右键打开 xls/xlsx/csv 应进入表格视图，而不是 Word/文档视图”。
const fs = require('fs')
const path = require('path')

const or = require('./.openroute-build/openroute.js')

const fix = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'))
const sheet = fix('sheet.json')
const csv = fix('csv.json')
const doc = fix('doc.json')
const styled = fix('styled.json')

let pass = 0, fails = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg) }
  else { fails++; console.error('  FAIL  ' + msg) }
}

console.log('[1] xlsx -> 表格视图')
const d1 = or.decideOpen('test_sheet.xlsx', sheet)
assert(d1.tab === 'spreadsheet', 'xlsx 路由到 spreadsheet（不是 document/Word 视图）')
assert(Array.isArray(d1.sheets) && d1.sheets.length === 1, 'xlsx 产出 1 个 sheet')
assert(d1.sheets[0].name === 'Sheet1', 'sheet 名称为 Sheet1')
const c1 = d1.sheets[0].cells
assert(c1['0-0'] && c1['0-0'].value === '姓名', 'A1 = 姓名')
assert(c1['1-0'] && c1['1-0'].value === '张三', 'A2 = 张三')
assert(c1['0-1'] && c1['0-1'].value === '分数', 'B1 = 分数')
assert(c1['1-1'] && c1['1-1'].value === '90', 'B2 = 90')

console.log('[2] csv -> 表格视图')
const d2 = or.decideOpen('data.csv', csv)
assert(d2.tab === 'spreadsheet', 'csv 路由到 spreadsheet')
assert(d2.sheets[0].cells['0-0'].value === '姓名', 'csv A1 = 姓名')

console.log('[3] docx -> 文档视图（负例）')
const d3 = or.decideOpen('test_startup.docx', doc)
assert(d3.tab === 'document', 'docx 路由到 document')

console.log('[4] 扩展名判定')
assert(or.isSpreadsheetPath('a.XLSX'), '.XLSX 识别为表格')
assert(or.isSpreadsheetPath('a.xls'), '.xls 识别为表格')
assert(or.isSpreadsheetPath('a.CSV'), '.CSV 识别为表格')
assert(!or.isSpreadsheetPath('a.docx'), '.docx 不识别为表格')

console.log('[5] 样式透传（粗体/颜色/对齐/填充/斜体）')
const d5 = or.decideOpen('test_styled.xlsx', styled)
assert(d5.tab === 'spreadsheet', 'styled xlsx 路由到 spreadsheet')
const sc = d5.sheets[0].cells
assert(sc['0-0'].value === '姓名', 'A1 文本=姓名')
assert(sc['0-0'].bold === true, 'A1 粗体已透传')
assert(sc['0-0'].color === '#FF0000', 'A1 字体红色 #FF0000 已透传')
assert(sc['0-0'].align === 'center', 'A1 居中对齐已透传')
assert(sc['0-0'].bg === '#FFFF00', 'A1 黄色填充 #FFFF00 已透传')
assert(sc['1-1'].value === '95', 'B2 文本=95')
assert(sc['1-1'].italic === true, 'B2 斜体已透传')
assert(sc['1-1'].align === 'right', 'B2 右对齐已透传')

console.log(`\n结果: ${pass} 通过, ${fails} 失败`)
process.exit(fails ? 1 : 0)
