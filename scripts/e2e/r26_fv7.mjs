// style 零变化。那只剩一个差异了：**proxy 的 mousedown 监听器**！
// fv3 裸层：addEventListener('mousedown', fn) —— 无参调用。
// 正式代码：同一个 addEventListener('mousedown', fn) —— 相同……
// 不，还有 mouseup preventDefault + mousedown 里的 preventDefault+setTimeout。
// fv3 的层 fn 只记 'hit'。正式代码 fn preventDefault() —— 
// preventDefault 本身不阻止【到达】（capture 计数器先于 handler）。
// ◆ 唯一未验证的：正式 proxy 的【创建者是 DocTableView 的 setTimeout】，
// fv3 的创建者是 evaluate 的 setTimeout —— 执行上下文无差。
// ★★★ 最后怀疑：**proxy 位置**！正式 proxy left/top 由 syncProxyGeometry
// 设置 —— 它挂 pm-host；fv3 层也挂 pm-host —— 相同。
// ◆◆ 直接对比同页面两个层（正式 proxy vs 并排新建层）的 rect + 层级：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(4000)
const cmp = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const w = document.querySelector('.tableWrapper')
  // 建对照层（同位置同样式）
  const host = proxy.parentElement
  const twin = document.createElement('div')
  const pr = proxy.getBoundingClientRect()
  twin.style.cssText = `position:absolute;left:${pr.left}px;top:${pr.top}px;width:${pr.width}px;height:${pr.height}px;z-index:6;background:transparent`
  window.__twinHit = ''
  twin.addEventListener('mousedown', () => { window.__twinHit = 'twin' })
  host.appendChild(twin)
  const wr = w.getBoundingClientRect()
  return {
    proxy: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height), z: getComputedStyle(proxy).zIndex, pe: getComputedStyle(proxy).pointerEvents, display: getComputedStyle(proxy).display, pos: getComputedStyle(proxy).position },
    wrapper: { x: Math.round(wr.x), y: Math.round(wr.y) },
    clickPt: { x: wr.x + wr.width * 0.6, y: wr.y + wr.height * 0.5 },
  }
})
console.log('对比:', JSON.stringify(cmp, null, 1))
await p.mouse.click(cmp.clickPt.x, cmp.clickPt.y)
await p.waitForTimeout(300)
console.log('twin 收到:', await p.evaluate(() => window.__twinHit) || '无')
console.log('谁在顶层:', JSON.stringify(await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.tagName + '.' + (el?.className || '').toString().slice(0, 30) }, [cmp.clickPt.x, cmp.clickPt.y])))
await b.close()
