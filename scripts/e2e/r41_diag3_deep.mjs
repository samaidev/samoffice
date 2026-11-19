// r41 诊断3：深挖块 k=21（386px 大段未断行）的分页内部状态
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?r41d3=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(5000)

const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const kids = [...pm.children]
  const papers = [...document.querySelectorAll('.pg-paper')]
  const pg = papers.map(el => el.getBoundingClientRect())
  // k=21 块详情
  const el = kids[21]
  const r = el.getBoundingClientRect()
  // pm-host 顶（纸页坐标系）
  const pmTop = pm.getBoundingClientRect().top
  // 分页内部状态（__pg 诊断全局）
  const pgState = (window).__pg
  // 全部 pg-linebreak / pg-brk 装饰的分布
  const brks = [...pm.querySelectorAll('.pg-brk')].map(e2 => ({ tag: e2.tagName, mt: e2.getAttribute('style') }))
  const linebrks = [...pm.querySelectorAll('.pg-linebreak')].map(e2 => ({ mt: e2.style.marginTop, pos: (e2).__pgPos }))
  // k=21 的文本前 30 字
  const blocksInfo = []
  for (const k of [20, 21, 22, 35, 127, 178]) {
    const e2 = kids[k]
    if (!e2) continue
    const r2 = e2.getBoundingClientRect()
    blocksInfo.push({ k, tag: e2.tagName, cls: String(e2.className).slice(0, 20), text: (e2.textContent || '').slice(0, 20), h: Math.round(r2.height), top: Math.round(r2.top - pmTop) })
  }
  return { pgState, brkCount: brks.length, brks: brks.slice(0, 8), linebrkCount: linebrks.length, linebrks: linebrks.slice(0, 10), blocksInfo, pmH: Math.round(pm.getBoundingClientRect().height) }
})
console.log('__pg 状态:', JSON.stringify(out.pgState))
console.log('pg-brk(块级断点):', out.brkCount, JSON.stringify(out.brks))
console.log('pg-linebreak(行级断点):', out.linebrkCount, JSON.stringify(out.linebrks))
console.log('块详情:', JSON.stringify(out.blocksInfo, null, 1))
console.log('pm 总高:', out.pmH, 'pageerror:', errs.length)
await b.close()
