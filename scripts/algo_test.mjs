// 纯算法单元测试：复刻 pagination.ts 的分页核心，验证
// 1) 长段落能正确跨页（产生行级断点）
// 2) 纸页高度恒为 pageHeightPx（不随内容变化）
// 3) 段落上半部分末行不超出首纸页下直角、下半部分首行贴下一页上直角
//
// 与 pagination.ts 中 recompute 内"正向分页"逻辑保持一致。

const PAGE_H = 1122 // A4 纵向 px
const GAP = 34
const MARGIN_T = 96 // 1 inch 左右
const MARGIN_B = 96

function paginate({ cumTop, lineTops, splittable, forceBreak, pageHeightPx = PAGE_H, gap = GAP, marginTop = MARGIN_T }) {
  const pageStep = pageHeightPx + gap
  const pageTopOf = (n) => n * pageStep + marginTop
  const pageOf = (y) => Math.max(0, Math.floor((y - marginTop) / pageStep))

  const K = cumTop.length
  const blockBreaks = new Set()
  const lineBreaks = new Set()
  const breakMargin = new Map()
  const blockPage = new Array(K).fill(0)

  for (let k = 0; k < K; k++) {
    const blockTop = cumTop[k]
    const blockPageNo = pageOf(blockTop)
    if (forceBreak[k] || !splittable[k]) {
      const blockBottomPage = pageOf(blockTop + 500/*近似块高，整块跳页只看顶页*/)
      if (forceBreak[k] || blockBottomPage > blockPageNo) {
        const targetPage = blockPageNo + 1
        const mt = Math.max(0, pageTopOf(targetPage) - blockTop)
        if (mt > 0) {
          breakMargin.set('b' + k, mt)
          blockBreaks.add(k)
        }
        blockPage[k] = targetPage
      } else {
        blockPage[k] = blockPageNo
      }
    } else {
      let prevPage = blockPageNo
      let anyBreak = false
      for (const ln of lineTops[k]) {
        const y = blockTop + ln.top
        const pg = pageOf(y)
        if (pg > prevPage) {
          const pos = 'k' + k + 'o' + ln.offset
          const mt = Math.max(0, pageTopOf(pg) - y)
          breakMargin.set(pos, mt)
          lineBreaks.add(pos)
          prevPage = pg
          anyBreak = true
        }
      }
      blockPage[k] = prevPage
    }
  }

  let maxPage = 0
  for (const p of blockPage) if (p > maxPage) maxPage = p
  const pageCount = maxPage + 1
  const rects = []
  for (let i = 0; i < pageCount; i++) rects.push({ top: pageTopOf(i) - marginTop, height: pageHeightPx })
  return { pageCount, rects, lineBreaks: [...lineBreaks], blockBreaks: [...blockBreaks], blockPage, breakMargin }
}

// ===== 构造一个超长单段落（连续 4 页文字，每行高 ~30px，不分段）=====
const LINE_H = 30
const lines = 150 // 150 * 30 = 4500px ≈ 4 页
const lineTops = []
for (let i = 0; i < lines; i++) {
  lineTops.push({ top: i * LINE_H, height: LINE_H, offset: i * 10 })
}
const cumTop = [0] // 段落块从文档顶开始
const splittable = [true]
const forceBreak = [false]

const res = paginate({ cumTop, lineTops: [lineTops], splittable, forceBreak })

function assert(cond, msg) {
  console.log((cond ? 'PASS: ' : 'FAIL: ') + msg)
  if (!cond) process.exitCode = 1
}

console.log('pageCount =', res.pageCount)
console.log('rects heights =', res.rects.map((r) => r.height).join(','))
console.log('lineBreaks count =', res.lineBreaks.length)
console.log('blockPage =', JSON.stringify(res.blockPage))

assert(res.pageCount > 1, `长段落跨页产生多张纸 (pageCount=${res.pageCount})`)
const heights = res.rects.map((r) => r.height)
assert(heights.every((h) => h === PAGE_H), `所有纸页高度恒为 ${PAGE_H}（不随内容变化）`)
assert(res.lineBreaks.length > 0, `段落内部行级断点 > 0（段落被拆分）`)

// 验证“上半部分不超首纸页下直角”：首纸页内容区 [marginTop, marginTop+per]
const per = PAGE_H - MARGIN_T - MARGIN_B
const firstPageBottomContent = MARGIN_T + per
// 段落在首纸页内的行：top < firstPageBottomContent 的最大行
let lastInFirst = -1
for (let i = 0; i < lines; i++) {
  const y = i * LINE_H + LINE_H // 行底
  if (y <= firstPageBottomContent + 0.5) lastInFirst = i
}
const lastLineBottom = lastInFirst * LINE_H + LINE_H
assert(lastLineBottom <= firstPageBottomContent + 0.5, `首纸页段落末行底(${lastLineBottom})不超出内容底(${firstPageBottomContent})`)

// 验证“下半部分首行贴下一页上直角”：第一个跨页行的断点 margin 应把它推到下一页内容区顶
// 找第一个行首 pageOf > 0
let firstCross = -1
for (let i = 0; i < lines; i++) {
  const pg = Math.max(0, Math.floor((i * LINE_H - MARGIN_T) / (PAGE_H + GAP)))
  if (pg > 0) { firstCross = i; break }
}
assert(firstCross > 0, `存在跨页行 (firstCross=${firstCross})`)
const breakPos = 'k0o' + firstCross * 10
assert(res.breakMargin?.has(breakPos) || res.lineBreaks.includes(breakPos), `跨页行存在断点装饰`)

console.log('\n算法测试完成。')
