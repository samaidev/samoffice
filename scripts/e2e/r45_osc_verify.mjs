// r45：验证「带文档启动卡死/打不开」修复
// 根因：分页闭环校验与 dispatch 相互触发 → 分页结果 A↔B 永久翻转 →
//       dispatch/重算风暴 → OnDomReady 延迟 >30s → 启动看门狗强杀。
// 修复：① pagination.ts 签名回环检测（冻结震荡输出）
//       ② PAGINATION_DEBUG 默认关闭  ③ TOC 回填 5s 内最多 3 次
// 验证：
//   A) 真实毒化文档（shan 13:46 保存的 docx，经 /api/doc/local 真实解析）
//      打开后 __pgDispatchCount 增长必须收敛到 0，pageCount 稳定；
//   B) r44 的"保存→重开"污染状态（pageNumber + footer="第  页"）：
//      页脚不得出现无数字的「第 页」行。
import { chromium } from 'playwright'
import { execSync, spawn } from 'child_process'

const PORT = 18401
const DOC_PATH = '/tmp/user-doc-131645.docx'
let server
try {
  server = spawn('/tmp/samoffice-server', ['--addr', `127.0.0.1:${PORT}`,
    '--data', '/tmp/samdata45', '--static', '/home/z/my-project/samoffice/frontend/dist'],
    { stdio: 'ignore' })
  execSync('sleep 1')
  // 等服务就绪
  for (let i = 0; i < 20; i++) {
    try { execSync(`curl -s -m 2 http://127.0.0.1:${PORT}/api/health -o /dev/null`); break } catch { execSync('sleep 0.5') }
  }
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => localStorage.setItem('samoffice_pgdebug', '1'))
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message.slice(0, 150)))

  await p.goto(`http://127.0.0.1:${PORT}/?r45=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => typeof (window).__setDocForTest === 'function', { timeout: 15000 })

  // === A) 真实毒化文档 ===
  const loaded = await p.evaluate(async (path) => {
    const r = await fetch('/api/doc/local?path=' + encodeURIComponent(path))
    if (!r.ok) return null
    const j = await r.json()
    window.__setDocForTest(j.document)
    return { blocks: (j.document.blocks || []).length, warnings: (j.warnings || []).length }
  }, DOC_PATH)
  if (!loaded) { console.log('FAIL: 文档加载失败', DOC_PATH); process.exit(1) }
  console.log('A0 真实文档解析 OK: blocks=' + loaded.blocks)

  const sample = () => p.evaluate(() => ({
    dispatch: (window).__pgDispatchCount || 0,
    pageCount: (window).__pg && (window).__pg.pageCount != null ? (window).__pg.pageCount : -1,
    zoom: (window).__docZoom != null ? (window).__docZoom : -1,
  }))
  await p.waitForTimeout(3000)
  const s1 = await sample()
  await p.waitForTimeout(4000)
  const s2 = await sample()
  await p.waitForTimeout(3000)
  const s3 = await sample()
  console.log(`A1 dispatch: ${s1.dispatch} -> ${s2.dispatch} -> ${s3.dispatch}; pageCount: ${s1.pageCount}/${s2.pageCount}/${s3.pageCount}`)
  const grown1 = s2.dispatch - s1.dispatch
  const grown2 = s3.dispatch - s2.dispatch
  const oscOK = grown2 === 0 && s1.pageCount > 0 && s1.pageCount === s3.pageCount
  console.log(`A2 3-7s 增量=${grown1}, 7-10s 增量=${grown2}（修复后应收敛为 0）→ ${oscOK ? 'PASS' : 'FAIL'}`)

  // === B) 保存→重开 污染状态（页码双行检查）===
  const DOC = JSON.parse((await import('fs')).readFileSync('/home/z/my-project/samoffice/scripts/fixtures/emc_contract.udm.json', 'utf-8'))
  await p.evaluate((d) => (window).__setDocForTest({
    ...d,
    pageNumber: { enabled: true, format: '第 {n} 页', align: 'center' },
    footer: { text: '第  页', align: 'center', fontSize: 9 },
  }), DOC)
  await p.waitForTimeout(4000)
  const footerLines = await p.evaluate(() => {
    const out = []
    document.querySelectorAll('div').forEach(d => {
      const direct = [...d.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
      if (/^第\s*\d*\s*页$/.test(direct) && direct) out.push(direct)
    })
    return [...new Set(out)]
  })
  const noDigit = footerLines.filter(t => !/\d/.test(t))
  console.log(`B1 独立页脚行: ${JSON.stringify(footerLines.slice(0, 4))}`)
  console.log(`B2 无数字的「第 页」行: ${noDigit.length === 0 ? '无 → PASS' : '存在 → FAIL: ' + JSON.stringify(noDigit)}`)
  const sB1 = await sample()
  await p.waitForTimeout(3000)
  const sB2 = await sample()
  console.log(`B3 重开态 dispatch: ${sB1.dispatch} -> ${sB2.dispatch}（增量 ${sB2.dispatch - sB1.dispatch}）`)

  await p.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/r45_final.png', fullPage: false })
  console.log('pageerror:', errs.length ? errs.slice(0, 3) : '无')
  console.log('SUMMARY: ' + (oscOK && noDigit.length === 0 ? 'ALL PASS' : 'HAS FAIL'))
  await b.close()
  server.kill()
} catch (e) {
  console.error('E2E error:', e.message)
  if (server) server.kill()
  process.exit(1)
}
