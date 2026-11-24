/**
 * charts.ts —— round61：浮动图表数据模型（对齐 MS Excel「插入图表/图表设计」）。
 *
 * 图表是浮层对象：两单元格锚点 + 对象定位（与图片 pictures.ts 同构），
 * 系列数据从单元格区域取（首行/列智能识别表头），编辑单元格后按引用实时重算。
 * 与后端 internal/parser/xlsx/charts.go 的 chartJSON 字段一一对应；
 * 未建模属性通过 anchorRaw/chartRaw 透传（未编辑时保存原样写回）。
 */

// ---- 类型 ----

/** 图表类型（12 种 2D；3D/组合图不建模，靠 raw 透传） */
export type ChartType =
  | 'column' | 'columnStacked' | 'columnStacked100'
  | 'bar' | 'barStacked' | 'barStacked100'
  | 'line' | 'lineMarker' | 'area'
  | 'pie' | 'doughnut' | 'scatter'

export interface ChartPoint { col: number; row: number; dx: number; dy: number }

/** round62：坐标轴配置（对齐 Excel「设置坐标轴格式」；语义 = 有/无 + 值） */
export interface AxisConfig {
  /** 轴标题（'' = 无） */
  title: string
  /** 数值轴最小值（null = 自动） */
  min: number | null
  /** 数值轴最大值（null = 自动） */
  max: number | null
  /** 主刻度单位（null = 自动） */
  majorUnit: number | null
  /** 次刻度单位（null = 自动；0 = 无次刻度） */
  minorUnit: number | null
  /** 主要刻度线：none|inside|outside|cross */
  majorTick: 'none' | 'inside' | 'outside' | 'cross' | ''
  /** 次要刻度线 */
  minorTick: 'none' | 'inside' | 'outside' | 'cross' | ''
  /** 轴标签位置：''(nextTo)|high|low|none */
  tickLabelPos: '' | 'high' | 'low' | 'none'
  /** 数字格式（'' = General）：'0.0' '#,##0' '0%' 等 */
  numFmt: string
  /** 反转轴方向 */
  reverse: boolean
  /** 对数刻度基数（null = 关闭；10/2） */
  logBase: number | null
  /** 轴线条颜色（'' = 自动） */
  lineColor: string
  /** 轴线条宽度 pt（0 = 默认） */
  lineWidth: number
  /** 主网格线开关（类别轴专用；数值轴走 chart.gridlines 总开关） */
  majorGridlines: boolean
}

export function defaultAxis(): AxisConfig {
  return {
    title: '', min: null, max: null, majorUnit: null, minorUnit: null,
    majorTick: '', minorTick: '', tickLabelPos: '', numFmt: '',
    reverse: false, logBase: null, lineColor: '', lineWidth: 0,
    majorGridlines: false,
  }
}

export interface ChartSeries {
  name: string
  nameRef: string
  cats: string[]
  catsRef: string
  values: number[]
  valuesRef: string
  color: string
}

export interface ChartSpec {
  id: string
  name: string
  type: ChartType
  from: ChartPoint
  to: ChartPoint
  mode: 'moveSize' | 'move' | 'fixed'
  title: string
  titleOn: boolean
  legend: 'none' | 'b' | 'l' | 't' | 'r'
  gridlines: boolean
  dataLabels: 'none' | 'ctr' | 'inEnd' | 'outEnd' | 'bestFit'
  gapWidth: number
  overlap: number
  holeSize: number
  /** round62：坐标轴配置（水平轴 = catAxis，垂直轴 = valAxis；散点图两者都是数值轴） */
  catAxis: AxisConfig
  valAxis: AxisConfig
  series: ChartSeries[]
  /** 数据区域（含表头），如 "B1:D4"；切换行列/重选数据源时更新 */
  rangeRef: string
  /** 系列取自行（false=列，Excel 默认按列） */
  byRows: boolean
  edited: boolean
  anchorRaw: string
  chartRaw: string
  /** round65：标题样式（对齐 Excel「图表标题」格式面板）；0/'' = 默认 */
  titleStyle: TitleStyle
}

