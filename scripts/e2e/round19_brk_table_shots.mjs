// round19: 跨页表格完整截图 —— 截表格所在的两张纸页区域（页1尾+页2头），验证断口处边框
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

  // 对每张跨页表格（pg-brk-table）：截取【表格顶所在纸页的下半 + 下一页的上半】
  const brkTables = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('table').forEach((t, ti) => {
      const wrap = t.closest('.tableWrapper')
      if (!wrap || !wrap.classList.contains('pg-brk-table')) return
      const rect = t.getBoundingClientRect()
      out.push({ ti, y: Math.round(rect.y), h: Math.round(rect.height), w: Math.round(rect.width), x: Math.round(rect.x) })
    })
    return out
  })
  console.log('跨页表格:', JSON.stringify(brkTables))

  for (const bt of brkTables.slice(0, 3)) {
    // 滚动容器到表格
    await page.evaluate(y => {
      const sc = document.querySelector('.flex-1.overflow-auto')
      sc.scrollTop = Math.max(0, y - 200)
    }, bt.y)
    await page.waitForTimeout(600)
    // 重新取 rect（滚动后变化）
    const rect = await page.evaluate(ti => {
      const t = document.querySelectorAll('table')[ti]
      const r = t.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }, bt.ti)
    // 截整张表格（分两段，各 750px 高）
    const clampShot = (path, y0, h) => page.screenshot({
      path,
      clip: {
        x: Math.max(0, rect.x - 40),
        y: Math.max(0, Math.min(y0, 900 - 10)),
        width: Math.min(rect.w + 80, 1340),
        height: Math.max(30, Math.min(h, 900 - Math.max(0, Math.min(y0, 890)))),
      },
    })
    await clampShot(join(SHOTS, `brk-t${bt.ti}-a.png`), Math.max(0, rect.y - 20), Math.min(750, rect.h + 40))
    // 第二段：滚动后再截
    if (rect.h > 730) {
      await page.evaluate(y => {
        const sc = document.querySelector('.flex-1.overflow-auto')
        sc.scrollTop = sc.scrollTop + 700
      }, rect.y)
      await page.waitForTimeout(500)
      const rect2 = await page.evaluate(ti => {
        const t = document.querySelectorAll('table')[ti]
        const r = t.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }, bt.ti)
      await page.screenshot({
        path: join(SHOTS, `brk-t${bt.ti}-b.png`),
        clip: { x: Math.max(0, rect2.x - 40), y: Math.max(0, rect2.y - 20), width: Math.min(rect2.w + 80, 1340), height: Math.min(750, 900 - Math.max(0, rect2.y - 20)) },
      })
    }
    console.log(`t${bt.ti} 两段截图完成`)
  }
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
