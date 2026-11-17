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
await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Files')); btn?.click() })
await p.waitForTimeout(600)
// 逐个列出 Open File 附近的元素 tag/结构
const els = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('*')) {
    if (el.offsetParent !== null && (el.textContent || '').includes('Open File') && el.children.length <= 2) {
      out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), txt: el.textContent?.slice(0, 20) })
      if (out.length >= 5) break
    }
  }
  return out
})
console.log('OpenFile 元素:', JSON.stringify(els, null, 1))
// 点击最内层
const clicked = await p.evaluate(() => {
  const cands = [...document.querySelectorAll('*')].filter(el => el.offsetParent !== null && (el.textContent || '').includes('Open File') && el.children.length === 0)
  const el = cands[cands.length - 1]
  if (el) { (el.closest('button,[role=menuitem],div[class*=item]') || el).click(); return el.tagName }
  return null
})
console.log('点了:', clicked)
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
  }))
  console.log('渲染状态:', JSON.stringify(st))
  await p.screenshot({ path: '/tmp/ppt_sam1.png' })
  console.log('截图 OK')
} else {
  console.log('仍无 filechooser')
}
await b.close()
