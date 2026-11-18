import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
// 空文档（无上传），插入原生对照表格到 body（页面级，不在 PM 内）
await p.evaluate(() => {
  window.__n = 0
  document.addEventListener('mousedown', (e) => window.__md = 'got@' + e.target.tagName, true)
  // 1) 页面级原生 table（body 直属）
  const t1 = document.createElement('table')
  t1.id = 'r34-native-body'
  t1.innerHTML = '<tr><td>native-body-cell</td></tr>'
  Object.assign(t1.style, { position: 'fixed', left: '20px', top: '100px', width: '200px', height: '60px', background: '#fee', zIndex: 500 })
  document.body.appendChild(t1)
  // 2) PM 内的对照：直接 append 一个 table 到 ProseMirror（旁路 NodeView）
  const pm = document.querySelector('.ProseMirror')
  let t2 = null
  if (pm) {
    t2 = document.createElement('table')
    t2.id = 'r34-native-pm'
    t2.innerHTML = '<tr><td>native-pm-cell</td></tr>'
    Object.assign(t2.style, { width: '200px', height: '60px', background: '#eef', marginTop: '200px' })
    pm.appendChild(t2)
  }
})
await p.waitForTimeout(600)
// 点击 body 级 table
await p.mouse.click(120, 130)
await p.waitForTimeout(250)
const r1 = await p.evaluate(() => window.__md || 'none')
console.log('body 级原生 table 点击:', r1)
// 点击 PM 内 append 的 table
const pmBox = await p.evaluate(() => {
  const t = document.getElementById('r34-native-pm')
  if (!t) return null
  const r = t.getBoundingClientRect()
  return { x: r.x + 50, y: r.y + 15 }
})
if (pmBox) {
  await p.mouse.click(pmBox.x, pmBox.y)
  await p.waitForTimeout(250)
  const r2 = await p.evaluate(() => window.__md || 'none')
  console.log('PM 内原生 table 点击:', r2)
}
// 3) 关键对照：PM 内的【div】（非 table 标签）同样位置
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const d = document.createElement('div')
  d.id = 'r34-div-pm'
  d.textContent = 'div-in-pm'
  Object.assign(d.style, { width: '200px', height: '60px', background: '#efe', marginTop: '100px' })
  pm.appendChild(d)
})
await p.waitForTimeout(400)
const dBox = await p.evaluate(() => {
  const d = document.getElementById('r34-div-pm')
  const r = d.getBoundingClientRect()
  return { x: r.x + 50, y: r.y + 15 }
})
await p.mouse.click(dBox.x, dBox.y)
await p.waitForTimeout(250)
const r3 = await p.evaluate(() => window.__md || 'none')
console.log('PM 内 div 点击:', r3)
await b.close()
