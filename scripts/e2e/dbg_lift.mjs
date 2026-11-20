// 调试 lift 逻辑：直接在 PM 里跑，检查 liftListItems 的事务结果
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
  window.__setDocForTest({ blocks: [mk('第一项'), mk('第二项'), mk('第三项')] })
})
await p.waitForSelector('.ProseMirror', { timeout: 15000 })
await p.waitForTimeout(600)
const sel = p.locator('.ProseMirror')
await sel.click()
await p.keyboard.press('Control+a')
const olBtn = p.locator('button[title="有序列表"]')
await olBtn.click()
await p.waitForTimeout(600)
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(300)

// 手动执行一次 lift 的等价事务，观察每步
const r = await p.evaluate(() => {
  const v = window.__pmView
  const { from, to, empty } = v.state.selection
  const items = []
  v.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'list_item') items.push({ pos, node: node.toJSON() })
    return true
  })
  if (!items.length && empty) {
    const $pos = v.state.doc.resolve(from)
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'list_item') { items.push({ pos: $pos.before(d), node: null }); break }
    }
  }
  const tr = v.state.tr
  const log = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const $item = tr.doc.resolve(it.pos)
    const li = $item.nodeAfter
    if (!li || li.type.name !== 'list_item') { log.push(`skip #${i}: nodeAfter=${li ? li.type.name : 'null'}`); continue }
    const itemStart = it.pos
    const contentStart = itemStart + 1
    const contentEnd = itemStart + li.nodeSize - 1
    const slice = tr.doc.slice(contentStart, contentEnd)
    log.push(`lift #${i}: pos=${itemStart} size=${li.nodeSize} content=${JSON.stringify(slice.content.content.map(n => n.type.name + ':' + n.textContent))}`)
    tr.replaceRangeWith(itemStart, itemStart + li.nodeSize, slice.content)
  }
  log.push('docChanged=' + tr.docChanged)
  log.push('after=' + tr.doc.toJSON().content.map(n => n.type.name + (n.content ? '(' + n.content.map(c => c.type.name).join(',') + ')' : '')).join(' '))
  return log
})
console.log(r.join('\n'))
await b.close()
