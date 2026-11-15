// round23_remote_e2e.cjs —— 在【远程 Windows】跑的 E2E：Node 24 原生 WebSocket + CDP
// 用法：node round23_remote_e2e.cjs <cdp-port> [test]
// 测试内容：打开隧道页 → 上传论文 docx（fetch /api/doc/open）→ __setDocForTest →
// 真实 GPU 合成器下点击段落/表格 → 报告 focus 与输入结果
const http = require('http')

const PORT = process.argv[2] || '9223'
const BASE = `http://127.0.0.1:${PORT}`

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get(BASE + path, r => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    }).on('error', rej)
  })
}

class CDPTab {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.results = [] }
  static async open(targetId) {
    const list = await getJSON('/json/list')
    let page = list.find(t => t.type === 'page')
    if (targetId) page = list.find(t => t.id === targetId)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const tab = new CDPTab(ws)
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && tab.pending.has(msg.id)) {
        tab.pending.get(msg.id)(msg)
        tab.pending.delete(msg.id)
      }
    }
    return tab
  }
  send(method, params = {}) {
    return new Promise(res => {
      const id = ++this.id
      this.pending.set(id, res)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
    return r.result?.result?.value
  }
  async input(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra })
  }
  async click(x, y) {
    await this.input('mousePressed', x, y)
    await this.input('mouseReleased', x, y)
  }
  close() { this.ws.close() }
}

