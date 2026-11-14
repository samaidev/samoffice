// round19: Excel 单元格输入复现 —— 打开 xlsx（走 __setSheetForTest 若有，否则造空表），
// 双击单元格 → 输入字符 → 验证输入框出现且值进入单元格
import { chromium } from 'playwright'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 150)))
  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 打开 xlsx：App 层看有没有表格测试钩子；没有就触发 drag&drop 不行——
  // 直接查 App 的 openFile 流程的 server 端点，从 fetch 层注入。
  const fs = await import('fs')
  const buf = fs.readFileSync('_verify/complex.xlsx')
  const resp = await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    // 模拟 drop 事件不可靠；看 window 上有什么 E2E 钩子
    return { hooks: Object.keys(window).filter(k => k.startsWith('__set') || k.startsWith('__')) }
  }, Array.from(buf))
  console.log('可用钩子:', JSON.stringify(resp.hooks))
  await page.screenshot({ path: join(SHOTS, 'xls-probe.png') })
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
