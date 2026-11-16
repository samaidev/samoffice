// 重写 DOM + 新建 PM（含表格）→ ALIVE！
// → 死区不是 PM 的 selectionchange 本身，而是【应用里某个额外监听/观察者】。
// document 上 3 个 selectionchange：PM 1 个 + 2 个来自应用（spellPlugin?
// Ruler? DocumentEditor 的 effect？）。还有 document mousemove。
// ★ 精确定位：劫持 addEventListener 记录调用栈 —— 在页面加载前注入
//（addInitScript），捕获所有 selectionchange/mousemove 注册的栈，定位源码。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } })
await ctx.addInitScript(() => {
  window.__reg = []
  const orig = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'selectionchange' || (type === 'mousemove' && (this === document || this === window))) {
      const stack = (new Error().stack || '').split('\n').slice(2, 6).join(' | ').slice(0, 300)
      window.__reg.push(type + ' @' + (this === document ? 'document' : this === window ? 'window' : this.tagName || '?') + ' ← ' + stack)
    }
    return orig.call(this, type, fn, opts)
  }
})
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const regs = await p.evaluate(() => window.__reg)
console.log('注册记录:', JSON.stringify(regs, null, 1))
await b.close()
