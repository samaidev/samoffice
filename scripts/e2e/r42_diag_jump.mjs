// r42 诊断：①页13/14 内容越过【顶部】直角 ②页15 图片在分页附近跳动（时序采样）
// 方法：加载带真图的 fixture → 激活显示标记 → 每隔 400ms 采样一次，持续 10s：
//   - 每块 DOM rect（pm 顶坐标系）vs 所在页内容区 [top, bottom]
//   - 顶部越界：块顶 < 页内容区顶 - 2
//   - 底部越界：块底 > 页内容区底 + 6
//   - 跳动：同一块的 page/actualTop 在采样间变化
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400/?r42=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => { localStorage.setItem('samoffice_show_marks', '1') })
await p.evaluate(d => window.__setDocForTest(d), DOC)

// 时序采样：10s，每 400ms
const samples = []
for (let t = 0; t <= 10000; t += 400) {
  const snap = await p.evaluate(() => {
    const pg = (window).__pg
    const pm = document.querySelector('.ProseMirror')
    if (!pg || !pm) return null
    const pmTop = pm.getBoundingClientRect().top
    const kids = [...pm.children]
    const step = pg.pageStep, per = pg.per
    const topBad = [], botBad = [], imgStates = []
    pg.blocks.forEach((blk, k) => {
      const el = kids[k]
      if (!el) return
      const r = el.getBoundingClientRect()
      const top = r.top - pmTop, bottom = r.bottom - pmTop
      const cTop = blk.page * step, cBot = blk.page * step + per
      if (top < cTop - 2) topBad.push({ k, page: blk.page, top: Math.round(top), cTop, gap: Math.round(cTop - top), pv: (blk.pv || '').slice(0, 8) })
      if (bottom > cBot + 6) botBad.push({ k, page: blk.page, bottom: Math.round(bottom), cBot, over: Math.round(bottom - cBot) })
    })
    kids.forEach((el, k) => {
      const img = el.querySelector && el.querySelector('img')
      if (img) {
        const r = el.getBoundingClientRect()
        imgStates.push({ k, top: Math.round(r.top - pmTop), h: Math.round(r.height), page: pg.blocks[k] ? pg.blocks[k].page : -1, loaded: img.complete && img.naturalWidth > 0 })
      }
    })
    return { t: Date.now(), pages: pg.pageCount, lineBreaks: pg.lineBreaks, blockBreaks: pg.blockBreaks, topBad, botBad, imgStates }
  })
  if (snap) samples.push(snap)
  await p.waitForTimeout(400)
}

// 分析
const pageSets = new Set(samples.map(s => s.pages))
console.log('页数轨迹:', [...pageSets].join(' → '), `(${samples.length} 采样)`)
console.log('断点数轨迹: lineBreaks', [...new Set(samples.map(s => s.lineBreaks))].join('/'), 'blockBreaks', [...new Set(samples.map(s => s.blockBreaks))].join('/'))

// 顶部越界：最后一个采样
const last = samples[samples.length - 1]
console.log(`\n① 顶部越界（末次采样，容差2px）: ${last.topBad.length} 个`)
for (const r of last.topBad.slice(0, 10)) console.log('  ', JSON.stringify(r))
console.log(`① 底部越界: ${last.botBad.length} 个`)
for (const r of last.botBad.slice(0, 6)) console.log('  ', JSON.stringify(r))

// 跳动：图片段的 top/page 时间序列
console.log('\n② 图片段时序（k: top/page/loaded 序列）:')
const byK = {}
for (const s of samples) for (const im of s.imgStates) (byK[im.k] = byK[im.k] || []).push(`${im.top}/${im.page}${im.loaded ? '' : '!'}${im.h}`)
for (const k of Object.keys(byK).map(Number).sort((a, b) => a - b)) {
  const seq = byK[k]
  const changing = new Set(seq.map(x => x.split('!')[0])).size > 1
  console.log(`  k=${k} ${changing ? '⚠️ 跳动' : '稳定'}: ${seq.slice(0, 12).join(' | ')}${seq.length > 12 ? ' ...' : ''}`)
}
// 所有块的页归属变化（跳动全集）
const pageTraj = samples.map(s => s.imgStates.map(i => i.page).join(','))
const uniq = new Set(pageTraj)
console.log('\n图片页归属唯一值数:', uniq.size, uniq.size > 1 ? '⚠️ 振荡' : '(稳定)')
if (uniq.size > 1) for (const u of [...uniq].slice(0, 6)) console.log('  状态:', u)
console.log('pageerror:', errs.length, errs.slice(0, 2))
await b.close()