/** round65：图表标题样式 + 位置（对齐 Excel Chart Title Format） */
export interface TitleStyle {
  /** 字号 pt（0 = 默认 14） */
  fontSize: number
  /** 文字颜色（'' = 默认 #333） */
  color: string
  bold: boolean
  italic: boolean
  /** 标题位置：top（默认，居中）/lt/ct/rt/l/c/r/lb/cb/rb —— 9 宫格对齐 Word/Excel */
  pos: 'top' | 'lt' | 'ct' | 'rt' | 'l' | 'c' | 'r' | 'lb' | 'cb' | 'rb'
}

export function defaultTitleStyle(): TitleStyle {
  return { fontSize: 0, color: '', bold: true, italic: false, pos: 'top' }
}

export interface ChartSeriesJSON {
  name?: string
  nameRef?: string
  cats?: string[]
  catsRef?: string
  values: number[]
  valuesRef?: string
  color?: string
}

/** round65：标题样式 JSON（与后端 chartTitleStyleJSON 一一对应） */
export interface TitleStyleJSON {
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  pos?: string
}

/** round62：轴配置 JSON（与后端 chartAxisJSON 一一对应；缺省字段 = 自动） */
export interface AxisConfigJSON {
  title?: string
  min?: number
  max?: number
  majorUnit?: number
  minorUnit?: number
  majorTick?: string
  minorTick?: string
  tickLabelPos?: string
  numFmt?: string
  reverse?: boolean
  logBase?: number
  lineColor?: string
  lineWidth?: number
  majorGridlines?: boolean
}

export interface ChartSpecJSON {
  name?: string
  type: string
  from?: ChartPoint
  to?: ChartPoint
  mode?: string
  title?: string
  titleOn?: boolean
  /** round65：标题样式 */
  titleStyle?: TitleStyleJSON
  legend?: string
  gridlines?: boolean
  dataLabels?: string
  gapWidth?: number
  overlap?: number
  holeSize?: number
  catAxis?: AxisConfigJSON
  valAxis?: AxisConfigJSON
  series: ChartSeriesJSON[]
  edited?: boolean
  anchorRaw?: string
  chartRaw?: string
}

// Office 主题配色（系列默认色）
export const CHART_PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300']

let chartSeq = 0
export function newChartId(): string {
  chartSeq += 1
  return `c${Date.now().toString(36)}${chartSeq}`
}

export function defaultChart(): ChartSpec {
  return {
    id: newChartId(), name: '',
    type: 'column',
    from: { col: 0, row: 0, dx: 0, dy: 0 },
    to: { col: 8, row: 15, dx: 0, dy: 0 },
    mode: 'moveSize',
    title: '', titleOn: true, titleStyle: defaultTitleStyle(),
    legend: 'r', gridlines: true, dataLabels: 'none',
    gapWidth: 150, overlap: 0, holeSize: 50,
    catAxis: defaultAxis(), valAxis: defaultAxis(),
    series: [],
    rangeRef: '', byRows: false,
    edited: true, anchorRaw: '', chartRaw: '',
  }
}

// ---- JSON 互转 ----

