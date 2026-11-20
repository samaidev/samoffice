// 调试2：Ctrl+A + ol 后文档结构 + ArrowLeft 后文档结构
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
const dump = () => p.evaluate(() => {
  const j = window.__pmView.state.doc.toJSON()
  const walk = (n, d) => {
    const pad = '  '.repeat(d)
    let s = pad + n.type
    if (n.content) s += '\n' + n.content.map(c => walk(c, d + 1)).join('\n')
    if (n.text) s += ' "' + n.text + '"'
    return s
  }
  return j.content.map(c => walk(c, 0)).join('\n')
})
await sel.click()
console.log('--- after plain click (before Ctrl+A) ---')
console.log(await dump())
await p.keyboard.press('Control+a')
const olBtn = p.locator('button[title="有序列表"]')
await olBtn.click()
await p.waitForTimeout(600)

console.log('--- after Ctrl+A + ol ---')
console.log(await dump())

await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(300)
console.log('--- after ArrowLeft ---')
console.log(await dump())

// 现在试 lift：调用按钮
await olBtn.click()
await p.waitForTimeout(500)
console.log('--- after 2nd ol click (toggle off) ---')
console.log(await dump())
console.log('DOM text:', await p.evaluate(() => document.querySelector('.ProseMirror').innerText.replace(/\n/g, '|')))
await b.close()
