import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
const dump = async (label) => {
  const out = await p.evaluate(() => {
    // 主画布：class 含 canvas 或宽 808 的最大容器
    const host = [...document.querySelectorAll('div')]
      .filter(d => { const r = d.getBoundingClientRect(); return Math.abs(r.width - 808) < 3 && r.height > 500 })
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
    if (!host) return { err: 'no 808 host' }
    const kids = [...host.querySelectorAll('*')].slice(0, 60).map(e => e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')).filter(s => !s.startsWith('#'))
    return {
      h: Math.round(host.getBoundingClientRect().height),
      html: host.innerHTML.slice(0, 300),
      kidKinds: kids.slice(0, 30),
      txt: (host.textContent || '').replace(/\s+/g, ' ').slice(0, 80),
      clipCount: host.querySelectorAll('[style*="clip-path"]').length,
      contentEditable: !!host.querySelector('[contenteditable]'),
    }
  })
  console.log(`===== ${label} =====`)
  console.log(JSON.stringify(out, null, 1))
}
await dump('页1 初始')
for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(280) }
await p.waitForTimeout(700)
await dump('页5')
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(900)
await dump('页6')
await b.close()