export function chartFromJSON(j: ChartSpecJSON): ChartSpec {
  const c = defaultChart()
  c.name = j.name || ''
  c.type = (j.type as ChartType) || 'column'
  if (j.from) c.from = j.from
  if (j.to) c.to = j.to
  c.mode = (j.mode as ChartSpec['mode']) || 'moveSize'
  c.title = j.title || ''
  c.titleOn = j.titleOn !== false
  c.titleStyle = titleStyleFromJSON(j.titleStyle)
  c.legend = (j.legend as ChartSpec['legend']) || 'r'
  c.gridlines = j.gridlines !== false
  c.dataLabels = (j.dataLabels as ChartSpec['dataLabels']) || 'none'
  c.gapWidth = j.gapWidth || 150
  c.overlap = j.overlap || 0
  c.holeSize = j.holeSize || 50
  c.catAxis = axisFromJSON(j.catAxis)
  c.valAxis = axisFromJSON(j.valAxis)
  c.series = (j.series || []).map(s => ({
    name: s.name || '', nameRef: s.nameRef || '',
    cats: s.cats || [], catsRef: s.catsRef || '',
    values: s.values || [], valuesRef: s.valuesRef || '',
    color: s.color || '',
  }))
  c.edited = !!j.edited
  c.anchorRaw = j.anchorRaw || ''
  c.chartRaw = j.chartRaw || ''
  return c
}

export function chartToJSON(c: ChartSpec): ChartSpecJSON {
  const j: ChartSpecJSON = {
    type: c.type,
    from: c.from, to: c.to, mode: c.mode,
    titleOn: c.titleOn,
    legend: c.legend === 'none' ? 'none' : c.legend,
    gridlines: c.gridlines,
    series: c.series.map(s => {
      const sj: ChartSeriesJSON = { values: s.values }
      if (s.name) sj.name = s.name
      if (s.nameRef) sj.nameRef = s.nameRef
      if (s.cats && s.cats.length) sj.cats = s.cats
      if (s.catsRef) sj.catsRef = s.catsRef
      if (s.valuesRef) sj.valuesRef = s.valuesRef
      if (s.color) sj.color = s.color
      return sj
    }),
  }
  if (c.name) j.name = c.name
  if (c.title) j.title = c.title
  if (c.dataLabels !== 'none') j.dataLabels = c.dataLabels
  if (c.gapWidth && c.gapWidth !== 150) j.gapWidth = c.gapWidth
  if (c.overlap) j.overlap = c.overlap
  if (c.type === 'doughnut') j.holeSize = c.holeSize
  j.titleStyle = titleStyleToJSON(c.titleStyle)
  j.catAxis = axisToJSON(c.catAxis)
  j.valAxis = axisToJSON(c.valAxis)
  if (c.edited) j.edited = true
  if (c.anchorRaw) j.anchorRaw = c.anchorRaw
  if (c.chartRaw) j.chartRaw = c.chartRaw
  return j
}

/** round65：标题样式 JSON 互转 */
function titleStyleFromJSON(j?: TitleStyleJSON): TitleStyle {
  const ts = defaultTitleStyle()
  if (!j) return ts
  ts.fontSize = j.fontSize || 0
  ts.color = j.color || ''
  ts.bold = j.bold !== false
  ts.italic = !!j.italic
  ts.pos = (j.pos as TitleStyle['pos']) || 'top'
  return ts
}

function titleStyleToJSON(ts: TitleStyle): TitleStyleJSON {
  const j: TitleStyleJSON = {}
  if (ts.fontSize) j.fontSize = ts.fontSize
  if (ts.color) j.color = ts.color
  // bold 默认 true：显式 false 时写出（与 bold=false 有意义的情况一致）
  j.bold = ts.bold !== false
  if (ts.italic) j.italic = true
  if (ts.pos && ts.pos !== 'top') j.pos = ts.pos
  return j
}

function axisFromJSON(j?: AxisConfigJSON): AxisConfig {
  const a = defaultAxis()
  if (!j) return a
  a.title = j.title || ''
  a.min = j.min ?? null
  a.max = j.max ?? null
  a.majorUnit = j.majorUnit ?? null
  a.minorUnit = j.minorUnit ?? null
  a.majorTick = (j.majorTick as AxisConfig['majorTick']) || ''
  a.minorTick = (j.minorTick as AxisConfig['minorTick']) || ''
  a.tickLabelPos = (j.tickLabelPos as AxisConfig['tickLabelPos']) || ''
  a.numFmt = j.numFmt || ''
  a.reverse = !!j.reverse
  a.logBase = j.logBase ?? null
  a.lineColor = j.lineColor || ''
  a.lineWidth = j.lineWidth || 0
  a.majorGridlines = !!j.majorGridlines
  return a
}

