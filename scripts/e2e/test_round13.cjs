// Round 13 E2E：Word 表格跨页复验 + 页间空白双击合并/表格角标全选/边框拖拽/自动调整
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:8080'
const OUT = path.join(__dirname, 'shots-r13')
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') })
    console.log('shot:', name)
  }

  // 1. 打开首页并拖放打开测试文档
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(3000) // 等 App 初始化（backend 就绪后 drop 才会被处理）
  // 拖放打开测试文档（backend 未就绪时重试）
  let opened = false
  for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    await page.evaluate(async () => {
      const buf = await fetch('/e2e_table.docx').then((r) => r.arrayBuffer())
      const file = new File([buf], 'e2e_table.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const target = document.querySelector('[style*="--wails-drop-target"]') || document.body
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    try {
      await page.waitForSelector('.ProseMirror', { timeout: 8000 })
      opened = true
    } catch (e) { await sleep(1500) }
  }
  if (!opened) throw new Error('document did not open after 4 drop attempts')
  await sleep(2500) // 分页引擎稳定
  await shot('01-opened-top')

  // 2. 滚动到跨页表格交界（页1→页2）
  const pgInfo = await page.evaluate(() => window.__pg ? { pageCount: window.__pg.pageCount, pageStep: window.__pg.pageStep, per: window.__pg.per } : null)
  console.log('pgInfo:', JSON.stringify(pgInfo))
  // 找表格第 18 行附近（大约在页 1/2 交界）
  const seamY = await page.evaluate(() => {
    const trs = document.querySelectorAll('.ProseMirror table tr')
    if (!trs.length) return -1
    const mid = trs[Math.floor(trs.length / 2)]
    const r = mid.getBoundingClientRect()
    window.scrollTo ? null : null
    return r.top + window.scrollY
  })
  console.log('seamY:', seamY)
  await page.evaluate((y) => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    sc.scrollTop = Math.max(0, y - 330)
  }, seamY)
  await sleep(1200)
  await shot('02-crosspage-seam')

  // 跨页几何诊断：取页 1 底与页 2 顶附近行的位置关系
  const diag = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('.pg-paper')).map((n) => {
      const r = n.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    const rows = Array.from(document.querySelectorAll('.ProseMirror table tr')).slice(0, 45).map((n, i) => {
      const r = n.getBoundingClientRect()
      return { i, top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    return { papers, rows }
  })
  console.log('papers:', JSON.stringify(diag.papers))
  console.log('rows near seam:', JSON.stringify(diag.rows.filter((r) => diag.papers[1] && r.bottom > diag.papers[0].top && r.top < diag.papers[1].bottom + 50)))

  // 3. Round13.1 页间空白双击合并：先滚动让页 0/1 交界出现在视口中部（避开 Ribbon ~240px）
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    sc.scrollTop = 1088 - 400
  })
  await sleep(800)
  await shot('03-gap-before-dblclick')
  let vpGapY = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('.pg-paper'))
    for (let i = 0; i < papers.length - 1; i++) {
      const a = papers[i].getBoundingClientRect()
      const c = papers[i + 1].getBoundingClientRect()
      if (a.bottom > 270 && c.top < 850) return (a.bottom + c.top) / 2
    }
    return -1
  })
  console.log('gap dblclick at viewport y =', Math.round(vpGapY))
  if (vpGapY > 0) {
    await page.mouse.dblclick(700, vpGapY)
    await sleep(1500)
    await shot('04-gap-collapsed')
    const papersAfter = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pg-paper')).map((n) => {
        const r = n.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
      }),
    )
    console.log('papers after collapse:', JSON.stringify(papersAfter.slice(0, 3)))
    // 在视口内找一条页界分隔线（收起模式：纸页首尾相接，取相邻纸页中点）
    let lineY = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('.pg-paper')).map((n) => n.getBoundingClientRect())
      for (let i = 1; i < ps.length; i++) {
        const mid = (ps[i - 1].bottom + ps[i].top) / 2
        if (mid > 270 && mid < 850) return mid
      }
      return -1
    })
    if (lineY < 0) {
      await page.evaluate(() => {
        const sc = document.querySelector('.overflow-auto') || document.scrollingElement
        sc.scrollTop += 1088
      })
      await sleep(600)
      lineY = await page.evaluate(() => {
        const ps = Array.from(document.querySelectorAll('.pg-paper')).map((n) => n.getBoundingClientRect())
        for (let i = 1; i < ps.length; i++) {
          const mid = (ps[i - 1].bottom + ps[i].top) / 2
          if (mid > 270 && mid < 850) return mid
        }
        return (ps[0].bottom + ps[1].top) / 2
      })
    }
    console.log('restore dblclick at viewport y =', Math.round(lineY))
    await page.mouse.dblclick(700, lineY)
    await sleep(1500)
    await shot('05-gap-restored')
  }

  // 4. Round13.2 表格左上角角标全选
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    const t = document.querySelector('.ProseMirror table')
    if (t) sc.scrollTop = Math.max(0, t.getBoundingClientRect().top + window.scrollY - 330)
  })
  await sleep(800)
  // 悬停表格触发手柄显示
  const tableBox = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    if (!t) return null
    const r = t.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 30 }
  })
  if (tableBox) {
    let handleVisible = 'missing'
    for (let tries = 0; tries < 3; tries++) {
      await page.mouse.move(tableBox.x, tableBox.y)
      await sleep(400)
      handleVisible = await page.evaluate(() => {
        const h = document.querySelector('.pm-table-handle')
        if (!h) return 'missing'
        return getComputedStyle(h).display
      })
      if (handleVisible === 'flex') break
      // 分页重渲染会重置 hover 状态：再触发一次移动
      await page.mouse.move(tableBox.x - 30, tableBox.y + 40)
      await sleep(200)
    }
    console.log('handle display on hover:', handleVisible)
    await shot('06-table-handle-hover')
    // 点击手柄（位置 = 表格左上角外侧）
    const handlePos = await page.evaluate(() => {
      const t = document.querySelector('.ProseMirror table')
      const h = document.querySelector('.pm-table-handle')
      if (!t || !h) return null
      const r = h.getBoundingClientRect()
      if (r.width === 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    console.log('handlePos:', JSON.stringify(handlePos))
    if (handlePos) {
      await page.mouse.click(handlePos.x, handlePos.y)
      await sleep(800)
      const selCount = await page.evaluate(() => document.querySelectorAll('.ProseMirror td.selectedCell, .ProseMirror th.selectedCell').length)
      const toolsVisible = await page.evaluate(() => !!document.querySelector('div')) // 占位
      console.log('selectedCell count after handle click:', selCount)
      await shot('07-table-selected-all')
    }
  }

  // 5. Round13.3 拖拽列边框
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    const t = document.querySelector('.ProseMirror table')
    if (t) sc.scrollTop = Math.max(0, t.getBoundingClientRect().top + window.scrollY - 330)
  })
  await sleep(600)
  const colGeo = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    const tr = t.rows[3]
    const cells = Array.from(tr.cells).map((td) => Math.round(td.getBoundingClientRect().width))
    const td = tr.cells[0]
    const r = td.getBoundingClientRect()
    return { widths: cells, borderX: r.right, borderY: r.top + r.height / 2 }
  })
  console.log('colGeo before drag:', JSON.stringify(colGeo))
  await shot('08-col-before-drag')
  // 按住列 0/1 边界向右拖 60px（down 前重测一次，防分页重渲染平移几何）
  const colGeo2 = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    const tr = t.rows[3]
    const td = tr.cells[0]
    const r = td.getBoundingClientRect()
    return { borderX: r.right, borderY: r.top + r.height / 2 }
  })
  if (Math.abs(colGeo2.borderX - colGeo.borderX) > 2 || Math.abs(colGeo2.borderY - colGeo.borderY) > 2) {
    console.log('border moved before down, re-aim:', Math.round(colGeo.borderX), '->', Math.round(colGeo2.borderX))
  }
  await page.mouse.move(colGeo2.borderX, colGeo2.borderY)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(colGeo.borderX + i * 10, colGeo.borderY, { steps: 2 })
    await sleep(60)
  }
  await page.mouse.up()
  await sleep(1200)
  const colGeoAfter = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    return Array.from(t.rows[3].cells).map((td) => Math.round(td.getBoundingClientRect().width))
  })
  console.log('widths after col drag:', JSON.stringify(colGeoAfter))
  await shot('09-col-after-drag')

  // 6. 拖拽行边框（行 2 底边向下拖 40px）
  // 先点击正文段落清空选区，隐藏浮动工具栏（否则会盖住行边界导致命中失败）
  const paraPos = await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    const ps = Array.from(document.querySelectorAll('.ProseMirror > p'))
    const last = ps[ps.length - 1]
    if (!last) return null
    sc.scrollTop = Math.max(0, last.getBoundingClientRect().top + window.scrollY - 400)
    return null
  })
  await sleep(500)
  const pmPara = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('.ProseMirror > p'))
    const last = ps[ps.length - 1]
    const r = last.getBoundingClientRect()
    return { x: r.left + 60, y: Math.max(280, r.top + 8) }
  })
  if (pmPara) { await page.mouse.click(pmPara.x, pmPara.y); await sleep(400) }
  // 回到表格
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    const t = document.querySelector('.ProseMirror table')
    if (t) sc.scrollTop = Math.max(0, t.getBoundingClientRect().top + window.scrollY - 330)
  })
  await sleep(600)
  const rowGeo = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    const tr = t.rows[2]
    const r = tr.getBoundingClientRect()
    return { h: Math.round(r.height), borderY: r.bottom, borderX: r.left + 200 }
  })
  console.log('rowGeo before drag:', JSON.stringify(rowGeo))
  await shot('10-row-before-drag')
  await page.mouse.move(rowGeo.borderX, rowGeo.borderY)
  await sleep(300)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(rowGeo.borderX, rowGeo.borderY + i * 10, { steps: 2 })
    await sleep(60)
  }
  await page.mouse.up()
  await sleep(1200)
  const rowGeoAfter = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    return Math.round(t.rows[2].getBoundingClientRect().height)
  })
  console.log('row2 height after drag:', rowGeoAfter, '(before', rowGeo.h + ')')
  await shot('11-row-after-drag')

  // 7. Round13.4 AutoFit 菜单
  // 光标放回表格内
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    const t = document.querySelector('.ProseMirror table')
    if (t) sc.scrollTop = Math.max(0, t.getBoundingClientRect().top + window.scrollY - 330)
  })
  const cellPos = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    const td = t.rows[1].cells[1]
    const r = td.getBoundingClientRect()
    return { x: r.left + 40, y: r.top + 10 }
  })
  await page.mouse.click(cellPos.x, cellPos.y)
  await sleep(600)
  // 点自动调整按钮
  const autoBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[title*="自动调整"], button[title*="AutoFit"]'))
    if (!btns.length) return null
    const r = btns[0].getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  console.log('autoFit btn:', JSON.stringify(autoBtn))
  if (autoBtn) {
    await page.mouse.click(autoBtn.x, autoBtn.y)
    await sleep(400)
    await shot('12-autofit-menu')
    // 点「根据内容调整表格」
    const item = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button')).filter((b) => ['根据内容调整表格', 'AutoFit to Contents'].includes(b.textContent.trim()))
      if (!els.length) return null
      const r = els[0].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    if (item) {
      await page.mouse.click(item.x, item.y)
      await sleep(1200)
      const wAfterContent = await page.evaluate(() => {
        const t = document.querySelector('.ProseMirror table')
        return Array.from(t.rows[3].cells).map((td) => Math.round(td.getBoundingClientRect().width))
      })
      console.log('widths after autofit-content:', JSON.stringify(wAfterContent))
      await shot('13-autofit-content')
    }
    // 再点「根据窗口调整表格」
    await page.mouse.click(autoBtn.x, autoBtn.y)
    await sleep(300)
    const item2 = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button')).filter((b) => ['根据窗口调整表格', 'AutoFit to Window'].includes(b.textContent.trim()))
      if (!els.length) return null
      const r = els[0].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    if (item2) {
      await page.mouse.click(item2.x, item2.y)
      await sleep(1200)
      const wAfterWindow = await page.evaluate(() => {
        const t = document.querySelector('.ProseMirror table')
        const table = t
        const cells = Array.from(t.rows[3].cells).map((td) => Math.round(td.getBoundingClientRect().width))
        return { cells, tableW: Math.round(table.getBoundingClientRect().width) }
      })
      console.log('widths after autofit-window:', JSON.stringify(wAfterWindow))
      await shot('14-autofit-window')
    }
  }

  console.log('page errors:', errors.length ? errors.slice(0, 6) : 'none')
  await browser.close()
}

main().catch((e) => { console.error('E2E FAIL:', e); process.exit(1) })
