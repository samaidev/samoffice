// 调试查找栏 DOM 结构
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1360, height: 900 } })
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => {
  const mk = (t) => ({ inline: [{ content: t }], style: '', align: '' })
  window.__setDocForTest({ blocks: [mk('节能收益测试段落一'), mk('能源收益测试段落二')] })
})
await p.waitForSelector('.ProseMirror', { timeout: 15000 })
await p.waitForTimeout(600)
await p.locator('.ProseMirror').click()
await p.keyboard.press('Control+f')
await p.waitForTimeout(500)

const info = await p.evaluate(() => {
  const bar = document.querySelector('.animate-fade-in')
  const inputs = bar ? Array.from(bar.querySelectorAll('input')).map(i => ({ ph: i.placeholder, cls: i.className })) : null
  const btns = bar ? Array.from(bar.querySelectorAll('button')).map(b => (b.textContent || '').trim()) : null
  return { hasBar: !!bar, inputs, btns }
})
console.log('search bar:', JSON.stringify(info, null, 1))
await b.close()
