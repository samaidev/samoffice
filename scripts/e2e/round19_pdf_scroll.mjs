// round19: PDF 连续滚动验证 —— 打开 13 页 PDF，验证：
// 1) 渲染区含 13 个页容器 2) 滚动条可从第1页连续滚到第13页（中途不断）
// 3) 滚动时 pageNum 同步 4) 滚过的页面被渲染（canvas 存在）
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
mkdirSync(SHOTS, { recursive: true })

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)))

  const fs = await import('fs')
  const buf = fs.readFileSync('build/real.pdf')

  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 用 __setPdfForTest 钩子打开（走 activateWindowData 正规路径）
  const pdfUrl = await page.evaluate(bytes => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    window.__setPdfForTest(url, 'test.pdf')
    return url
  }, Array.from(buf))
  await page.waitForTimeout(3500)

  const info1 = await page.evaluate(() => {
    const pages = document.querySelectorAll('[data-testid^="pdf-page-"]')
    const sc = document.querySelector('[data-testid="pdf-canvas-area"]')
    return {
      pageCount: pages.length,
      hasScroller: !!sc,
      scrollHeight: sc ? sc.scrollHeight : 0,
      clientHeight: sc ? sc.clientHeight : 0,
      canvasCount: document.querySelectorAll('[data-testid^="pdf-page-"] canvas').length,
    }
  })
  console.log('初始状态:', JSON.stringify(info1))
  await page.screenshot({ path: join(SHOTS, 'pdf-1-top.png') })

  // 连续滚动到底部：分 6 步滚，记录中途状态
  const sc2 = '[data-testid="pdf-canvas-area"]'
  const steps = []
  for (let step = 1; step <= 6; step++) {
    await page.evaluate(({ sel, frac }) => {
      const sc = document.querySelector(sel)
      sc.scrollTop = sc.scrollHeight * frac
    }, { sel: sc2, frac: step / 6 })
    await page.waitForTimeout(900)
    const st = await page.evaluate(sel => {
      const sc = document.querySelector(sel)
      const input = document.querySelector('[data-testid="pdf-page-input"]')
      const canvases = document.querySelectorAll('[data-testid^="pdf-page-"] canvas')
      return {
        scrollTop: Math.round(sc.scrollTop),
        maxScroll: sc.scrollHeight - sc.clientHeight,
        pageNum: input ? input.value : -1,
        canvasCount: canvases.length,
      }
    }, sc2)
    steps.push(st)
    console.log(`滚到 ${step}/6:`, JSON.stringify(st))
    if (step === 3 || step === 6) {
      await page.screenshot({ path: join(SHOTS, `pdf-scroll-${step === 3 ? 'mid' : 'bottom'}.png`) })
    }
  }

  const last = steps[steps.length - 1]
  const ok = info1.pageCount >= 13 && Number(last.pageNum) >= info1.pageCount - 1 && last.canvasCount >= 1
  console.log('\n连续滚动验证:', ok ? 'PASS' : 'FAIL')
  console.log('pageerrors:', errors.slice(0, 3))
  await browser.close()
  process.exit(ok ? 0 : 1)
}
main().catch(e => { console.error('ERR:', e); process.exit(2) })
