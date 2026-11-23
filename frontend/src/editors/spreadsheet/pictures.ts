/**
 * pictures.ts —— round60：浮动图片数据模型（对齐 MS Excel「设置图片格式」）。
 *
 * 坐标系：工作表坐标（原点 = A1 左上角，不含行/列标头）。锚点为两单元格标记
 * （0 基列/行号 + 单元格内偏移 px），对象定位方式对应 DrawingML editAs：
 *   moveSize = twoCell   随单元格改变位置和大小（Excel 默认）
 *   move     = oneCell   只移动不调整大小
 *   fixed    = absolute  固定位置和大小
 * 与后端 internal/parser/xlsx/pictures.go 的 imageJSON 字段一一对应；
 * 未建模的原始 XML 片段（rawGeom/rawLn/rawFx/rawBlipFill/...）透传，
 * 用户没动过的图片保存时原样写回（保真）。
 */

// ---- 类型 ----

export type PicAnchorMode = 'moveSize' | 'move' | 'fixed'

/** 单元格锚点：0 基列/行号 + 单元格内偏移（px） */
export interface PicPoint { col: number; row: number; dx: number; dy: number }

export interface PicRect { x: number; y: number; w: number; h: number }

/** 裁剪：相对原图尺寸的比例（0~1） */
export interface PicCrop { l: number; t: number; r: number; b: number }

/** 颜色校正（-1~1 偏移；transparency 0~1；duotone [暗, 亮]） */
export interface PicColor {
  brightness: number; contrast: number; saturation: number
  transparency: number; grayscale: boolean
  duotone: [string, string] | null; transparent: string
}

/** 边框：W 为磅（pt） */
export interface PicLine { color: string; w: number; dash: string; alpha: number }

/** 阴影：blur/dist 为 px，dir 为角度（顺时针，0 = 向右） */
export interface PicShadow { kind: 'outer' | 'inner'; blur: number; dist: number; dir: number; color: string; alpha: number }

export interface PicGlow { size: number; color: string; alpha: number }

export interface PicBevel { preset: string; w: number; h: number }

/** 运行时图片对象（src 为 dataURL；emf/wmf 等无法预览的格式 src 为空，显示占位框） */
export interface SheetPicture {
  id: string
  name: string
  alt: string
  src: string
  base64: string
  ext: string
  /** SVG 矢量源（Excel svgBlip / 内置图标库），可无损缩放显示 */
  svgSrc?: string
  natW: number; natH: number
  from: PicPoint
  to: PicPoint
  mode: PicAnchorMode
  /** move/fixed 模式的显示尺寸；fixed 的绝对位置 */
  size: { w: number; h: number }
  abs: { x: number; y: number }
  rot: number
  flipH: boolean; flipV: boolean
  crop: PicCrop
  geom: string
  lockAspect: boolean
  hidden: boolean
  locked: boolean
  print: boolean
  color: PicColor | null
  ln: PicLine | null
  shadow: PicShadow | null
  glow: PicGlow | null
  softEdge: number
  reflection: number
  bevel: PicBevel | null
  cam: string
  camLat: number; camLon: number; camRev: number
  // 透传（未编辑时保存原样写回）
  raw: string
  rawGeom: string; geomEdited: boolean
  rawFill: string
  rawLn: string; lnEdited: boolean
  rawFx: string; rawScene: string; rawSpExt: string; rawPicExt: string; fxEdited: boolean
  rawBlipFill: string; srcRel: string; cropEdited: boolean; colorEdited: boolean
  svgB64: string; svgRel: string
  stylePreset: string
}

/** 快照 JSON（与 Go imageJSON 对应；row/col/width/height 为兼容字段） */
export interface SheetPictureJSON {
  row: number; col: number; base64: string; ext: string; width: number; height: number
  from?: PicPoint; to?: PicPoint
  mode?: PicAnchorMode
  size?: { w: number; h: number }
  abs?: { x: number; y: number }
  rot?: number; flipH?: boolean; flipV?: boolean
  crop?: PicCrop
  geom?: string
  name?: string; alt?: string
  lockAspect?: boolean; hidden?: boolean; locked?: boolean; print?: boolean
  color?: PicColor
  ln?: PicLine | null
  shadow?: PicShadow | null
  glow?: PicGlow | null
  softEdge?: number; reflection?: number
  bevel?: PicBevel | null
  stylePreset?: string
  cam?: string; camLat?: number; camLon?: number; camRev?: number
  lightRig?: string; lightDir?: string
  geomEdited?: boolean; lnEdited?: boolean; fxEdited?: boolean; cropEdited?: boolean; colorEdited?: boolean
  raw?: string
  rawGeom?: string; rawFill?: string; rawLn?: string
  rawFx?: string; rawScene?: string; rawSpExt?: string; rawPicExt?: string; rawBlipFill?: string
  srcRel?: string
  svgB64?: string; svgRel?: string
}

// ---- 几何 ----

/** 工作表几何接口（由编辑器提供；colLeft/rowTop 不含标头偏移） */
export interface PicGeometry {
  colLeft(c: number): number
  rowTop(r: number): number
  colW(c: number): number
  rowH(r: number): number
}

export function picPointXY(m: PicPoint, g: PicGeometry): { x: number; y: number } {
  return { x: g.colLeft(m.col) + m.dx, y: g.rowTop(m.row) + m.dy }
}

