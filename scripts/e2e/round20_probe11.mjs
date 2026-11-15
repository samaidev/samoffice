// 视口下半部分 (y>=550) 全部死区！这不是表格问题 —— 是视口底部的【某个覆盖层】
// 拦截鼠标。查 y=550-900 区域覆盖在页面上的元素（fixed 定位）：
import { chromium } from 'playwright'
import fs from 'fs'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const overlays = await p.evaluate(() => {
  const out = []
  document.querySelectorAll('body *').forEach(el => {
    const s = getComputedStyle(el)
    if ((s.position === 'fixed' || s.position === 'sticky') && s.pointerEvents !== 'none' && el.offsetWidth > 100) {
      const r = el.getBoundingClientRect()
      if (r.height > 0) {
        out.push({
          tag: el.tagName, cls: (el.className?.toString().slice(0, 40) || ''),
          pos: s.position, pe: s.pointerEvents,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        })
      }
    }
  })
  return out
})
console.log('fixed/sticky 可交互层:', JSON.stringify(overlays, null, 1).slice(0, 1500))
await b.close()
