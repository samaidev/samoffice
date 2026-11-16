// 纸页层全隐藏仍无事件 —— 排除纸页层。还剩下唯一未排除的：
// **水印 div**（selector 没匹配上，因为 style 属性里是 rotate(-30deg) 的写法不同）
// 以及「pg-linebreak 装饰」（display:block margin-top 推行的 span）和
// pg-brk（margin-top 推块）。表格前的最后一个块若被 pg-brk margin-top 推下，
// 表格正上方的「装饰链」可以形成巨大 margin —— 但这不挡事件。
// ★ 最重要嫌疑人：**水印 div** —— 它 absolute + rotate + nowrap + 72px，
// fontSize 大 + whiteSpace:nowrap → 旋转后的包围盒可覆盖全页！
// 之前的 selector 失败因为 style 里写的是 rotate(-30deg)（无空格）。重查：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
// 列出 pm-host 之前/内部的所有 position:absolute 兄弟（在 pageRef 容器内）
const abs = await p.evaluate(() => {
  const pageRef = window.__pmView.dom.closest('.mx-auto')
  const out = []
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.position === 'absolute' && s.display !== 'none') {
        const r = el.getBoundingClientRect()
        out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 25), style: (el.getAttribute('style') || '').slice(0, 90), rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`, pe: s.pointerEvents, z: s.zIndex })
      }
    }
  }
  walk(pageRef.parentElement)
  return out.filter(o => o.rect.includes('NaN') === false)
})
console.log(JSON.stringify(abs, null, 1))
await b.close()
