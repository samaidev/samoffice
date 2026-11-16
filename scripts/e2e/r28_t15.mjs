// DOM 9 行 = doc 9 行（无分页副本），全部 tr 都在 9957-10382 区域。
// 所以 DOM-sel 同步的 tdEl 就在视口附近 —— addRange 不会导致滚到 16142。
// ★★★ 回到时间线：跳变发生在点击后 0-280ms。这段里发生什么：
// mousedown(proxy, pd) → applySel(0ms): dispatch+focus+addRange → 
// mouseup(pd) → click → 浏览器默认 focus 处理 → applySel(60ms 补刀)。
// 跳到 16142（参考文献）—— 唯一能在那个方向滚动的：scrollIntoView
// 调用或「focus 到末尾元素」。◆ 手段：劫持 scrollIntoView 记录调用栈！
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
// 劫持 Element.prototype.scrollIntoView + scrollTop 赋值
await p.evaluate(() => {
  window.__scr = []
  const orig = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (...a) {
    try { window.__scr.push('SIV:' + this.tagName + ':' + (this.textContent || '').slice(0, 10) + '|' + (new Error().stack || '').split('\n')[2].trim().slice(0, 80)) } catch {}
    return orig.apply(this, a)
  }
  const sc = document.querySelector('.overflow-auto')
  let lastTop = sc.scrollTop
  Object.defineProperty(sc, 'scrollTop', {
    get() { return lastTop },
    set(v) { window.__scr.push('SET:' + v + '|' + (new Error().stack || '').split('\n').slice(1, 3).map(x => x.trim().slice(0, 60)).join(' <- ')); lastTop = v },
    configurable: true,
  })
})
let box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[6].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
await p.evaluate(() => { window.__scr = [] }) // 只看第二次点击
box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[8].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const scr = await p.evaluate(() => [...window.__scr].slice(0, 8))
console.log('滚动来源:')
scr.forEach(s => console.log(' ', s))
await b.close()
