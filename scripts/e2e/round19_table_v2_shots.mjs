// round19: 修复后的表格截图 — 对每张表截取其【首个分片】（scrollIntoView 后整屏），
// 跨页表格额外截第二屏。整屏截图保证不受 clip 裁切影响。
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const fs = await import('fs')
  const buf = fs.readFileSync(DOC)
  const form = new FormData()
  form.append('file', new Blob([buf]), 'china.doc')
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2800)

  const n = await page.evaluate(() => document.querySelectorAll('table').length)
  for (let i = 0; i < n; i++) {
    await page.evaluate(idx => {
      const t = document.querySelectorAll('table')[idx]
      t.scrollIntoView({ block: 'start' })
    }, i)
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(SHOTS, `v2-t${i}-a.png`) })
    // 跨页表格：往下滚一屏截第二段
    const isBrk = await page.evaluate(idx => {
      const t = document.querySelectorAll('table')[idx]
      return t.closest('.tableWrapper').classList.contains('pg-brk-table')
    }, i)
    if (isBrk) {
      await page.evaluate(() => {
        const sc = document.querySelector('.flex-1.overflow-auto')
        sc.scrollTop += 750
      })
      await page.waitForTimeout(700)
      await page.screenshot({ path: join(SHOTS, `v2-t${i}-b.png`) })
    }
    console.log(`t${i} ${isBrk ? '(跨页, 2屏)' : '(单页, 1屏)'} done`)
  }
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