/** 图片的工作表坐标矩形（未旋转外接框） */
export function picRect(p: SheetPicture, g: PicGeometry): PicRect {
  if (p.mode === 'fixed') {
    return { x: p.abs.x, y: p.abs.y, w: p.size.w, h: p.size.h }
  }
  const a = picPointXY(p.from, g)
  if (p.mode === 'move') {
    return { x: a.x, y: a.y, w: p.size.w, h: p.size.h }
  }
  const b = picPointXY(p.to, g)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/** 坐标 → 单元格锚点 */
export function anchorAt(x: number, y: number, g: PicGeometry): PicPoint {
  let c = 0, dx = x
  while (dx >= g.colW(c) && c < 20000) { dx -= g.colW(c); c++ }
  let r = 0, dy = y
  while (dy >= g.rowH(r) && r < 200000) { dy -= g.rowH(r); r++ }
  return { col: c, row: r, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 }
}

/**
 * 把矩形写回图片锚点（移动/缩放后调用）。
 * moveSize：更新 from/to；move：更新 from 与 size；fixed：更新 abs 与 size。
 * to 始终保持同步（fixed 保存时也要有有效标记）。
 */
export function setPicRect(p: SheetPicture, g: PicGeometry, rect: PicRect): SheetPicture {
  const r: PicRect = { ...rect, w: Math.max(1, rect.w), h: Math.max(1, rect.h) }
  if (p.mode === 'fixed') {
    return { ...p, abs: { x: r.x, y: r.y }, size: { w: r.w, h: r.h }, from: anchorAt(r.x, r.y, g), to: anchorAt(r.x + r.w, r.y + r.h, g) }
  }
  if (p.mode === 'move') {
    return { ...p, from: anchorAt(r.x, r.y, g), size: { w: r.w, h: r.h }, to: anchorAt(r.x + r.w, r.y + r.h, g) }
  }
  return { ...p, from: anchorAt(r.x, r.y, g), to: anchorAt(r.x + r.w, r.y + r.h, g), size: { w: r.w, h: r.h } }
}

// ---- 默认值 / JSON 转换 ----

export const defaultColor = (): PicColor => ({
  brightness: 0, contrast: 0, saturation: 0, transparency: 0, grayscale: false, duotone: null, transparent: '',
})

let picSeq = 0
export function newPicId(): string {
  picSeq += 1
  return `p${Date.now().toString(36)}${picSeq}`
}

export function defaultPicture(src: string, base64: string, ext: string, natW: number, natH: number): SheetPicture {
  return {
    id: newPicId(), name: '', alt: '',
    src, base64, ext,
    natW: Math.max(1, natW), natH: Math.max(1, natH),
    from: { col: 0, row: 0, dx: 0, dy: 0 }, to: { col: 1, row: 1, dx: 0, dy: 0 },
    mode: 'moveSize',
    size: { w: natW, h: natH }, abs: { x: 0, y: 0 },
    rot: 0, flipH: false, flipV: false,
    crop: { l: 0, t: 0, r: 0, b: 0 },
    geom: 'rect',
    lockAspect: true, hidden: false, locked: true, print: true,
    color: null, ln: null, shadow: null, glow: null, softEdge: 0, reflection: 0, bevel: null,
    cam: '', camLat: 0, camLon: 0, camRev: 0,
    raw: '',
    rawGeom: '', geomEdited: false, rawFill: '',
    rawLn: '', lnEdited: false,
    rawFx: '', rawScene: '', rawSpExt: '', rawPicExt: '', fxEdited: false,
    rawBlipFill: '', srcRel: '', cropEdited: false, colorEdited: false,
    svgB64: '', svgRel: '', stylePreset: '',
  }
}

export function picFromJSON(j: SheetPictureJSON): SheetPicture {
  const src = j.ext === 'emf' || j.ext === 'wmf' || j.ext === 'emz' || j.ext === 'wmz' ? '' : `data:image/${j.ext === 'svg' ? 'svg+xml' : j.ext};base64,${j.base64}`
  const p = defaultPicture(src, j.base64, j.ext || 'png', j.width || 100, j.height || 75)
  p.name = j.name || ''
  p.alt = j.alt || ''
  // 旧快照（round59 及更早）：只有锚定单元格 + 显示尺寸 → 转为 move 模式保持原有视觉位置
  if (!j.from && !j.to) {
    p.from = { col: j.col || 0, row: j.row || 0, dx: 2, dy: 2 }
    p.mode = 'move'
    p.size = { w: j.width || 100, h: j.height || 75 }
    p.to = p.from
  }
  if (j.from) p.from = j.from
  if (j.to) p.to = j.to
  p.mode = j.mode || p.mode
  if (j.size) p.size = j.size
  if (j.abs) p.abs = j.abs
  else p.abs = { x: (p.from.col ? 64 * p.from.col : 0) + p.from.dx, y: (p.from.row ? 20 * p.from.row : 0) + p.from.dy }
  p.rot = j.rot || 0
  p.flipH = !!j.flipH
  p.flipV = !!j.flipV
  if (j.crop) p.crop = j.crop
  p.geom = j.geom || 'rect'
  p.lockAspect = j.lockAspect !== false
  p.hidden = !!j.hidden
  p.locked = j.locked !== false
  p.print = j.print !== false
  if (j.color) p.color = { ...defaultColor(), ...j.color }
  if (j.ln) p.ln = { ...j.ln, alpha: j.ln.alpha ?? 1 }
  if (j.shadow) p.shadow = j.shadow
  if (j.glow) p.glow = j.glow
  p.softEdge = j.softEdge || 0
  p.reflection = j.reflection || 0
  if (j.bevel) p.bevel = j.bevel
  p.cam = j.cam || ''
  p.camLat = j.camLat || 0; p.camLon = j.camLon || 0; p.camRev = j.camRev || 0
  p.raw = j.raw || ''
  p.rawGeom = j.rawGeom || ''; p.geomEdited = !!j.geomEdited
  p.rawFill = j.rawFill || ''
  p.rawLn = j.rawLn || ''; p.lnEdited = !!j.lnEdited
  p.rawFx = j.rawFx || ''; p.rawScene = j.rawScene || ''; p.rawSpExt = j.rawSpExt || ''
  p.rawPicExt = j.rawPicExt || ''; p.fxEdited = !!j.fxEdited
  p.rawBlipFill = j.rawBlipFill || ''; p.srcRel = j.srcRel || ''
  p.cropEdited = !!j.cropEdited; p.colorEdited = !!j.colorEdited
  p.svgB64 = j.svgB64 || ''; p.svgRel = j.svgRel || ''
  if (j.svgB64) p.svgSrc = `data:image/svg+xml;base64,${j.svgB64}`
  p.stylePreset = j.stylePreset || ''
  return p
}

export function picToJSON(p: SheetPicture): SheetPictureJSON {
  const j: SheetPictureJSON = {
    row: p.from.row, col: p.from.col,
    base64: p.base64, ext: p.ext,
    width: Math.round(p.size.w), height: Math.round(p.size.h),
    from: p.from, to: p.to, mode: p.mode,
    size: p.size,
    rot: p.rot, flipH: p.flipH, flipV: p.flipV,
    crop: p.crop, geom: p.geom,
    name: p.name, alt: p.alt,
    lockAspect: p.lockAspect, hidden: p.hidden, locked: p.locked, print: p.print,
    softEdge: p.softEdge, reflection: p.reflection,
    stylePreset: p.stylePreset || undefined,
    geomEdited: p.geomEdited || undefined,
    lnEdited: p.lnEdited || undefined,
    fxEdited: p.fxEdited || undefined,
    cropEdited: p.cropEdited || undefined,
    colorEdited: p.colorEdited || undefined,
  }
  if (p.mode === 'fixed') j.abs = p.abs
  if (p.color) j.color = p.color
  if (p.ln) j.ln = p.ln
  if (p.shadow) j.shadow = p.shadow
  if (p.glow) j.glow = p.glow
  if (p.bevel) j.bevel = p.bevel
  if (p.cam) { j.cam = p.cam; if (p.camLat) j.camLat = p.camLat; if (p.camLon) j.camLon = p.camLon; if (p.camRev) j.camRev = p.camRev }
  if (p.raw) j.raw = p.raw
  if (p.rawGeom) j.rawGeom = p.rawGeom
  if (p.rawFill) j.rawFill = p.rawFill
  if (p.rawLn) j.rawLn = p.rawLn
  if (p.rawFx) j.rawFx = p.rawFx
  if (p.rawScene) j.rawScene = p.rawScene
  if (p.rawSpExt) j.rawSpExt = p.rawSpExt
  if (p.rawPicExt) j.rawPicExt = p.rawPicExt
  if (p.rawBlipFill) j.rawBlipFill = p.rawBlipFill
  if (p.srcRel) j.srcRel = p.srcRel
  if (p.svgB64) { j.svgB64 = p.svgB64; if (p.svgRel) j.svgRel = p.svgRel }
  return j
}

/** 用户改动标记：pos=位置尺寸（丢弃 raw 整段锚点），其余按属性清除对应透传片段。
 * meta（名称/旋转/翻转等）也丢弃 raw —— 原始锚点 XML 里带着旧的 xfrm 属性。 */
export type PicPart = 'pos' | 'geom' | 'ln' | 'fx' | 'crop' | 'color' | 'meta' | 'style'
export function touchPic(p: SheetPicture, part: PicPart): SheetPicture {
  const q: SheetPicture = { ...p }
  if (part === 'pos') {
    q.raw = ''
  } else if (part === 'geom') {
    q.geomEdited = true
    q.raw = ''
  } else if (part === 'ln') {
    q.lnEdited = true
    q.raw = ''
  } else if (part === 'fx') {
    q.fxEdited = true
    q.raw = ''
    q.rawPicExt = ''
    q.rawFx = ''
    q.rawScene = ''
    q.stylePreset = ''
  } else if (part === 'crop') {
    q.cropEdited = true
    q.raw = ''
  } else if (part === 'color') {
    q.colorEdited = true
    q.raw = ''
    q.rawPicExt = ''
    q.rawBlipFill = ''
    q.stylePreset = ''
  } else if (part === 'meta') {
    q.raw = ''
  } else if (part === 'style') {
    // 图片样式预设：可能同时改几何/边框/效果/颜色/裁剪 —— 全部标记为已编辑，
    // 保存时用模型重建（否则原始 XML 透传会把新样式盖掉）
    q.geomEdited = true
    q.lnEdited = true
    q.fxEdited = true
    q.colorEdited = true
    q.cropEdited = true
    q.raw = ''
    q.rawFx = ''
    q.rawScene = ''
    q.rawPicExt = ''
    q.rawBlipFill = ''
  }
  return q
}

// ---- 形状库（prstGeom 预设 → SVG 路径，坐标 0..w / 0..h）----

type PathGen = (w: number, h: number) => string

const f = (v: number) => Math.round(v * 100) / 100

function regularPoly(w: number, h: number, n: number, rotDeg = -90): string {
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + i * 360 / n) * Math.PI) / 180
    d += `${i ? 'L' : 'M'}${f(cx + rx * Math.cos(a))},${f(cy + ry * Math.sin(a))}`
  }
  return d + 'Z'
}

