import { chromium } from 'playwright'
import fs from 'fs'
// round26 问题2复现：Word 表格单个格子点击无法获得光标。
// 用带表格的合同文档，点击第二个单元格中心（避开全选手柄/边框容差），观察：
// 1) elementFromPoint 命中什么 2) 点击后 selection 类型 3) 打字是否进入单元格
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)

// 找一个表格并点击多个不同格子
const cells = p.locator('.ProseMirror td')
const n = await cells.count()
console.log('td count:', n)
if (n === 0) { console.log('NO TABLE in doc'); await b.close(); process.exit(0) }

for (const idx of [0, Math.min(1, n - 1), Math.min(2, n - 1)]) {
  const td = cells.nth(idx)
  await td.scrollIntoViewIfNeeded()
  await p.waitForTimeout(300)
  const cb = await td.boundingBox()
  // 点格子中心偏右下（避开左上角手柄热区和边框 4px 容差）
  const cx = cb.x + cb.width * 0.7, cy = cb.y + cb.height * 0.6
  const hit = await p.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return {
      tag: el?.tagName,
      cls: (el?.className || '').toString().slice(0, 70),
      parentTag: el?.parentElement?.tagName,
      hasHandle: !!el?.closest('.pm-table-handle'),
      inCell: !!el?.closest('td,th'),
    }
  }, [cx, cy])
  await p.mouse.click(cx, cy)
  await p.waitForTimeout(350)
  const sel = await p.evaluate(() => {
    const v = window.__pmView
    const s = v?.state?.selection
    return {
      type: s?.type?.name || s?.constructor?.name,
      from: s?.from, to: s?.to,
      nodeAt: v?.state?.doc?.nodeAt?.(s?.from)?.type?.name,
      anchorNode: window.getSelection?.()?.anchorNode?.nodeName,
      editable: (v?.editDOM !== undefined) ? undefined : undefined,
    }
  })
  // 试打字
  await p.keyboard.type('X', { delay: 50 })
  await p.waitForTimeout(300)
  const typed = await p.evaluate(i => {
    const tds = [...document.querySelectorAll('.ProseMirror td')]
    return tds[i]?.textContent || ''
  }, idx)
  console.log(`cell[${idx}] click@(${Math.round(cx)},${Math.round(cy)}) size=${Math.round(cb.width)}x${Math.round(cb.height)}`)
  console.log('  hit:', JSON.stringify(hit))
  console.log('  sel:', JSON.stringify(sel))
  console.log('  text-after-typing:', JSON.stringify(typed.slice(0, 40)))
}
await b.close()
