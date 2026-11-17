import { chromium } from 'playwright'
import { execSync } from 'child_process'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR: ' + e.message.slice(0, 200)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// instrument tbody 重建检测
await p.evaluate(() => {
  window.__rebuilds = 0
  const tb = document.querySelector('table tbody')
  new MutationObserver((muts) => {
    for (const m of muts) if (m.addedNodes.length > 2 || m.removedNodes.length > 2) window.__rebuilds++
  }).observe(tb, { childList: true, subtree: true })
})
// 1) 点击 idx20（"a" 格）→ 打字 "XY"
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
await p.keyboard.type('XY')
await p.waitForTimeout(600)
const after = await p.evaluate(() => {
  const cells = document.querySelectorAll('table td, table th')
  return {
    cell20: (cells[20]?.textContent || '').slice(0, 8),
    rebuilds: window.__rebuilds,
    selCell: (window.getSelection()?.focusNode?.parentElement?.closest('td')?.textContent || '').slice(0, 8),
  }
})
console.log('点击"敲入 XY"后:', JSON.stringify(after))
// 2) 连续点击多个格（模拟用户切格编辑）→ 检查重建次数 + 滚动稳定性
const scroll0 = await p.evaluate(() => document.querySelector('.overflow-auto').scrollTop)
for (const idx of [0, 8, 16, 24, 32]) {
  const bb = await p.evaluate((i) => {
    const cell = document.querySelectorAll('table td, table th')[i]
    const r = cell.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, idx)
  await p.mouse.click(bb.x, bb.y)
  await p.waitForTimeout(250)
}
await p.waitForTimeout(600)
const final = await p.evaluate(() => ({
  rebuilds: window.__rebuilds,
  selCell: (window.getSelection()?.focusNode?.parentElement?.closest('td')?.textContent || '【无】').slice(0, 8),
}))
const scroll1 = await p.evaluate(() => document.querySelector('.overflow-auto').scrollTop)
console.log('连续点击 5 格后:', JSON.stringify(final), '滚动漂移:', Math.abs(scroll1 - scroll0), 'px')
await p.screenshot({ path: '/tmp/r33_after.png' })
await b.close()
console.log('DONE')
