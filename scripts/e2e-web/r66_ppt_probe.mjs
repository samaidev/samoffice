// round66 探针：PPT 讲义母版（Handout Master）全链路。
// 验证：
//   1. 新建演示 → 视图选项卡 → 「讲义母版」按钮 → 讲义母版视图出现（A4 卡 + 四占位符）
//   2. 编辑页眉/页脚/日期/字号/颜色 → 数据生效
//   3. 打印（讲义模式 slidesPerPage=3）→ 纸张页缘出现母版四要素（页眉文本/页码）
//   4. 保存（Ctrl+S 下载 pptx）→ zip 内 handoutMaster1.xml 存在且含页眉文本 →
//      重开文件 → 讲义母版视图数据恢复（保存往返）
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r66_ppt_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const SHOTS = path.resolve(__dirname, 'r66-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const PORT = 8833

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.pptx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, `http://x`).pathname)
  let file = path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
page.setDefaultTimeout(20000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.waitForTimeout(500)
  // 新建演示
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Files'))?.click()
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => { const t = (b.textContent || '').trim(); return t.includes('演示') || t.includes('Slide') || t.includes('PPT') })?.click()
  })
  await page.waitForTimeout(900)
  await page.waitForSelector('.slide-canvas')

  // ===== 1. 讲义母版视图 =====
  await page.click('[data-testid="ribbon-tab-view"]')
  await page.waitForTimeout(300)
  const btn = await page.$('[data-testid="ppt-print-btn"]') // 确认 view tab 在
  // 讲义母版按钮（icon 🗒）
  const handoutBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('讲义母版') || /Handout\s*Master/i.test(x.textContent || ''))
    if (b) { return true }
    return false
  })
  ok('视图选项卡含「讲义母版」按钮', handoutBtn)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('讲义母版') || /Handout\s*Master/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(500)
  const hoCanvas = await page.$('.handout-master-canvas')
  ok('讲义母版视图打开（A4 编辑卡）', !!hoCanvas)

  // ===== 2. 编辑四要素 =====
  await page.fill('[data-testid="handout-header"]', 'SamOffice 产品发布')
  await page.fill('[data-testid="handout-footer"]', '机密文件')
  await page.fill('[data-testid="handout-date"]', '2026-11-24')
  await page.fill('[data-testid="handout-fontsize"]', '12')
  await page.$eval('[data-testid="handout-color"]', el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '#4472c4')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  const hdrVal = await page.$eval('[data-testid="handout-header"]', el => el.value)
  const numChk = await page.$eval('[data-testid="handout-pageon"]', el => el.checked)
  ok('页眉/页脚/日期编辑生效', hdrVal === 'SamOffice 产品发布' && numChk, `hdr=${hdrVal} pageOn=${numChk}`)

  // ===== 3. 讲义打印应用四要素 =====
  // 退出讲义母版视图 → 打印对话框 → 讲义（3张/页）→ 检查纸张上的母版要素
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('退出讲义母版') || /Exit\s*Handout/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(400)
  await page.click('[data-testid="ppt-print-btn"]')
  await page.waitForTimeout(1000)
  // 切「讲义」内容 + 每页 3 张
  await page.evaluate(() => {
    // pptContent select → handout
    const sel = document.querySelector('select')
    if (sel) {
      for (const o of sel.options) {
        if ((o.textContent || '').includes('讲义') || /handout/i.test(o.value || '')) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); break }
      }
    }
  })
  await page.waitForTimeout(800)
  const printState = await page.evaluate(() => {
    const hdr = document.querySelectorAll('[data-testid="handout-print-hdr"]')
    const ftr = document.querySelectorAll('[data-testid="handout-print-ftr"]')
    const dt = document.querySelectorAll('[data-testid="handout-print-dt"]')
    const num = document.querySelectorAll('[data-testid="handout-print-num"]')
    const hdrText = hdr[0]?.textContent || ''
    const ftrText = ftr[0]?.textContent || ''
    const dtText = dt[0]?.textContent || ''
    const numText = num[0]?.textContent || ''
    return { papers: document.querySelectorAll('.print-paper').length, hdrText, ftrText, dtText, numText, hdrColor: hdr[0]?.style?.color || '' }
  })
  ok('讲义打印：页眉出现在纸张', printState.hdrText.includes('SamOffice 产品发布'), JSON.stringify(printState).slice(0, 100))
  ok('讲义打印：页脚出现在纸张', printState.ftrText.includes('机密文件'), printState.ftrText.slice(0, 30))
  ok('讲义打印：日期出现在纸张', printState.dtText.includes('2026-11-24'), printState.dtText.slice(0, 30))
  ok('讲义打印：页码自动编号', printState.numText === '1', `num=${printState.numText}`)
  ok('讲义打印：页眉颜色生效', /rgb\(68, 114, 196\)|#4472c4/i.test(printState.hdrColor), printState.hdrColor)

  // ===== 4. 保存往返 =====
  // 关闭打印对话框（ESC）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.keyboard.press('Control+s'),
  ])
  const savedPath = path.join(SHOTS, 'r66-handout.pptx')
  await download.saveAs(savedPath)
  const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) } catch { return '' } }
  const hmXml = run(`cd ${SHOTS} && unzip -p r66-handout.pptx ppt/handoutMasters/handoutMaster1.xml`)
  ok('保存 pptx 含 handoutMaster1.xml', !!hmXml && hmXml.includes('handoutMaster'), hmXml ? 'present' : 'missing')
  ok('handoutMaster1.xml 含页眉文本', (hmXml || '').includes('SamOffice 产品发布'), '')
  ok('handoutMaster1.xml 含字号 sz=1200', (hmXml || '').includes('sz="1200"'), '')
  ok('handoutMaster1.xml 含颜色 4472C4', /4472C4/i.test(hmXml || ''), '')
  const presXml = run(`cd ${SHOTS} && unzip -p r66-handout.pptx ppt/_rels/presentation.xml.rels`)
  ok('presentation rels 注册 handoutMaster', (presXml || '').includes('handoutMaster1.xml'), '')
  const ctXml = run(`cd ${SHOTS} && unzip -p r66-handout.pptx "word/document.xml" 2>/dev/null; unzip -p r66-handout.pptx -x "*" 2>/dev/null; true`)
  const ctXml2 = (() => { try { return execSync(`cd ${SHOTS} && zipinfo -1 r66-handout.pptx`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) } catch { return '' } })()
  const ct = (() => { try { return execSync(`cd ${SHOTS} && python3 -c "import zipfile,sys; print(zipfile.ZipFile('r66-handout.pptx').read('[Content_Types].xml').decode())"`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) } catch { return '' } })()
  ok('ContentTypes 注册讲义/备注母版', /handoutMaster\+xml/.test(ct || '') && /notesMaster\+xml/.test(ct || ''), '')

  // 重开文件 → 讲义母版恢复
  await page.evaluate(async (bytes) => {
    const buf = new Uint8Array(bytes).buffer
    await window.__setFileForTest(new File([buf], 'r66-handout.pptx'))
  }, [...fs.readFileSync(savedPath)])
  await page.waitForSelector('.slide-canvas')
  await page.waitForTimeout(900)
  await page.click('[data-testid="ribbon-tab-view"]')
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('讲义母版') || /Handout\s*Master/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(500)
  const restored = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="handout-header"]')
    const f = document.querySelector('[data-testid="handout-footer"]')
    const d = document.querySelector('[data-testid="handout-date"]')
    return { hdr: h?.value || '', ftr: f?.value || '', dt: d?.value || '' }
  })
  ok('重开后讲义母版页眉恢复', restored.hdr === 'SamOffice 产品发布', JSON.stringify(restored).slice(0, 90))
  ok('重开后讲义母版页脚恢复', restored.ftr === '机密文件', '')
} catch (e) {
  console.log('ERROR', String(e).slice(0, 400))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
