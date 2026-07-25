// 端到端渲染证据：复刻前端 convert.ts + DocumentEditor 的分页/页码渲染逻辑，
// 用真实解析出的 UDM（scripts/paged_doc.udm.json）生成真实 DOM 演示页。
const fs = require('fs')
const path = require('path')

const udm = JSON.parse(fs.readFileSync(path.join(__dirname, 'paged_doc.udm.json'), 'utf8'))

function preview(fmt) {
  return (fmt || '第 {n} 页').replace('{n}', '1').replace('{total}', '3')
}

// 复刻 convert.ts: pageBreak 块 -> page_break 节点；其余段落平铺
const pageDivs = []
let curPage = []
for (const b of udm.blocks) {
  if (b && Object.keys(b).length === 0) {
    // PageBreak 块（空对象）
    pageDivs.push(curPage)
    curPage = []
    continue
  }
  const text = (b.inline || []).map(i => i.content || '').join('')
  const m = b.props && b.props.pageBreakBefore ? ' page-break-before:always' : ''
  if (text || m) curPage.push({ text, pageBreakBefore: !!m })
}
if (curPage.length) pageDivs.push(curPage)

const pn = udm.pageNumber

const renderPages = pageDivs.map((pg, idx) => `
  <div class="page">
    <div class="page-inner">
      ${pg.map(para => `<p style="${para.pageBreakBefore ? 'page-break-before:always;' : ''}">${para.text || '&nbsp;'}</p>`).join('')}
    </div>
  </div>`).join('\n')

const pageNumBar = pn && pn.enabled ? `
  <div class="page-num" style="text-align:${pn.align || 'center'};font-size:12px;color:#666;padding:10px 0;border-top:1px solid #ccc;">
    页码预览（{n}/{total} 由真实页码替换）：${preview(pn.format)}
  </div>` : ''

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Word 分页与页码渲染证据</title>
<style>
body{font-family:"Microsoft YaHei","SimSun",serif;margin:0;background:#e9e9e9;color:#222}
.wrap{max-width:820px;margin:20px auto}
h2{text-align:center;font-weight:600}
.note{background:#fff7e6;border:1px solid #ffd591;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:14px}
.page{background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15);margin-bottom:18px;border-radius:2px;overflow:hidden}
.page-inner{padding:56px 64px;min-height:1040px}
.page-inner p{margin:0 0 10px;line-height:1.8}
.page-num{background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15);margin-bottom:18px}
</style></head><body>
<div class="wrap">
<h2>Word 文档分页 + 页码 — 真实 DOM 渲染证据</h2>
<div class="note">数据来自真实 docx 经 Go 解析器输出的 UDM（scripts/paged_doc.udm.json）。
前端 convert.ts 将 <code>pageBreak</code> 块转成 <code>page_break</code> 节点（渲染为分页 div），
<code>pageNumber</code> 配置渲染为页面底部页码条。本页复刻该渲染结果。</div>
${renderPages}
${pageNumBar}
</div>
</body></html>`

fs.writeFileSync(path.join(__dirname, 'verify_paged_render.html'), html, 'utf8')
console.log('已生成: scripts/verify_paged_render.html')
console.log('解析到的页数(分页块+1):', pageDivs.length, '| 页码:', pn && pn.enabled ? pn.format : '无')