function starPoly(w: number, h: number, n: number, inner: number): string {
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2
  let d = ''
  for (let i = 0; i < n * 2; i++) {
    const a = ((-90 + i * 180 / n) * Math.PI) / 180
    const rr = i % 2 === 0 ? 1 : inner
    d += `${i ? 'L' : 'M'}${f(cx + rx * rr * Math.cos(a))},${f(cy + ry * rr * Math.sin(a))}`
  }
  return d + 'Z'
}

const shapeDefs: Record<string, PathGen> = {
  rect: (w, h) => `M0,0H${f(w)}V${f(h)}H0Z`,
  roundRect: (w, h) => {
    const r = Math.min(w, h) * 0.16667
    return `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`
  },
  snip1Rect: (w, h) => { const s = Math.min(w, h) * 0.16667; return `M${f(s)},0H${f(w)}V${f(h)}H0V${f(s)}Z` },
  ellipse: (w, h) => `M${f(w / 2)},0A${f(w / 2)},${f(h / 2)} 0 1 1 ${f(w / 2 - 0.01)},0Z`,
  triangle: (w, h) => `M${f(w / 2)},0L${f(w)},${f(h)}L0,${f(h)}Z`,
  rtTriangle: (w, h) => `M0,0L${f(w)},${f(h)}L0,${f(h)}Z`,
  diamond: (w, h) => `M${f(w / 2)},0L${f(w)},${f(h / 2)}L${f(w / 2)},${f(h)}L0,${f(h / 2)}Z`,
  parallelogram: (w, h) => `M${f(w * 0.25)},0H${f(w)}L${f(w * 0.75)},${f(h)}H0Z`,
  trapezoid: (w, h) => `M${f(w * 0.25)},0H${f(w * 0.75)}L${f(w)},${f(h)}H0Z`,
  pentagon: (w, h) => regularPoly(w, h, 5),
  hexagon: (w, h) => regularPoly(w, h, 6, 0),
  heptagon: (w, h) => regularPoly(w, h, 7),
  octagon: (w, h) => {
    const s = Math.min(w, h) * 0.29289
    return `M${f(s)},0H${f(w - s)}L${f(w)},${f(s)}V${f(h - s)}L${f(w - s)},${f(h)}H${f(s)}L0,${f(h - s)}V${f(s)}Z`
  },
  decagon: (w, h) => regularPoly(w, h, 10),
  dodecagon: (w, h) => regularPoly(w, h, 12),
  star4: (w, h) => starPoly(w, h, 4, 0.35),
  star5: (w, h) => starPoly(w, h, 5, 0.382),
  star6: (w, h) => starPoly(w, h, 6, 0.577),
  star7: (w, h) => starPoly(w, h, 7, 0.55),
  star8: (w, h) => starPoly(w, h, 8, 0.541),
  star10: (w, h) => starPoly(w, h, 10, 0.6),
  star12: (w, h) => starPoly(w, h, 12, 0.6),
  star16: (w, h) => starPoly(w, h, 16, 0.7),
  star24: (w, h) => starPoly(w, h, 24, 0.8),
  rightArrow: (w, h) => `M0,${f(h * 0.25)}H${f(w * 0.5)}V0L${f(w)},${f(h / 2)}L${f(w * 0.5)},${f(h)}V${f(h * 0.75)}H0Z`,
  leftArrow: (w, h) => `M${f(w)},${f(h * 0.25)}H${f(w * 0.5)}V0L0,${f(h / 2)}L${f(w * 0.5)},${f(h)}V${f(h * 0.75)}H${f(w)}Z`,
  upArrow: (w, h) => `M${f(w * 0.25)},${f(h)}V${f(h * 0.5)}H0L${f(w / 2)},0L${f(w)},${f(h * 0.5)}H${f(w * 0.75)}V${f(h)}Z`,
  downArrow: (w, h) => `M${f(w * 0.25)},0V${f(h * 0.5)}H0L${f(w / 2)},${f(h)}L${f(w)},${f(h * 0.5)}H${f(w * 0.75)}V0Z`,
  leftRightArrow: (w, h) => `M0,${f(h / 2)}L${f(w * 0.18)},0V${f(h * 0.3)}H${f(w * 0.82)}V0L${f(w)},${f(h / 2)}L${f(w * 0.82)},${f(h)}V${f(h * 0.7)}H${f(w * 0.18)}V${f(h)}Z`,
  upDownArrow: (w, h) => `M${f(w / 2)},0L${f(w)},${f(h * 0.18)}H${f(w * 0.7)}V${f(h * 0.82)}H${f(w)}L${f(w / 2)},${f(h)}L0,${f(h * 0.82)}H${f(w * 0.3)}V${f(h * 0.18)}H0Z`,
  quadArrow: (w, h) => `M${f(w / 2)},0L${f(w * 0.65)},${f(h * 0.15)}V${f(h * 0.35)}H${f(w * 0.85)}L${f(w)},${f(h / 2)}L${f(w * 0.85)},${f(h * 0.65)}H${f(w * 0.65)}V${f(h * 0.85)}L${f(w / 2)},${f(h)}L${f(w * 0.35)},${f(h * 0.85)}V${f(h * 0.65)}H${f(w * 0.15)}L0,${f(h / 2)}L${f(w * 0.15)},${f(h * 0.35)}H${f(w * 0.35)}V${f(h * 0.15)}Z`,
  bentArrow: (w, h) => `M0,${f(h * 0.7)}H${f(w * 0.55)}V${f(h * 0.3)}L${f(w)},${f(h * 0.6)}L${f(w * 0.55)},${f(h * 0.9)}V${f(h * 0.85)}H${f(w * 0.18)}V0H0Z`,
  circularArrow: (w, h) => `M${f(w * 0.1)},${f(h * 0.5)}A${f(w * 0.4)},${f(h * 0.4)} 0 1 1 ${f(w * 0.5)},${f(h * 0.9)}L${f(w * 0.5)},${f(h)}A${f(w * 0.5)},${f(h * 0.5)} 0 1 0 ${f(w * 0.1)},${f(h * 0.5)}Z`,
  chevron: (w, h) => `M0,0H${f(w * 0.5)}L${f(w)},${f(h / 2)}L${f(w * 0.5)},${f(h)}H0L${f(w * 0.5)},${f(h / 2)}Z`,
  homePlate: (w, h) => `M0,0H${f(w * 0.6)}L${f(w)},${f(h / 2)}L${f(w * 0.6)},${f(h)}H0Z`,
  heart: (w, h) => `M${f(w / 2)},${f(h * 0.28)}C${f(w / 2)},${f(h * 0.1)},${f(w * 0.35)},0,${f(w * 0.25)},0C${f(w * 0.1)},0,0,${f(h * 0.12)},0,${f(h * 0.3)}C0,${f(h * 0.52)},${f(w * 0.25)},${f(h * 0.72)},${f(w / 2)},${f(h)}C${f(w * 0.75)},${f(h * 0.72)},${f(w)},${f(h * 0.52)},${f(w)},${f(h * 0.3)}C${f(w)},${f(h * 0.12)},${f(w * 0.9)},0,${f(w * 0.75)},0C${f(w * 0.65)},0,${f(w / 2)},${f(h * 0.1)},${f(w / 2)},${f(h * 0.28)}Z`,
  lightningBolt: (w, h) => `M${f(w * 0.45)},0L${f(w * 0.1)},${f(h * 0.6)}L${f(w * 0.38)},${f(h * 0.62)}L${f(w * 0.25)},${f(h)}L${f(w * 0.9)},${f(h * 0.38)}L${f(w * 0.58)},${f(h * 0.36)}L${f(w * 0.75)},0Z`,
  sun: (w, h) => {
    let d = `M${f(w / 2)},${f(h * 0.3)}A${f(w * 0.2)},${f(h * 0.2)} 0 1 0 ${f(w / 2 - 0.01)},${f(h * 0.3)}Z`
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180
      const x1 = w / 2 + w * 0.3 * Math.cos(a), y1 = h / 2 + h * 0.3 * Math.sin(a)
      const x2 = w / 2 + w * 0.48 * Math.cos(a - 0.09), y2 = h / 2 + h * 0.48 * Math.sin(a - 0.09)
      const x3 = w / 2 + w * 0.48 * Math.cos(a + 0.09), y3 = h / 2 + h * 0.48 * Math.sin(a + 0.09)
      d += `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}L${f(x3)},${f(y3)}Z`
    }
    return d
  },
  moon: (w, h) => `M${f(w * 0.55)},0A${f(w * 0.45)},${f(h * 0.5)} 0 1 0 ${f(w * 0.55)},${f(h)}A${f(w * 0.36)},${f(h * 0.42)} 0 1 1 ${f(w * 0.55)},0Z`,
  cloud: (w, h) => `M${f(w * 0.16)},${f(h * 0.78)}A${f(w * 0.17)},${f(h * 0.17)} 0 0 1 ${f(w * 0.2)},${f(h * 0.38)}A${f(w * 0.2)},${f(h * 0.24)} 0 0 1 ${f(w * 0.62)},${f(h * 0.28)}A${f(w * 0.16)},${f(h * 0.16)} 0 0 1 ${f(w * 0.84)},${f(h * 0.75)}A${f(w * 0.12)},${f(h * 0.12)} 0 0 1 ${f(w * 0.16)},${f(h * 0.78)}Z`,
  teardrop: (w, h) => `M${f(w / 2)},0C${f(w / 2)},${f(h * 0.28)},0,${f(h * 0.46)},0,${f(h * 0.68)}A${f(w / 2)},${f(h * 0.32)} 0 1 0 ${f(w)},${f(h * 0.68)}C${f(w)},${f(h * 0.46)},${f(w / 2)},${f(h * 0.28)},${f(w / 2)},0Z`,
  plaque: (w, h) => {
    const r = Math.min(w, h) * 0.16667
    return `M0,${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}Z`
  },
  frame: (w, h) => {
    const i = Math.min(w, h) * 0.125
    return `M0,0H${f(w)}V${f(h)}H0Z M${f(i)},${f(i)}H${f(w - i)}V${f(h - i)}H${f(i)}Z`
  },
  donut: (w, h) => {
    const rx = w / 2, ry = h / 2, irx = rx * 0.75, iry = ry * 0.75
    return `M${f(rx)},0A${f(rx)},${f(ry)} 0 1 1 ${f(rx - 0.01)},0Z M${f(rx)},${f(ry - iry)}A${f(irx)},${f(iry)} 0 1 0 ${f(rx - 0.01)},${f(ry - iry)}Z`
  },
  plus: (w, h) => `M${f(w * 0.25)},0H${f(w * 0.75)}V${f(h * 0.25)}H${f(w)}V${f(h * 0.75)}H${f(w * 0.75)}V${f(h)}H${f(w * 0.25)}V${f(h * 0.75)}H0V${f(h * 0.25)}H${f(w * 0.25)}Z`,
  can: (w, h) => `M0,${f(h * 0.12)}A${f(w / 2)},${f(h * 0.12)} 0 0 1 ${f(w)},${f(h * 0.12)}V${f(h * 0.88)}A${f(w / 2)},${f(h * 0.12)} 0 0 1 0,${f(h * 0.88)}Z`,
  cube: (w, h) => `M0,${f(h * 0.25)}L${f(w * 0.25)},0H${f(w)}V${f(h * 0.75)}L${f(w * 0.75)},${f(h)}H0Z M0,${f(h * 0.25)}L${f(w * 0.75)},${f(h * 0.25)}L${f(w)},0 M${f(w * 0.75)},${f(h * 0.25)}V${f(h)}`,
  smileyFace: (w, h) => shapeDefs.ellipse(w, h),
  corner: (w, h) => `M0,0H${f(w)}V${f(h * 0.2)}H${f(w * 0.2)}V${f(h)}H0Z`,
  diagStripe: (w, h) => `M${f(w * 0.3)},0H${f(w)}L${f(w * 0.7)},${f(h)}H0Z`,
  chord: (w, h) => `M${f(w / 2)},0A${f(w / 2)},${f(h / 2)} 0 0 1 ${f(w / 2)},${f(h)}L${f(w / 2)},0Z`,
  pie: (w, h) => `M${f(w / 2)},${f(h / 2)}L${f(w / 2)},0A${f(w / 2)},${f(h / 2)} 0 1 1 ${f(w * 0.85)},${f(h * 0.85)}Z`,
  blockArc: (w, h) => {
    const rx = w / 2, ry = h / 2, irx = rx * 0.62, iry = ry * 0.62
    return `M${f(rx)},0A${f(rx)},${f(ry)} 0 1 1 ${f(rx - 0.01)},0Z M${f(rx)},${f(ry - iry)}A${f(irx)},${f(iry)} 0 1 0 ${f(rx + 0.01)},${f(ry - iry)}Z`
  },
  flowChartProcess: (w, h) => shapeDefs.rect(w, h),
  flowChartDecision: (w, h) => shapeDefs.diamond(w, h),
  flowChartTerminator: (w, h) => {
    const r = h / 2
    return `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`
  },
  flowChartInputOutput: (w, h) => `M${f(w * 0.2)},0H${f(w)}L${f(w * 0.8)},${f(h)}H0Z`,
  flowChartPredefinedProcess: (w, h) => {
    const i = w * 0.15
    return `M0,0H${f(w)}V${f(h)}H0Z M${f(i)},0V${f(h)} M${f(w - i)},0V${f(h)}`
  },
  flowChartInternalStorage: (w, h) => `M0,0H${f(w)}V${f(h)}H0Z M${f(w * 0.18)},0V${f(h)} M0,${f(h * 0.25)}H${f(w)}`,
  flowChartDocument: (w, h) => `M0,0H${f(w)}V${f(h * 0.75)}C${f(w * 0.75)},${f(h)},${f(w * 0.25)},${f(h * 0.55)},0,${f(h * 0.85)}Z`,
  flowChartMultidocument: (w, h) => `M0,${f(h * 0.1)}H${f(w * 0.85)}V${f(h * 0.6)}C${f(w * 0.6)},${f(h * 0.82)},${f(w * 0.2)},${f(h * 0.45)},0,${f(h * 0.75)}Z M${f(w * 0.08)},0H${f(w)}V${f(h * 0.55)}C${f(w * 0.75)},${f(h * 0.75)},${f(w * 0.35)},${f(h * 0.4)},${f(w * 0.08)},${f(h * 0.6)}Z`,
  flowChartConnector: (w, h) => shapeDefs.ellipse(w, h),
  flowChartOffpageConnector: (w, h) => `M0,0H${f(w)}V${f(h * 0.65)}L${f(w / 2)},${f(h)}L0,${f(h * 0.65)}Z`,
  flowChartDelay: (w, h) => `M0,0H${f(w * 0.6)}A${f(w * 0.4)},${f(h * 0.5)} 0 0 1 ${f(w * 0.6)},${f(h)}H0Z`,
  mathPlus: (w, h) => shapeDefs.plus(w, h),
  mathMinus: (w, h) => `M0,${f(h * 0.35)}H${f(w)}V${f(h * 0.65)}H0Z`,
  wedgeRectCallout: (w, h) => `M0,0H${f(w * 0.58)}V${f(h * 0.58)}H${f(w * 0.44)}L${f(w * 0.3)},${f(h)}L${f(w * 0.34)},${f(h * 0.58)}H0Z`,
  wedgeEllipseCallout: (w, h) => `M${f(w / 2)},0A${f(w / 2)},${f(h * 0.32)} 0 1 0 ${f(w / 2)},${f(h * 0.64)}L${f(w * 0.32)},${f(h)}L${f(w * 0.4)},${f(h * 0.63)}A${f(w / 2)},${f(h * 0.32)} 0 0 1 ${f(w / 2)},0Z`,
  wedgeRoundRectCallout: (w, h) => {
    const r = Math.min(w, h) * 0.1
    return `M${f(r)},0H${f(w * 0.58 - r)}A${f(r)},${f(r)} 0 0 1 ${f(w * 0.58)},${f(r)}V${f(h * 0.58 - r)}A${f(r)},${f(r)} 0 0 1 ${f(w * 0.58 - r)},${f(h * 0.58)}H${f(w * 0.46)}L${f(w * 0.3)},${f(h)}L${f(w * 0.36)},${f(h * 0.58)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h * 0.58 - r)}}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`
  },
  lineInv: (w, h) => `M${f(w * 0.7)},0L${f(w)},0L${f(w * 0.3)},${f(h)}L0,${f(h)}Z`,
}

