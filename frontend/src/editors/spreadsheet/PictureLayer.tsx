/**
 * PictureLayer.tsx —— round60：浮动图片渲染与交互层（对齐 MS Excel）。
 *
 * 渲染：每张图片一个内联 SVG —— clipPath 承载 prstGeom 几何形状，<image> 承载
 * 裁剪/翻转/颜色校正（CSS filter + SVG 滤镜），feDropShadow/feMorphology/feGaussianBlur
 * 等实现阴影/发光/柔化边缘/映像/棱台，scene3d 相机用 CSS 3D 变换近似。
 * 点击命中跟随裁剪形状（svg 根不响应指针，只有裁剪组与边框响应）。
 * 交互：8 个尺寸柄 + 旋转柄 + 裁剪柄，拖动（Alt=吸附网格，Ctrl=拖动复制），
 * 多选（Ctrl/Shift+点击切换），裁剪模式（柄调区域 / 拖主体平移画面）。
 * 坐标系：工作表坐标（不含行/列标头），由编辑器把本层定位到 A1 原点。
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  SheetPicture, PicGeometry, PicRect, PicHandle, picRect, setPicRect, shapePath, shapeFillRule,
  cropWindow, resizeRect, rotationFromPointer, touchPic, PicPart, newPicId,
} from './pictures'
import { ChartSpec, chartRect, setChartRect, newChartId } from './charts'
import ChartRenderer from './ChartRenderer'

export interface PictureLayerProps {
  pics: SheetPicture[]
  sel: string[]
  cropId: string | null
  geom: PicGeometry
  /** 滚动容器 CSS zoom 百分比（指针坐标 → 工作表坐标要除掉缩放） */
  zoom: number
  onChange: (fn: (pics: SheetPicture[]) => SheetPicture[], touch?: PicPart | PicPart[]) => void
  /** round61：浮动图表（与图片同层；渲染在图片之上） */
  charts: ChartSpec[]
  onChangeCharts: (fn: (charts: ChartSpec[]) => ChartSpec[]) => void
  onSelect: (ids: string[], focusId?: string) => void
  onActivate: () => void
  onMenu: (x: number, y: number, picId: string) => void
  onNativeSize: (id: string, w: number, h: number) => void
  onBeginEdit: () => void // 拖动/缩放开始时由编辑器压入撤销栈
  onEndCrop: () => void
}

const HANDLE_POS: Record<PicHandle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
}
const HANDLES: PicHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR: Record<PicHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
}

const DASH_MAP: Record<string, string> = {
  solid: '', dot: '1,3', sysDot: '1,3', dash: '4,3', sysDash: '3,2',
  lgDash: '8,3', dashDot: '4,3,1,3', sysDashDot: '3,2,1,2',
  lgDashDot: '8,3,2,3', lgDashDotDot: '8,3,2,3,2,3', sysDashDotDot: '3,2,1,2,1,2',
}

/** 颜色校正 → CSS filter（亮度/对比度/饱和度/灰度；透明度走 opacity） */
function colorFilterCSS(c: SheetPicture['color']): string {
  if (!c) return ''
  const parts: string[] = []
  if (c.brightness) parts.push(`brightness(${(1 + c.brightness).toFixed(3)})`)
  if (c.contrast) parts.push(`contrast(${(1 + c.contrast).toFixed(3)})`)
  if (c.saturation) parts.push(`saturate(${Math.max(0, 1 + c.saturation).toFixed(3)})`)
  if (c.grayscale) parts.push('grayscale(1)')
  return parts.join(' ')
}

