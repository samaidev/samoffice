/**
 * ChartRenderer.tsx —— round61：图表 SVG 渲染器（对齐 MS Office 视觉）。
 *
 * 12 种 2D 图表类型：簇状/堆积/百分比堆积柱形、条形、折线（±标记）、面积、饼、环、散点。
 * 自适应任意框尺寸：坐标轴 + 漂亮刻度 + 网格线 + 图例（四方位）+ 标题 + 数据标签。
 * Office 主题配色；系列色可由模型覆盖（读自文件的 c:spPr）。
 */
import React from 'react'
import { ChartSpec, AxisConfig, CHART_PALETTE, isPercentStacked, TitleStyle } from './charts'

const AXIS = '#8c8c8c'
const GRID = '#e6e6e6'
const TEXT = '#595959'

/** round65：标题元素（样式 + 9 宫格位置；对齐 Excel「图表标题」格式）。
 *  pos: top（默认居中）/lt/ct/rt/l/c/r/lb/cb/rb —— 标题 overlay 不占布局
 *  （与 Excel 标题可放角落一致），仅 top 类位置保留顶部 padT 占位。 */
function titleEl(spec: ChartSpec, W: number, H: number): React.ReactNode {
  const ts: TitleStyle = spec.titleStyle || { fontSize: 0, color: '', bold: true, italic: false, pos: 'top' }
  const fs = Math.max(8, Math.min(48, ts.fontSize || 13))
  const fill = ts.color || '#333'
  const fw = ts.bold ? 600 : 400
  const style: React.CSSProperties = { fontStyle: ts.italic ? 'italic' : 'normal' }
  const pos = ts.pos || 'top'
  const anchor = (pos !== 'top' && pos.endsWith('l')) ? 'start' : (pos !== 'top' && pos.endsWith('r')) ? 'end' : 'middle'
  const x = anchor === 'start' ? 8 : anchor === 'end' ? W - 8 : W / 2
  let y: number
  if (pos === 'lb' || pos === 'cb' || pos === 'rb') y = H - 6          // 底部三格：贴底
  else if (pos === 'l' || pos === 'c' || pos === 'r') y = Math.round(H / 2)  // 中部三格：垂直居中
  else y = fs + 4                                                      // 顶部三格 + top 默认
  return (
    <text x={x} y={y} fontSize={fs} fontWeight={fw} fill={fill} style={style} textAnchor={anchor}>
      {spec.title}
    </text>
  )
}

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1)
  const r = Math.round(v * 100) / 100
  return String(r)
}

/** round62：Excel 数字格式码渲染（轴标签/数据标签共用；支持 0/0.0/0.00/#,##0/#,##0.0/0%/0.0%/"0 "等子集） */
function fmtByCode(v: number, code: string): string {
  if (!code || code === 'General') return fmtNum(v)
  const dec = (code.match(/\.(0+)/) || [, ''])[1]?.length ?? 0
  let out: string
  if (/%/.test(code)) {
    out = (v * 100).toFixed(dec) + '%'
  } else {
    out = v.toFixed(dec)
  }
  // 千分位
  if (/#,/.test(code) || /,/.test(code)) {
    const neg = out.startsWith('-')
    const [ip, dp] = out.replace('-', '').split('.')
    out = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dp ? '.' + dp : '')
    if (neg) out = '-' + out
  }
  return out
}

/** 漂亮刻度：覆盖 [min,max] 的 ~count 个等步长值。
 *  round62：axis.majorUnit 固定步长；axis.min/max 固定域；logBase 对数刻度。 */
function niceTicks(min: number, max: number, count = 5, axis?: AxisConfig): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1]
  if (min === max) { max = min + 1 }
  const lo = axis?.min != null ? axis.min : min
  const hi = axis?.max != null ? axis.max : max
  // 对数刻度：整数幂次刻度
  if (axis?.logBase != null && axis.logBase > 1) {
    const b = axis.logBase
    const out: number[] = []
    for (let e = Math.floor(Math.log10(lo) / Math.log10(b) + 1e-9); Math.pow(b, e) <= hi + 1e-9; e++) {
      out.push(Math.pow(b, e))
    }
    return out.length ? out : [1, 10]
  }
  // 固定主刻度单位：起点对齐 lo（含 lo 本身），步长 = majorUnit
  if (axis?.majorUnit != null && axis.majorUnit > 0) {
    const step = axis.majorUnit
    const out: number[] = []
    const start = Math.ceil((lo - 1e-9) / step) * step
    for (let v = start; v <= hi + step * 1e-3; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v)
    return out.length ? out : [lo, hi]
  }
  // 自动刻度：漂亮步长
  const step0 = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.floor(lo / step + 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= hi + step * 1e-3; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v)
  return out
}