/** 布尔形状（frame/donut/blockArc 等带孔路径）需要 evenodd 填充规则 */
const evenOddGeoms = new Set(['frame', 'donut', 'blockArc', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'cube'])

export function shapePath(prst: string, w: number, h: number): string | null {
  const gen = shapeDefs[prst]
  return gen ? gen(w, h) : null
}

export function shapeFillRule(prst: string): 'evenodd' | 'nonzero' {
  return evenOddGeoms.has(prst) ? 'evenodd' : 'nonzero'
}

export interface ShapeGroup { name: string; items: { prst: string; name: string }[] }
export const SHAPE_GROUPS: ShapeGroup[] = [
  { name: '矩形', items: [{ prst: 'rect', name: '矩形' }, { prst: 'roundRect', name: '圆角矩形' }, { prst: 'snip1Rect', name: '剪角矩形' }, { prst: 'frame', name: '框架' }] },
  {
    name: '基本形状', items: [
      { prst: 'ellipse', name: '椭圆' }, { prst: 'triangle', name: '三角形' }, { prst: 'rtTriangle', name: '直角三角形' },
      { prst: 'diamond', name: '菱形' }, { prst: 'parallelogram', name: '平行四边形' }, { prst: 'trapezoid', name: '梯形' },
      { prst: 'pentagon', name: '正五边形' }, { prst: 'hexagon', name: '六边形' }, { prst: 'heptagon', name: '七边形' },
      { prst: 'octagon', name: '八边形' }, { prst: 'decagon', name: '十边形' }, { prst: 'dodecagon', name: '十二边形' },
      { prst: 'plus', name: '加号' }, { prst: 'can', name: '圆柱' }, { prst: 'cube', name: '立方体' },
      { prst: 'heart', name: '心形' }, { prst: 'lightningBolt', name: '闪电' }, { prst: 'sun', name: '太阳' },
      { prst: 'moon', name: '月亮' }, { prst: 'cloud', name: '云形' }, { prst: 'teardrop', name: '泪滴' },
      { prst: 'plaque', name: '牌匾' }, { prst: 'donut', name: '圆环' }, { prst: 'corner', name: '拐角' },
    ],
  },
  {
    name: '箭头总汇', items: [
      { prst: 'rightArrow', name: '右箭头' }, { prst: 'leftArrow', name: '左箭头' }, { prst: 'upArrow', name: '上箭头' },
      { prst: 'downArrow', name: '下箭头' }, { prst: 'leftRightArrow', name: '左右箭头' }, { prst: 'upDownArrow', name: '上下箭头' },
      { prst: 'quadArrow', name: '十字箭头' }, { prst: 'bentArrow', name: '手杖形箭头' }, { prst: 'circularArrow', name: '循环箭头' },
      { prst: 'chevron', name: 'V 形' }, { prst: 'homePlate', name: '五边形箭头' }, { prst: 'lineInv', name: '反转箭头' },
    ],
  },
  {
    name: '流程图', items: [
      { prst: 'flowChartProcess', name: '过程' }, { prst: 'flowChartDecision', name: '判定' }, { prst: 'flowChartTerminator', name: '终止' },
      { prst: 'flowChartInputOutput', name: '数据' }, { prst: 'flowChartPredefinedProcess', name: '预定义过程' },
      { prst: 'flowChartInternalStorage', name: '内部贮存' }, { prst: 'flowChartDocument', name: '文档' },
      { prst: 'flowChartMultidocument', name: '多文档' }, { prst: 'flowChartConnector', name: '联系' },
      { prst: 'flowChartOffpageConnector', name: '离页连接符' }, { prst: 'flowChartDelay', name: '延迟' },
    ],
  },
  {
    name: '星与旗帜', items: [
      { prst: 'star4', name: '四角星' }, { prst: 'star5', name: '五角星' }, { prst: 'star6', name: '六角星' },
      { prst: 'star7', name: '七角星' }, { prst: 'star8', name: '八角星' }, { prst: 'star10', name: '十字星' },
      { prst: 'star12', name: '十二角星' }, { prst: 'star16', name: '十六角星' }, { prst: 'star24', name: '二十四角星' },
      { prst: 'diagStripe', name: '条纹' },
    ],
  },
  {
    name: '标注', items: [
      { prst: 'wedgeRectCallout', name: '矩形标注' }, { prst: 'wedgeRoundRectCallout', name: '圆角矩形标注' },
      { prst: 'wedgeEllipseCallout', name: '椭圆形标注' }, { prst: 'chord', name: '弦形' }, { prst: 'pie', name: '饼形' },
      { prst: 'blockArc', name: '弧形' },
    ],
  },
]

