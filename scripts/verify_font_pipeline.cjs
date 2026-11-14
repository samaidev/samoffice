const fs = require('fs')
const { tablesToSheets } = require('./.openroute-build/openroute.js')
const doc = JSON.parse(fs.readFileSync(__dirname + '/fixtures/fontcheck.udm.json', 'utf8'))
const sheets = tablesToSheets(doc)
const cells = sheets[0].cells

// key 语义: "r-c" = 第 r 行第 c 列（0 基）。对应 Excel:
//   0-0=A1 宋体标题(bold,18,红,黄底,center)  1-0=A2 下划线红字(宋体,right)
//   0-1=B1 微软雅黑(italic,12,绿底,left)     1-1=B2 删除线(等线,center)
//   0-2=A3 大字号黄底(黑体,22,黄底,center)   1-2=B3 普通 Calibri(11,left)
function check(key, want) {
  const got = cells[key]
  if (!got) { console.error('FAIL ' + key + ' 缺失'); return false }
  let ok = true
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) { console.error('FAIL ' + key + '.' + k + ' = ' + JSON.stringify(got[k]) + ' 期望 ' + JSON.stringify(v)); ok = false }
  }
  if (ok) console.log('PASS ' + key + ' -> ' + JSON.stringify(got))
  return ok
}

let all = true
all = check('0-0', { value: '宋体标题', fontFamily: '宋体', bold: true, fontSize: 18, color: '#FF0000', align: 'center', bg: '#FFFF00' }) && all
all = check('0-1', { value: '微软雅黑', fontFamily: '微软雅黑', italic: true, fontSize: 12, align: 'left', bg: '#C6EFCE' }) && all
all = check('1-0', { value: '下划线红字', fontFamily: '宋体', under: true, color: '#FF0000', align: 'right' }) && all
all = check('1-1', { value: '删除线', fontFamily: '等线', strike: true, align: 'center' }) && all
all = check('2-0', { value: '大字号黄底', fontFamily: '黑体', fontSize: 22, bg: '#FFFF00', align: 'center' }) && all
all = check('2-1', { value: '普通 Calibri', fontFamily: 'Calibri', fontSize: 11, align: 'left' }) && all

process.exit(all ? 0 : 1)
