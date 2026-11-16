// DOM/CSS 全灭。剩最后一条路：**确认这是否为 headless/new-headless 特有**。
// 我们的目标环境是 WebView2（shan 用户）—— 若 WebView2 正常而 Playwright
// headless 复现，则该 bug 不影响真实用户！之前 xvfb headed 也复现过
//（r26_headed_tmp）—— 但那也是 Playwright 的 Chromium 1200。
// ★ 测试不同启动方式：chromium channel / --headless=new / --headless=old
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const launchAndTest = async (label, opts) => {
  const b = await chromium.launch(opts)
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.setDefaultTimeout(30000)
  try {
    await p.goto(BASE, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
      { type: 'p', inline: [{ content: '段落内容' }] },
      { type: 'table', rows: [
        [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
        [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
      ] },
    ] }))
    await p.waitForTimeout(3000)
    await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
    const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
    await p.mouse.click(box.x, box.y)
    await p.waitForTimeout(250)
    console.log(`${label}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
  } catch (e) {
    console.log(`${label}: ERR ${e.message.slice(0, 80)}`)
  }
  await b.close()
}
await launchAndTest('headless(new, 默认)', { args: ['--no-sandbox'] })
await launchAndTest('headless=old', { args: ['--no-sandbox', '--headless=old'] })
await launchAndTest('禁 GPU 合成', { args: ['--no-sandbox', '--disable-gpu'] })
await launchAndTest('禁 compositor 部分特性', { args: ['--no-sandbox', '--disable-features=CalculateNativeWinOcclusion'] })
await launchAndTest('强制 software 渲染', { args: ['--no-sandbox', '--disable-gpu-compositing'] })
