// ★★★★★ 决定性 A/B：
//   克隆（新节点）放 body → 命中 clone-body ✅
//   【原 wrapper 节点】转移到 body → 未命中（事件丢失）！
// 结论反转：**问题绑在 wrapper 节点本身**（不是位置/父链）！
// 新节点在同位置活、原 PM NodeView 节点在任何位置都死。
// PM NodeView 的 dom 有什么特别？—— PM 会在 NodeView dom 上挂
// 【pmViewDesc 属性】（JS 属性，不影响浏览器）。但浏览器层面……
// ★★ 等等：克隆时 cloneNode(true) —— 若 wrapper 上有 expando 属性
//（如 contenteditable="false"？表格 NodeView 常见 contenteditable=false！）
// outerHTML 会带（我们提取过：cls=tableWrapper style 空 —— 没有 ce=false）。
// ★★★ 直接 diff 原节点 vs 克隆的全部 DOM 属性 + 事件计数：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const diff = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const clone = w.cloneNode(true)
  const attrsOf = (el) => [...el.attributes].map(a => a.name + '=' + a.value.slice(0, 40))
  const styleOf = (el) => {
    const s = getComputedStyle(el)
    return ['display','position','transform','contain','contentVisibility','visibility','opacity','isolation','zIndex','pointerEvents'].map(k => k + ':' + s[k]).join(' ')
  }
  return {
    origAttrs: attrsOf(w), cloneAttrs: attrsOf(clone),
    origStyle: styleOf(w), cloneStyle: styleOf(clone),
    origParentTag: w.parentElement?.tagName + '.' + (w.parentElement?.className || '').toString().slice(0, 20),
    // NodeView 特征：pmViewDesc?
    hasDesc: 'pmViewDesc' in w,
    descType: w.pmViewDesc?.constructor?.name,
    childDesc: w.querySelector("tbody")?.pmViewDesc?.constructor?.name,
  }
})
console.log(JSON.stringify(diff, null, 1))
await b.close()
