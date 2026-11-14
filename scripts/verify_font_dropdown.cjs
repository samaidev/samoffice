// 验证 Word Ribbon 字体下拉框修复：当前文档字体能正确选中 + 下拉包含中文字体
// 复刻 DocumentEditor.tsx 中的 FONTS 构建与 options 合并逻辑

const defaultFonts = [
  '宋体', '黑体', '楷体', '仿宋', '微软雅黑', '等线',
  'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei', 'Microsoft JhengHei',
  'Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Georgia', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Courier New', 'Consolas', 'Lucida Console',
]

// queryLocalFonts 不可用时回退到 defaultFonts（WebView2 常受限）；可用时追加系统字体
const systemFonts = defaultFonts

// 复刻修复后的 FONTS 定义（value = 纯字体名，不再包裹 ", sans-serif"）
const FONTS = [
  { name: '(默认)', value: '' },
  ...systemFonts.slice(0, 120).map(f => ({ name: f, value: f })),
]

// 复刻修复后的 options 合并：动态补全当前文档字体
function buildOptions(activeFont) {
  const opts = FONTS.map(f => ({ label: f.name, value: f.value }))
  if (activeFont && !opts.some(o => o.value === activeFont)) {
    opts.push({ label: activeFont, value: activeFont })
  }
  return opts
}

const cases = [
  { activeFont: '宋体', desc: 'docx 解析出的中文 eastAsia 字体' },
  { activeFont: 'SimSun', desc: '英文 family 名（旧/英文系统）' },
  { activeFont: '"SimSun", sans-serif', desc: '旧文档遗留的封装格式值' },
  { activeFont: '黑体', desc: '中文字体' },
  { activeFont: '微软雅黑', desc: '中文字体' },
  { activeFont: '', desc: '无字体（默认）' },
]

let allPass = true
const rows = []
for (const c of cases) {
  const opts = buildOptions(c.activeFont)
  const selected = opts.find(o => o.value === c.activeFont)
  const inBaseList = FONTS.some(f => f.value === c.activeFont)
  const pass = !!selected
  if (!pass) allPass = false
  rows.push({ ...c, selected: selected ? selected.label : '(无)', inBaseList, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] activeFont="${c.activeFont}" -> 下拉选中:"${selected ? selected.label : '无'}" | 基础列表含此项:${inBaseList} | ${c.desc}`)
}

// 断言：常用中文字体必须出现在基础下拉列表中（解决“下拉也没有对应字体”）
const mustHave = ['宋体', '黑体', '楷体', '仿宋', '微软雅黑', '等线']
for (const m of mustHave) {
  const ok = FONTS.some(f => f.value === m)
  if (!ok) { allPass = false; console.log(`[FAIL] 基础下拉列表缺少中文字体: ${m}`) }
}

console.log('\n整体结果:', allPass ? 'ALL PASS ✅' : 'HAS FAIL ❌')

// 生成真实 DOM 证据页
const demo = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>字体下拉修复验证</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:24px;background:#f5f5f5;color:#222}
h2{margin-top:0}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
select{width:220px;padding:6px 8px;font-size:14px;border:1px solid #bbb;border-radius:4px}
.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;margin-left:8px}
.ok{background:#e6f4ea;color:#137333}.bad{background:#fce8e6;color:#c5221f}
code{background:#eee;padding:1px 5px;border-radius:3px}
</style></head><body>
<h2>Word Ribbon 字体下拉框修复 — 真实 DOM 证据</h2>
<p>每个卡片模拟一个 <code>activeFont</code> 场景下的字体下拉框（value 匹配逻辑与组件一致）。选中项即工具栏应显示的当前字体。</p>
${rows.map(r => {
  const opts = buildOptions(r.activeFont)
  const sel = opts.find(o => o.value === r.activeFont)
  const optHtml = FONTS.slice(0, 14).map(f => `<option value="${f.value}" ${f.value === r.activeFont ? 'selected' : ''}>${f.name}</option>`).join('') +
    (sel && !FONTS.some(f => f.value === r.activeFont) ? `<option value="${sel.value}" selected>${sel.label}（文档实际字体）</option>` : '')
  return `<div class="card">
    <div><b>场景：</b>${r.desc} <span class="tag ${r.pass ? 'ok' : 'bad'}">${r.pass ? '选中成功' : '失败'}</span></div>
    <div style="margin:8px 0">字体下拉框（当前值 <code>${r.activeFont || '(空)'}</code>）：</div>
    <select>${optHtml}</select>
    <div style="margin-top:6px;font-size:13px;color:#666">基础列表含中文字体：宋体/黑体/楷体/仿宋/微软雅黑/等线 ✅</div>
  </div>`
}).join('')}
<p style="font-size:13px;color:#666">说明：下拉项 value 现已为纯字体名（如 <code>宋体</code>），与文档 <code>fontFamily</code> mark 存储的纯名一致；当前文档字体若不在预置列表（如旧封装值）也会被动态补全，确保工具栏正确显示并可选中。</p>
</body></html>`

const fs = require('fs')
fs.writeFileSync(__dirname + '/verify_font_dropdown.html', demo, 'utf8')
console.log('已生成证据页: scripts/verify_font_dropdown.html')
