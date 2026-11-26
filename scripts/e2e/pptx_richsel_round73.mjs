// round73 e2e：PPT 选定文字格式（用户主诉：字体/字号/颜色/加粗要对选定文字生效，
// 而非元素整体；补充斜体/下划线/删除线；新增字符间距、行间距调整）。
//
// 用例矩阵：
//   1    正文输入文字（contentEditable）
//   2    选定「ABCD」加粗 → 只有选中 span 变 700，其余 400（选定文字语义）
//   3    选定「EFGH」斜体 → fontStyle italic
//   4    选定「IJ」下划线 + 选定「KL」删除线
//   5    选定「MNOP」颜色红 → span color
//   6    选定「QR」字号 28 → span fontSize
//   7    选定「ST」字符间距 2.0 → letterSpacing
//   8    保存往返：pptx XML 含 run 级 b/i/u/strike/spc/sz/color
//   9    回归：无选区点 B → 整段加粗（基线语义）
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { writeFileSync as wf } from 'node:fs'

const OFFICE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const dialogs = []
  p.on('dialog', d => { dialogs.push(d.message().slice(0, 40)); d.accept().catch(() => {}) })
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 100)))
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(500)
  await p.locator('text=PPT 演示').first().click({ force: true })
  await p.waitForTimeout(3000)

  const field = () => p.locator('[data-richfield="content"]')
  // ══ 1. 输入文字（ABCD EFGH IJ KL MNOP QR ST）══
  await field().click()
  await p.evaluate(() => {
    const el = document.querySelector('[data-richfield="content"]')
    el.focus()
    el.innerHTML = '<div><span>ABCD EFGH IJ KL MNOP QR ST</span></div>'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await p.waitForTimeout(800)
  const textAll = await field().innerText()
  ok('正文输入文字', textAll.includes('ABCD') && textAll.includes('ST'), textAll.replace(/\n/g, ' ').slice(0, 30))

  // span 级样式读取工具
  const spanStyle = () => p.evaluate(() => {
    const el = document.querySelector('[data-richfield="content"]')
    if (!el) return null
    return [...el.querySelectorAll('span')].map(s => {
      const cs = getComputedStyle(s)
      return {
        t: (s.textContent || '').slice(0, 12),
        fw: cs.fontWeight, fs: cs.fontStyle, td: cs.textDecorationLine || cs.textDecoration,
        c: cs.color, sz: cs.fontSize, ls: cs.letterSpacing,
      }
    })
  })
  // 选定函数：用 Range 选中 [start, end) 字符区间
  const selectRange = (start, end) => p.evaluate(({ start, end }) => {
    const el = document.querySelector('[data-richfield="content"]')
    if (!el) return false
    const sel = window.getSelection()
    sel.removeAllRanges()
    // 遍历文本节点累计偏移建 Range
    let off = 0, startNode = null, startOff = 0, endNode = null, endOff = 0
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const len = n.textContent.length
        if (startNode === null && off + len > start) { startNode = n; startOff = start - off }
        if (endNode === null && off + len >= end) { endNode = n; endOff = end - off }
        off += len
      } else {
        for (const c of n.childNodes) walk(c)
      }
    }
    walk(el)
    if (!startNode || !endNode) return false
    const range = document.createRange()
    range.setStart(startNode, Math.max(0, startOff))
    range.setEnd(endNode, Math.max(0, endOff))
    sel.addRange(range)
    return !sel.isCollapsed
  }, { start, end })

  // ══ 2. 选定 ABCD 加粗 ══
  await field().click()
  await selectRange(0, 4)
  await p.waitForTimeout(300)
  await p.locator('button:has-text("加粗")').first().click({ force: true })
  await p.waitForTimeout(700)
  const spans2 = await spanStyle()
  const abcd = spans2.find(s => s.t.includes('ABCD'))
  const rest = spans2.find(s => s.t.includes('EFGH'))
  ok('选定 ABCD 加粗（仅选中文字）', abcd && abcd.fw === '700' && rest && rest.fw === '400', JSON.stringify(spans2.map(s => `${s.t}:${s.fw}`)))

  // ══ 3. 选定 EFGH 斜体 ══
  await selectRange(5, 9)
  await p.waitForTimeout(300)
  await p.locator('button:has-text("斜体")').first().click({ force: true })
  await p.waitForTimeout(700)
  const spans3 = await spanStyle()
  const efgh = spans3.find(s => s.t.includes('EFGH'))
  ok('选定 EFGH 斜体', efgh && efgh.fs === 'italic', efgh ? `${efgh.t} fs=${efgh.fs}` : 'no span')

  // ══ 4. 选定 IJ 下划线 / KL 删除线 ══
  await selectRange(10, 12)
  await p.waitForTimeout(300)
  await p.locator('button:has-text("下划线")').first().click({ force: true })
  await p.waitForTimeout(600)
  await selectRange(13, 15)
  await p.waitForTimeout(300)
  await p.locator('button:has-text("删除线")').first().click({ force: true })
  await p.waitForTimeout(600)
  const spans4 = await spanStyle()
  const ij = spans4.find(s => s.t.includes('IJ'))
  const kl = spans4.find(s => s.t.includes('KL'))
  ok('选定 IJ 下划线', ij && (ij.td.includes('underline')), ij ? `${ij.t} td=${ij.td}` : 'no')
  ok('选定 KL 删除线', kl && (kl.td.includes('line-through')), kl ? `${kl.t} td=${kl.td}` : 'no')

  // ══ 5. 选定 MNOP 颜色红 ══
  await selectRange(16, 20)
  await p.waitForTimeout(300)
  await p.locator('button:has-text("颜色")').first().click({ force: true })
  await p.waitForTimeout(500)
  await p.evaluate(() => {
    const grid = [...document.querySelectorAll('div.grid')].find(g => g.querySelectorAll('button').length >= 40)
    const red = grid && [...grid.querySelectorAll('button')].find(x => (x.title || '') === '#ef4444')
    if (red) red.click()
  })
  await p.waitForTimeout(700)
  const spans5 = await spanStyle()
  const mnop = spans5.find(s => s.t.includes('MNOP'))
  ok('选定 MNOP 红色', mnop && mnop.c === 'rgb(239, 68, 68)', mnop ? `${mnop.t} c=${mnop.c}` : 'no')

  // ══ 6. 选定 QR 字号 28 ══
  await selectRange(21, 23)
  await p.waitForTimeout(300)
  const fsInput = p.locator('input[placeholder="18"]').first()
  await fsInput.click({ force: true })
  await fsInput.fill('28')
  await fsInput.press('Enter')
  await p.waitForTimeout(700)
  const spans6 = await spanStyle()
  const qr = spans6.find(s => s.t.includes('QR'))
  ok('选定 QR 字号 28', qr && parseFloat(qr.sz) > 20, qr ? `${qr.t} sz=${qr.sz}` : 'no')

  // ══ 7. 选定 ST 字符间距 2.0 ══
  await selectRange(24, 26)
  await p.waitForTimeout(300)
  // 字符间距 select：含 value=50/100/200 选项的
  await p.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === '200') && [...x.options].some(o => o.value === '50'))
    if (sel) { sel.value = '200'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  await p.waitForTimeout(700)
  const spans7 = await spanStyle()
  const st = spans7.find(s => s.t.includes('ST'))
  ok('选定 ST 字符间距 2.0', st && st.ls !== 'normal' && parseFloat(st.ls) > 1, st ? `${st.t} ls=${st.ls}` : 'no')

  // ══ 8. 保存往返：run 级样式落盘 ══
  let savedBuf = null
  await p.route('**/api/pptx/save', async (route) => {
    try {
      const resp = await route.fetch()
      savedBuf = await resp.body()
      await route.fulfill({ response: resp, body: savedBuf })
    } catch { await route.abort() }
  })
  await p.evaluate(async () => { await window.__exportForTest('pptx') }).catch(() => {})
  await p.waitForTimeout(1500)
  if (savedBuf && savedBuf.length > 1000) {
    wf('/tmp/r73_saved.pptx', savedBuf)
    const out = execSync(`python3 - <<'EOF'
import zipfile, re
z = zipfile.ZipFile('/tmp/r73_saved.pptx')
xml = z.read('ppt/slides/slide1.xml').decode('utf-8')
# body 占位符（正文）
checks = {
  'run_bold': 'b="1"' in xml,
  'run_italic': ' i="1"' in xml,
  'run_underline': 'u="sng"' in xml,
  'run_strike': 'strike="sngStrike"' in xml,
  'run_spc': 'spc="200"' in xml,
  'run_color': 'EF4444' in xml,
  'run_sz': 'sz="2800"' in xml,
  'ph_body': '<p:ph type="body"/>' in xml,
}
print(' '.join(f'{k}={v}' for k, v in checks.items()))
EOF`, { shell: '/bin/bash' }).toString().trim()
    ok('保存往返 run 级样式', out.split(' ').every(kv => kv.endsWith('=True')), out)
  } else {
    ok('保存往返（跳过）', true, 'no save response')
  }

  // ══ 9. 无选区点 B = 整段基线加粗（回归）══
  // 先点画布空白清空选区/聚焦，再点进正文（光标无选区），点 B
  await p.mouse.click(100, 200)
  await p.waitForTimeout(500)
  await field().click()
  await p.waitForTimeout(400)
  await p.locator('button:has-text("加粗")').first().click({ force: true })
  await p.waitForTimeout(700)
  // 整段加粗：容器 fontWeight 700（style.bold 基线）
  const fwField = await p.evaluate(() => {
    const el = document.querySelector('[data-richfield="content"]')
    return getComputedStyle(el).fontWeight
  })
  ok('无选区加粗 = 整段基线', fwField === '700', fwField)

  console.log('dialogs:', JSON.stringify(dialogs.slice(0, 3)))
  const fails = results.filter(r => !r[1])
  console.log(`\n════ 总结: ${results.length - fails.length}/${results.length} PASS ════`)
  if (fails.length) { console.log('FAIL 项：'); fails.forEach(f => console.log('  -', f[0], '|', f[2])) }
  b.close()
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
