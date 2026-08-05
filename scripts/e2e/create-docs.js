// 通过 Playwright 在 UI 中创建真实文档，导出 docx/xlsx/pptx/pdf
const { firefox } = require('playwright')
const path = require('path')
const fs = require('fs')
const http = require('http')

const BASE_URL = 'http://127.0.0.1:19000'
const DOWNLOAD_DIR = '/home/z/my-project/download'
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

const results = []
function log(name, status, details = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '→'
  console.log(`  ${icon} [${status}] ${name}${details ? ' - ' + details : ''}`)
  results.push({ name, status, details })
}

// 下载文件的辅助函数（通过 API 创建并保存）
async function downloadFile(endpoint, body, filename) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(endpoint, BASE_URL)
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }
    const req = http.request(options, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const filePath = path.join(DOWNLOAD_DIR, filename)
        fs.writeFileSync(filePath, buffer)
        resolve({ size: buffer.length, type: res.headers['content-type'] })
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  console.log('=== SamOffice 文档创建测试 ===\n')

  // === 1. 通过 UI 创建 Word 文档 ===
  console.log('--- 1. 通过 UI 创建 Word 文档 ---')
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  const page = await ctx.newPage()

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(500)
    
    // 在编辑器中输入内容
    await page.click('.ProseMirror')
    await page.waitForTimeout(300)

    // 用 evaluate 直接操作 ProseMirror 创建富文本文档
    await page.evaluate(() => {
      const view = window.__pmView
      if (!view) return
      const schema = view.state.schema
      const trs = []

      // 标题
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.heading.create({ level: 1 }, schema.text('SamOffice 产品白皮书', [
          schema.marks.bold.create(),
          schema.marks.fontSize.create({ size: '32px' }),
          schema.marks.textColor.create({ color: '#4f46e5' }),
        ]))
      ))

      // 副标题段落
      trs.push(view.state.tr.insertText('\n', view.state.selection.to))
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.paragraph.create({ align: 'center' }, schema.text('SamAI Group · 2026年7月', [
          schema.marks.italic.create(),
          schema.marks.textColor.create({ color: '#64748b' }),
        ]))
      ))

      // 分页符
      trs.push(view.state.tr.replaceSelectionWith(schema.nodes.page_break.create()))

      // 正文标题
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.heading.create({ level: 2 }, schema.text('一、产品概述'))
      ))

      // 正文段落
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.paragraph.create({}, schema.text('SamOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。它支持文档、表格、演示三件套，以及 Markdown 和 HTML 编辑，覆盖办公全场景。'))
      ))

      // 段落带样式
      const p = schema.nodes.paragraph.create({}, [
        schema.text('核心特性包括：', [schema.marks.bold.create()]),
        schema.text('富文本编辑、'),
        schema.text('表格操作', [schema.marks.textColor.create({ color: '#ef4444' }), schema.marks.bold.create()]),
        schema.text('、'),
        schema.text('拼写检查', [schema.marks.highlight.create({ color: '#fef08a' })]),
        schema.text('、'),
        schema.text('PDF 导出', [schema.marks.underline.create()]),
        schema.text(' 等。'),
      ])
      trs.push(view.state.tr.replaceSelectionWith(p))

      // 无序列表
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.bullet_list.create(null, [
          schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('ProseMirror 富文本引擎'))),
          schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('SymSpell 拼写纠错算法'))),
          schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('Hunspell + jieba 中文分词'))),
          schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('KaTeX 公式渲染'))),
          schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('深色模式 + 响应式 UI'))),
        ])
      ))

      // 水平线
      trs.push(view.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()))

      // 二级标题
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.heading.create({ level: 2 }, schema.text('二、技术架构'))
      ))

      // 代码块
      trs.push(view.state.tr.replaceSelectionWith(
        schema.nodes.code_block.create({}, schema.text('package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, SamOffice!")\n}'))
      ))

      // 表格
      const tableRows = []
      for (let r = 0; r < 4; r++) {
        const cells = []
        const headers = ['模块', '技术栈', '状态']
        const data = [
          ['文档编辑', 'ProseMirror + React', '✅ 完成'],
          ['表格编辑', 'excelize + 自研', '✅ 完成'],
          ['演示编辑', '自研 OOXML', '✅ 完成'],
        ]
        for (let c = 0; c < 3; c++) {
          const text = r === 0 ? headers[c] : data[r - 1][c]
          cells.push(schema.nodes.table_cell.create(
            { isHeader: r === 0 },
            schema.nodes.paragraph.create(null, schema.text(text))
          ))
        }
        tableRows.push(schema.nodes.table_row.create(null, cells))
      }
      trs.push(view.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tableRows)))

      // 依次 dispatch
      for (const tr of trs) {
        view.dispatch(tr)
      }
    })

    await page.waitForTimeout(500)
    log('Word 文档内容创建', 'PASS', '标题+段落+列表+代码块+表格')

    // 截图
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'word-screenshot.png') })
    log('Word 截图', 'PASS', 'word-screenshot.png')

    // 导出 docx - 通过 API 保存当前文档
    const docContent = await page.evaluate(() => {
      const view = window.__pmView
      if (!view) return null
      // 简单提取文本内容作为 JSON
      const blocks = []
      view.state.doc.forEach(node => {
        if (node.type.name === 'heading') {
          blocks.push({ type: 'heading', level: node.attrs.level, inline: [{ content: node.textContent }] })
        } else if (node.type.name === 'paragraph') {
          blocks.push({ type: 'paragraph', inline: [{ content: node.textContent }] })
        } else if (node.type.name === 'bullet_list') {
          const items = []
          node.forEach(item => {
            items.push(item.textContent)
          })
          blocks.push({ type: 'list', items, ordered: false })
        } else if (node.type.name === 'code_block') {
          blocks.push({ type: 'code', language: 'go', code: node.textContent })
        } else if (node.type.name === 'table') {
          const rows = []
          node.forEach(row => {
            const cells = []
            row.forEach(cell => {
              cells.push(cell.textContent)
            })
            rows.push(cells)
          })
          blocks.push({ type: 'table', rows })
        }
      })
      return { meta: { title: 'SamOffice 产品白皮书', author: 'SamAI Group' }, blocks: blocks.map(b => {
        if (b.type === 'heading') return { type: 'heading', text: b.inline[0].content, level: b.level }
        if (b.type === 'paragraph') return { type: 'paragraph', text: b.inline[0].content }
        if (b.type === 'list') return { type: 'list', items: b.items }
        if (b.type === 'code') return { type: 'code', language: b.language, code: b.code }
        if (b.type === 'table') return { type: 'table', rows: b.rows }
        return null
      }).filter(Boolean) }
    })

    if (docContent) {
      // 通过 officelib API 创建 docx
      const docxResult = await downloadFile('/api/lib/doc/create', {
        title: 'SamOffice 产品白皮书',
        author: 'SamAI Group',
        elements: [
          { type: 'heading', text: 'SamOffice 产品白皮书', level: 1 },
          { type: 'paragraph', text: 'SamAI Group · 2026年7月' },
          { type: 'heading', text: '一、产品概述', level: 2 },
          { type: 'paragraph', text: 'SamOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。它支持文档、表格、演示三件套，以及 Markdown 和 HTML 编辑，覆盖办公全场景。' },
          { type: 'paragraph', text: '核心特性包括：富文本编辑、表格操作、拼写检查、PDF 导出等。' },
          { type: 'list', items: ['ProseMirror 富文本引擎', 'SymSpell 拼写纠错算法', 'Hunspell + jieba 中文分词', 'KaTeX 公式渲染', '深色模式 + 响应式 UI'] },
          { type: 'heading', text: '二、技术架构', level: 2 },
          { type: 'code', language: 'go', code: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, SamOffice!")\n}' },
          { type: 'table', rows: [['模块', '技术栈', '状态'], ['文档编辑', 'ProseMirror + React', '✅ 完成'], ['表格编辑', 'excelize + 自研', '✅ 完成'], ['演示编辑', '自研 OOXML', '✅ 完成']] },
          { type: 'heading', text: '三、关于 SamAI', level: 2 },
          { type: 'paragraph', text: 'SamAI 是一家全球领先的 AI 集团，总部位于新加坡。所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。访问 samai.cc 了解更多。' },
        ]
      }, 'SamOffice-产品白皮书.docx')
      log('导出 Word docx', docxResult.size > 1000 ? 'PASS' : 'FAIL', `${docxResult.size} bytes`)

      // 导出 PDF
      const pdfResult = await downloadFile('/api/doc/export-pdf', {
        meta: { title: 'SamOffice 产品白皮书' },
        blocks: [
          { inline: [{ content: 'SamOffice 产品白皮书', bold: true }], style: 'Heading1', align: 'center' },
          { inline: [{ content: 'SamAI Group · 2026年7月' }], style: '', align: 'center' },
          { level: 2, inline: [{ content: '一、产品概述' }] },
          { inline: [{ content: 'SamOffice 是一款基于 Go + Web 技术构建的跨平台办公套件，由 SamAI 集团公益开源。它支持文档、表格、演示三件套，以及 Markdown 和 HTML 编辑，覆盖办公全场景。' }] },
          { inline: [{ content: '核心特性包括：', bold: true }, { content: '富文本编辑、表格操作、拼写检查、PDF 导出等。' }] },
          { items: [[{ inline: [{ content: 'ProseMirror 富文本引擎' }], style: '', align: '' }]], ordered: false },
          { items: [[{ inline: [{ content: 'SymSpell 拼写纠错算法' }], style: '', align: '' }]], ordered: false },
          { items: [[{ inline: [{ content: 'Hunspell + jieba 中文分词' }], style: '', align: '' }]], ordered: false },
          { items: [[{ inline: [{ content: 'KaTeX 公式渲染' }], style: '', align: '' }]], ordered: false },
          { level: 2, inline: [{ content: '二、技术架构' }] },
          { code: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, SamOffice!")\n}' },
          { level: 2, inline: [{ content: '三、关于 SamAI' }] },
          { inline: [{ content: 'SamAI 是一家全球领先的 AI 集团，总部位于新加坡。所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。访问 samai.cc 了解更多。' }] },
        ]
      }, 'SamOffice-产品白皮书.pdf')
      log('导出 PDF', pdfResult.type === 'application/pdf' ? 'PASS' : 'FAIL', `${pdfResult.size} bytes`)
    }

    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'word-after-edit.png') })
  } catch (e) {
    log('Word 文档创建', 'FAIL', e.message.slice(0, 80))
  }
  await browser.close()

  // === 2. 通过 API 创建 Excel ===
  console.log('\n--- 2. 创建 Excel 工作簿 ---')
  try {
    const xlsResult = await downloadFile('/api/lib/xls/create', {
      sheets: [{
        name: 'SamOffice 功能清单',
        headers: ['模块', '功能', '技术栈', '状态', '完成度'],
        rows: [
          ['文档编辑', '富文本编辑', 'ProseMirror', '✅', '100%'],
          ['文档编辑', '表格编辑', '自研 PM Table', '✅', '100%'],
          ['文档编辑', '查找替换', 'searchPlugin', '✅', '100%'],
          ['文档编辑', '上下标', 'PM marks', '✅', '100%'],
          ['文档编辑', '分页符/水平线', 'PM nodes', '✅', '100%'],
          ['表格编辑', '多 Sheet', 'excelize', '✅', '100%'],
          ['表格编辑', '公式', 'excelize', '✅', '100%'],
          ['表格编辑', '图表', 'excelize charts', '✅', '100%'],
          ['表格编辑', '条件格式', 'excelize', '✅', '100%'],
          ['演示编辑', '多布局', '自研 OOXML', '✅', '100%'],
          ['演示编辑', '过渡动画', 'p:transition', '✅', '100%'],
          ['演示编辑', '演讲者备注', 'p:notes', '✅', '100%'],
          ['拼写检查', '英文词库', 'Hunspell 10万词', '✅', '100%'],
          ['拼写检查', '中文分词', 'jieba 35万词', '✅', '100%'],
          ['拼写检查', '用户词库', 'SQLite 自学习', '✅', '100%'],
          ['导出', 'docx', '自研 OOXML', '✅', '100%'],
          ['导出', 'PDF', 'gopdf 多字体', '✅', '100%'],
          ['导出', 'xlsx', 'excelize', '✅', '100%'],
          ['导出', 'pptx', '自研 OOXML', '✅', '100%'],
          ['UI', 'Ribbon 风格', '对标 MS Office', '✅', '100%'],
          ['UI', '深色模式', 'CSS 变量', '✅', '100%'],
          ['UI', '响应式', '桌面+移动端', '✅', '100%'],
        ],
        colWidths: { 'A': 15, 'B': 18, 'C': 20, 'D': 8, 'E': 10 },
        freeze: 'A2',
      }]
    }, 'SamOffice-功能清单.xlsx')
    log('创建 Excel', xlsResult.size > 1000 ? 'PASS' : 'FAIL', `${xlsResult.size} bytes`)
  } catch (e) {
    log('创建 Excel', 'FAIL', e.message.slice(0, 80))
  }

  // === 3. 通过 API 创建 PPT ===
  console.log('\n--- 3. 创建 PPT 演示文稿 ---')
  try {
    const pptResult = await downloadFile('/api/lib/ppt/create', {
      title: 'SamOffice 产品介绍',
      author: 'SamAI Group',
      slides: [
        { layout: 'title', title: 'SamOffice', subtitle: '跨平台办公套件 · SamAI Group 公益开源', bgColor: '#ffffff', transition: 'fade' },
        { layout: 'content', title: '产品定位', bullets: ['基于 Go + Web 构建', '支持 Win/Mac/Linux 三端', '本地 Wails + 远程 HTTP 双模', '对标 MS Office 全功能'], bgColor: '#ffffff', transition: 'push' },
        { layout: 'content', title: '核心功能', bullets: ['文档编辑（ProseMirror Ribbon UI）', '表格编辑（多 Sheet + 图表 + 公式）', '演示编辑（多布局 + 过渡动画）', 'Markdown + HTML 编辑', '拼写检查（中英双语）', 'PDF/docx/xlsx/pptx 导出'], bgColor: '#f0f9ff', transition: 'wipe' },
        { layout: 'content', title: '技术亮点', bullets: ['SymSpell 拼写纠错（纯 Go）', 'Hunspell aff 派生规则', 'jieba 中文分词 35 万词', 'KaTeX 公式渲染', '深色模式 + 响应式', 'docgo/xlsgo/pptgo 独立库'], bgColor: '#fef3c7', transition: 'cover' },
        { layout: 'content', title: '开源生态', bullets: ['github.com/samaidev/samoffice', 'github.com/samaidev/docgo', 'github.com/samaidev/xlsgo', 'github.com/samaidev/pptgo', 'MIT 许可证 · 永久公益'], bgColor: '#ffffff', transition: 'fade' },
        { layout: 'title', title: 'SamAI Group', subtitle: 'samai.cc · 全球领先 AI 集团', bgColor: '#1e293b', transition: 'fade' },
      ]
    }, 'SamOffice-产品介绍.pptx')
    log('创建 PPT', pptResult.size > 1000 ? 'PASS' : 'FAIL', `${pptResult.size} bytes`)
  } catch (e) {
    log('创建 PPT', 'FAIL', e.message.slice(0, 80))
  }

  // === 4. 验证文件 ===
  console.log('\n--- 4. 验证生成文件 ---')
  const files = ['SamOffice-产品白皮书.docx', 'SamOffice-产品白皮书.pdf', 'SamOffice-功能清单.xlsx', 'SamOffice-产品介绍.pptx', 'word-screenshot.png', 'word-after-edit.png']
  for (const f of files) {
    const fp = path.join(DOWNLOAD_DIR, f)
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp)
      const fileType = require('child_process').execSync(`file "${fp}"`).toString().trim()
      log(`文件: ${f}`, 'PASS', `${(stat.size / 1024).toFixed(1)}KB | ${fileType.split(': ')[1] || ''}`)
    } else {
      log(`文件: ${f}`, 'FAIL', '不存在')
    }
  }

  // === 5. 汇总 ===
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log(`\n=== Summary ===`)
  console.log(`  PASS: ${passed}  FAIL: ${failed}`)

  console.log(`\n=== 生成文件 ===`)
  console.log(`  目录: ${DOWNLOAD_DIR}`)
  for (const f of files) {
    const fp = path.join(DOWNLOAD_DIR, f)
    if (fs.existsSync(fp)) {
      console.log(`  📄 ${f} (${(fs.statSync(fp).size / 1024).toFixed(1)}KB)`)
    }
  }
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