function axisToJSON(a: AxisConfig): AxisConfigJSON {
  const j: AxisConfigJSON = {}
  if (a.title) j.title = a.title
  if (a.min != null) j.min = a.min
  if (a.max != null) j.max = a.max
  if (a.majorUnit != null) j.majorUnit = a.majorUnit
  if (a.minorUnit != null) j.minorUnit = a.minorUnit
  if (a.majorTick) j.majorTick = a.majorTick
  if (a.minorTick) j.minorTick = a.minorTick
  if (a.tickLabelPos) j.tickLabelPos = a.tickLabelPos
  if (a.numFmt) j.numFmt = a.numFmt
  if (a.reverse) j.reverse = true
  if (a.logBase != null) j.logBase = a.logBase
  if (a.lineColor) j.lineColor = a.lineColor
  if (a.lineWidth) j.lineWidth = a.lineWidth
  if (a.majorGridlines) j.majorGridlines = true
  return j
}

// ---- 单元格取数（由编辑器注入取值函数） ----

export interface ChartDataAccess {
  /** 取指定区域的原始显示值（sheet 内相对引用，"B2:D4"） */
  rangeValues(ref: string): string[][]
  /** 绝对引用（含表名）→ 区域值（读取文件时后端给的引用是 "Sheet1!$B$2" 形式） */
  absRangeValues(ref: string): string[][] | null
  /** 区域值 → 绝对引用（写出时生成，如 "S1!$B$2:$D$4"） */
  makeAbsRef(ref: string): string
  /** 单元格引用 → 绝对引用 */
  makeAbsCellRef(ref: string): string
}

/** 判断字符串是否可解析为数值 */
export function parseNum(v: string): number {
  const f = parseFloat(v)
  return isNaN(f) || !isFinite(f) ? NaN : f
}

/**
 * 从矩形区域提取系列（Excel 默认规则）：
 * byRows=false（默认）：首行为系列名、首列为类别（每列一个系列）；
 * byRows=true：首列为系列名、首行为类别（每行一个系列）。
 * 区域只有一行/一列时：无表头，系列名用列标/行号。
 */
export function seriesFromRange(range: string, byRows: boolean, acc: ChartDataAccess): ChartSeries[] {
  const grid = acc.rangeValues(range)
  if (!grid.length || !grid[0].length) return []
  const rows = grid.length, cols = grid[0].length
  const out: ChartSeries[] = []

  if (!byRows) {
    // 每列一个系列；首行为系列名（多列时），首列为类别
    const hasHeader = rows >= 2 && cols >= 2
    const cats = hasHeader ? grid.slice(1).map(r => r[0] || '') : grid.map(r => r[0] || '')
    for (let c = hasHeader ? 1 : 0; c < cols; c++) {
      const col = grid.map(r => r[c] ?? '')
      const vals = (hasHeader ? col.slice(1) : col).map(parseNum)
      if (!vals.some(v => !isNaN(v))) continue
      out.push({
        name: hasHeader ? col[0] : `系列${out.length + 1}`,
        nameRef: '',
        cats: cats.map(s => s ?? ''),
        catsRef: '',
        values: vals,
        valuesRef: '',
        color: '',
      })
    }
  } else {
    // 每行一个系列；首列为系列名（多行时），首行为类别
    const hasHeader = rows >= 2 && cols >= 2
    const cats = hasHeader ? grid[0].slice(1) : grid[0]
    for (let r = hasHeader ? 1 : 0; r < rows; r++) {
      const row = grid[r]
      const vals = (hasHeader ? row.slice(1) : row).map(parseNum)
      if (!vals.some(v => !isNaN(v))) continue
      out.push({
        name: hasHeader ? (row[0] || '') : `系列${out.length + 1}`,
        nameRef: '',
        cats: cats.map(s => s ?? ''),
        catsRef: '',
        values: vals,
        valuesRef: '',
        color: '',
      })
    }
  }
  return out
}

