const { firefox } = require('playwright')
const path = require('path')
const fs = require('fs')
const http = require('http')

const BASE_URL = 'http://127.0.0.1:19000'
const DOWNLOAD_DIR = '/home/z/my-project/download'

function downloadFile(endpoint, body, filename) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(endpoint, BASE_URL)
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        fs.writeFileSync(path.join(DOWNLOAD_DIR, filename), buffer)
        resolve({ size: buffer.length, type: res.headers['content-type'] })
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  console.log('=== 1. 通过 UI 创建 Word 文档 ===')
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(800)
  await page.click('.ProseMirror')
  await page.waitForTimeout(300)

  // 用逐个 dispatch 方式创建内容
  await page.evaluate(() => {
    const view = window.__pmView
    if (!view) return
    const schema = view.state.schema

    // 清空文档
    const emptyDoc = schema.nodes.doc.create(null, schema.nodes.paragraph.create())
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes.paragraph.create()))

    // 插入标题
    let tr = view.state.tr
    const pos = 1
    tr = tr.insert(pos, schema.nodes.heading.create({ level: 1 },
      schema.text('GoOffice 产品白皮书', [schema.marks.bold.create(), schema.marks.textColor.create({ color: '#4f46e5' })]))
    )
    view.dispatch(tr)

    // 副标题
    tr = view.state.tr.insert(view.state.selection.to,
      schema.nodes.paragraph.create({ align: 'center' },
        schema.text('SamAI Group · 2026年7月', [schema.marks.italic.create(), schema.marks.textColor.create({ color: '#64748b' })])
      )
    )
    view.dispatch(tr)

    // 分页符
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.page_break.create()))

    // 正文
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.heading.create({ level: 2 }, schema.text('一、产品概述'))
    ))
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.paragraph.create({}, schema.text('GoOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。它支持文档、表格、演示三件套，以及 Markdown 和 HTML 编辑，覆盖办公全场景。'))
    ))
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.paragraph.create({}, [
        schema.text('核心特性包括：', [schema.marks.bold.create()]),
        schema.text('富文本编辑、'),
        schema.text('表格操作', [schema.marks.textColor.create({ color: '#ef4444' }), schema.marks.bold.create()]),
        schema.text('、'),
        schema.text('拼写检查', [schema.marks.highlight.create({ color: '#fef08a' })]),
        schema.text('、'),
        schema.text('PDF 导出', [schema.marks.underline.create()]),
        schema.text(' 等。'),
      ])
    ))

    // 列表
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('ProseMirror 富文本引擎'))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('SymSpell 拼写纠错算法'))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('Hunspell + jieba 中文分词'))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('KaTeX 公式渲染'))),
      ])
    ))

    // 水平线
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()))

    // 二级标题
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.heading.create({ level: 2 }, schema.text('二、技术架构'))
    ))

    // 代码块
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.code_block.create({}, schema.text('package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, GoOffice!")\n}'))
    ))

    // 表格
    const rows = []
    const headers = ['模块', '技术栈', '状态']
    const data = [
      ['文档编辑', 'ProseMirror + React', '✅'],
      ['表格编辑', 'excelize + 自研', '✅'],
      ['演示编辑', '自研 OOXML', '✅'],
    ]
    for (let r = 0; r < 4; r++) {
      const cells = []
      for (let c = 0; c < 3; c++) {
        const text = r === 0 ? headers[c] : data[r - 1][c]
        cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, schema.text(text))))
      }
      rows.push(schema.nodes.table_row.create(null, cells))
    }
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.table.create(null, rows)))

    // 关于 SamAI
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.heading.create({ level: 2 }, schema.text('三、关于 SamAI'))
    ))
    view.dispatch(view.state.tr.replaceSelectionWith(
      schema.nodes.paragraph.create({}, schema.text('SamAI 是一家全球领先的 AI 集团，总部位于新加坡。所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。访问 samai.cc 了解更多。'))
    ))
  })

  await page.waitForTimeout(500)
  console.log('  ✓ Word 文档内容创建完成')

  await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'word-screenshot.png') })
  console.log('  ✓ Word 截图保存')

  await browser.close()

  // === 2. 通过 API 导出 docx ===
  console.log('\n=== 2. 导出 docx ===')
  const docxResult = await downloadFile('/api/lib/doc/create', {
    title: 'GoOffice 产品白皮书',
    author: 'SamAI Group',
    elements: [
      { type: 'heading', text: 'GoOffice 产品白皮书', level: 1 },
      { type: 'paragraph', text: 'SamAI Group · 2026年7月' },
      { type: 'heading', text: '一、产品概述', level: 2 },
      { type: 'paragraph', text: 'GoOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。它支持文档、表格、演示三件套，以及 Markdown 和 HTML 编辑，覆盖办公全场景。' },
      { type: 'paragraph', runs: [
        { text: '核心特性包括：', bold: true },
        { text: '富文本编辑、' },
        { text: '表格操作', bold: true, color: 'FF0000' },
        { text: '、拼写检查、PDF 导出等。' },
      ]},
      { type: 'list', items: ['ProseMirror 富文本引擎', 'SymSpell 拼写纠错算法', 'Hunspell + jieba 中文分词', 'KaTeX 公式渲染', '深色模式 + 响应式 UI'] },
      { type: 'heading', text: '二、技术架构', level: 2 },
      { type: 'code', language: 'go', code: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, GoOffice!")\n}' },
      { type: 'table', rows: [['模块', '技术栈', '状态'], ['文档编辑', 'ProseMirror + React', '✅ 完成'], ['表格编辑', 'excelize + 自研', '✅ 完成'], ['演示编辑', '自研 OOXML', '✅ 完成']] },
      { type: 'heading', text: '三、关于 SamAI', level: 2 },
      { type: 'paragraph', text: 'SamAI 是一家全球领先的 AI 集团，总部位于新加坡。所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。访问 samai.cc 了解更多。' },
    ]
  }, 'GoOffice-产品白皮书.docx')
  console.log(`  ✓ docx: ${(docxResult.size/1024).toFixed(1)}KB`)

  // === 3. 导出 PDF ===
  console.log('\n=== 3. 导出 PDF ===')
  const pdfResult = await downloadFile('/api/doc/export-pdf', {
    meta: { title: 'GoOffice 产品白皮书' },
    blocks: [
      { level: 2, inline: [{ content: 'GoOffice 产品白皮书', bold: true }] },
      { inline: [{ content: 'SamAI Group · 2026年7月' }] },
      { level: 2, inline: [{ content: '一、产品概述' }] },
      { inline: [{ content: 'GoOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。' }] },
      { inline: [{ content: '核心特性包括：', bold: true }, { content: '富文本编辑、表格操作、拼写检查、PDF 导出等。' }] },
      { items: [[{ inline: [{ content: 'ProseMirror 富文本引擎' }], style: '', align: '' }]], ordered: false },
      { items: [[{ inline: [{ content: 'SymSpell 拼写纠错算法' }], style: '', align: '' }]], ordered: false },
      { items: [[{ inline: [{ content: 'Hunspell + jieba 中文分词' }], style: '', align: '' }]], ordered: false },
      { items: [[{ inline: [{ content: 'KaTeX 公式渲染' }], style: '', align: '' }]], ordered: false },
      { items: [[{ inline: [{ content: '深色模式 + 响应式 UI' }], style: '', align: '' }]], ordered: false },
      { level: 2, inline: [{ content: '二、技术架构' }] },
      { code: 'package main\nimport "fmt"\nfunc main() {\n    fmt.Println("Hello!")\n}' },
      { level: 2, inline: [{ content: '三、关于 SamAI' }] },
      { inline: [{ content: 'SamAI 是一家全球领先的 AI 集团，总部位于新加坡。所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。访问 samai.cc 了解更多。' }] },
    ]
  }, 'GoOffice-产品白皮书.pdf')
  console.log(`  ✓ PDF: ${(pdfResult.size/1024).toFixed(1)}KB`)

  // === 4. 验证 ===
  console.log('\n=== 4. 文件验证 ===')
  const files = ['GoOffice-产品白皮书.docx', 'GoOffice-产品白皮书.pdf', 'GoOffice-功能清单.xlsx', 'GoOffice-产品介绍.pptx', 'word-screenshot.png']
  for (const f of files) {
    const fp = path.join(DOWNLOAD_DIR, f)
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp)
      const { execSync } = require('child_process')
      let ft = ''
      try { ft = execSync(`file "${fp}"`).toString().split(': ')[1].trim() } catch {}
      console.log(`  ✓ ${f} (${(stat.size/1024).toFixed(1)}KB) - ${ft}`)
    } else {
      console.log(`  ✗ ${f} - 不存在`)
    }
  }

  console.log(`\n所有文件位于: ${DOWNLOAD_DIR}`)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
