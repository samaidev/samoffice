// sel=1 完全没变 —— 代理 mousedown 根本没生效。查代理状态：
// 猜测：真实文档打开走的是「文档打开流程」而非 __setDocForTest 的同一路径
// —— 之前 r27_final 是 __setDocForTest 后立即点击（编辑器刚重建）；
// 真实流程：打开文档 → 切到 Word 标签页？还是直接展示？
// __setDocForTest 可能绕过了真实 UI 流程（Word 编辑器可能根本没挂载/没激活！）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { const t = m.text(); if (t.includes('R28')) console.log('LOG:', t.slice(0, 150)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// ★ 走真实 UI 流程：点击「文件」→「打开」上传？或直接看 App 结构。
// 先检查 __setDocForTest 后 Word 编辑器是否 active：
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
const state = await p.evaluate(() => {
  // Word 编辑器是否可见？
  const pm = window.__pmView?.dom
  const visible = pm ? pm.offsetParent !== null : false
  // 代理管理器是否激活（需要首次 pointerdown）
  const proxy = document.querySelector('.pm-table-clickproxy')
  // 有多少个编辑器实例（Word/Excel）？
  const pms = document.querySelectorAll('.ProseMirror')
  return {
    pmVisible: visible,
    pmCount: pms.length,
    proxyExists: !!proxy,
    proxyShown: proxy ? proxy.style.display : 'none',
    activeTab: document.querySelector('[data-tab].active,[class*=active][data-tab]')?.textContent?.slice(0, 10) || '?',
  }
})
console.log('编辑器状态:', JSON.stringify(state))
// 手动派发一次 pointerdown（激活管理器）再试
await p.evaluate(() => { window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
await p.waitForTimeout(3000)
const st2 = await p.evaluate(() => ({ proxy: document.querySelectorAll('.pm-table-clickproxy').length }))
console.log('激活后代理:', JSON.stringify(st2))
await b.close()
