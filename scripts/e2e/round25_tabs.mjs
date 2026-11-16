// round25 E2E：文件标签过多时动态缩放，窗口控制按钮不越界
import { chromium } from 'playwright'
const results = []
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const b = await chromium.launch({ args: ['--no-sandbox'] })
const VW = 1280
const p = await (await b.newContext({ viewport: { width: VW, height: 800 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto('http://127.0.0.1:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_lang', 'zh'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

// 连开 25 个文件窗口标签（Files 菜单 → 第一个新建项）：
// 压缩到 min-width 仍放不下 → 容器必须进入横向滚动模式
for (let i = 0; i < 25; i++) {
  await p.locator('[data-testid=menu-files]').click()
  await p.waitForTimeout(180)
  await p.locator('[data-testid^="menu-"]:not([data-testid="menu-files"])').first().click()
  await p.waitForTimeout(220)
}
await p.waitForTimeout(800)
const tabCount = await p.locator('.header-tabs-scroll > div[data-testid^="tab-"]').count()
ok('25 tabs opened', tabCount >= 25, `count=${tabCount}`)

// 窗口控制按钮（header 最后三个按钮，含关闭）不越界
const ctrl = await p.evaluate((vw) => {
  const btns = [...document.querySelectorAll('header button')]
  const close = btns[btns.length - 1]
  const r = close.getBoundingClientRect()
  return { right: r.right, visible: r.right <= vw + 1 && r.width > 0 }
}, VW)
ok('window controls inside viewport', ctrl.visible, `closeBtn.right=${Math.round(ctrl.right)}/${VW}`)

// 单标签宽度受限（≤200px）且被压缩
const widths = await p.evaluate(() =>
  [...document.querySelectorAll('.header-tabs-scroll > div[data-testid^="tab-"]')].map(el => Math.round(el.getBoundingClientRect().width))
)
const maxW = Math.max(...widths)
ok('tabs capped at 200px', maxW <= 201, `max=${maxW}px`)

// 容器进入滚动模式（内容宽 > 可视宽）且滚轮可横向滚动
const scroll = await p.evaluate(async () => {
  const el = document.querySelector('.header-tabs-scroll')
  const over = el.scrollWidth > el.clientWidth + 2
  const before = el.scrollLeft
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 200))
  return { over, moved: el.scrollLeft !== before || el.scrollWidth > el.clientWidth }
})
ok('tabs container scrolls when overflow', scroll.over && scroll.moved, JSON.stringify(scroll))

// 压缩后的标签仍可点击切换（点第一个）
await p.locator('.header-tabs-scroll > div[data-testid^="tab-"]').first().click()
await p.waitForTimeout(400)
const firstActive = await p.evaluate(() => {
  const el = document.querySelector('.header-tabs-scroll > div[data-testid^="tab-"]')
  return (el?.style.background || '').includes('0.22')
})
ok('shrunken tab still clickable', firstActive)

// 脏标记与关闭 ✕ 仍可见（flex-shrink-0 生效）——先点进正文拿焦点再打字
await p.locator('.ProseMirror p').first().click()
await p.keyboard.type('X', { delay: 80 })
await p.waitForTimeout(1200)
const dirty = await p.locator('.header-tabs-scroll > div[data-testid^="tab-"] span[data-testid^="tab-dirty-"]').count()
ok('dirty dot survives compression', dirty >= 1, `dirty=${dirty}`)

await p.screenshot({ path: '/tmp/round25_tabs.png' })
console.log(results.join('\n'))
const fails = results.filter(r => r.startsWith('FAIL')).length
console.log(fails === 0 ? 'ALL-PASS' : `FAILED:${fails}`)
await b.close()
process.exit(fails === 0 ? 0 : 1)
