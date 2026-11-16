// withtimeout/withdispatch 都活！blob module 的完整逻辑层活！
// 那 t22 的死因不在 handler —— t22 与 t24-withdispatch 的差异：
// t22 删了产品 proxy【之后建】；t24 只删自己的 data-variant 层。
// ★★★ t22 建层时【产品 proxy 刚被删】—— 死区也许与【删除一个已存在的
// 层】有关（Chromium 对被删层的区域标记 pending/损坏 —— 新层放同位置
// 也死！）t24 没删产品 proxy（只删 data-variant）—— 产品 proxy 一直在
// —— 但 t24 层 z7 在产品 proxy z6 之上 —— 活。
// ★★★★★ 全新模型：**「替换」死区** —— 位置上曾有死层，删除后新层同位
// 也死！t22 = 删产品层+建 = 「替换」= 死！
// 一致性检查：
//  - fv22 改名+移位原 proxy（不删不建）= 死 ✓（原死层还在）
//  - fv22 同名新层（不删原层，z 更高叠加）= 活 ✓
//  - t19 产品层（首建，无删除）= 死 ✗ —— 不一致！产品首建时该位置无层
//    —— 应该活！但它死……
// ◆ 除非产品层建的位置【曾有 PM 内的 wrapper 死区】—— 对！位置本身
// 是 wrapper 的（死区源头），新层 alpha>0 应覆盖…… t21/t24 层活了
// 说明「死区上叠活层」可行。产品层死 = 它不在「死区上叠加」而是……
// ★★★★ 等等 —— 回到被忽略的物理事实：t24 的层 z-index:7 —— 
// 产品层 z-index:6！pm-host 里有没有 z 6-7 之间的层？行号层 z:2、
// 手柄 z:5 —— proxy z6 已在顶。但 —— 【Ruler 组件 zIndex 5】+
// 【分页装饰】…… 
// ◆ 一击必杀验证：产品层 z 改 7（只改 z-index）能否复活：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(5000) // 产品层已建（2s/4s channel）
// 检查产品层 z 与所有兄弟层 z
const zinfo = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const host = proxy.parentElement
  const sibs = [...host.children].map(c => ({ tag: c.tagName, cls: (c.className || '').toString().slice(0, 22), z: getComputedStyle(c).zIndex, pos: getComputedStyle(c).position }))
  return { proxyZ: getComputedStyle(proxy).zIndex, sibs }
})
console.log(JSON.stringify(zinfo, null, 1))
await b.close()
