// ★★★★ PM dom 内的外来表（插在表格正上方，立即点击）也死！
// 但 pageRef 内（PM 外）的流内表活。收敛：**.ProseMirror dom 内部
// 的区域，从表格 wrapper 顶部开始的整个矩形条带，鼠标 hit-test 全死**。
// 段落活是因为在 wrapper 条带【上方】。为什么条带从 wrapper 开始？
// wrapper 是 PM 的【NodeView】！NodeView 的 dom 会被 PM 标记 —— 
// PM 用 ViewDesc 挂在 DOM 上（ WeakMap/desc prop），不影响浏览器。
// ★ 直觉革命：也许是 wrapper 的【前面那个兄弟】—— pg-linebreak span，
// 它的 margin-top 巨大（如 500px+）—— 【margin 折叠穿透】！
// display:block 零高 + margin-top 大 —— 它自身在视觉上把 wrapper 推下去。
// 但 wrapper 上方条带（包含 span 的 margin 区域）不可点 —— 之前 y=508 活！
// 那不是它。
// ★★ 换位思考 —— 也许根本不是「从哪开始死」，而是「wrapper 内部才死」：
// probe26: y=460~516 活（表格上方），524~620 死（表格内部）。
// wrapper rect=516~1003。所以死区= wrapper 矩形本身！
// 流内外来表在 pageRef 活 —— 那外来表放进【PM dom 内的条带区域】也死
// （verify8 实锤 —— 插在 wrapper 前 = wrapper 条带顶部）。
// 等等 verify8 插入的表 top 在 wrapper 之上 —— 也死！
// → 死区其实从「插入表的位置」开始？插入表 z-index:9 relative —— 
// 它自己形成了新条带？越来越像【.ProseMirror 的某个内部状态】。
// 直接验证最粗暴的假设：**.ProseMirror dom 加 contenteditable=false + 
// 移除所有 class** 后外来表能点吗：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const tryVariant = async (name, mutate) => {
  const setup = await p.evaluate((mutateSrc) => {
    const pm = window.__pmView.dom
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const wrapper = td.closest('.tableWrapper')
    document.querySelectorAll('[data-tprobe]').forEach(e => e.remove())
    const t = document.createElement('table')
    t.setAttribute('data-tprobe', '1')
    t.style.cssText = 'border:2px solid #d33;width:300px;height:70px;background:#fffde7;position:relative;z-index:9'
    t.innerHTML = '<tr><td>V</td></tr>'
    wrapper.parentElement.insertBefore(t, wrapper)
    const fn = new Function('pm', 'wrapper', mutateSrc)
    fn(pm, wrapper)
    window.__e = []
    window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
    const r = t.getBoundingClientRect()
    return { x: r.x + 40, y: r.y + 35 }
  }, mutate)
  await p.mouse.click(setup.x, setup.y)
  await p.waitForTimeout(150)
  const ev = await p.evaluate(() => window.__e)
  console.log(`${name}: ${ev.length ? 'ALIVE' : 'DEAD'}`)
}
await tryVariant('baseline(editable)', 'pm.setAttribute("contenteditable","true")')
await tryVariant('contenteditable=false', 'pm.setAttribute("contenteditable","false")')
await tryVariant('去class', 'pm.className=""')
await tryVariant('去spellcheck', 'pm.setAttribute("spellcheck","false")')
await b.close()