function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.padEnd(6, '0').slice(0, 6), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** 相机预设 → CSS 3D 近似（正交/透视各预设的近似旋转角） */
function camCSS(p: SheetPicture): string {
  if (!p.cam) return ''
  const persp = p.cam.startsWith('perspective') ? 'perspective(900px) ' : ''
  const table: Record<string, [number, number, number]> = {
    orthographicFront: [0, 0, 0],
    isometricOffAxis1Left: [0, -30, 0], isometricOffAxis1Right: [0, 30, 0],
    isometricOffAxis2Left: [30, -30, 0], isometricOffAxis2Right: [30, 30, 0],
    isometricOffAxis3Left: [-30, -30, 0], isometricOffAxis3Right: [-30, 30, 0],
    isometricOffAxis4Left: [0, -45, 0], isometricOffAxis4Right: [0, 45, 0],
    isometricTopDown: [90, 0, 0], isometricBottomUp: [-90, 0, 0],
    perspectiveFront: [0, 0, 0], perspectiveLeft: [0, -35, 0], perspectiveRight: [0, 35, 0],
    perspectiveUp: [-35, 0, 0], perspectiveDown: [35, 0, 0],
    perspectiveContrastingLeftFacing: [0, -60, 0], perspectiveContrastingRightFacing: [0, 60, 0],
    legacyObliqueTopLeft: [20, -30, 0], legacyObliqueTopRight: [20, 30, 0],
    legacyObliqueBottomLeft: [-20, -30, 0], legacyObliqueBottomRight: [-20, 30, 0],
  }
  const [rx, ry, rz] = table[p.cam] || [0, 0, 0]
  const X = rx + p.camLat, Y = ry + p.camLon, Z = rz + p.camRev
  if (!X && !Y && !Z) return ''
  return `${persp}rotateX(${X.toFixed(1)}deg) rotateY(${Y.toFixed(1)}deg) rotateZ(${Z.toFixed(1)}deg)`
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

/** 单张图片的 SVG 渲染（点击命中 = 裁剪组 + 边框描边） */
const PicSvg: React.FC<{
  p: SheetPicture
  r: PicRect
  onNativeSize: (id: string, w: number, h: number) => void
  onDown: (e: React.MouseEvent) => void
  onCtx: (e: React.MouseEvent) => void
}> = ({ p, r, onNativeSize, onDown, onCtx }) => {
  const uid = useMemo(() => p.id.replace(/[^a-zA-Z0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6), [p.id])
  const win = cropWindow(p.crop)
  const imgW = r.w / win.w, imgH = r.h / win.h
  const imgX = -p.crop.l * imgW, imgY = -p.crop.t * imgH
  const path = shapePath(p.geom === 'custGeom' ? 'rect' : p.geom, r.w, r.h) || shapePath('rect', r.w, r.h)!
  const fillRule = shapeFillRule(p.geom)

  const flip = p.flipH || p.flipV
    ? `translate(${p.flipH ? r.w : 0},${p.flipV ? r.h : 0}) scale(${p.flipH ? -1 : 1},${p.flipV ? -1 : 1})`
    : undefined

  const c = p.color
  const needDuo = !!c?.duotone
  const needTP = !!c?.transparent
  const [dr, dg, db] = c?.duotone ? hexRGB(c.duotone[0]) : [0, 0, 0]
  const [lr, lg, lb] = c?.duotone ? hexRGB(c.duotone[1]) : [255, 255, 255]

  const sh = p.shadow
  const glow = p.glow && p.glow.size > 0 ? p.glow : null
  const soft = p.softEdge > 0 ? p.softEdge : 0
  const bevel = p.bevel
  const hasShadow = !!sh && (sh.blur > 0 || sh.dist > 0)
  const hasFx = hasShadow || !!glow || soft > 0 || !!bevel

  const reflH = p.reflection > 0 ? r.h * 0.55 : 0
  const reflGap = 3
  const cssFilter = colorFilterCSS(c)
  const opacity = c && c.transparency > 0 ? 1 - c.transparency : 1

  return (
    <svg
      width={Math.max(1, r.w)} height={Math.max(1, r.h)}
      viewBox={`0 0 ${Math.max(1, r.w)} ${Math.max(1, r.h)}`}
      data-pic-id={p.id}
      style={{
        position: 'absolute', left: r.x, top: r.y, overflow: 'visible', display: 'block', pointerEvents: 'none',
        transform: [p.rot ? `rotate(${p.rot}deg)` : '', camCSS(p)].filter(Boolean).join(' ') || undefined,
        transformOrigin: 'center center',
      }}
    >
      <defs>
        <clipPath id={`clip${uid}`} clipPathUnits="userSpaceOnUse">
          <path d={path} clipRule={fillRule} />
        </clipPath>
        {needDuo && (
          <filter id={`duo${uid}`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" result="lum" />
            <feComponentTransfer in="lum">
              <feFuncR type="table" tableValues={`${(dr / 255).toFixed(3)} ${(lr / 255).toFixed(3)}`} />
              <feFuncG type="table" tableValues={`${(dg / 255).toFixed(3)} ${(lg / 255).toFixed(3)}`} />
              <feFuncB type="table" tableValues={`${(db / 255).toFixed(3)} ${(lb / 255).toFixed(3)}`} />
              <feFuncA type="table" tableValues="0 1" />
            </feComponentTransfer>
          </filter>
        )}
        {needTP && (() => {
          const [tr, tg, tb] = hexRGB(c!.transparent)
          const yc = (0.2126 * tr + 0.7152 * tg + 0.0722 * tb) / 255
          const tol = 0.08
          return (
            <filter id={`tp${uid}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="luminanceToAlpha" result="la" />
              <feComponentTransfer in="la" result="lin">
                <feFuncA type="linear" slope={1 / (2 * tol)} intercept={-(yc - tol) / (2 * tol)} />
              </feComponentTransfer>
              <feComponentTransfer in="lin" result="disc">
                <feFuncA type="discrete" tableValues="0 1" />
              </feComponentTransfer>
              <feComposite in="disc" in2="SourceGraphic" operator="in" />
            </filter>
          )
        })()}
        {hasFx && (
          <filter id={`fx${uid}`} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
            {hasShadow && sh!.kind === 'inner' && (
              <React.Fragment>
                <feOffset in="SourceAlpha" dx={sh!.dist * Math.cos((sh!.dir * Math.PI) / 180)} dy={sh!.dist * Math.sin((sh!.dir * Math.PI) / 180)} result="off" />
                <feComposite in="off" in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="inv" />
                <feGaussianBlur in="inv" stdDeviation={Math.max(0.1, sh!.blur / 2)} result="blurred" />
                <feFlood floodColor={sh!.color} floodOpacity={sh!.alpha} result="col" />
                <feComposite in="col" in2="blurred" operator="in" result="shadow" />
                <feComposite in="shadow" in2="SourceAlpha" operator="in" result="shadowIn" />
                <feMerge result="base"><feMergeNode in="SourceGraphic" /><feMergeNode in="shadowIn" /></feMerge>
              </React.Fragment>
            )}
            {hasShadow && sh!.kind === 'outer' && (
              <feDropShadow
                dx={sh!.dist * Math.cos((sh!.dir * Math.PI) / 180)}
                dy={sh!.dist * Math.sin((sh!.dir * Math.PI) / 180)}
                stdDeviation={Math.max(0.1, sh!.blur / 2)}
                floodColor={sh!.color}
                floodOpacity={sh!.alpha}
              />
            )}
            {glow && (
              <React.Fragment>
                <feMorphology in="SourceAlpha" operator="dilate" radius={glow.size / 2} result="dilated" />
                <feGaussianBlur in="dilated" stdDeviation={Math.max(0.1, glow.size / 2.5)} result="glowBlur" />
                <feFlood floodColor={glow.color} floodOpacity={glow.alpha} result="col" />
                <feComposite in="col" in2="glowBlur" operator="in" result="glowLayer" />
                <feMerge result="base"><feMergeNode in="glowLayer" /><feMergeNode in="SourceGraphic" /></feMerge>
              </React.Fragment>
            )}
            {bevel && (
              <React.Fragment>
                <feGaussianBlur in="SourceAlpha" stdDeviation={Math.max(0.4, bevel.w / 2)} result="bblur" />
                <feSpecularLighting in="bblur" surfaceScale={Math.max(1, bevel.h / 2)} specularConstant="0.45" specularExponent="10" lightingColor="#ffffff" result="spec">
                  <feDistantLight azimuth="270" elevation="55" />
                </feSpecularLighting>
                <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
                <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="base" />
              </React.Fragment>
            )}
            {soft > 0 && (
              <React.Fragment>
                <feGaussianBlur in="SourceAlpha" stdDeviation={soft / 2} result="softAlpha" />
                <feComposite in="SourceGraphic" in2="softAlpha" operator="in" />
              </React.Fragment>
            )}
          </filter>
        )}
        {reflH > 0 && (
          <linearGradient id={`refl${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1={r.h + reflGap} x2="0" y2={r.h + reflGap + reflH}>
            <stop offset="0" stopColor="#fff" stopOpacity={Math.min(0.9, 0.3 + p.reflection * 0.6)} />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        )}
      </defs>
      <g
        id={`body${uid}`}
        clipPath={`url(#clip${uid})`}
        filter={hasFx ? `url(#fx${uid})` : undefined}
        style={{ pointerEvents: 'auto', cursor: 'move' }}
        onMouseDown={onDown}
        onContextMenu={onCtx}
      >
        <g transform={flip}>
          <image
            href={p.svgSrc || p.src} x={imgX} y={imgY} width={imgW} height={imgH}
            preserveAspectRatio="none"
            style={{
              filter: [cssFilter, needDuo ? `url(#duo${uid})` : '', needTP ? `url(#tp${uid})` : ''].filter(Boolean).join(' ') || undefined,
              opacity: opacity < 1 ? opacity : undefined,
            }}
            onLoad={e => {
              const im = e.currentTarget as unknown as HTMLImageElement
              const nw = im.naturalWidth || p.natW, nh = im.naturalHeight || p.natH
              if (nw && nh && (nw !== p.natW || nh !== p.natH)) onNativeSize(p.id, nw, nh)
            }}
          />
        </g>
      </g>
      {reflH > 0 && (
        <g mask={`url(#refl${uid})`} opacity="0.55" style={{ pointerEvents: 'none' }}>
          <g transform={`translate(0,${2 * r.h + reflGap}) scale(1,-1)`}>
            <use href={`#body${uid}`} />
          </g>
        </g>
      )}
      {p.ln && p.ln.w > 0 && (
        <path
          d={path} fill="none" fillRule={fillRule}
          stroke={p.ln.color} strokeWidth={Math.max(0.5, (p.ln.w * 4) / 3)}
          strokeOpacity={p.ln.alpha < 1 ? p.ln.alpha : undefined}
          strokeDasharray={DASH_MAP[p.ln.dash] || undefined}
          strokeLinejoin="round"
          style={{ pointerEvents: 'auto', cursor: 'move' }}
          onMouseDown={onDown}
          onContextMenu={onCtx}
        />
      )}
    </svg>
  )
}

/** 主层：渲染 + 交互 */
const PictureLayer: React.FC<PictureLayerProps> = ({
  pics, sel, cropId, geom, zoom, onChange, onChangeCharts, charts, onSelect, onActivate, onMenu, onNativeSize, onBeginEdit, onEndCrop,
}) => {
  const layerRef = useRef<HTMLDivElement>(null)
  // 拖拽期间 props 可能变化，用 ref 镜像避免监听器闭包读到旧值
  const picsRef = useRef(pics); picsRef.current = pics
  const chartsRef = useRef(charts); chartsRef.current = charts
  const geomRef = useRef(geom); geomRef.current = geom
  const cropRef = useRef(cropId); cropRef.current = cropId

  const drag = useRef<{
    kind: 'move' | 'resize' | 'rotate' | 'crop' | 'cropPan'
    handle?: PicHandle
    startX: number; startY: number
    startClientX: number; startClientY: number
    startRects: Record<string, PicRect>
    startPics: Record<string, SheetPicture>
    copyLeft: boolean       // Ctrl 拖动复制尚未执行
    pendingToggleOff: string | null // 松开未拖动时从选区移除（Ctrl/Shift+点击已选中项）
    pendingCollapse: string | null  // 多选中无拖动单击 → 收缩为单选该图片（Excel 行为）
    moved: boolean
  } | null>(null)

  // 指针坐标 → 工作表坐标：层的 getBoundingClientRect 给出 A1 原点的视口位置，
  // 缩放比来自滚动容器的 CSS zoom（★不能用 0×0 图片层自身算缩放，会除零出 NaN）
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const toSheet = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = layerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const scale = (zoomRef.current || 100) / 100
    const x = (clientX - rect.left) / scale
    const y = (clientY - rect.top) / scale
    return { x: isFinite(x) ? x : 0, y: isFinite(y) ? y : 0 }
  }, [])

  const selSet = useMemo(() => new Set(sel), [sel])

  /** 统一应用矩形：图片走 setPicRect（清 raw），图表走 setChartRect（置 edited） */
  const applyRects = useCallback((rects: Record<string, PicRect>) => {
    const g = geomRef.current
    onChange(list => list.map(p => rects[p.id] ? setPicRect(touchPic(p, 'pos'), g, rects[p.id]) : p))
    onChangeCharts(list => list.map(c => rects[c.id] ? setChartRect(c, g, rects[c.id]) : c))
  }, [onChange, onChangeCharts])

  // ★ 修复 stale closure：useCallback([]) 会捕获首渲染的 onDragMove/onDragUp，
  // 其闭包里的 onBeginEdit→pushHistory→picSnapshot 读到首渲染的空状态
  //（运行时新建的图表在拖拽撤销时被整体删掉）。经 ref 转发最新处理器。
  const onDragMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const onDragUpRef = useRef<(e: PointerEvent) => void>(() => {})
  const dragListeners = useRef<{ mv: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null)
  const attachDrag = useCallback(() => {
    if (dragListeners.current) return
    const mv = (e: PointerEvent) => onDragMoveRef.current(e)
    const up = (e: PointerEvent) => onDragUpRef.current(e)
    dragListeners.current = { mv, up }
    document.addEventListener('pointermove', mv)
    document.addEventListener('pointerup', up)
  }, [])
  const detachDrag = useCallback(() => {
    const L = dragListeners.current
    if (!L) return
    document.removeEventListener('pointermove', L.mv)
    document.removeEventListener('pointerup', L.up)
    dragListeners.current = null
  }, [])
  useEffect(() => detachDrag, [detachDrag])

  // ---- 拖拽 ----
  const onDragMove = useCallback((ev: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const g = geomRef.current
    const s = toSheet(ev.clientX, ev.clientY)
    let dx = s.x - d.startX, dy = s.y - d.startY
    if (!d.moved) {
      if (Math.abs(ev.clientX - d.startClientX) + Math.abs(ev.clientY - d.startClientY) < 3) return
      d.moved = true
      onBeginEdit()
      // Ctrl+拖动复制：先在原位复制一份，拖动的仍是原对象（Excel 语义）
      if (d.kind === 'move' && d.copyLeft) {
        d.copyLeft = false
        const ids = Object.keys(d.startRects)
        const picCopies = picsRef.current.filter(q => ids.includes(q.id)).map(q => ({ ...q, id: newPicId(), raw: '', name: q.name ? `${q.name} 副本` : q.name }))
        const chartCopies = chartsRef.current.filter(c => ids.includes(c.id)).map(c => ({ ...c, id: newChartId(), name: c.name ? `${c.name} 副本` : c.name, edited: true, anchorRaw: '', chartRaw: '' }))
        if (picCopies.length) onChange(list => [...list, ...picCopies])
        if (chartCopies.length) onChangeCharts(list => [...list, ...chartCopies])
      }
    }

    if (d.kind === 'move') {
      if (ev.altKey) {
        const first = Object.values(d.startRects)[0]
        if (first) {
          dx = snapTo(first.x + dx, i => g.colLeft(Math.max(0, i))) - first.x
          dy = snapTo(first.y + dy, i => g.rowTop(Math.max(0, i))) - first.y
        }
      }
      const fx = dx, fy = dy
      const rects: Record<string, PicRect> = {}
      for (const id of Object.keys(d.startRects)) {
        const r0 = d.startRects[id]
        rects[id] = { x: r0.x + fx, y: r0.y + fy, w: r0.w, h: r0.h }
      }
      applyRects(rects)
      return
    }

    if (d.kind === 'resize' && d.handle) {
      const ids = Object.keys(d.startRects)
      if (ids.length === 1) {
        const id = ids[0]
        const q = picsRef.current.find(x => x.id === id)
        const c = q ? null : chartsRef.current.find(x => x.id === id)
        const r0 = d.startRects[id]
        if ((!q && !c) || !r0) return
        // 图表不锁纵横比（Excel 图表自由缩放）；图片按锁定/Shift 规则
        let keepRatio: number | null = null
        if (q) {
          const corner = d.handle.length === 2
          if (corner && ev.shiftKey && q.natW && q.natH) keepRatio = q.natW / q.natH
          else if (q.lockAspect) keepRatio = r0.w / r0.h
        }
        const nr = resizeRect(r0, d.handle, dx, dy, q ? q.rot : 0, { keepRatio, fromCenter: ev.ctrlKey || ev.metaKey })
        applyRects({ [id]: nr })
      } else {
        const objs: { id: string; lockAspect?: boolean }[] = [
          ...picsRef.current.filter(x => d.startRects[x.id]),
          ...chartsRef.current.filter(x => d.startRects[x.id]),
        ]
        const bb0 = bboxOf(objs.map(x => d.startRects[x.id]))
        if (!bb0) return
        const keepRatio = objs.some(x => x.lockAspect) ? bb0.w / bb0.h : null
        const nb = resizeRect(bb0, d.handle, dx, dy, 0, { keepRatio, fromCenter: ev.ctrlKey || ev.metaKey })
        const sx = bb0.w ? nb.w / bb0.w : 1, sy = bb0.h ? nb.h / bb0.h : 1
        const rects: Record<string, PicRect> = {}
        for (const x of objs) {
          const r0 = d.startRects[x.id]
          rects[x.id] = {
            x: nb.x + (r0.x - bb0.x) * sx, y: nb.y + (r0.y - bb0.y) * sy,
            w: Math.max(1, r0.w * sx), h: Math.max(1, r0.h * sy),
          }
        }
        applyRects(rects)
      }
      return
    }

    if (d.kind === 'rotate') {
      const id = Object.keys(d.startRects)[0]
      const q = cur().find(x => x.id === id)
      if (!q) return
      const r0 = d.startRects[id]
      let rot = rotationFromPointer(r0.x + r0.w / 2, r0.y + r0.h / 2, s.x, s.y)
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15
      const nr = Math.round(rot * 10) / 10
      onChange(list => list.map(x => x.id === id ? { ...touchPic(x, 'pos'), rot: nr } : x), 'pos')
      return
    }

    if (d.kind === 'crop' && d.handle) {
      const p0 = d.startPics[Object.keys(d.startPics)[0]]
      if (!p0) return
      const r0 = d.startRects[p0.id]
      const W = r0.w / cropWindow(p0.crop).w, H = r0.h / cropWindow(p0.crop).h
      let c = { ...p0.crop }
      let rect = { ...r0 }
      const h = d.handle
      const sym = ev.shiftKey
      if (h.includes('e')) {
        const dd = sym ? dx / 2 : dx
        c = { ...c, r: c.r - dd / W }
        rect = sym ? { ...rect, x: r0.x - dd, w: r0.w + dx } : { ...rect, w: Math.max(8, r0.w + dx) }
      }
      if (h.includes('s')) {
        const dd = sym ? dy / 2 : dy
        c = { ...c, b: c.b - dd / H }
        rect = sym ? { ...rect, y: r0.y - dd, h: r0.h + dy } : { ...rect, h: Math.max(8, r0.h + dy) }
      }
      if (h.includes('w')) {
        const dd = sym ? dx / 2 : dx
        c = { ...c, l: c.l + dd / W }
        rect = sym ? { ...rect, x: r0.x + dd, w: r0.w - dx } : { ...rect, x: r0.x + dx, w: Math.max(8, r0.w - dx) }
      }
      if (h.includes('n')) {
        const dd = sym ? dy / 2 : dy
        c = { ...c, t: c.t + dd / H }
        rect = sym ? { ...rect, y: r0.y + dd, h: r0.h - dy } : { ...rect, y: r0.y + dy, h: Math.max(8, r0.h - dy) }
      }
      const cc = c, rr = rect
      onChange(list => list.map(x => x.id === p0.id
        ? { ...setPicRect(touchPic(x, 'crop'), g, rr), crop: { l: round4(cc.l), t: round4(cc.t), r: round4(cc.r), b: round4(cc.b) } }
        : x), 'crop')
      return
    }

    if (d.kind === 'cropPan') {
      const p0 = d.startPics[Object.keys(d.startPics)[0]]
      if (!p0) return
      const r0 = d.startRects[p0.id]
      const W = r0.w / cropWindow(p0.crop).w, H = r0.h / cropWindow(p0.crop).h
      // 画面跟随指针：图像平面右移 = 可视窗口左移
      const nl = p0.crop.l - dx / W
      const nt = p0.crop.t - dy / H
      const nr2 = p0.crop.r + dx / W
      const nb2 = p0.crop.b + dy / H
      onChange(list => list.map(x => x.id === p0.id
        ? { ...touchPic(x, 'crop'), crop: { l: round4(nl), t: round4(nt), r: round4(nr2), b: round4(nb2) } }
        : x), 'crop')
    }
  }, [onChange, onBeginEdit, toSheet])

  const onDragUp = useCallback(() => {
    const d = drag.current
    if (d && !d.moved) {
      if (d.pendingToggleOff) onSelect(selRef.current.filter(x => x !== d.pendingToggleOff))
      else if (d.pendingCollapse) onSelect([d.pendingCollapse], d.pendingCollapse)
    }
    drag.current = null
    detachDrag()
  }, [detachDrag, onSelect])
  onDragMoveRef.current = onDragMove
  onDragUpRef.current = onDragUp

  // sel 的 ref（pointerup 里用）
  const selRef = useRef(sel); selRef.current = sel
  const cur = useCallback(() => picsRef.current, [])

  // ---- 按下处理 ----
  const beginDrag = (e: React.MouseEvent, p: SheetPicture, kind: 'move' | 'crop' | 'cropPan', additiveCtx = false, handle?: PicHandle) => {
    const s = toSheet(e.clientX, e.clientY)
    const list = kind === 'move' ? picsRef.current.filter(q => selSet.has(q.id) || q.id === p.id) : [p]
    const startRects: Record<string, PicRect> = {}
    const startPics: Record<string, SheetPicture> = {}
    for (const q of list) {
      startRects[q.id] = picRect(q, geomRef.current)
      startPics[q.id] = q
    }
    drag.current = {
      kind, handle, startX: s.x, startY: s.y, startClientX: e.clientX, startClientY: e.clientY,
      startRects, startPics,
      copyLeft: kind === 'move' && (e.ctrlKey || e.metaKey),
      pendingToggleOff: null,
      // 多选中普通单击已选成员：保持多选以便拖动整组；未拖动松开时收缩为单选
      pendingCollapse: kind === 'move' && !additiveCtx && selRef.current.length > 1 ? p.id : null,
      moved: false,
    }
    attachDrag()
  }

  const onPicMouseDown = (e: React.MouseEvent, p: SheetPicture) => {
    if (e.button === 2) {
      if (!selSet.has(p.id)) onSelect([p.id], p.id)
      return
    }
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onActivate()

    if (cropRef.current === p.id) {
      beginDrag(e, p, 'cropPan')
      return
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (additive) {
      if (selSet.has(p.id)) {
        // 挂起的“取消选择”：未拖动时生效；拖动则照常移动（Ctrl+拖动仍是复制）
        beginDrag(e, p, 'move', true)
        drag.current!.pendingToggleOff = p.id
        drag.current!.copyLeft = e.ctrlKey || e.metaKey
        drag.current!.pendingCollapse = null
        return
      }
      onSelect([...selRef.current, p.id], p.id)
    } else if (!selSet.has(p.id)) {
      onSelect([p.id], p.id)
    }
    beginDrag(e, p, 'move', false)
  }

  /** 图表按下：与图片同一套选择/拖动状态机（无裁剪/旋转） */
  const onChartMouseDown = (e: React.MouseEvent, c: ChartSpec) => {
    if (e.button === 2) {
      if (!selSet.has(c.id)) onSelect([c.id], c.id)
      return
    }
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onActivate()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (additive) {
      if (selSet.has(c.id)) {
        beginChartDrag(e, c, 'move', true)
        drag.current!.pendingToggleOff = c.id
        drag.current!.copyLeft = e.ctrlKey || e.metaKey
        drag.current!.pendingCollapse = null
        return
      }
      onSelect([...selRef.current, c.id], c.id)
    } else if (!selSet.has(c.id)) {
      onSelect([c.id], c.id)
    }
    beginChartDrag(e, c, 'move', false)
  }

  const beginChartDrag = (e: React.MouseEvent, c: ChartSpec, kind: 'move', additiveCtx = false) => {
    const s = toSheet(e.clientX, e.clientY)
    const list = kind === 'move'
      ? [...chartsRef.current.filter(q => selSet.has(q.id) || q.id === c.id)]
      : [c]
    const startRects: Record<string, PicRect> = {}
    const startPics: Record<string, SheetPicture> = {}
    for (const q of list) {
      startRects[q.id] = chartRect(q, geomRef.current)
      startPics[q.id] = q as unknown as SheetPicture
    }
    drag.current = {
      kind, startX: s.x, startY: s.y, startClientX: e.clientX, startClientY: e.clientY,
      startRects, startPics,
      copyLeft: kind === 'move' && (e.ctrlKey || e.metaKey),
      pendingToggleOff: null,
      pendingCollapse: kind === 'move' && !additiveCtx && selRef.current.length > 1 ? c.id : null,
      moved: false,
    }
    attachDrag()
  }

  const onHandleMouseDown = (e: React.MouseEvent, p: { id: string }, handle: PicHandle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onActivate()
    // 多选时拖任意成员的柄 = 缩放整组（图片 + 图表一起）
    const list: { id: string }[] = selSet.has(p.id) && selRef.current.length > 1
      ? [...picsRef.current.filter(q => selSet.has(q.id)), ...chartsRef.current.filter(q => selSet.has(q.id))]
      : [...picsRef.current.filter(q => q.id === p.id), ...chartsRef.current.filter(q => q.id === p.id)]
    const startRects: Record<string, PicRect> = {}
    const startPics: Record<string, SheetPicture> = {}
    for (const q of list) {
      const isChart = chartsRef.current.some(c => c.id === q.id)
      startRects[q.id] = isChart ? chartRect(q as unknown as ChartSpec, geomRef.current) : picRect(q as SheetPicture, geomRef.current)
      startPics[q.id] = q as unknown as SheetPicture
    }
    drag.current = {
      kind: 'resize', handle, startX: toSheet(e.clientX, e.clientY).x, startY: toSheet(e.clientX, e.clientY).y,
      startClientX: e.clientX, startClientY: e.clientY,
      startRects, startPics, copyLeft: false, pendingToggleOff: null, pendingCollapse: null, moved: false,
    }
    attachDrag()
  }

  const onRotateMouseDown = (e: React.MouseEvent, p: SheetPicture) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onActivate()
    const s = toSheet(e.clientX, e.clientY)
    drag.current = {
      kind: 'rotate', startX: s.x, startY: s.y, startClientX: e.clientX, startClientY: e.clientY,
      startRects: { [p.id]: picRect(p, geomRef.current) }, startPics: { [p.id]: p },
      copyLeft: false, pendingToggleOff: null, pendingCollapse: null, moved: false,
    }
    attachDrag()
  }

  const onCropHandleMouseDown = (e: React.MouseEvent, p: SheetPicture, handle: PicHandle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onActivate()
    const s = toSheet(e.clientX, e.clientY)
    drag.current = {
      kind: 'crop', handle, startX: s.x, startY: s.y, startClientX: e.clientX, startClientY: e.clientY,
      startRects: { [p.id]: picRect(p, geomRef.current) }, startPics: { [p.id]: p },
      copyLeft: false, pendingToggleOff: null, pendingCollapse: null, moved: false,
    }
    attachDrag()
  }

  const onCtx = (e: React.MouseEvent, p: SheetPicture) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selSet.has(p.id)) onSelect([p.id], p.id)
    onMenu(e.clientX, e.clientY, p.id)
  }

  const onChartCtx = (e: React.MouseEvent, c: ChartSpec) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selSet.has(c.id)) onSelect([c.id], c.id)
    onMenu(e.clientX, e.clientY, c.id)
  }

  return (
    <div
      ref={layerRef}
      data-testid="pic-layer"
      style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible' }}
    >
      {pics.map(p => {
        if (p.hidden) return null
        const r = picRect(p, geom)
        if (!p.src && !p.svgSrc) {
          // EMF/WMF 等无法预览：占位框（保持位置与尺寸，随文件原样保存）
          return (
            <div key={p.id} data-pic-id={p.id} data-testid="pic-placeholder"
              style={{
                position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                transform: p.rot ? `rotate(${p.rot}deg)` : undefined,
                border: '1px dashed #b9b9b9', background: 'repeating-linear-gradient(45deg,#f3f4f6 0 8px,#e5e7eb 8px 16px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 12, cursor: 'move',
              }}
              onMouseDown={e => onPicMouseDown(e, p)}
              onContextMenu={e => onCtx(e, p)}
              title={`${p.name || '图片'}（${p.ext.toUpperCase()} 格式无法预览，将随文件保存）`}
            >
              {p.ext.toUpperCase()}
            </div>
          )
        }
        return (
          <PicSvg key={p.id} p={p} r={r} onNativeSize={onNativeSize}
            onDown={e => onPicMouseDown(e, p)} onCtx={e => onCtx(e, p)} />
        )
      })}

      {/* round61：浮动图表（渲染在图片之上；与图片同一选择/拖拽状态机） */}
      {charts.map(c => {
        const r = chartRect(c, geom)
        return (
          <div key={c.id} data-chart-id={c.id}
            style={{ position: 'absolute', left: r.x, top: r.y, width: Math.max(60, r.w), height: Math.max(50, r.h), cursor: 'move' }}
            onMouseDown={e => onChartMouseDown(e, c)}
            onContextMenu={e => onChartCtx(e, c)}>
            <ChartRenderer spec={c} w={Math.max(60, r.w)} h={Math.max(50, r.h)} />
          </div>
        )
      })}

      {/* 选择框与手柄（渲染在图片之上） */}
      {pics.map(p => {
        if (!selSet.has(p.id) || p.hidden) return null
        const r = picRect(p, geom)
        const isCrop = cropId === p.id
        return (
          <div key={`f${p.id}`} data-testid={`pic-frame-${p.id}`}
            style={{
              position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
              transform: p.rot ? `rotate(${p.rot}deg)` : undefined, pointerEvents: 'none',
            }}>
            {!isCrop && <div style={{ position: 'absolute', inset: 0, border: '1px solid var(--color-primary,#2563eb)' }} />}
            {isCrop ? (
              HANDLES.map(h => {
                const [hx, hy] = HANDLE_POS[h]
                const corner = h.length === 2
                return (
                  <div key={h} data-crop-handle={h}
                    style={{
                      position: 'absolute', left: `calc(${hx * 100}% - ${corner ? 7 : 5}px)`, top: `calc(${hy * 100}% - ${corner ? 7 : 5}px)`,
                      width: corner ? 14 : 11, height: corner ? 14 : 11, pointerEvents: 'auto', cursor: CURSOR[h],
                    }}
                    onMouseDown={e => onCropHandleMouseDown(e, p, h)}
                  >
                    {corner ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', inset: 0, display: 'block' }}>
                        <path d={
                          h === 'nw' ? 'M13,1 L13,5 M13,1 L9,1' : h === 'ne' ? 'M1,1 L5,1 M1,1 L1,5' :
                            h === 'se' ? 'M1,13 L1,9 M1,13 L5,13' : 'M13,13 L9,13 M13,13 L13,9'
                        } stroke="#111" strokeWidth="2.5" fill="none" />
                      </svg>
                    ) : (
                      <div style={{
                        position: 'absolute', background: '#111',
                        ...(h === 'n' || h === 's'
                          ? { left: 0, right: 0, top: h === 'n' ? 0 : 'auto', bottom: h === 's' ? 0 : 'auto', height: 3 }
                          : { top: 0, bottom: 0, left: h === 'w' ? 0 : 'auto', right: h === 'e' ? 0 : 'auto', width: 3 }),
                      }} />
                    )}
                  </div>
                )
              })
            ) : (
              <React.Fragment>
                {HANDLES.map(h => {
                  const [hx, hy] = HANDLE_POS[h]
                  return (
                    <div key={h} data-handle={h}
                      style={{
                        position: 'absolute', left: `calc(${hx * 100}% - 4px)`, top: `calc(${hy * 100}% - 4px)`,
                        width: 8, height: 8, background: '#fff', border: '1px solid #8ea9db',
                        pointerEvents: 'auto', cursor: CURSOR[h], boxShadow: '0 0 1px rgba(0,0,0,.35)',
                      }}
                      onMouseDown={e => onHandleMouseDown(e, p, h)}
                    />
                  )
                })}
                <div style={{ position: 'absolute', left: '50%', top: -18, width: 1, height: 14, background: '#8ea9db' }} />
                <div data-handle="rot"
                  style={{ position: 'absolute', left: '50%', top: -26, width: 16, height: 16, marginLeft: -8,
                    pointerEvents: 'auto', cursor: 'grab', color: '#8ea9db' }}
                  onMouseDown={e => onRotateMouseDown(e, p)}
                  title="拖动旋转（Shift = 15° 步进）"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
                    <path d="M8,2 A6,6 0 1 1 2.8,5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M1,1.6 L3.4,6 L6.2,3 Z" fill="currentColor" />
                  </svg>
                </div>
              </React.Fragment>
            )}
            {selRef.current.length > 1 && (
              <div style={{
                position: 'absolute', left: 0, top: -20, background: 'var(--color-primary,#2563eb)', color: '#fff',
                fontSize: 10, padding: '0 4px', borderRadius: 2, whiteSpace: 'nowrap',
              }}>
                {p.name || '图片'}
              </div>
            )}
          </div>
        )
      })}

      {/* round61：图表选择框（8 尺寸柄，图表无旋转柄） */}
      {charts.map(c => {
        if (!selSet.has(c.id)) return null
        const r = chartRect(c, geom)
        return (
          <div key={`fc${c.id}`} data-testid={`pic-frame-${c.id}`}
            style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, border: '1px solid var(--color-primary,#2563eb)' }} />
            {HANDLES.map(h => {
              const [hx, hy] = HANDLE_POS[h]
              return (
                <div key={h} data-handle={h}
                  style={{
                    position: 'absolute', left: `calc(${hx * 100}% - 4px)`, top: `calc(${hy * 100}% - 4px)`,
                    width: 8, height: 8, background: '#fff', border: '1px solid #8ea9db',
                    pointerEvents: 'auto', cursor: CURSOR[h], boxShadow: '0 0 1px rgba(0,0,0,.35)',
                  }}
                  onMouseDown={e => onHandleMouseDown(e, c, h)}
                />
              )
            })}
            {selRef.current.length > 1 && (
              <div style={{
                position: 'absolute', left: 0, top: -20, background: 'var(--color-primary,#2563eb)', color: '#fff',
                fontSize: 10, padding: '0 4px', borderRadius: 2, whiteSpace: 'nowrap',
              }}>
                {c.name || '图表'}
              </div>
            )}
          </div>
        )
      })}

      {cropId && (
        <div data-testid="crop-banner" style={{
          position: 'fixed', bottom: 64, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(17,24,39,.9)', color: '#fff', padding: '4px 12px', borderRadius: 4, fontSize: 12, zIndex: 60,
        }}>
          裁剪模式：拖动黑色手柄调整显示区域，拖动图片平移画面 ·{' '}
          <button style={{ color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={onEndCrop}>完成</button>
        </div>
      )}
    </div>
  )
}

function bboxOf(rects: PicRect[]): PicRect | null {
  if (!rects.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 吸附到最近的网格线（距离 < 12px 才吸附） */
function snapTo(v: number, line: (i: number) => number): number {
  let best = v, bd = Infinity
  for (let i = 0; i < 400; i++) {
    const g = line(i)
    const d = Math.abs(g - v)
    if (d < bd) { bd = d; best = g }
    if (g > v + 60) break
  }
  return bd < 12 ? best : v
}

export default PictureLayer
