// round32 E2E：SmartArt 解析渲染验证（slide 5/6/7/15）— v2
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)

const expected = {
  5: ['传统集市', '传统出租车', '淘宝'],
  6: ['2012', '滴滴', '融资'],
  7: ['2014', '用户数'],
  15: ['天使轮', 'IPO'],
}

for (const sn of [5, 6, 7, 15]) {
  await p.evaluate((n) => {
    const items = [...document.querySelectorAll('button, [role=button], li, div')].filter(x => x.offsetParent !== null)
    const target = items.find(x => new RegExp(`^\\s*${n}\\s*$`).test(x.textContent || ''))
    if (target) target.click()
  }, sn)
  await p.waitForTimeout(1800)
  const info = await p.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ')
    const pageInd = (body.match(/#(\d+)\s*\/\s*16/) || [])[1]
    const shapesInd = (body.match(/📊 Shapes (\d+)/) || [])[1]
    // 含 SmartArt 形状文本的宿主（主画布或当前缩略图 —— 单页模式下
    // 两者都渲染该页 shapes）
    const host = [...document.querySelectorAll('div')]
      .filter(d => { const t = (d.textContent || ''); return t.includes('clip-path') || d.querySelectorAll('[style*="clip-path"]').length > 1 })
    let texts = body
    return { pageInd, shapesInd, texts }
  })
  const okPage = info.pageInd === String(sn)
  const hits = expected[sn].filter(kw => info.texts.includes(kw))
  const minShapes = { 5: 8, 6: 15, 7: 15, 15: 6 }[sn]
  const ok = okPage && Number(info.shapesInd) >= minShapes && hits.length >= 2
  console.log(`slide${sn}: [页${info.pageInd}] Shapes=${info.shapesInd} 关键词${hits.length}/${expected[sn].length} ${ok ? '✓' : '✗'} ${hits.join('/')}`)
  await p.screenshot({ path: `/tmp/r32_slide${sn}.png` })
}
await b.close()
console.log('DONE')