export function geomLabel(prst: string): string {
  for (const g of SHAPE_GROUPS) for (const it of g.items) if (it.prst === prst) return it.name
  if (prst === 'custGeom') return '自定义形状'
  return prst
}

// ---- 图片样式库（对齐 Excel「图片格式 → 图片样式」）----

export interface PictureStyle {
  name: string
  /** 相对默认的属性补丁（null 表示清除该效果） */
  patch: Partial<SheetPicture>
}

export const PICTURE_STYLES: PictureStyle[] = [
  { name: '无样式', patch: { geom: 'rect', ln: null, shadow: null, glow: null, softEdge: 0, reflection: 0, bevel: null, cam: '', crop: { l: 0, t: 0, r: 0, b: 0 }, color: null } },
  { name: '柔化边缘椭圆', patch: { geom: 'ellipse', ln: null, shadow: null, glow: null, softEdge: 12, reflection: 0, bevel: null } },
  { name: '简易框架', patch: { geom: 'rect', ln: { color: '#FFFFFF', w: 12, dash: 'solid', alpha: 1 }, shadow: { kind: 'outer', blur: 5, dist: 4, dir: 90, color: '#000000', alpha: 0.35 }, softEdge: 0 } },
  { name: '矩形投影', patch: { geom: 'rect', ln: null, shadow: { kind: 'outer', blur: 5, dist: 4, dir: 90, color: '#000000', alpha: 0.4 } } },
  { name: '圆角矩形', patch: { geom: 'roundRect', ln: null } },
  { name: '圆形', patch: { geom: 'ellipse', ln: null } },
  { name: '映像圆形', patch: { geom: 'ellipse', ln: null, reflection: 0.6 } },
  { name: '映像圆角矩形', patch: { geom: 'roundRect', ln: null, reflection: 0.6 } },
  { name: '圆形投影', patch: { geom: 'ellipse', ln: null, shadow: { kind: 'outer', blur: 6, dist: 5, dir: 90, color: '#000000', alpha: 0.45 } } },
  { name: '金属圆角矩形', patch: { geom: 'roundRect', ln: { color: '#BFBFBF', w: 2.25, dash: 'solid', alpha: 1 }, bevel: { preset: 'angle', w: 4, h: 4 } } },
  { name: '强调边框', patch: { geom: 'rect', ln: { color: '#4472C4', w: 2.25, dash: 'solid', alpha: 1 } } },
  { name: '发光', patch: { geom: 'roundRect', ln: null, glow: { size: 10, color: '#4472C4', alpha: 0.6 } } },
]

