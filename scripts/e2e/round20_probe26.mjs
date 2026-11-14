// ★ 重大结论：键盘输入 + PM 光标定位【完全正常】—— "K参数" 写入成功！
// 说明 PM 编辑功能没坏，坏的只是【鼠标 hit-test 在 headless 下半屏】。
// 这是 Playwright headless 的 input pipeline 问题，不是产品 bug！
// （用户桌面端 Wails WebView 里鼠标事件走真实 OS 输入，不会有这个问题。）
// 
// 交叉验证：用 CDP Input.dispatchMouseEvent 带 source=mouse（之前试过无效）——
// 但那次目标也是 y>550 区域。现在验证 CDP 点击 y=300（活区）是否 OK，
// 以及换 headless:false（headed 模式 + xvfb）点击 y=530：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

// 有 X server 吗？
import { execSync } from 'child_process'
let headed = false
try { execSync('xdpyinfo -display :99 2>&1 | head -1'); headed = true } catch { try { execSync('Xvfb :99 -screen 0 1360x900x24 & sleep 1'); headed = true } catch { headed = false } }
console.log('headed 可用:', headed, '(有 DISPLAY=' + (process.env.DISPLAY || '无') + ')')

const b = await chromium.launch({ args: ['--no-sandbox'], headless: !headed ? undefined : false, env: { ...process.env, DISPLAY: ':99' } })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
await p.mouse.click(700, 530)
await p.waitForTimeout(200)
const hit = await p.evaluate(() => window.__hit)
console.log(headed ? 'headed 模式点击 (700,530):' : 'headless 复测:', hit >= 0 ? '✓ 事件到达（产品无问题，是 headless 输入管线 bug）' : '✗ 仍死区')
await b.close()
