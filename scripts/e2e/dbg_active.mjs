// 调试激活态 + toggle 嵌套问题
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
  window.__setDocForTest({ blocks: [mk('第一项'), mk('第二项'), mk('第三项')] })
})
await p.waitForSelector('.ProseMirror', { timeout: 15000 })
await p.waitForTimeout(600)
const sel = p.locator('.ProseMirror')
await sel.click()
await p.keyboard.press('Control+a')
const olBtn = p.locator('button[title="有序列表"]')
await olBtn.click()
await p.waitForTimeout(600)

// 状态检查：selection + active class
const state1 = await p.evaluate(() => {
  const v = window.__pmView
  const s = v.state.selection
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.title === '有序列表')
  return {
    from: s.from, to: s.to, empty: s.empty,
    active: btn ? btn.classList.contains('active') : 'no-btn',
    olCount: document.querySelectorAll('.ProseMirror ol').length,
  }
})
console.log('after Ctrl+A + ol:', JSON.stringify(state1))

// 光标移到列表第一行（ArrowLeft 收缩选区到起点）
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(400)
const state2 = await p.evaluate(() => {
  const v = window.__pmView
  const s = v.state.selection
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.title === '有序列表')
  return { from: s.from, to: s.to, active: btn ? btn.classList.contains('active') : 'no-btn' }
})
console.log('after ArrowLeft:', JSON.stringify(state2))

// 再点 ol 按钮 —— 应取消
await olBtn.click()
await p.waitForTimeout(500)
const state3 = await p.evaluate(() => ({
  ol: document.querySelectorAll('.ProseMirror ol').length,
  ul: document.querySelectorAll('.ProseMirror ul').length,
  text: document.querySelector('.ProseMirror').innerText.replace(/\n/g, '|'),
}))
console.log('after 2nd ol click:', JSON.stringify(state3))
await b.close()
