// 调试保存菜单路径
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
  window.__setDocForTest({ blocks: [mk('第一项')] })
})
await p.waitForSelector('.ProseMirror', { timeout: 15000 })
await p.waitForTimeout(600)

// 打开顶部菜单
const menuBtns = await p.evaluate(() => Array.from(document.querySelectorAll('button')).map((b, i) => ({ i, t: (b.textContent || '').trim().slice(0, 14), title: b.title })).filter(x => x.t))
console.log('buttons:', JSON.stringify(menuBtns.slice(0, 20)))

// 找 Files/文件 菜单
const filesBtn = menuBtns.find(m => /Files|文件/.test(m.t))
if (filesBtn) {
  await p.evaluate((i) => { document.querySelectorAll('button')[i].click() }, filesBtn.i)
  await p.waitForTimeout(500)
  const items = await p.evaluate(() => Array.from(document.querySelectorAll('button, div, [role=menuitem]')).map((e, i) => ({ i, t: (e.textContent || '').trim().slice(0, 20) })).filter(x => x.t && x.t.length < 20).slice(0, 40))
  console.log('menu items:', JSON.stringify(items))
}
await b.close()
