/**
 * ChartRenderer.tsx —— round61：图表 SVG 渲染器（对齐 MS Office 视觉）。
 *
 * 12 种 2D 图表类型：簇状/堆积/百分比堆积柱形、条形、折线（±标记）、面积、饼、环、散点。
 * 自适应任意框尺寸：坐标轴 + 漂亮刻度 + 网格线 + 图例（四方位）+ 标题 + 数据标签。
 * Office 主题配色；系列色可由模型覆盖（读自文件的 c:spPr）。
 */
import React from 'react'
import { ChartSpec, CHART_PALETTE, isPercentStacked } from './charts'

const AXIS = '#8c8c8c'
const GRID = '#e6e6e6'
const TEXT = '#595959'

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1)
  const r = Math.round(v * 100) / 100
  return String(r)
}

/** 漂亮刻度：覆盖 [min,max] 的 ~count 个等步长值 */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1]
  if (min === max) { max = min + 1 }
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.floor(min / step + 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-3; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v)
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
        {hasTitle && <text x={W / 2} y={15} fontSize={13} fontWeight={600} fill="#333" textAnchor="middle">{spec.title}</text>}
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
  const ticks = niceTicks(domainMin, domainMax, 4)
  const vMin = Math.min(domainMin, ticks[0]), vMax = Math.max(domainMax, ticks[ticks.length - 1])
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

  // 值 → 像素
  const valPx = (v: number) => horizontal ? plotX + ((v - vMin) / vSpan) * plotW : plotBottom - ((v - vMin) / vSpan) * plotH
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

  // ---------- 轴与网格 ----------
  const axes: React.ReactNode[] = []
  if (spec.gridlines) {
    ticks.forEach((t, i) => {
      const p = valPx(t)
      axes.push(horizontal
        ? <line key={`g${i}`} x1={p} y1={plotY} x2={p} y2={plotBottom} stroke={GRID} />
        : <line key={`g${i}`} x1={plotX} y1={p} x2={plotX + plotW} y2={p} stroke={GRID} />)
    })
  }
  ticks.forEach((t, i) => {
    const label = pct ? `${Math.round(t * 100)}%` : fmtNum(t)
    const p = valPx(t)
    axes.push(horizontal
      ? <text key={`t${i}`} x={p} y={plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{label}</text>
      : <text key={`t${i}`} x={plotX - 5} y={p + 3} fontSize={9.5} fill={AXIS} textAnchor="end">{label}</text>)
  })
  // 轴线
  axes.push(<line key="ax" x1={plotX} y1={plotBottom} x2={plotX + plotW} y2={plotBottom} stroke={AXIS} strokeWidth={1} />)
  axes.push(<line key="ay" x1={plotX} y1={plotY} x2={plotX} y2={plotBottom} stroke={AXIS} strokeWidth={1} />)
  // 类别标签（散点图用 x 数值刻度）
  if (scatter) {
    xTicks.forEach((t, i) => {
      const p = plotX + ((t - xMin) / (xMax - xMin || 1)) * plotW
      axes.push(<text key={`x${i}`} x={p} y={plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{fmtNum(t)}</text>)
    })
  } else {
    const step = Math.max(1, Math.ceil(nCats / Math.max(2, Math.floor((horizontal ? plotH : plotW) / 34))))
    for (let ci = 0; ci < nCats; ci += step) {
      const label = cats[ci] ?? String(ci + 1)
      const p = catPx(ci)
      axes.push(horizontal
        ? <text key={`c${ci}`} x={plotX - 5} y={p + 3} fontSize={9.5} fill={AXIS} textAnchor="end">{label}</text>
        : <text key={`c${ci}`} x={plotX + ((ci + 0.5) / nCats) * plotW} y={plotBottom + 14} fontSize={9.5} fill={AXIS} textAnchor="middle">{label}</text>)
    }
  }

  return (
    <svg width={W} height={H} data-chart-id={spec.id} style={{ display: 'block', background: '#fff', border: '1px solid #d9d9d9' }}>
      {hasTitle && <text x={W / 2} y={15} fontSize={13} fontWeight={600} fill="#333" textAnchor="middle">{spec.title}</text>}
      {axes}
      {renderers}
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