// ---- 效果预设（对齐 Excel「图片效果」下拉）----

export interface ShadowPreset { name: string; kind: 'outer' | 'inner'; blur: number; dist: number; dir: number; color: string; alpha: number }
export const SHADOW_PRESETS: ShadowPreset[] = [
  { name: '无阴影', kind: 'outer', blur: 0, dist: 0, dir: 90, color: '#000000', alpha: 0 },
  { name: '右下外阴影', kind: 'outer', blur: 5, dist: 4, dir: 90, color: '#000000', alpha: 0.4 },
  { name: '左下外阴影', kind: 'outer', blur: 5, dist: 4, dir: 150, color: '#000000', alpha: 0.4 },
  { name: '右上外阴影', kind: 'outer', blur: 5, dist: 4, dir: 30, color: '#000000', alpha: 0.4 },
  { name: '透视左下', kind: 'outer', blur: 0, dist: 9, dir: 135, color: '#000000', alpha: 0.35 },
  { name: '内部右下', kind: 'inner', blur: 6, dist: 4, dir: 90, color: '#000000', alpha: 0.45 },
]

export interface CamPreset { name: string; cam: string; lat: number; lon: number; rev: number }
export const CAM_PRESETS: CamPreset[] = [
  { name: '无旋转', cam: '', lat: 0, lon: 0, rev: 0 },
  { name: '平行下', cam: 'orthographicFront', lat: -90, lon: 0, rev: 0 },
  { name: '等距左下', cam: 'isometricOffAxis1Left', lat: 0, lon: 0, rev: 0 },
  { name: '等距右上', cam: 'isometricOffAxis4Right', lat: 0, lon: 0, rev: 0 },
  { name: '等距左上', cam: 'isometricOffAxis2Left', lat: 0, lon: 0, rev: 0 },
  { name: '透视左', cam: 'perspectiveLeft', lat: 0, lon: 0, rev: 0 },
  { name: '透视右', cam: 'perspectiveRight', lat: 0, lon: 0, rev: 0 },
  { name: '宽松透视', cam: 'legacyObliqueTopLeft', lat: 0, lon: 0, rev: 0 },
]