/** 解析区域字符串 "B2:D4" → {c1,r1,c2,r2}（0 基）；非法返回 null */
export function parseRange(ref: string): { c1: number; r1: number; c2: number; r2: number } | null {
  const m = ref.trim().match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/)
  if (!m) return null
  const col = (s: string) => {
    let n = 0
    for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }
  const c1 = col(m[1]), r1 = parseInt(m[2], 10) - 1
  const c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? parseInt(m[4], 10) - 1 : r1
  return { c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) }
}

/** 编辑单元格后：按引用重算系列值（引用失效则保留缓存） */
export function refreshChartSeries(c: ChartSpec, acc: ChartDataAccess): ChartSpec {
  if (!c.rangeRef) return c
  const fresh = seriesFromRange(c.rangeRef, c.byRows, acc)
  if (!fresh.length) return c
  return { ...c, series: fresh }
}

/** 生成绝对引用（写出用）：区域首列引用 → 系列值引用等 */
export function absRefsForSeries(c: ChartSpec, acc: ChartDataAccess): ChartSpec {
  if (!c.rangeRef) return c
  const rg = parseRange(c.rangeRef)
  if (!rg) return c
  const series = c.series.map((s, i) => ({ ...s }))
  // ★ absRangeRef/absCellRef 内部 colLetter 按传参【原样】解释为列号：
  //   colLetter(1)='A'。parseRange 返回 0 基 → 传参必须是 1 基列号。
  //   round61 起 valuesRef 全部左移一列（指到类别列），此处统一换算修正。
  if (!c.byRows) {
    // 按列取系列：系列 i = c1+1(表头下一系列起)…实际数据列 c1+2..；首行 r1+1 为表头
    for (let i = 0; i < series.length; i++) {
      const col = rg.c1 + 2 + i // 数据列（c1+1 是类别列，c1+2 起是系列）
      series[i].valuesRef = absRangeRef(acc, col, rg.r1 + 2, col, rg.r2 + 1) // 数据行（跳过表头行 r1+1）
      series[i].nameRef = absCellRef(acc, col, rg.r1 + 1) // 系列名 = 数据列首行（表头）
      series[i].catsRef = absRangeRef(acc, rg.c1 + 1, rg.r1 + 2, rg.c1 + 1, rg.r2 + 1) // 类别 = 首列数据行
    }
  } else {
    // 按行取系列：系列 i = 数据行 r1+2..；首列 c1+1 为系列名列
    for (let i = 0; i < series.length; i++) {
      const row = rg.r1 + 2 + i // 数据行（跳过表头行 r1+1）
      series[i].valuesRef = absRangeRef(acc, rg.c1 + 2, row, rg.c2 + 1, row) // 数据行 c1+2..c2+1
      series[i].nameRef = absCellRef(acc, rg.c1 + 1, row) // 系列名 = 行首（首列）
      series[i].catsRef = absRangeRef(acc, rg.c1 + 2, rg.r1 + 1, rg.c2 + 1, rg.r1 + 1) // 类别 = 表头行数据列
    }
  }
  return { ...c, series }
}

function absRangeRef(acc: ChartDataAccess, c1: number, r1: number, c2: number, r2: number): string {
  return acc.makeAbsRef(`${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`)
}

function absCellRef(acc: ChartDataAccess, c: number, r: number): string {
  return acc.makeAbsCellRef(`${colLetter(c)}${r}`)
}

function colLetter(c: number): string {
  let s = ''
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return s || 'A'
}

// ---- 锚点几何（与图片 pictures.ts 同构；geom 由编辑器注入） ----

export interface ChartGeometry {
  colLeft(c: number): number
  rowTop(r: number): number
  colW(c: number): number
  rowH(r: number): number
}

