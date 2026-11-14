// 验证因果：.sam-math { display:block; padding; border; background } ——
// 这些样式让公式块【占据布局高度】。罪魁不是这条规则"挡住"表格，
// 而是它影响【文档总高度 → 分页计算 → 表格位置】。
// 真正机制猜想修正：死区 = 【表格紧贴某个 compositor 层边界】。
// .sam-math 的 padding/border 让内容总高恰好把表格推到层边界/跨层。
// 核心问题在层本身 —— 找出真正的【层】：渲染时 PM 上方的 transform 层
// 高 16842px > GPU 纹理 16384 上限！表格在层内 9957 偏移 —— 但更关键的是
// 【哪个后代元素被提升为独立层】。用 CDP Layer 树看：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
await p.waitForTimeout(1500)
// CDP 层树
const cdp = await p.context().newCDPSession(p)
const { layerTree } = await cdp.send('Compositing.layersTree').catch(() => ({ layerTree: null }))
if (layerTree) {
  const dumpLayer = (l, depth) => {
    const b2 = l.bounds || [0, 0, 0, 0]
    console.log(' '.repeat(depth) + `${(l.layerId || '')} ${b2[0]},${b2[1]} ${b2[2]}x${b2[3]}${l.drawsContent ? '' : ' (no-draw)'}`)
    ;(l.children || []).forEach(c => dumpLayer(c, depth + 1))
  }
  dumpLayer(layerTree, 0)
} else {
  console.log('Compositing.layersTree 不可用，改用 DOM.getFlowedElements? 试 Compositing.getLayers?')
  // 检查层大小限制的直接证据：找高度 > 16384 的元素
  const big = await p.evaluate(() => {
    const out = []
    document.querySelectorAll('.ProseMirror, .ProseMirror *').forEach(el => {
      const h = el.getBoundingClientRect().height
      if (h > 16000) out.push(`${el.tagName}.${(el.className?.toString().slice(0, 25) || '')} h=${Math.round(h)}`)
    })
    return out
  })
  console.log('>16000px 元素:', JSON.stringify(big, null, 1))
}
await b.close()
