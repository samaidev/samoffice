// e2e_round46_save.mjs — 前端完整保存链路验证：编辑器 UDM → /api/doc/save → docx 公式保真
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round46-shots'
mkdirSync(SHOTS, { recursive: true })

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  const docx = readFileSync('/tmp/formula_cmp/orig.docx')
  const form = new FormData()
  form.append('file', new Blob([docx]), 'contract.docx')
  const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
  const j = await r.json()

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate((doc) => window.__setDocForTest(doc), j.document)
  await page.waitForTimeout(4500)

  // 拦截保存响应
  let savedBuf = null
  let saveRespInfo = ''
  await page.route('**/api/doc/save', async (route) => {
    try {
      const resp = await route.fetch()
      saveRespInfo = `${resp.status()}`
      const buf = await resp.body()
      savedBuf = buf
      await route.fulfill({ response: resp, body: buf })
    } catch (e) { saveRespInfo += ' routeErr=' + String(e).slice(0, 80); await route.abort() }
  })

  const reqs = []
  page.on('request', rq => { if (rq.url().includes('/api/')) reqs.push(rq.method() + ' ' + rq.url().slice(BASE.length)) })
  // 触发保存：点菜单"保存"（web 模式走下载 = POST /api/doc/save）
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const labels = btns.map(b => b.getAttribute('aria-label') || b.textContent || '').slice(0, 40).join('|')
    ;(window).__e2eLabels = labels
    const menuBtn = btns.find(b => /Files/i.test(b.textContent || ''))
    if (menuBtn) { menuBtn.click(); return 'files-btn' }
    return 'no-files-btn: ' + labels.slice(0, 120)
  })
  await page.waitForTimeout(600)
  const itemClicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, [role=menuitem], div'))
    const save = items.find(b => /保存/.test(b.textContent || '') && (b.textContent || '').includes('Ctrl+S'))
    if (save) { save.click(); return 'save-item' }
    const save2 = items.find(b => (b.textContent || '').trim().startsWith('💾'))
    if (save2) { save2.click(); return 'save2' }
    return 'no-item: ' + items.map(b => (b.textContent || '').trim()).filter(t => t && t.length < 20).slice(0, 25).join('|')
  })
  await page.waitForTimeout(4000)

  let pass = false, info = 'no save response'
  if (savedBuf && savedBuf.length > 1000) {
    writeFileSync('/tmp/formula_cmp/ui_saved.docx', savedBuf)
    info = `saved ${savedBuf.length} bytes`
    // Go mathrt 不可用（需重编译）；用 python 统计公式结构
    const out = execSync(`python3 - <<'EOF'
import zipfile
from xml.etree import ElementTree as ET
M='http://schemas.openxmlformats.org/officeDocument/2006/math'
z=zipfile.ZipFile('/tmp/formula_cmp/ui_saved.docx')
root=ET.fromstring(z.read('word/document.xml').decode('utf-8','replace'))
oms=list(root.iter('{%s}oMath'%M))
sig=lambda om:[('T:'+(el.text or '')) if el.tag=='{%s}t'%M else el.tag.split('}')[1] for el in om.iter() if not el.tag.startswith('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}')]
z2=zipfile.ZipFile('/tmp/formula_cmp/orig.docx')
root2=ET.fromstring(z2.read('word/document.xml').decode('utf-8','replace'))
oms2=list(root2.iter('{%s}oMath'%M))
s2=[sig(x) for x in oms2]; s1=[sig(x) for x in oms]
same=sum(1 for x,y in zip(s1,s2) if x==y)
print(f"UI_SAVED oMath={len(s1)} orig={len(s2)} identical={same}/{min(len(s1),len(s2))}")
EOF`, { shell: '/bin/bash' }).toString().trim()
    info += ' | ' + out
    pass = out.includes('oMath=46') && out.includes('identical=46/46')
  }
  console.log(`${pass ? 'PASS' : 'FAIL'}  UI save roundtrip  ${info} | click=${clicked}/${itemClicked} | resp=${saveRespInfo}`)
  console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'}  no pageerror  ${errors.slice(0, 2).join(' | ')}`)
  console.log('API requests:', reqs.join(', ') || '(none)')
  await browser.close()
  if (!pass || errors.length) process.exit(1)
}
main().catch(e => { console.error('E2E ERROR', e); process.exit(2) })