export function chartPointXY(m: ChartPoint, g: ChartGeometry): { x: number; y: number } {
  return { x: g.colLeft(m.col) + m.dx, y: g.rowTop(m.row) + m.dy }
}

export function chartRect(c: ChartSpec, g: ChartGeometry): { x: number; y: number; w: number; h: number } {
  const a = chartPointXY(c.from, g)
  const b = chartPointXY(c.to, g)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export function setChartRect(c: ChartSpec, g: ChartGeometry, rect: { x: number; y: number; w: number; h: number }): ChartSpec {
  const r = { ...rect, w: Math.max(20, rect.w), h: Math.max(20, rect.h) }
  return anchorChartAt(c, g, r)
}

/** 坐标 → 单元格锚点 */
export function chartAnchorAt(x: number, y: number, g: ChartGeometry): ChartPoint {
  let c = 0, dx = x
  while (dx >= g.colW(c) && c < 20000) { dx -= g.colW(c); c++ }
  let r = 0, dy = y
  while (dy >= g.rowH(r) && r < 200000) { dy -= g.rowH(r); r++ }
  return { col: c, row: r, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 }
}

function anchorChartAt(c: ChartSpec, g: ChartGeometry, r: { x: number; y: number; w: number; h: number }): ChartSpec {
  return {
    ...c,
    from: chartAnchorAt(r.x, r.y, g),
    to: chartAnchorAt(r.x + r.w, r.y + r.h, g),
    edited: true,
  }
}

// ---- 类型标签 / 类型库 ----

export const CHART_TYPES: { group: string; items: { type: ChartType; icon: string; nameKey: string; name: string }[] }[] = [
  {
    group: '柱形图',
    items: [
      { type: 'column', icon: '▮▮▮', nameKey: 'sheet.chart.col', name: '簇状柱形图' },
      { type: 'columnStacked', icon: '▤▤▤', nameKey: 'sheet.chart.colStacked', name: '堆积柱形图' },
      { type: 'columnStacked100', icon: '▥▥▥', nameKey: 'sheet.chart.colStacked100', name: '百分比堆积柱形图' },
    ],
  },
  {
    group: '条形图',
    items: [
      { type: 'bar', icon: '▬▬▬', nameKey: 'sheet.chart.bar2', name: '簇状条形图' },
      { type: 'barStacked', icon: '▭▭▭', nameKey: 'sheet.chart.barStacked', name: '堆积条形图' },
      { type: 'barStacked100', icon: '▯▯▯', nameKey: 'sheet.chart.barStacked100', name: '百分比堆积条形图' },
    ],
  },
  {
    group: '折线图/面积图',
    items: [
      { type: 'line', icon: '📈', nameKey: 'sheet.chart.line', name: '折线图' },
      { type: 'lineMarker', icon: '⁘⁘⁘', nameKey: 'sheet.chart.lineMarker', name: '带数据标记的折线图' },
      { type: 'area', icon: '🔻', nameKey: 'sheet.chart.area', name: '面积图' },
    ],
  },
  {
    group: '饼图/散点图',
    items: [
      { type: 'pie', icon: '🥧', nameKey: 'sheet.chart.pie', name: '饼图' },
      { type: 'doughnut', icon: '🍩', nameKey: 'sheet.chart.donut', name: '圆环图' },
      { type: 'scatter', icon: '⚫', nameKey: 'sheet.chart.scatter', name: '散点图' },
    ],
  },
]

export function chartTypeLabel(t: string): string {
  for (const g of CHART_TYPES) for (const it of g.items) if (it.type === t) return it.name
  return t
}

/** 类型是否为笛卡尔图（有坐标轴） */
export function isCartesian(t: string): boolean {
  return t !== 'pie' && t !== 'doughnut'
}

/** 类型是否为百分比堆积（渲染时归一化到 100%） */
export function isPercentStacked(t: string): boolean {
  return t === 'columnStacked100' || t === 'barStacked100'
}
