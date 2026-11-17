// 排查：①为何放映按钮 null 却出现放映态 ②回车为何没翻页（→ 却可以）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 120)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
// 1) 当前是否已在放映态？（fixed inset-0 黑底容器）
const st0 = await p.evaluate(() => ({
  presenting: !!document.querySelector('.fixed.inset-0'),
  presentBtn: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null && /from current|from start|从头开始|从当前/.test((x.textContent || '') + (x.title || ''))).length,
  playBtn: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null && (x.textContent || '').includes('放映')).length,
}))
console.log('初始状态:', JSON.stringify(st0))
// 2) View 标签下的按钮列表
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(500)
const viewBtns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(x => (x.textContent || '').trim()).filter(t => t && t.length < 20).slice(-15))
console.log('View 标签按钮:', JSON.stringify(viewBtns))
await b.close()
