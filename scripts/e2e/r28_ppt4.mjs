// 走真实打开流程：监听 filechooser → 上传 pptx → SlideEditor 渲染 → 逐页截图
import { chromium } from 'playwright'
import fs from 'fs'
const FILE = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 120)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 找「打开」入口（Home 标签里的 Open 按钮）
const opened = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const ob = btns.find(x => /open/i.test(x.textContent || '') && x.offsetParent !== null)
  if (ob) { ob.click(); return ob.textContent?.trim().slice(0, 10) }
  return null
})
console.log('Open 按钮:', JSON.stringify(opened))
const chooser = await p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null)
if (!chooser) {
  console.log('无 filechooser —— 列出可见按钮:')
  const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(x => x.textContent?.trim()).filter(Boolean).slice(0, 25))
  console.log(JSON.stringify(btns))
} else {
  await chooser.setFiles(FILE)
  console.log('已上传，等待渲染...')
  await p.waitForTimeout(6000)
  const st = await p.evaluate(() => ({
    slidePanels: document.querySelectorAll('[class*=slide]').length,
    canvases: document.querySelectorAll('canvas').length,
    svgs: document.querySelectorAll('svg').length,
    imgs: document.querySelectorAll('img').length,
  }))
  console.log('渲染状态:', JSON.stringify(st))
  await p.screenshot({ path: '/tmp/ppt_sam1.png' })
  console.log('截图 /tmp/ppt_sam1.png')
}
await b.close()
