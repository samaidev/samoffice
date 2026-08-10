// 通过 Playwright 驱动真实后端 HTTP API，验证"保存含保护的文档 → 重新打开保留保护"。
// 说明：Wails dev 的编辑器在外部浏览器会因 wails ipc.js 不兼容而崩溃（与保护无关），
// 因此本脚本以 Remote(HTTP) 模式驱动，调用与前端 handleDownload 完全相同的 /api/doc/save、
// 与前端 openFile 完全相同的 /api/doc/local，验证数据链路。
const { firefox } = require('playwright')
const fs = require('fs')

const API = 'http://127.0.0.1:51803'   // 当前 wails dev 后端端口（运行时探知）
const TMP = 'c:\\samoffice\\_verify_tmp'
const SAVE_PATH = TMP + '\\protect_verify.docx'
const PWD = '123456'

function assert(cond, msg) {
  if (cond) { console.log('  ✅ ' + msg); return true }
  console.log('  ❌ ' + msg); return false
}

;(async () => {
  fs.mkdirSync(TMP, { recursive: true })
  if (fs.existsSync(SAVE_PATH)) fs.unlinkSync(SAVE_PATH)

  const browser = await firefox.launch()
  const page = await browser.newContext({ acceptDownloads: true }).then(c => c.newPage())
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message.slice(0, 120)))

  // 确认前端可以正常加载（RemoteBackend，无 wails ipc 崩溃）
  await page.addInitScript((api) => {
    try { window.go = undefined } catch (e) {}
    const orig = window.fetch.bind(window)
    window.fetch = (input, init) => {
      let url = typeof input === 'string' ? input : (input && input.url) || ''
      if (url.includes('/api/')) { const i = url.indexOf('/api/'); url = api + url.slice(i); input = typeof input==='string'?url:new Request(url, input) }
      return orig(input, init)
    }
  }, API)
  await page.goto('http://[::1]:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const frontendOk = await page.evaluate(() => {
    const root = document.querySelector('#root')
    return !!root && root.children.length > 0
  })
  console.log('[1] 前端页面可正常加载（RemoteBackend，无 wails ipc 崩溃）: ' + (frontendOk ? 'YES' : 'NO'))

  console.log('[2] 在页面内通过真实后端 API 构造并保存一个"已设置保护"的文档')
  // 构造与前端一致结构的 Document（含保护），模拟用户设完保护后保存的状态
  const result = await page.evaluate(async (args) => {
    const { api, path, pwd } = args
    const enc = new TextEncoder()
    const pwdBytes = enc.encode(pwd)
    // 与前端 ProtectTab 相同的 hash 逻辑（sha256(pwd)）
    const buf = await crypto.subtle.digest('SHA-256', pwdBytes)
    const hashHex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const doc = {
      meta: { title: '保护验证文档' },
      blocks: [
        { type: 'paragraph', text: 'Playwright 文件保护验证内容', style: 'Normal' }
      ],
      protect: { enabled: true, hash: hashHex }
    }
    const saveResp = await fetch(api + '/api/doc/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    })
    const ab = await saveResp.arrayBuffer()
    // 转为 base64 传回 Node 端写盘
    const bytes = new Uint8Array(ab)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const b64 = btoa(bin)
    return { ok: saveResp.ok, status: saveResp.status, b64, hashHex }
  }, { api: API, path: SAVE_PATH, pwd: PWD })

  console.log('    保存响应: HTTP ' + result.status + ' bytes=' + (result.b64 ? Buffer.from(result.b64,'base64').length : 0))
  let ok = true
  ok &= assert(result.ok, '后端 /api/doc/save 接受含 protect 的文档')

  if (result.b64) fs.writeFileSync(SAVE_PATH, Buffer.from(result.b64, 'base64'))
  ok &= assert(fs.existsSync(SAVE_PATH), '磁盘文件已生成: ' + SAVE_PATH)

  console.log('[3] 重新打开该文件（与前端 openFile 相同的 /api/doc/local）')
  const reopen = await page.evaluate(async (args) => {
    const { api, path } = args
    const r = await fetch(api + '/api/doc/local?path=' + encodeURIComponent(path))
    return { status: r.status, body: await r.json() }
  }, { api: API, path: SAVE_PATH })

  if (reopen.status === 200 && reopen.body && reopen.body.document) {
    const rp = reopen.body.document.protect
    console.log('    重开文档 protect = ' + JSON.stringify(rp))
    ok &= assert(rp && rp.enabled === true, '重新打开后 protect.enabled 仍为 true')
    ok &= assert(rp && rp.hash === result.hashHex, '重新打开后 protect.hash 与保存时一致')
  } else {
    ok &= assert(false, '重新打开返回合法文档')
    console.log('    重开结果: ' + JSON.stringify(reopen).slice(0, 200))
  }

  await browser.close()
  console.log('\n========== 结论 ==========')
  if (ok) { console.log('PASS：含保护的文档经保存→重开，保护状态完整保留（后端数据链路正确）。'); process.exit(0) }
  else { console.log('FAIL：保护未正确保留。'); process.exit(1) }
})().catch(e => { console.error('脚本异常:', e); process.exit(2) })