async function main() {
  // 新开隧道页 tab（PUT /json/new —— Edge/Chrome 111+ 要求 PUT）
  await new Promise((res, rej) => {
    const req = http.request(BASE + `/json/new?https://aitun.cc/NEHLYZ5V`, { method: 'PUT' }, r => { r.resume(); r.on('end', res) })
    req.on('error', rej); req.end()
  }).catch(e => console.log('[new-tab]', e.message))
  await new Promise(r => setTimeout(r, 8000))
  const tab = await CDPTab.open()
  const url = await tab.eval('location.href')
  console.log('[page]', url)
  if (!url.includes('aitun.cc')) {
    console.log('[FATAL] 无法打开隧道页'); process.exit(1)
  }
  await tab.send('Runtime.enable')
  // 等应用加载
  for (let i = 0; i < 30; i++) {
    const ready = await tab.eval('!!window.__pmView && !!(window.fetch)').catch(() => false)
    if (ready) break
    await new Promise(r => setTimeout(r, 1000))
  }
  // 主题 light + 清 localStorage 重载
  await tab.eval(`localStorage.setItem('samoffice_theme','light')`)
  await tab.send('Page.reload')
  await new Promise(r => setTimeout(r, 8000))
  for (let i = 0; i < 30; i++) {
    const ready = await tab.eval('!!window.__pmView').catch(() => false)
    if (ready) break
    await new Promise(r => setTimeout(r, 1000))
  }
  console.log('[app ready]')

  // 上传论文 docx —— 从远程机本地文件 C:/Users/Administrator/Downloads/contract-math.docx
  const uploadRes = await tab.eval(`(async () => {
    const fs = await import('fs').catch(() => null)
    return 'no-fs-in-page'
  })()`)
  // 文件内容走 HTTP：在沙箱 server 直接给 /api/doc/open —— 页面 fetch multipart
  // 需要文件 bytes —— 通过 CDP Runtime 传 base64 太大 —— 用【远程机 shell 读文件转 base64 再注入】：
  // 简化：让页面先 fetch 沙箱上传的【已解析 doc JSON】—— 不行，server 没存。
  // ★ 用 DOM.setFileInputFiles？页面没有 file input。
  // ★★ 直接把 docx base64 分块注入 window 再构造 File：
  const fs = require('fs')
  const buf = fs.readFileSync('C:/Users/Administrator/Downloads/contract-math.docx')
  const b64 = buf.toString('base64')
  // 分块注入（每块 512KB）
  await tab.eval(`window.__docB64parts = []`)
  const CHUNK = 512 * 1024
  for (let i = 0; i < b64.length; i += CHUNK) {
    await tab.eval(`window.__docB64parts.push(${JSON.stringify(b64.slice(i, i + CHUNK))})`)
  }
  const opened = await tab.eval(`(async () => {
    const b64 = window.__docB64parts.join('')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const form = new FormData()
    form.append('file', new Blob([bytes]), 'contract.docx')
    const r = await fetch('/api/doc/open', { method: 'POST', body: form })
    const j = await r.json()
    window.__setDocForTest(j.document)
    return { blocks: j.document ? j.document.blocks.length : 0, warns: (j.warnings||[]).length }
  })()`)
  console.log('[doc opened]', JSON.stringify(opened))
  await new Promise(r => setTimeout(r, 6000))

  // ===== 测试 1：首屏段落点击 + 输入 =====
  let pt = await tab.eval(`(() => {
    for (const el of document.querySelectorAll('.ProseMirror p')) {
      const r = el.getBoundingClientRect()
      if (r.y > 250 && r.y < 600 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
    }
    return null
  })()`)
  await tab.click(pt.x, pt.y)
  await new Promise(r => setTimeout(r, 500))
  const len1 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
  await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Q', code: 'KeyQ', windowsVirtualKeyCode: 81, text: 'Q' })
  await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Q', code: 'KeyQ', windowsVirtualKeyCode: 81 })
  await new Promise(r => setTimeout(r, 500))
  const len2 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
  console.log('[T1 首屏段落点击+输入]', len2 > len1 ? `PASS (${len1}→${len2})` : `FAIL (${len1}→${len2})`)
  await tab.eval(`window.__pmView.dom.dispatchEvent(new KeyboardEvent('keydown', {key:'z',ctrlKey:true,bubbles:true}))`)
  await new Promise(r => setTimeout(r, 300))

  // ===== 测试 2：滚轮滚到公式/表格区（13×800px）→ 点段落 =====
  for (let i = 0; i < 13; i++) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaY: -800 })
    await new Promise(r => setTimeout(r, 60))
  }
  await new Promise(r => setTimeout(r, 2000))
  const st = await tab.eval(`window.__pmView.dom.closest('[class*="overflow"]').scrollTop`)
  console.log('[scroll]', st)
  pt = await tab.eval(`(() => {
    for (const el of document.querySelectorAll('.ProseMirror p')) {
      const r = el.getBoundingClientRect()
      if (r.y > 250 && r.y < 700 && r.height > 5 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
    }
    return null
  })()`)
  if (pt) {
    await tab.click(pt.x, pt.y)
    await new Promise(r => setTimeout(r, 500))
    const f = await tab.eval(`window.__pmView.hasFocus()`)
    console.log('[T2 深滚段落点击 focus]', f ? 'PASS' : 'FAIL')
  }

  // ===== 测试 3：表格内点击 + 输入 =====
  const tp = await tab.eval(`(() => {
    const t = document.querySelector('table.pm-table')
    if (!t) return null
    const r = t.getBoundingClientRect()
    if (r.y < 150 || r.y > 700) return { needScroll: true, top: r.y }
    return { x: r.x + 60, y: r.y + 80 }
  })()`)
  if (tp && tp.needScroll) {
    await tab.eval(`document.querySelector('table.pm-table').scrollIntoView({block:'center'})`)
    await new Promise(r => setTimeout(r, 1200))
  }
  const tp2 = await tab.eval(`(() => {
    const t = document.querySelector('table.pm-table')
    const r = t.getBoundingClientRect()
    const td = t.querySelector('td')
    const dr = td.getBoundingClientRect()
    return { x: dr.x + dr.width/2, y: dr.y + dr.height/2, vis: dr.y > 150 && dr.y < 750 }
  })()`)
  if (tp2 && tp2.vis) {
    await tab.click(tp2.x, tp2.y)
    await new Promise(r => setTimeout(r, 500))
    const l1 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'W', code: 'KeyW', windowsVirtualKeyCode: 87, text: 'W' })
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'W', code: 'KeyW', windowsVirtualKeyCode: 87 })
    await new Promise(r => setTimeout(r, 500))
    const l2 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
    const focus = await tab.eval(`window.__pmView.hasFocus()`)
    console.log('[T3 表格内点击 focus]', focus ? 'PASS' : 'FAIL')
    console.log('[T3 表格内输入]', l2 > l1 ? `PASS (${l1}→${l2})` : `FAIL (${l1}→${l2})`)
    await tab.eval(`window.__pmView.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`)
  } else {
    console.log('[T3] 表格不在视口', JSON.stringify(tp2))
  }

  // ===== 测试 4：双击公式区段落选词 =====
  await tab.eval(`document.querySelectorAll('.sam-math')[3]?.scrollIntoView({block:'center'})`)
  await new Promise(r => setTimeout(r, 1000))
  const mp = await tab.eval(`(() => {
    const m = document.querySelectorAll('.sam-math')[3]
    const r = m.getBoundingClientRect()
    return { y: r.y, h: r.height }
  })()`)
  console.log('[T4 公式可见性]', mp.h > 20 ? 'PASS' : 'FAIL', JSON.stringify(mp))

  console.log('[E2E DONE]')
  tab.close()
}

main().catch(e => { console.error('E2E-ERR:', e.message); process.exit(1) })