const ChartRenderer: React.FC<{ spec: ChartSpec; w: number; h: number }> = ({ spec, w, h }) => {
  const series = spec.series.filter(s => s.values && s.values.length)
  const W = Math.max(80, Math.round(w)), H = Math.max(60, Math.round(h))

  // ---- 布局：标题/图例占位 ----
  const hasTitle = spec.titleOn && spec.title
  const legend = spec.legend
  const showLegend = legend !== 'none' && series.length > 0 && (series.length > 1 || spec.type === 'pie' || spec.type === 'doughnut' || series[0].name)
  let padT = 8, padB = 8, padL = 8, padR = 8
  if (hasTitle) padT += 22
  if (showLegend && (legend === 'b' || legend === 't')) padB += legend === 'b' ? 20 : 0, padT += legend === 't' ? 20 : 0
  if (showLegend && (legend === 'r' || legend === 'l')) padR += legend === 'r' ? 96 : 0, padL += legend === 'l' ? 96 : 0
  const xLabels = 30 // x 轴标签高度
  const yLabels = 42 // y 轴标签宽度
  const plotX = padL + yLabels
  const plotY = padT
  const plotW = Math.max(20, W - plotX - padR)
  const plotH = Math.max(20, H - plotY - padB - xLabels)
  const plotBottom = plotY + plotH

  const serColor = (i: number) => series[i]?.color || CHART_PALETTE[i % CHART_PALETTE.length]
  const nCats = Math.max(1, ...series.map(s => s.values.length))
  const cats: string[] = (series.find(s => s.cats.length >= nCats)?.cats) || series[0]?.cats || []

  // ---------- 饼 / 环 ----------
  if (spec.type === 'pie' || spec.type === 'doughnut') {
    const s0 = series[0]
    if (!s0) return <EmptyChart w={W} h={H} />
    const total = s0.values.reduce((a, b) => a + (isFinite(b) ? Math.max(0, b) : 0), 0)
    const cx = plotX + plotW / 2, cy = plotY + plotH / 2
    const r = Math.min(plotW, plotH) / 2 - 4
    const innerR = spec.type === 'doughnut' ? r * Math.max(0.1, spec.holeSize / 100) : 0
    let ang = -Math.PI / 2
    const slices = s0.values.map((v, i) => {
      const frac = total > 0 ? Math.max(0, isFinite(v) ? v : 0) / total : 1 / s0.values.length
      const a2 = ang + frac * Math.PI * 2
      const x1 = cx + Math.cos(ang) * r, y1 = cy + Math.sin(ang) * r
      const x2 = cx + Math.cos(a2 - 0.0001) * r, y2 = cy + Math.sin(a2 - 0.0001) * r
      const ix1 = cx + Math.cos(ang) * innerR, iy1 = cy + Math.sin(ang) * innerR
      const ix2 = cx + Math.cos(a2 - 0.0001) * innerR, iy2 = cy + Math.sin(a2 - 0.0001) * innerR
      const large = frac > 0.5 ? 1 : 0
      const d = innerR > 0
        ? `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}L${ix2},${iy2}A${innerR},${innerR} 0 ${large} 0 ${ix1},${iy1}Z`
        : `M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}Z`
      const mid = (ang + a2) / 2
      const lx = cx + Math.cos(mid) * (r + 12), ly = cy + Math.sin(mid) * (r + 12)
      const el = <g key={i}>
        <path d={d} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="#fff" strokeWidth={1.5} />
        {spec.dataLabels !== 'none' && total > 0 && frac > 0.03 && (
          <text x={lx} y={ly} fontSize={10} fill={TEXT} textAnchor="middle" dominantBaseline="middle">
            {`${Math.round(frac * 100)}%`}
          </text>
        )}
      </g>
      ang = a2
      return el
    })
    return (
      <svg width={W} height={H} data-chart-id={spec.id} style={{ display: 'block', background: '#fff' }}>
        {hasTitle && titleEl(spec, W, H)}
        {slices}
        {showLegend && <Legend spec={spec} series={series} serColor={serColor} W={W} H={H} padT={padT} />}
      </svg>
    )
  }

  // ---------- 笛卡尔图：值域 ----------
  const stacked = spec.type.includes('Stacked')
  const pct = isPercentStacked(spec.type)
  const horizontal = spec.type.startsWith('bar')
  const lineish = spec.type === 'line' || spec.type === 'lineMarker'
  const scatter = spec.type === 'scatter'
  // round62 轴配置（值轴 = 数值；类别轴仅标题/刻度线/反转）
  const vAx = spec.valAxis
  const cAx = spec.catAxis

  let domainMin = 0, domainMax = 1
  if (stacked) {
    domainMin = 0
    const sums: number[] = []
    for (let ci = 0; ci < nCats; ci++) {
      let s = 0
      for (const ser of series) s += isFinite(ser.values[ci]) ? ser.values[ci] : 0
      sums.push(s)
    }
    domainMax = Math.max(1, ...sums)
    if (pct) domainMax = 1
  } else {
    let mn = Infinity, mx = -Infinity
    for (const ser of series) for (const v of ser.values) {
      if (!isFinite(v)) continue
      mn = Math.min(mn, v); mx = Math.max(mx, v)
    }
    if (!isFinite(mn)) { mn = 0; mx = 1 }
    if (mn > 0) mn = 0
    if (mx < 0) mx = 0
    if (mn === mx) mx = mn + 1
    domainMin = mn; domainMax = mx
  }
  // round62：固定域优先（axis.min/max），否则取自动刻度的覆盖域
  let vMin: number, vMax: number, ticks: number[]
  if (vAx.min != null || vAx.max != null) {
    vMin = vAx.min != null ? vAx.min : Math.min(domainMin, 0)
    vMax = vAx.max != null ? vAx.max : domainMax + Math.max(1, (domainMax - Math.min(domainMin, 0)) * 0.1)
    if (vMax <= vMin) vMax = vMin + 1
    ticks = niceTicks(vMin, vMax, 4, vAx)
    if (!ticks.length) ticks = [vMin, vMax]
    if (ticks[0] > vMin) ticks.unshift(vMin)
    if (ticks[ticks.length - 1] < vMax) ticks.push(vMax)
  } else {
    ticks = niceTicks(domainMin, domainMax, 4, vAx)
    vMin = Math.min(domainMin, ticks[0])
    vMax = Math.max(domainMax, ticks[ticks.length - 1])
  }
  // 反转轴（Excel「逆序类别/值」）
  const vReversed = vAx.reverse
  const vSpan = vMax - vMin || 1

  // 散点 x 域（类别可解析为数值则用数值，否则用序号）
  const catNum = (s: string, i: number) => {
    const v = parseFloat(s)
    return isNaN(v) ? i : v
  }
  let xMin = Infinity, xMax = -Infinity
  if (scatter) {
    for (const ser of series) ser.cats.forEach((c, i) => {
      const v = catNum(c, i)
      xMin = Math.min(xMin, v); xMax = Math.max(xMax, v)
    })
    if (!isFinite(xMin)) { xMin = 0; xMax = 1 }
    if (xMin === xMax) xMax = xMin + 1
  }
  const xTicks = scatter ? niceTicks(xMin, xMax, 4) : []

  // 值 → 像素（round62：reverse 翻转方向）
  const valPx = (v: number) => {
    const f = vReversed ? 1 - (v - vMin) / vSpan : (v - vMin) / vSpan
    return horizontal ? plotX + f * plotW : plotBottom - f * plotH
  }
  const xPx = (i: number) => scatter ? plotX + ((catNum(cats[i] ?? String(i), i) - xMin) / (xMax - xMin || 1)) * plotW
    : horizontal ? plotX : plotX + ((i + 0.5) / nCats) * plotW
  const catPx = (i: number) => horizontal ? plotY + ((i + 0.5) / nCats) * plotH : plotBottom - ((i + 0.5) / nCats) * plotH

  // 堆积基线
  const stackPos: number[][] = []
  for (let ci = 0; ci < nCats; ci++) {
    let acc = 0
    stackPos.push(series.map(ser => {
      const v = isFinite(ser.values[ci]) ? ser.values[ci] : 0
      const base = acc
      acc += pct && v > 0 ? v : v // 百分比堆积在渲染时按比例归一
      return base
    }))
  }
  const catSum = (ci: number) => {
    let s = 0
    for (const ser of series) s += Math.max(0, isFinite(ser.values[ci]) ? ser.values[ci] : 0)
    return s
  }

  // ---------- 序列绘制 ----------
  const bandSize = horizontal ? plotH / nCats : plotW / nCats
  const barW = Math.max(2, stacked ? bandSize * 0.62 : (bandSize * 0.62) / Math.max(1, series.length))
  const gap = bandSize * 0.38

  const renderers: React.ReactNode[] = []
  series.forEach((ser, si) => {
    const color = serColor(si)
    if (spec.type === 'column' || spec.type === 'bar' || stacked) {
      const els: React.ReactNode[] = []
      for (let ci = 0; ci < ser.values.length; ci++) {
        let v = ser.values[ci]
        if (!isFinite(v)) continue
        let base = 0
        if (stacked) {
          base = stackPos[ci][si]
          if (pct) {
            const sum = catSum(ci) || 1
            const h0 = (Math.max(0, v) / sum)
            v = h0 * (vMax - 0) // 归一化后的“值”（域 0..1）
            base = base / sum
          }
        }
        const a = valPx(base), b = valPx(base + v)
        if (horizontal) {
          const y = catPx(ci) - (stacked ? barW / 2 : barW / 2 - si * barW) - (stacked ? 0 : 0)
          const yy = stacked ? catPx(ci) - barW / 2 : plotY + (catPx(ci) - plotY) - (series.length * barW) / 2 + si * barW
          els.push(<rect key={ci} x={Math.min(a, b)} y={yy} width={Math.max(1, Math.abs(b - a))} height={barW - 1} fill={color} rx={1} />)
        } else {
          const xx = stacked ? catPx(ci) - barW / 2 : catPx(ci) - (series.length * barW) / 2 + si * barW
          els.push(<rect key={ci} x={xx} y={Math.min(a, b)} width={barW - 1} height={Math.max(1, Math.abs(b - a))} fill={color} rx={1} />)
        }
        if (spec.dataLabels !== 'none' && !stacked && ser.values.length <= 12) {
          const raw = ser.values[ci]
          if (horizontal) {
            const yy = stacked ? catPx(ci) - barW / 2 : plotY + (catPx(ci) - plotY) - (series.length * barW) / 2 + si * barW
            els.push(<text key={`l${ci}`} x={b + 3} y={yy + barW / 2} fontSize={9} fill={TEXT} dominantBaseline="middle">{fmtNum(raw)}</text>)
          } else {
            const xx = stacked ? catPx(ci) - barW / 2 : catPx(ci) - (series.length * barW) / 2 + si * barW
            els.push(<text key={`l${ci}`} x={xx + (barW - 1) / 2} y={Math.min(a, b) - 3} fontSize={9} fill={TEXT} textAnchor="middle">{fmtNum(raw)}</text>)
          }
        }
      }
      renderers.push(<g key={si}>{els}</g>)
    } else if (lineish) {
      const pts: string[] = []
      const dots: React.ReactNode[] = []
      for (let ci = 0; ci < ser.values.length; ci++) {
        const v = ser.values[ci]
        if (!isFinite(v)) continue
        const x = plotX + ((ci + 0.5) / nCats) * plotW
        const y = plotBottom - ((v - vMin) / vSpan) * plotH
        pts.push(`${x},${y}`)
        if (spec.type === 'lineMarker') dots.push(<circle key={ci} cx={x} cy={y} r={3} fill={color} />)
        if (spec.dataLabels !== 'none' && ser.values.length <= 12) dots.push(<text key={`t${ci}`} x={x} y={y - 6} fontSize={9} fill={TEXT} textAnchor="middle">{fmtNum(v)}</text>)
      }
      renderers.push(<g key={si}>
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />
        {dots}
      </g>)
    } else if (spec.type === 'area') {
      const pts: string[] = []
      for (let ci = 0; ci < ser.values.length; ci++) {
        const v = isFinite(ser.values[ci]) ? ser.values[ci] : 0
        pts.push(`${plotX + ((ci + 0.5) / nCats) * plotW},${plotBottom - ((v - vMin) / vSpan) * plotH}`)
      }
      const base = `${plotX + 0.5 / nCats * plotW},${plotBottom} ${pts.join(' ')} ${plotX + ((ser.values.length - 0.5) / nCats) * plotW},${plotBottom}`
      renderers.push(<g key={si}>
        <polygon points={base} fill={color} opacity={0.35} />
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />
      </g>)
    } else if (scatter) {
      const dots: React.ReactNode[] = []
      for (let ci = 0; ci < ser.values.length; ci++) {
        const v = ser.values[ci]
        if (!isFinite(v)) continue
        const x = plotX + ((catNum(ser.cats[ci] ?? String(ci), ci) - xMin) / (xMax - xMin || 1)) * plotW
        const y = plotBottom - ((v - vMin) / vSpan) * plotH
        dots.push(<circle key={ci} cx={x} cy={y} r={4} fill={color} />)
        if (spec.dataLabels !== 'none' && ser.values.length <= 12) dots.push(<text key={`t${ci}`} x={x + 6} y={y - 6} fontSize={9} fill={TEXT}>{fmtNum(v)}</text>)
      }
      renderers.push(<g key={si}>{dots}</g>)
    }
  })

  // ---------- 轴与网格（round62：全属性渲染） ----------
  const axes: React.ReactNode[] = []
  // 网格线（数值轴总开关 spec.gridlines；样式取 vAx.lineColor/lineWidth）
  const gridStroke = vAx.lineColor || GRID
  const gridW = vAx.lineWidth ? Math.max(0.5, vAx.lineWidth) : 1
  if (spec.gridlines) {
    ticks.forEach((t, i) => {
      const p = valPx(t)
      axes.push(horizontal
        ? <line key={`g${i}`} x1={p} y1={plotY} x2={p} y2={plotBottom} stroke={gridStroke} strokeWidth={gridW} />
        : <line key={`g${i}`} x1={plotX} y1={p} x2={plotX + plotW} y2={p} stroke={gridStroke} strokeWidth={gridW} />)
    })
  }
  // 值刻度标签（数字格式 vAx.numFmt；tickLabelPos=none 隐藏；high 贴绘图区顶端/右缘）
  const vShowLabels = vAx.tickLabelPos !== 'none'
  if (vShowLabels) {
    ticks.forEach((t, i) => {
      const label = pct ? `${Math.round(t * 100)}%` : fmtByCode(t, vAx.numFmt)
      const p = valPx(t)
      const high = vAx.tickLabelPos === 'high'
      axes.push(horizontal
        ? <text key={`t${i}`} x={p} y={high ? plotY - 3 : plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{label}</text>
        : <text key={`t${i}`} x={high ? plotX + plotW + 5 : plotX - 5} y={p + 3} fontSize={9.5} fill={AXIS} textAnchor={high ? 'start' : 'end'}>{label}</text>)
    })
  }
  // 轴线（颜色/宽度可定制；tickLabelPos=none 视为隐藏整轴）
  const axStroke = vAx.lineColor || AXIS
  const axW = vAx.lineWidth ? Math.max(0.75, vAx.lineWidth) : 1
  if (vAx.tickLabelPos !== 'none') {
    axes.push(<line key="ax" x1={plotX} y1={plotBottom} x2={plotX + plotW} y2={plotBottom} stroke={axStroke} strokeWidth={axW} />)
    axes.push(<line key="ay" x1={plotX} y1={plotY} x2={plotX} y2={plotBottom} stroke={axStroke} strokeWidth={axW} />)
    // 值轴主要刻度线（outside 向外/inside 向内/cross 两向；horizontal 时竖直方向）
    const vTick = vAx.majorTick || 'outside'
    if (vTick !== 'none') {
      ticks.forEach(t => {
        const p = valPx(t)
        const len = 4
        if (horizontal) {
          const y2v = vTick === 'inside' ? p - len : vTick === 'cross' ? p - len : p + len
          const y1v = vTick === 'inside' ? p : vTick === 'cross' ? p + len : p
          axes.push(<line key={`vt${t}`} x1={plotX} y1={y1v} x2={plotX} y2={y2v} stroke={axStroke} strokeWidth={1} />)
        } else {
          const x2v = vTick === 'inside' ? plotX + len : vTick === 'cross' ? plotX + len : plotX - len
          const x1v = vTick === 'inside' ? plotX : vTick === 'cross' ? plotX - len : plotX
          axes.push(<line key={`vt${t}`} x1={x1v} y1={p} x2={x2v} y2={p} stroke={axStroke} strokeWidth={1} />)
        }
      })
    }
    // 值轴次要刻度线（主刻度间按 minorUnit 插入）
    if (vAx.minorUnit != null && vAx.minorUnit > 0 && vAx.majorUnit != null && vAx.majorUnit > vAx.minorUnit) {
      const n = Math.floor(vAx.majorUnit / vAx.minorUnit)
      for (let t = vMin; t < vMax; t += vAx.majorUnit) {
        for (let k = 1; k < n && t + k * vAx.minorUnit < vMax; k++) {
          const p = valPx(t + k * vAx.minorUnit)
          const len = 2.5
          if (horizontal) {
            axes.push(<line key={`vm${t}.${k}`} x1={plotX} y1={p} x2={plotX} y2={p + len} stroke={axStroke} strokeWidth={1} />)
          } else {
            axes.push(<line key={`vm${t}.${k}`} x1={plotX - len} y1={p} x2={plotX} y2={p} stroke={axStroke} strokeWidth={1} />)
          }
        }
      }
    }
  }
  // 类别轴（round62：标题/刻度线/标签隐藏/反转/线条样式）
  const cShowLabels = cAx.tickLabelPos !== 'none'
  const cAxStroke = cAx.lineColor || AXIS
  const catReversed = cAx.reverse
  // 反转类别：catPx 映射倒置
  const catPxR = (i: number) => catReversed
    ? (horizontal ? plotY + plotH - ((i + 0.5) / nCats) * plotH : plotBottom - ((i + 0.5) / nCats) * plotW)
    : catPx(i)
  if (cShowLabels) {
    // 类别标签（散点图用 x 数值刻度）
    if (scatter) {
      const xFmt = (t: number) => fmtByCode(t, cAx.numFmt)
      const xr = (t: number) => catReversed ? plotX + plotW - ((t - xMin) / (xMax - xMin || 1)) * plotW : plotX + ((t - xMin) / (xMax - xMin || 1)) * plotW
      xTicks.forEach((t, i) => {
        axes.push(<text key={`x${i}`} x={xr(t)} y={plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{xFmt(t)}</text>)
      })
    } else {
      const step = Math.max(1, Math.ceil(nCats / Math.max(2, Math.floor((horizontal ? plotH : plotW) / 34))))
      for (let ci = 0; ci < nCats; ci += step) {
        const label = cats[ci] ?? String(ci + 1)
        const p = catPxR(ci)
        axes.push(horizontal
          ? <text key={`c${ci}`} x={plotX - 5} y={p + 3} fontSize={9.5} fill={AXIS} textAnchor="end">{label}</text>
          : <text key={`c${ci}`} x={p} y={plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{label}</text>)
      }
    }
  }
  // 类别轴刻度线（每个类别一记；horizontal 时为水平短线）
  if (cAx.tickLabelPos !== 'none') {
    for (let ci = 0; ci < nCats; ci++) {
      const p = catPxR(ci)
      const len = 4
      if (cAx.majorTick && cAx.majorTick !== 'none') {
        axes.push(horizontal
          ? <line key={`ct${ci}`} x1={plotX} y1={p} x2={plotX + len} y2={p} stroke={cAxStroke} strokeWidth={1} />
          : <line key={`ct${ci}`} x1={p} y1={plotBottom} x2={p} y2={plotBottom + len} stroke={cAxStroke} strokeWidth={1} />)
      }
    }
    if (cAx.majorGridlines) {
      for (let ci = 0; ci < nCats; ci++) {
        const p = catPxR(ci)
        axes.push(horizontal
          ? <line key={`cg${ci}`} x1={plotX} y1={p} x2={plotX + plotW} y2={p} stroke={cAx.lineColor || GRID} strokeWidth={cAx.lineWidth || 1} />
          : <line key={`cg${ci}`} x1={p} y1={plotY} x2={p} y2={plotBottom} stroke={cAx.lineColor || GRID} strokeWidth={cAx.lineWidth || 1} />)
      }
    }
  }

  // 轴标题（round62：水平方向的轴标题横排底部；垂直方向旋转 -90°）
  const axisTitleEl = (text: string, horiz: boolean) => {
    if (!text) return null
    return horiz
      ? <text x={plotX + plotW / 2} y={H - 6} fontSize={11} fill={TEXT} textAnchor="middle">{text}</text>
      : <text x={12} y={plotY + plotH / 2} fontSize={11} fill={TEXT} textAnchor="middle" transform={`rotate(-90 12 ${plotY + plotH / 2})`}>{text}</text>
  }
  // 值轴标题：垂直图（值轴在左）旋转；horizontal 条形图（值轴在下）横排
  const valTitle = vAx.title ? axisTitleEl(vAx.title, horizontal) : null
  // 类别轴标题：垂直图（类别轴在下）横排；horizontal 条形图（类别轴在左）旋转
  const catTitle = cAx.title ? axisTitleEl(cAx.title, !horizontal) : null

  return (
    <svg width={W} height={H} data-chart-id={spec.id} style={{ display: 'block', background: '#fff', border: '1px solid #d9d9d9' }}>
      {hasTitle && titleEl(spec, W, H)}
      {axes}
      {renderers}
      {valTitle}
      {catTitle}
      {showLegend && <Legend spec={spec} series={series} serColor={serColor} W={W} H={H} padT={padT} />}
    </svg>
  )
}

/** 图例：按方位渲染系列名 + 色块（饼/环用类别名） */
const Legend: React.FC<{ spec: ChartSpec; series: ChartSpec['series']; serColor: (i: number) => string; W: number; H: number; padT: number }> = ({ spec, series, serColor, W, H, padT }) => {
  const isPie = spec.type === 'pie' || spec.type === 'doughnut'
  const n = isPie ? (series[0]?.values.length || 0) : series.length
  const label = (i: number) => isPie ? (series[0]?.cats[i] ?? `项${i + 1}`) : (series[i]?.name || `系列${i + 1}`)
  const color = (i: number) => isPie ? CHART_PALETTE[i % CHART_PALETTE.length] : serColor(i)
  const items: React.ReactNode[] = []
  const fs = 9.5
  let tw = 0
  const texts = Array.from({ length: n }, (_, i) => label(i))
  // 用近似宽度（中文≈字号，西文≈0.55×字号）
  const width = (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? fs : fs * 0.55), 0)
  tw = texts.reduce((a, s) => a + width(s), 0) + n * 16 + 8

  if (spec.legend === 'r' || spec.legend === 'l') {
    const lx = spec.legend === 'r' ? W - Math.min(120, tw) : 6
    for (let i = 0; i < n; i++) {
      items.push(<g key={i} transform={`translate(${lx},${padT + 6 + i * 15})`}>
        <rect width={10} height={10} y={-8} fill={color(i)} rx={2} />
        <text x={14} y={0} fontSize={fs} fill={TEXT}>{texts[i]}</text>
      </g>)
    }
  } else {
    const horiz = tw < W - 20
    const perRow = horiz ? 1 : Math.max(1, Math.floor((W - 16) / Math.max(60, tw / n)))
    const rows = Math.ceil(n / perRow)
    const ly = spec.legend === 'b' ? H - 6 - (rows - 1) * 15 : padT - 14
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), colI = i % perRow
      const colW = (W - 16) / perRow
      items.push(<g key={i} transform={`translate(${8 + colI * colW},${ly + row * 15})`}>
        <rect width={10} height={10} y={-8} fill={color(i)} rx={2} />
        <text x={14} y={0} fontSize={fs} fill={TEXT}>{texts[i]}</text>
      </g>)
    }
  }
  return <g>{items}</g>
}

const EmptyChart: React.FC<{ w: number; h: number }> = ({ w, h }) => (
  <svg width={w} height={h} style={{ display: 'block', background: '#fff', border: '1px solid #d9d9d9' }}>
    <text x={w / 2} y={h / 2} fontSize={11} fill="#999" textAnchor="middle" dominantBaseline="middle">无数据</text>
  </svg>
)

export default ChartRenderer