// ---- 裁剪辅助 ----

/** 裁剪后可见窗口占原图的宽高比例 */
export function cropWindow(c: PicCrop): { w: number; h: number } {
  return { w: Math.max(0.02, 1 - c.l - c.r), h: Math.max(0.02, 1 - c.t - c.b) }
}

/** 可见区域显示尺寸 → 原图等比尺寸（“重置大小”用） */
export function naturalRectSize(p: SheetPicture): { w: number; h: number } {
  const win = cropWindow(p.crop)
  return { w: p.size.w / win.w, h: p.size.h / win.h }
}

/** 填充/调整（裁剪子菜单）：fit = 完整显示（保持框面积改纵横比 + 清除裁剪），fill = 填满裁剪区（居中裁剪） */
export function cropFit(p: SheetPicture): SheetPicture {
  const ratio = p.natW / p.natH
  let w = p.size.w, h = p.size.h
  if (w / h > ratio) w = h * ratio
  else h = w / ratio
  return { ...p, size: { w, h }, crop: { l: 0, t: 0, r: 0, b: 0 } }
}

/** 填充：以框的纵横比居中裁剪原图 */
export function cropFill(p: SheetPicture): SheetPicture {
  const ratio = p.size.w / p.size.h
  const natRatio = p.natW / p.natH
  let l = 0, t = 0, r = 0, b = 0
  if (natRatio > ratio) {
    const cut = 1 - ratio / natRatio
    l = cut / 2; r = cut / 2
  } else {
    const cut = 1 - natRatio / ratio
    t = cut / 2; b = cut / 2
  }
  return { ...p, crop: { l, t, r, b } }
}

