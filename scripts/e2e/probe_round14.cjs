// Round 14 探针：点击边框按钮时记录所有 PM 事务，找出清空 CellSelection 的事务来源
const { chromium } = require('playwright')
const path = require('path')
const BASE = 'http://127.0.0.1:8080'
const OUT = path.join(__dirname, 'shots-r14')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', (m) => { if (/^\[(TR|MD|HIT|MUT|SELDOM)\]/.test(m.text())) console.log(m.text()) })
  page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 150)))

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(async () => {
      const buf = await fetch('/e2e_table.docx').then((r) => r.arrayBuffer())
      const file = new File([buf], 'e2e_table.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const dt = new DataTransfer(); dt.items.add(file)
      const target = document.querySelector('[style*="--wails-drop-target"]') || document.body
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    try { await page.waitForSelector('.ProseMirror table', { timeout: 8000 }); break } catch (e) { await sleep(1500) }
  }
  await sleep(1800)

  // 安装事务探针 + selectionchange 探针
  await page.evaluate(() => {
    const v = window.__pmView
    const orig = v.dispatch.bind(v)
    let n = 0
    v.dispatch = (tr) => {
      n++
      const sel = tr.selection
      const kind = sel && sel.$anchorCell ? 'CellSelection' : sel ? sel.constructor.name : '?'
      const stack = tr.selectionSet && !tr.docChanged ? (new Error().stack || '').split('\n').slice(2, 8).join(' | ') : ''
      console.log(`[TR] #${n} docChanged=${tr.docChanged} sel=${kind} from=${tr.selection?.from} meta=${JSON.stringify(Object.keys(tr.meta || {}))} setSelection=${tr.selectionSet}${stack ? '\n[STACK] ' + stack : ''}`)
      return orig(tr)
    }
    window.document.addEventListener('selectionchange', () => {
      const a = window.getSelection()?.anchorNode
      const inPm = a ? v.dom.contains(a) : false
      console.log(`[SELDOM] anchorInPm=${inPm} selType=${window.getSelection()?.type} rangeCount=${window.getSelection()?.rangeCount} focused=${v.hasFocus()} active=${document.activeElement?.tagName}:${(document.activeElement?.className || '').slice(0, 30)}`)
    }, true)
    // MutationObserver 探针：观察编辑器 DOM 的突变（触发 DOMObserver.flush 的来源）
    new MutationObserver((muts) => {
      const n = muts.length
      const kinds = muts.slice(0, 3).map((m) => m.type + ':' + ((m.target.className || m.target.nodeName) + '').slice(0, 25)).join(' ; ')
      console.log(`[MUT] n=${n} ${kinds} focused=${v.hasFocus()} domSel=${(() => { const s = window.getSelection(); return s && s.rangeCount ? (s.anchorNode ? (v.dom.contains(s.anchorNode) ? 'inPm' : 'outPm') + '@' + s.anchorOffset : 'null') : 'none' })()}`)
    }).observe(v.dom, { subtree: true, childList: true, attributes: true, characterData: true })
    // 捕获表格工具栏与边框按钮的存在性
    window.__snap = () => ({
      selectedCells: document.querySelectorAll('.ProseMirror .selectedCell').length,
      inToolbar: !!Array.from(document.querySelectorAll('button.toolbar-btn')).find((b) => b.title && (b.title.includes('边框') || b.title.includes('Borders'))),
      domSelInPm: (() => { const a = window.getSelection()?.anchorNode; return a ? v.dom.contains(a) : false })(),
      pmSel: (() => { const s = v.state.selection; return s.$anchorCell ? 'CellSelection' : s.constructor.name })(),
    })
    console.log('[TR] probe installed')
  })

  // 全选（合成 mousedown）
  await page.evaluate(() => {
    const h = document.querySelector('.ProseMirror .pm-table-handle')
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 400, clientY: 430 }))
  })
  await sleep(400)
  console.log('after select-all:', JSON.stringify(await page.evaluate(() => window.__snap())))

  // 真实点击边框按钮
  const btn = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button.toolbar-btn')).find((el) => el.title && (el.title.includes('边框') || el.title.toLowerCase().includes('border')))
    if (!b) return null
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  console.log('border btn:', JSON.stringify(btn))
  // mousedown 目标捕获：确认按钮坐标实际命中的元素
  await page.evaluate(() => {
    window.document.addEventListener('mousedown', (e) => {
      const t = e.target
      const chain = []
      let el = t
      while (el && chain.length < 5) { chain.push((el.className || el.nodeName) + ''.slice(0)); el = el.parentElement }
      console.log(`[MD] target=${t.tagName}.${(t.className || '').toString().slice(0, 40)} chain=${chain.join(' < ')}`)
    }, true)
  }, { silent: true }).catch(() => {})
  await page.evaluate(() => {
    window.__snap()
    const b = Array.from(document.querySelectorAll('button.toolbar-btn')).find((el) => el.title && (el.title.includes('边框') || el.title.toLowerCase().includes('border')))
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    console.log(`[HIT] btnRect=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} hit=${hit?.tagName}.${(hit?.className || '').toString().slice(0, 40)} isBtn=${hit === b || b.contains(hit)}`)
  })
  await page.mouse.move(btn.x, btn.y, { steps: 6 })
  await sleep(100)
  await page.mouse.down()
  await sleep(50)
  console.log('after mousedown:', JSON.stringify(await page.evaluate(() => window.__snap())))
  await page.mouse.up()
  await sleep(350)
  console.log('after click (mouseup):', JSON.stringify(await page.evaluate(() => window.__snap())))
  await page.screenshot({ path: path.join(OUT, 'probe-after-btn.png') })
  await browser.close()
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
