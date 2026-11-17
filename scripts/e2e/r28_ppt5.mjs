import { chromium } from 'playwright'
import fs from 'fs'
const FILE = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 点 Files 菜单
await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Files')); btn?.click() })
await p.waitForTimeout(600)
const menu = await p.evaluate(() => [...document.querySelectorAll('button,[role=menuitem],a')].filter(x => x.offsetParent !== null).map(x => x.textContent?.trim()).filter(Boolean).slice(0, 20))
console.log('Files 菜单:', JSON.stringify(menu))
// 找 Open 菜单项
const openItem = await p.evaluate(() => {
  const items = [...document.querySelectorAll('button,[role=menuitem],a,div')]
  const it = items.find(x => x.offsetParent !== null && (x.textContent || '').includes('Open File') && x.textContent.length < 15)
  if (it) { it.click(); return it.textContent.trim() }
  return null
})
console.log('点了:', JSON.stringify(openItem))
const chooser = await p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null)
if (chooser) {
  await chooser.setFiles(FILE)
  console.log('已上传...')
  await p.waitForTimeout(7000)
  const st = await p.evaluate(() => ({
    slideEls: document.querySelectorAll('[class*=slide]').length,
    canvases: document.querySelectorAll('canvas').length,
    svgs: document.querySelectorAll('svg').length,
    imgs: document.querySelectorAll('img').length,
    tabActive: document.querySelector('[class*=active]')?.textContent?.slice(0, 20),
  }))
  console.log('渲染状态:', JSON.stringify(st))
  await p.screenshot({ path: '/tmp/ppt_sam1.png' })
  console.log('截图 OK')
} else {
  console.log('仍无 filechooser')
}
await b.close()
