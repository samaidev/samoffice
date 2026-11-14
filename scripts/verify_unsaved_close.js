/**
 * 验证「文档有未保存修改时关闭要提示」。
 *
 * 覆盖：
 *  1. 刚打开的文档不脏（无 • 标记）—— 防止"一打开就提示"的误报
 *  2. 编辑后变脏（出现 •）
 *  3. 撤销回原样后不再脏 —— 验证是"内容比对"而非"编辑即脏"
 *  4. 关闭脏标签弹出三按钮确认框
 *  5. 「取消」→ 标签保留，内容不丢
 *  6. 「不保存」→ 标签关闭
 *  7. Esc 等价于取消
 *
 * 前置：npx vite --port 5199（在 frontend 目录）
 * 运行：node scripts/verify_unsaved_close.js
 */
const { firefox } = require('playwright')

const URL = process.env.APP_URL || 'http://[::1]:5199/'
let failed = 0
const check = (c, m) => { if (!c) failed++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`) }

const DOC = {
  path: 'probe.docx',
  document: { meta: { title: 'probe' }, blocks: [{ inline: [{ content: 'original text' }] }] },
}

async function openDoc(p) {
  await p.route('**/api/doc/open', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(DOC),
  }))
  const dt = await p.evaluateHandle(() => {
    const d = new DataTransfer()
    d.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'probe.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    return d
  })
  await p.locator('#root > div').first().dispatchEvent('drop', { dataTransfer: dt })
  await p.waitForSelector('.ProseMirror', { timeout: 10000 })
  await p.waitForTimeout(800)
}

;(async () => {
  const browser = await firefox.launch()
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', e.message))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await openDoc(page)

  const dots = page.locator('[data-testid^="tab-dirty-"]')
  const closeX = page.locator('span').filter({ hasText: /^✕$/ }).first()
  const dlg = page.locator('[data-testid="confirm-unsaved"]')
  const editor = page.locator('.ProseMirror').first()

  // 1. 刚打开不脏
  check((await dots.count()) === 0, '刚打开的文档不脏（无误报）')

  // 2. 编辑 → 脏
  await editor.click()
  await page.keyboard.type('XYZ')
  await page.waitForTimeout(700)
  check((await dots.count()) === 1, '编辑后出现 • 脏标记')

  // 3. 撤销回原样 → 不脏
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(60) }
  await page.waitForTimeout(700)
  check((await dots.count()) === 0, '撤销回原样后 • 消失（内容比对精确）')

  // 重新弄脏
  await editor.click()
  await page.keyboard.type('DIRTY')
  await page.waitForTimeout(700)
  check((await dots.count()) === 1, '再次编辑后重新变脏')

  // 4. 关闭 → 弹框
  await closeX.click({ force: true })
  await page.waitForTimeout(500)
  check((await dlg.count()) === 1, '关闭脏标签时弹出确认框')
  const btns = await page.locator('button[data-testid^="confirm-"]').count()
  check(btns === 3, `确认框为三按钮：保存/不保存/取消（实际 ${btns}）`)

  // 5. 取消 → 标签保留
  await page.locator('[data-testid="confirm-cancel"]').click()
  await page.waitForTimeout(500)
  check((await dlg.count()) === 0, '「取消」后确认框关闭')
  check((await page.locator('.ProseMirror').count()) === 1, '「取消」后文档仍在，内容未丢')

  // 7. Esc 等价取消
  await closeX.click({ force: true })
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check((await dlg.count()) === 0 && (await page.locator('.ProseMirror').count()) === 1,
    'Esc 等价于「取消」')

  // 6. 不保存 → 关闭
  await closeX.click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-testid="confirm-discard"]').click()
  await page.waitForTimeout(800)
  check((await page.locator('span').filter({ hasText: /^✕$/ }).count()) === 0,
    '「不保存」后标签被关闭')

  await browser.close()
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
