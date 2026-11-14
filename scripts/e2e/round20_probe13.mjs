// 堆栈完全正常！没有覆盖层。但下半视口点击无事件。
// 最后假设：死区不是页面元素 —— 是 Playwright 的鼠标事件在 headless 下
// 因【页面持续 reflow/动画】（分页引擎反复重算导致 compositor busy）被节流丢弃！
// 验证：等页面完全静止（无任何 reflow）后再点。监听 requestAnimationFrame + 
// 检查分页是否还在跑：
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
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
// 监听 scroll 事件 —— 若分页引擎在持续滚动/跳动：
const scrollInfo = await p.evaluate(() => new Promise(resolve => {
  let n = 0
  const sc = document.querySelector('.flex-1.overflow-auto')
  const onScroll = () => n++
  sc.addEventListener('scroll', onScroll)
  // 观察 layout 变化 2 秒
  let mutations = 0
  const obs = new MutationObserver(() => mutations++)
  obs.observe(sc, { subtree: true, childList: true, attributes: true })
  setTimeout(() => {
    sc.removeEventListener('scroll', onScroll)
    obs.disconnect()
    resolve({ scrollEvents: n, mutations })
  }, 2000)
}))
console.log('2秒内 scroll/mutation:', JSON.stringify(scrollInfo))
await b.close()
