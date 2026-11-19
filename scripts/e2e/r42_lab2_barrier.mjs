// r42 方案验证补：D —— widget 自带 micro-border barrier（链式双断点吞量场景）
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?lab2=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const lab = await p.evaluate(() => {
  const mk = (mode) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;font-size:14px'
    const p1 = document.createElement('p')
    p1.style.cssText = 'margin:12px 0'
    const lb1 = document.createElement('span')
    lb1.style.cssText = 'display:block;height:0;overflow:hidden;line-height:0;font-size:0'
    lb1.style.marginTop = '314px'
    const t1 = document.createElement('span')
    t1.textContent = 'blk1'
    t1.style.cssText = 'display:block;line-height:27px;font-size:14px'
    p1.append(lb1, t1)
    const p2 = document.createElement('p')
    p2.style.cssText = 'margin:12px 0'
    const lb2 = document.createElement('span')
    lb2.style.cssText = 'display:block;height:0;overflow:hidden;line-height:0;font-size:0'
    if (mode === 'D') lb2.style.borderTop = '0.02px solid transparent'
    lb2.style.marginTop = '200px'
    const t2 = document.createElement('span')
    t2.textContent = 'blk2'
    t2.style.cssText = 'display:block;line-height:27px;font-size:14px'
    p2.append(lb2, t2)
    host.append(p1, p2)
    document.body.appendChild(host)
    const t2Top = t2.getBoundingClientRect().top
    const t1Bottom = t1.getBoundingClientRect().bottom
    host.remove()
    return Math.round((t2Top - t1Bottom) * 10) / 10
  }
  return { base: mk('base'), D: mk('D') }
})
console.log('链式双断点场景，t1底→t2顶位移（无折叠时期望=200+24）:', JSON.stringify(lab))
await b.close()