// ---- 交互几何（旋转框下的缩放）----

export type PicHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const handleVec: Record<PicHandle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
}

/**
 * 在图片本地坐标系（已按 rot 旋转）中，以拖拽柄的对侧为定点缩放。
 * start 为开始时的轴对齐矩形，dx/dy 为指针位移（工作表坐标）。
 * keepRatio 传入需保持的宽高比（null 不约束），fromCenter 时以中心为定点。
 */
export function resizeRect(start: PicRect, handle: PicHandle, dx: number, dy: number, rotDeg: number, opts: { keepRatio?: number | null; fromCenter?: boolean }): PicRect {
  const rad = (-rotDeg * Math.PI) / 180
  const ldx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ldy = dx * Math.sin(rad) + dy * Math.cos(rad)
  const [sx, sy] = handleVec[handle]
  const cx = start.x + start.w / 2, cy = start.y + start.h / 2
  let hw = start.w / 2, hh = start.h / 2
  if (sx !== 0) hw += (sx * ldx) / 2
  if (sy !== 0) hh += (sy * ldy) / 2
  if (hw < 1) hw = 1
  if (hh < 1) hh = 1
  if (opts.keepRatio && opts.keepRatio > 0) {
    const r = opts.keepRatio
    if (sx !== 0 && sy !== 0) {
      // 角柄：取变化幅度更大的轴
      const s = Math.max(hw / (start.w / 2 || 1), hh / (start.h / 2 || 1))
      hw = (start.w / 2) * s
      hh = (start.h / 2) * s
    } else if (sx !== 0) {
      hh = hw / r
    } else {
      hw = hh * r
    }
  }
  // 中心位移（本地）：拖动边/角时中心跟随半程
  let dcx = 0, dcy = 0
  if (!opts.fromCenter) {
    if (sx !== 0) dcx = ldx / 2
    if (sy !== 0) dcy = ldy / 2
  }
  const rad2 = (rotDeg * Math.PI) / 180
  const gx = dcx * Math.cos(rad2) - dcy * Math.sin(rad2)
  const gy = dcx * Math.sin(rad2) + dcy * Math.cos(rad2)
  return { x: cx + gx - hw, y: cy + gy - hh, w: hw * 2, h: hh * 2 }
}

/** 旋转柄拖拽：指针相对图片中心的角度（deg，顺时针，0 = 向上） */
export function rotationFromPointer(cx: number, cy: number, px: number, py: number): number {
  const a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90
  return (a + 360) % 360
}
