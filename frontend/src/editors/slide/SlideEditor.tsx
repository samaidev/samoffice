import { useState, useMemo, memo, useEffect, useRef } from 'react'
import { askText } from '../../lib/askText'
import { useI18n } from '../../i18n'
import { PrintDialog, PAPER_SIZES } from '../../components/PrintDialog'
import { Dropdown } from '../../components/Dropdown'
import { SlideData, SlideShape } from '../../lib/openroute'

interface Slide {
  id: number; title: string; content: string; bg: string
  // round58：背景纹理图（bgRef → 主题 blipFill；tile 0 = stretch cover）
  bgImg?: string; bgImgTileW?: number; bgImgTileH?: number
  // round58：本页装饰形状（版式/母版非占位符形状 —— 每页版式不同，装饰不同；
  // 之前用首页装饰渲染所有页 → 无装饰页出现多余分隔线）
  deco?: ShapeItem[]
  layout: 'title' | 'section' | 'content' | 'blank'
  transition: string; notes: string
  shapes: ShapeItem[]; artTexts: ArtTextItem[]
  animations: AnimItem[]
  // round71/72：标题/正文的整段文字样式（颜色/字号/字体/加粗/对齐/行距/缩进/项目符号）。
  // round73：新增 titleParas/contentParas —— 选定文字（选区）级样式：
  // 字体、字号、颜色、加粗、斜体、下划线、删除线、字符间距按 run 拆分存储，
  // 未选区命令回退写整段 style（与 MS PPT 语义一致）。
  titleStyle?: { color?: string; fontSize?: number; fontFamily?: string; bold?: boolean; align?: 'left' | 'center' | 'right'; lineHeight?: number; indent?: number; bullet?: boolean; numbered?: boolean; charSpacing?: number }
  contentStyle?: { color?: string; fontSize?: number; fontFamily?: string; bold?: boolean; align?: 'left' | 'center' | 'right'; lineHeight?: number; indent?: number; bullet?: boolean; numbered?: boolean; charSpacing?: number }
  // round73：标题/正文的逐段逐 run 富文本（选定文字格式落点；与 title/content
  // 平行存在 —— 有 paras 时渲染优先，纯文本回退 title/content）
  titleParas?: TextPara[]
  contentParas?: TextPara[]
}

// round73：富文本段落/run（标题/正文共用 —— 选定文字样式模型）
interface TextPara { align?: string; bullet?: boolean; numbered?: boolean; runs: TextRun[] }
interface TextRun {
  text: string
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  color?: string; fontSize?: number; font?: string; spc?: number // spc = 字符间距 pt×100（OOXML 语义）
}

// 画布逻辑坐标：宽 6464 单位 = 808px（1px = 8 单位），高随页面比例变化。
// 所有新建形状的坐标必须是“单位”而非 px，否则渲染时 /8 后只剩 1/8 大小。
const PXU = 8 // units per px
const DECK_W_169 = 12192000
const DECK_H_169 = 6858000
const DECK_W_43 = 9144000
const DECK_H_43 = 6858000

// 静态常量在组件外定义，避免每次渲染重建 (perf: 首屏性能优化)
const SHAPE_DEFS = [
  { type: 'rect', icon: '▭' }, { type: 'roundRect', icon: '▢' },
  { type: 'ellipse', icon: '⬭' }, { type: 'triangle', icon: '△' },
  { type: 'diamond', icon: '◇' }, { type: 'rightArrow', icon: '→' },
  { type: 'star5', icon: '★' }, { type: 'hexagon', icon: '⬡' },
  { type: 'pentagon', icon: '⬠' }, { type: 'heart', icon: '♥' },
  { type: 'cloud', icon: '☁' }, { type: 'callout', icon: '💬' },
  // === 流程图（对齐 MS PPT 形状库）===
  { type: 'parallelogram', icon: '▱' }, { type: 'trapezoid', icon: ' ⬢' },
  { type: 'can', icon: '🛢' }, { type: 'flowDoc', icon: '📄' },
  { type: 'chevron', icon: '⫸' }, { type: 'lightning', icon: '⚡' },
  { type: 'flowManualInput', icon: '⏢' }, { type: 'flowDelay', icon: '◐' },
  { type: 'flowMerge', icon: '▽' }, { type: 'flowOffpage', icon: '⧕' },
  { type: 'leftArrow', icon: '←' }, { type: 'upArrow', icon: '↑' },
  { type: 'downArrow', icon: '↓' }, { type: 'leftRightArrow', icon: '↔' },
  { type: 'upDownArrow', icon: '↕' }, { type: 'bentArrow', icon: '⤸' },
] as const

const LAYOUT_DEFS = [
  { id: 'title', icon: '🎯' }, { id: 'content', icon: '📝' }, { id: 'blank', icon: '⬜' },
] as const

const PRESET_COLOR_DEFS = [
  '#ffffff', '#f8fafc', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#1e293b', '#312e81',
] as const

// round71：文字色板（对齐 MS PPT 标准色 + 常用色，旧版仅 8 色太少 —— 用户主诉②）。
// 6 行 × 8 列 = 48 色 + 色板底部 hex 自定义输入。
const PALETTE_COLORS = [
  // 第 1 行：标准色（MS Office 经典 10 色的核心 8）
  '#000000', '#7f7f7f', '#595959', '#404040', '#bf9000', '#c45911', '#843c0c', '#375623',
  // 第 2 行：Word/PPT 主题色
  '#4f46e5', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
  // 第 3 行：亮色系
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  // 第 4 行：蓝紫系
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  // 第 5 行：暗色系
  '#0f172a', '#1e293b', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9',
  // 第 6 行：中文场景常用（深蓝/酒红/墨绿/藏青/棕/金/银/白）
  '#1e3a8a', '#7f1d1d', '#14532d', '#164e63', '#78350f', '#b8860b', '#c0c0c0', '#ffffff',
]

const TRANSITION_DEFS = [
  '', 'fade', 'push', 'wipe', 'cover', 'cut', 'zoom', 'morph',
] as const

const ENTRANCE_ANIM_DEFS = ['fade', 'fly', 'zoom', 'wipe', 'bounce'] as const
const EMPHASIS_ANIM_DEFS = ['pulse', 'spin'] as const
const EXIT_ANIM_DEFS = ['fade', 'fly', 'zoom'] as const

const ART_PRESET_DEFS = [
  { color: '#4f46e5', gradient: '4f46e5,818cf8', shadow: true },
  { color: '#3b82f6', outline: '1e40af', glow: true },
  { color: '#10b981', glow: true, gradient: '10b981,34d399' },
  { color: '#f59e0b', shadow: true, gradient: 'f59e0b,fbbf24' },
  { color: '#ef4444', shadow: true, outline: '991b1b' },
  { color: '#ffffff', shadow: true },
] as const

interface ShapeItem {
  type: string; x: number; y: number; w: number; h: number
  fill: string; text: string; shadow: boolean; glow: boolean
  gradient: string; rotation: number
  // 现代扩展
  stroke?: string; strokeWidth?: number
  fontSize?: number; fontBold?: boolean; fontColor?: string; font?: string
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  indent?: number
  bullet?: boolean
  numbered?: boolean
  media?: { type: 'video' | 'audio'; src: string; poster?: string }
  vAlign?: 'top' | 'middle' | 'bottom'
  isFootnote?: boolean
  glowColor?: string; glowRadius?: number
  link?: string // 超链接 URL（形状点击打开）
  fontFamily?: string
  // round73：形状文字字符间距（pt×100）
  charSpacing?: number
  paras?: { align?: string; runs: { text?: string; color?: string; fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean; font?: string; strike?: boolean; spc?: number }[] }[]
  // 来自文件的形状：不画装饰边框，边框用文件里的 a:ln
  noDecor?: boolean
  groupId?: string // 所属组合 ID（同组成员整组选中/拖动，写回时包为 p:grpSp）
}

// 选中项：形状或艺术字 + 数组下标（多选集合 selectedEls 的成员）
type SelEl = { type: 'shape' | 'art'; index: number }

interface ArtTextItem {
  text: string; x: number; y: number; w: number; h: number
  fontSize: number; color: string; gradient: string
  shadow: boolean; glow: boolean; outline: string; rotation: number
}

interface AnimItem {
  target: string; effect: string; category: string; delay: number; sound?: string
}

// round66：讲义母版（对齐 MS PPT「讲义母版视图」）—— 页眉/页脚/日期/页码四占位符。
// 打印讲义（pptContent=handout）时把四要素渲染到纸张页缘；随 deck 保存往返。
interface HandoutMaster {
  header: string        // 页眉（纸张右上）
  footer: string        // 页脚（纸张左下）
  date: string          // 日期（纸张左上；空 = 不打印）
  pageOn: boolean       // 页码开关（纸张右下，打印时自动编号）
  fontSize: number      // 四要素字号 pt
  color: string         // 四要素文字颜色
}

function normalizeHandout(h: any): HandoutMaster {
  if (!h || typeof h !== 'object') return { header: '', footer: '', date: '', pageOn: true, fontSize: 10, color: '#333333' }
  return {
    header: typeof h.header === 'string' ? h.header : '',
    footer: typeof h.footer === 'string' ? h.footer : '',
    date: typeof h.date === 'string' ? h.date : '',
    pageOn: h.pageOn !== false,
    fontSize: Number.isFinite(Number(h.fontSize)) && Number(h.fontSize) > 0 ? Number(h.fontSize) : 10,
    color: typeof h.color === 'string' && h.color ? h.color : '#333333',
  }
}

type RibbonTab = 'home' | 'insert' | 'design' | 'modern' | 'animations' | 'transition' | 'view'

// prstGeom/内部形状 → 缩略图 clip-path（与主画布保持一致的视觉）
const SHAPE_CLIP: Record<string, string> = {
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  rightArrow: 'polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)',
  star5: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  pentagon: 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)',
  heart: 'path("M50 90 L10 50 A20 20 0 0 1 50 30 A20 20 0 0 1 90 50 Z")',
  cloud: 'ellipse(50% 50% at 50% 50%)',
  callout: 'polygon(0 0, 100% 0, 100% 70%, 60% 70%, 50% 100%, 40% 70%, 0 70%)',
  // === 流程图 ===
  parallelogram: 'polygon(18% 0, 100% 0, 82% 100%, 0 100%)',
  trapezoid: 'polygon(22% 0, 78% 0, 100% 100%, 0 100%)',
  // can（圆柱）：不用 clip —— 主画布/缩略图用 borderRadius '50%/12%' 呈现上下椭圆盖
  can: '',
  flowDoc: 'path("M0 8 Q25 0 50 8 Q75 16 100 8 L100 92 Q75 100 50 92 Q25 84 0 92 Z")',
  chevron: 'polygon(0 0, 72% 0, 100% 50%, 72% 100%, 0 100%, 28% 50%)',
  lightning: 'polygon(62% 0, 20% 55%, 45% 55%, 38% 100%, 80% 40%, 55% 40%, 75% 0)',
  flowManualInput: 'polygon(0 18%, 100% 0, 100% 100%, 0 100%)',
  flowDelay: 'polygon(0 0, 55% 0, 100% 50%, 55% 100%, 0 100%)',
  flowMerge: 'polygon(0 0, 100% 0, 50% 100%)',
  flowOffpage: 'polygon(0 0, 78% 0, 100% 50%, 78% 100%, 0 100%)',
  leftArrow: 'polygon(0 50%, 40% 8%, 40% 30%, 100% 30%, 100% 70%, 40% 70%, 40% 92%)',
  upArrow: 'polygon(50% 0, 92% 40%, 70% 40%, 70% 100%, 30% 100%, 30% 40%, 8% 40%)',
  downArrow: 'polygon(50% 100%, 92% 60%, 70% 60%, 70% 0, 30% 0, 30% 60%, 8% 60%)',
  leftRightArrow: 'polygon(0 50%, 30% 20%, 30% 40%, 70% 40%, 70% 20%, 100% 50%, 70% 80%, 70% 60%, 30% 60%, 30% 80%)',
  upDownArrow: 'polygon(50% 0, 80% 30%, 60% 30%, 60% 70%, 80% 70%, 50% 100%, 20% 70%, 40% 70%, 40% 30%, 20% 30%)',
  bentArrow: 'polygon(0 100%, 0 40%, 30% 40%, 30% 0, 100% 0, 100% 30%, 55% 30%, 55% 65%, 30% 65%, 30% 74%)',
}

// SlideThumb — 幻灯片真实缩略图（左侧面板 / 打印讲义共用）。
// 按 808x454 画布等比缩放，完整渲染：背景、形状（含 paras 逐 run 样式、
// 填充/渐变/边框/裁剪几何）、图片、艺术字。修复打开 PPT 后左侧缩略图
// 只显示裸文字、没有样式的问题。
// round58：CJK-Latin 自动间距（MS autoSpaceDE/DN 默认开 —— 中文与西文 run
// 之间自动加约 1/8 em 空隙；XML 无空格但 MS 渲染有（"互联网 + 机遇"）。
// 用 U+2009 thin space 近似；pre-wrap 不会折叠它。
const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/
const LATIN = /[A-Za-z0-9+=$%.]/
const autoSpaceRuns = (runs: { text: string }[]) => {
  const out = runs.map(r => ({ ...r, text: r.text || '' }))
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].text
    const cur = out[i].text
    if (!prev || !cur) continue
    const pLast = prev[prev.length - 1]
    const cFirst = cur[0]
    if (CJK.test(pLast) && LATIN.test(cFirst)) {
      out[i].text = '\u2009' + cur
    } else if (LATIN.test(pLast) && CJK.test(cFirst)) {
      out[i - 1].text = prev + '\u2009'
    }
  }
  return out
}

const bgImgStyle = (bgImg?: string, tileW?: number, tileH?: number): React.CSSProperties => {
  if (!bgImg) return {}
  const tiled = !!tileW && !!tileH
  // round58 二轮：背景图已在解析侧做 duotone 像素映射，直接平铺
  //（multiply 混合近似偏浅，VLM 对比背景过亮）
  return {
    backgroundImage: `url("${bgImg}")`,
    backgroundRepeat: tiled ? 'repeat' : 'no-repeat',
    backgroundSize: tiled ? `${tileW! / 1000}% ${tileH! / 1000}%` : 'cover',
    backgroundPosition: 'center',
  }
}

// round72：聚焦文本（标题/正文）样式 → 输入框 CSS 属性。
// 消费 titleStyle/contentStyle 的全部字段（颜色/字号/字体/加粗/对齐/行距/缩进）；
// bullet/numbered 由 BulletText 渲染符号行。
const fieldStyleToCSS = (
  st: Slide['titleStyle'],
  field: 'title' | 'content',
  isDark: boolean,
  ptToPx: (pt: number) => number,
): React.CSSProperties => {
  const baseColor = field === 'title' ? (isDark ? '#f1f5f9' : '#0f172a') : (isDark ? '#cbd5e1' : '#334155')
  return {
    color: st?.color || baseColor,
    fontSize: st?.fontSize ? `${ptToPx(st.fontSize)}px` : undefined,
    fontFamily: st?.fontFamily,
    // bold 显式设置优先；未设置时标题默认粗（版式语义），正文细
    fontWeight: st?.bold === undefined ? (field === 'title' ? 700 : undefined) : (st.bold ? 700 : 400),
    textAlign: st?.align,
    lineHeight: st?.lineHeight,
    paddingLeft: st?.indent ? `${st.indent * 12}px` : undefined,
    // round73：字符间距（pt → px 换算；OOXML spc=pt×100）
    letterSpacing: st?.charSpacing != null ? `${(st.charSpacing / 100) * (ptToPx(72) / 72)}px` : undefined,
  }
}

// ════ round73：标题/正文富文本编辑器（contentEditable）════
// 选定文字调整字体/字号/颜色/加粗/斜体/下划线/删除线/字符间距 —— 不再只对元素整体。
// 方案：contentEditable div 渲 paras/runs（span 逐 run 带样式），选区命中时
// 以“选区状态”驱动命令；命令把选区映射回 paras 的 run 拆分（与 MS PPT 同语义：
// 选中文字应用格式；无选区时应用到整段/全部 run）。
//
// 序列化策略：onInput 时读 DOM 子树 → paras（按 <div> 段 + <span> run 还原
// 样式）→ onChange(paras) 上抛。受控渲染用 key 重挂载防 cursor 抖动：
// 仅在 paras 与 DOM 不同步（如撤销/换页）时重挂；输入中用 suppressContentEditableWarning。
const runOfNode = (node: Node, inherited: Partial<TextRun>): Partial<TextRun> => {
  const el = node instanceof HTMLElement ? node : (node.parentElement instanceof HTMLElement ? node.parentElement : null)
  if (!el) return { ...inherited }
  const r: Partial<TextRun> = { ...inherited }
  const fw = el.style.fontWeight
  if (fw === 'bold' || fw === '700') r.bold = true
  else if (fw === 'normal' || fw === '400') r.bold = false
  if (el.style.fontStyle === 'italic') r.italic = true
  else if (el.style.fontStyle === 'normal') r.italic = false
  const td = el.style.textDecoration || ''
  if (td.includes('underline')) r.underline = true
  if (td.includes('line-through')) r.strike = true
  if (td === 'none') { r.underline = false; r.strike = false }
  if (el.style.color) r.color = el.style.color
  if (el.style.fontSize) {
    const m = el.style.fontSize.match(/^([\d.]+)px$/)
    if (m) r.fontSize = parseFloat(m[1]) // px 画布值；序列化时再换算 pt
  }
  if (el.style.fontFamily) r.font = el.style.fontFamily
  if (el.style.letterSpacing) {
    const m = el.style.letterSpacing.match(/^(-?[\d.]+)px$/)
    if (m) r.spc = Math.round(parseFloat(m[1]) * 100) // px → pt×100（近似 1px=1pt 级差用 100 基准）
  }
  return r
}

// DOM 子树 → paras（每段 div；run = 直接文本节点或带样式 span）
const extractParas = (root: HTMLElement): TextPara[] => {
  const paras: TextPara[] = []
  const blocks = [...root.childNodes].filter(n => n.nodeName === 'DIV' || n.nodeName === 'P')
  const lines: Node[][] = blocks.length ? blocks.map(b => [...b.childNodes]) : [[...root.childNodes]]
  for (const nodes of lines) {
    const runs: TextRun[] = []
    for (const n of nodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent) runs.push({ text: n.textContent })
      } else if (n.nodeName === 'SPAN') {
        const st = runOfNode(n, {})
        const txt = n.textContent || ''
        if (txt) runs.push({ ...st, text: txt } as TextRun)
      } else if (n.nodeName === 'BR') {
        runs.push({ text: '\n' })
      }
    }
    paras.push({ runs })
  }
  return paras.filter(p => p.runs.length)
}

// paras → contentEditable 内部 HTML（span 逐 run；空段给 <br>）
const parasToHTML = (paras: TextPara[], field: 'title' | 'content', base: React.CSSProperties): string => {
  const styleOf = (r: TextRun): string => {
    const s: string[] = []
    if (r.bold) s.push('font-weight:700')
    if (r.italic) s.push('font-style:italic')
    const deco: string[] = []
    if (r.underline) deco.push('underline')
    if (r.strike) deco.push('line-through')
    if (deco.length) s.push(`text-decoration:${deco.join(' ')}`)
    if (r.color) s.push(`color:${r.color}`)
    if (r.fontSize) s.push(`font-size:${r.fontSize}px`)
    if (r.font) s.push(`font-family:${r.font}`)
    if (r.spc != null) s.push(`letter-spacing:${r.spc / 100}px`)
    return s.join(';')
  }
  const lines = paras.length ? paras.map(p => {
    const spans = (p.runs.length ? p.runs : [{ text: '' }]).map(r => {
      const st = styleOf(r)
      return `<span${st ? ` style="${st}"` : ''}>${escHTML(r.text)}</span>`
    }).join('')
    return `<div>${spans || '<br>'}</div>`
  }) : []
  void field; void base
  return lines.join('') || '<div><br></div>'
}

const escHTML = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// RichField：受控 contentEditable（标题/正文富文本）
// - paras/renderKey 变化时重写 DOM（选区命令更新 paras 后视图同步；
//   撤销/换页/外部更新同路）
// - onInput 上抛 paras；onFocus 上抛 focus 状态
// - 选区命令（B/I/U/S 等）不直接改 DOM：父层通过 window.getSelection 找到
//   本元素选区 → run 拆分写 paras → 本组件 effect 重绘
// 重绘时保留选区（字符区间记录/恢复 —— MS PPT 点 B 后可继续点 I/U/S 连续操作）
// placeholder 用 data-ph + CSS ::before（空时显示，对齐 input/textarea 观感）
const richSelOffsets = (el: HTMLElement): { start: number; end: number } | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !el.contains(sel.anchorNode)) return null
  const anchor = sel.anchorNode
  const focus = sel.focusNode
  const offsetOf = (node: Node, off: number): number => {
    let total = 0
    const walkInto = (n: Node): number => {
      for (const c of Array.from(n.childNodes)) {
        if (c === node) return total + off
        if (c.contains(node)) { const r = walkInto(c); if (r >= 0) return r }
        total += (c.textContent || '').length
      }
      return -1
    }
    return walkInto(el)
  }
  const start = offsetOf(anchor, sel.anchorOffset)
  const end = focus ? offsetOf(focus, sel.focusOffset) : start
  if (start < 0 || end < 0) return null
  return { start: Math.min(start, end), end: Math.max(start, end) }
}
const setRichSelOffsets = (el: HTMLElement, start: number, end: number) => {
  const sel = window.getSelection()
  if (!sel) return
  // 在文本节点树中找 [start,end) 的锚点
  let off = 0
  let sn: Node | null = null, so = 0, en: Node | null = null, eo = 0
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.textContent!.length
      if (sn === null && off + len > start) { sn = n; so = Math.max(0, start - off) }
      if (en === null && off + len >= end) { en = n; eo = Math.max(0, end - off) }
      off += len
    } else {
      for (const c of Array.from(n.childNodes)) walk(c)
    }
  }
  walk(el)
  if (!sn || !en) return
  try {
    const range = document.createRange()
    range.setStart(sn, so)
    range.setEnd(en, eo)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch { /* 忽略异常偏移 */ }
}
const RichField = ({ paras, plain, className, style, placeholder, onFocus, onInput, renderKey, field }: {
  paras?: TextPara[]; plain: string; className?: string; style?: React.CSSProperties
  placeholder?: string; onFocus?: () => void; onInput?: (paras: TextPara[] | null) => void
  renderKey: string; field: 'title' | 'content'
}) => {
  const ref = useRef<HTMLDivElement | null>(null)
  // 上一次渲染的 paras 引用 —— 变化时重写 DOM（选区命令路径）
  const lastParasRef = useRef<TextPara[] | undefined>(undefined)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const html = paras && paras.length
      ? parasToHTML(paras, field, {})
      : (plain || '')
    // 输入焦点在本元素时：保留选区重写（命令更新 paras 的主路径）；
    // 非聚焦（换页/外部）直接重写
    if (document.activeElement === el) {
      const saved = richSelOffsets(el)
      el.innerHTML = html
      if (saved) setRichSelOffsets(el, saved.start, saved.end)
    } else {
      el.innerHTML = html
    }
    lastParasRef.current = paras
  }, [paras, plain, renderKey])
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-richfield={field}
      data-ph={placeholder}
      className={className}
      style={{ ...style, outline: 'none', background: 'transparent', minHeight: '1em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      onFocus={() => onFocus?.()}
      onInput={() => {
        const el = ref.current
        if (!el) return
        const text = el.innerText
        if (!text.trim()) { onInput?.(null); return }
        onInput?.(extractParas(el))
      }}
    />
  )
}

// round72：带项目符号/编号的多行文本展示（bullet/numbered 只在展示层渲染符号，
// 编辑仍在 textarea/input 中进行 —— 对齐 MS PPT 的占位符语义）
const BulletText = ({ text, numbered, bullet }: { text: string; numbered?: boolean; bullet?: boolean }) => {
  if (!numbered && !bullet) return null
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-center" style={{ opacity: 0 }}>
      {text.split('\n').map((line, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <span style={{ flex: '0 0 auto' }}>{numbered ? `${i + 1}.` : '•'}</span>
          <span style={{ flex: 1 }}>{line || ' '}</span>
        </div>
      ))}
    </div>
  )
}

const SlideThumb = memo(function SlideThumb({ slide, width, aspect = 454 / 808, deco }: { slide: Slide; width: number; aspect?: number; deco?: ShapeItem[] }) {
  const K = width / 808
  const isDark = slide.bg === '#1e293b' || slide.bg === '#312e81'
  return (
    <div style={{ width, height: Math.round(width * aspect), overflow: 'hidden', position: 'relative', background: slide.bg, flex: '0 0 auto' }}>
      {/* round58：背景纹理图（bgRef → 主题 blipFill + duotone，multiply 混合近似） */}
      {slide.bgImg && <div style={{ position: 'absolute', inset: 0, backgroundColor: slide.bg, ...bgImgStyle(slide.bgImg, slide.bgImgTileW, slide.bgImgTileH) }} />}
      <div style={{ width: 808, height: Math.round(808 * aspect), transform: `scale(${K})`, transformOrigin: 'top left', position: 'relative', color: isDark ? '#f1f5f9' : '#0f172a' }}>
        {/* round58：版式/母版装饰层（分隔线/圆点等非占位符形状） */}
        {(deco || []).map((msh, i) => {
          const isDecoPic = typeof msh.fill === 'string' && msh.fill.startsWith('url(')
          return (
            <div key={'d' + i} style={{
              position: 'absolute', left: msh.x / 8, top: msh.y / 8, width: msh.w / 8, height: msh.h / 8,
              transform: msh.rotation ? `rotate(${msh.rotation}deg)` : undefined,
              background: isDecoPic ? msh.fill : (msh.gradient ? `linear-gradient(135deg, #${msh.gradient.split(',')[0]}, #${msh.gradient.split(',')[1]})` : msh.fill),
              backgroundSize: isDecoPic ? 'cover' : undefined,
              clipPath: msh.type === 'roundRect' ? 'inset(0 round 8px)' : (SHAPE_CLIP[msh.type] || (msh.type === 'ellipse' ? 'ellipse(50% 50% at 50% 50%)' : undefined)),
              borderRadius: msh.type === 'ellipse' ? '50%' : undefined,
              border: msh.stroke ? `${Math.max(1, msh.strokeWidth || 1)}px solid ${msh.stroke}` : 'none',
              boxShadow: msh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
              overflow: 'hidden',
            }} />
          )
        })}
        {/* 无形状时展示 title/content（新建的版式幻灯片） */}
        {!slide.shapes.length && (
          <div style={{ position: 'absolute', inset: 0, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {slide.title && <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.12 }}>{slide.title}</div>}
            {slide.content && <div style={{ fontSize: 18, marginTop: 8, whiteSpace: 'pre-wrap', opacity: 0.85 }}>{slide.content}</div>}
          </div>
        )}
        {slide.shapes.map((sh, i) => {
          const isPic = typeof sh.fill === 'string' && sh.fill.startsWith('url(')
          const left = sh.x / 8, top = sh.y / 8, w = sh.w / 8, h = sh.h / 8
          if (isPic) {
            const m = sh.fill.match(/^url\(\s*["']?(.*?)["']?\s*\)$/)
            return <img key={i} src={m ? m[1] : ''} alt="" style={{ position: 'absolute', left, top, width: w, height: h, objectFit: 'cover' }} />
          }
          const bg = sh.gradient
            ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})`
            : sh.fill
          const hasParas = !!(sh.paras && sh.paras.some(p => p.runs && p.runs.length))
          return (
            <div key={i} style={{
              position: 'absolute', left, top, width: w, height: h,
              display: 'flex', flexDirection: 'column',
              transform: sh.rotation ? `rotate(${sh.rotation}deg)` : undefined,
              alignItems: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
              justifyContent: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
              textAlign: (sh.textAlign || 'left') as any,
              padding: 6, overflow: 'hidden',
              background: bg,
              backgroundSize: bg.startsWith('url') ? 'cover' : undefined,
              backgroundRepeat: bg.startsWith('url') ? 'no-repeat' : undefined,
              backgroundPosition: bg.startsWith('url') ? 'center' : undefined,
              clipPath: sh.type === 'roundRect' ? 'inset(0 round 8px)' : (SHAPE_CLIP[sh.type] || (sh.type === 'ellipse' ? 'ellipse(50% 50% at 50% 50%)' : undefined)),
              borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : undefined,
              border: sh.stroke
                ? `${Math.max(1, sh.strokeWidth || 1)}px solid ${sh.stroke}`
                : (sh.noDecor ? 'none' : (sh.type === 'rect' || sh.type === 'roundRect' ? '1px solid rgba(0,0,0,0.1)' : 'none')),
              boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
              filter: sh.glow ? `drop-shadow(0 0 ${Math.min(28, Math.max(4, (sh.glowRadius || 60000) / 5000))}px ${sh.glowColor || (sh.fill && !sh.fill.startsWith('url') ? sh.fill : '#818cf8')})` : 'none',
              color: sh.fontColor || (sh.fill && !sh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
              fontSize: sh.fontSize ? `${sh.fontSize}px` : '12px',
              fontFamily: sh.font || undefined,
              fontWeight: sh.fontBold ? 700 : 400,
              lineHeight: sh.lineHeight || 1.2,
              paddingLeft: sh.indent ? `${sh.indent * 12}px` : undefined,
            }}>
              {hasParas ? sh.paras!.map((p, pi) => (
                <div key={pi} style={{ width: '100%', display: (p as any).bullet ? 'flex' : undefined, gap: (p as any).bullet ? 10 : undefined, textAlign: ((p as any).bullet ? undefined : (p.align === 'c' ? 'center' : p.align === 'r' ? 'right' : 'left')) as any }}>
                  {(p as any).bullet && <span style={{ color: (p as any).bulletColor || undefined, flex: '0 0 auto' }}>{(p as any).bulletChar || '•'}</span>}
                  <span key={'rw' + pi} style={{ display: (p as any).bullet ? 'block' : undefined, flex: (p as any).bullet ? 1 : undefined, textAlign: (p as any).bullet ? ((p as any).align === 'c' ? 'center' : (p as any).align === 'r' ? 'right' : 'left') as any : undefined }}>
                  {(p.runs && p.runs.length ? p.runs : [{ text: '' } as any]).map((r, ri) => (
                    <span key={ri} style={{
                      color: r.color || undefined,
                      fontSize: r.fontSize ? `${Math.max(4, r.fontSize)}px` : undefined,
                      fontWeight: r.bold ? 700 : undefined,
                      fontStyle: r.italic ? 'italic' : undefined,
                      textDecoration: r.underline ? 'underline' : undefined,
                      fontFamily: r.font || undefined,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>{r.text}</span>
                  ))}
                  </span>
                </div>
              )) : (sh.text ? (
                sh.bullet
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6, width: '100%' }}><span>•</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : sh.numbered
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6, width: '100%' }}><span>{li + 1}.</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block', width: '100%', textShadow: sh.fill && !sh.fill.startsWith('url') ? '0 1px 2px rgba(0,0,0,0.3)' : 'none' }}>{sh.text}</span>
              ) : null)}
            </div>
          )
        })}
        {slide.artTexts.map((at, i) => (
          <div key={'a' + i} style={{ position: 'absolute', left: at.x / 8, top: at.y / 8, color: at.color, fontWeight: 700, fontSize: at.fontSize / 2.5, textAlign: 'center', maxWidth: at.w / 8, lineHeight: 1.05,
            background: at.gradient ? `linear-gradient(135deg, #${at.gradient.split(',')[0]}, #${at.gradient.split(',')[1]})` : undefined,
            WebkitBackgroundClip: at.gradient ? 'text' : undefined,
            WebkitTextFillColor: at.gradient ? 'transparent' : undefined,
            textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none',
            filter: at.glow ? `drop-shadow(0 0 6px ${at.color})` : 'none',
            WebkitTextStroke: at.outline ? `1px #${at.outline}` : 'none',
            transform: at.rotation ? `rotate(${at.rotation}deg)` : undefined }}>
            {at.text}
          </div>
        ))}
      </div>
    </div>
  )
})

function RibbonButton({ icon, label, onClick, active, disabled, title, ...rest }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} {...rest}
      className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-md transition-colors min-w-[44px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '15px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}
function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r ribbon-group" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}
function MenuItem({ label, icon, onClick, disabled, danger }: any) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40"
      style={{ color: danger ? '#e11d48' : 'var(--color-text)', background: 'transparent' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

export function SlideEditor({ initialSlides, onSlidesChange }: { initialSlides?: SlideData[]; onSlidesChange?: (slides: SlideData[]) => void }) {
  const { t, tf } = useI18n()

  // round73：占位符富文本 paras（sizePt EMU→画布 px 换算；spc/样式直存）
  // 与 emuShapesToItems 的 run 换算一致（ptToPx = pt·914400·808/(72·pageW)）
  const fieldParasFromData = (src: any, pageW: number): TextPara[] | undefined => {
    if (!Array.isArray(src) || !src.length) return undefined
    const ptToPx = (pt: number) => Math.round(pt * 914400 * 808 / (72 * pageW))
    return src.map((p: any) => ({
      align: p.align,
      bullet: !!p.bullet,
      numbered: !!p.numbered,
      runs: autoSpaceRuns((p.runs || []).map((r: any) => ({
        text: r.text || '',
        color: r.color,
        fontSize: r.sizePt ? ptToPx(r.sizePt) : undefined,
        bold: r.bold,
        italic: r.italic,
        underline: r.underline,
        strike: r.strike,
        font: r.font,
        spc: r.spc,
      }))),
    }))
  }

  // 将真实 PPTX 解析出的 EMU 形状转换为内部 ShapeItem（等比坐标系：宽 6464 单位，高随页比例）
  const emuShapesToItems = (shapes?: SlideShape[], pageW = 12192000, pageH = 6858000): ShapeItem[] => {
    if (!shapes || !shapes.length) return []
    const SX = 6464 / pageW // 808px 宽 = 6464 单位 (x/8)；等比坐标 x/y 同尺度
    // 字号 pt → 画布 px（与几何同比例）
    const ptToPx = (pt: number) => Math.round(pt * 914400 * 808 / (72 * pageW))
    // PPTX prstGeom → 内部形状类型（含流程图形状，与 SHAPE_CLIP/prstGeom 写盘映射对应）
    const GEOM_MAP: Record<string, string> = {
      ellipse: 'ellipse', roundRect: 'roundRect', triangle: 'triangle',
      diamond: 'diamond', rightArrow: 'rightArrow', star5: 'star5',
      hexagon: 'hexagon', pentagon: 'pentagon', heart: 'heart',
      cloud: 'cloud', wedgeRectCallout: 'callout',
      // 流程图
      parallelogram: 'parallelogram', trapezoid: 'trapezoid', can: 'can',
      flowChartDocument: 'flowDoc', chevron: 'chevron', lightningBolt: 'lightning',
      flowChartManualInput: 'flowManualInput', flowChartDelay: 'flowDelay',
      flowChartMerge: 'flowMerge', flowChartOffpageConnector: 'flowOffpage',
      leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow',
      leftRightArrow: 'leftRightArrow', upDownArrow: 'upDownArrow', bentArrow: 'bentArrow',
      notchedRightArrow: 'rightArrow', // SmartArt 流程箭头（round32）：先退化右箭头保证可见

    }
    return shapes.map((s) => {
      const isPic = s.kind === 'pic'
      const fill = isPic && s.img ? `url("${s.img}")` : (s.fill || '')
      const paras = (s.paras || []).map((p) => ({
        align: p.align,
        // round58：段落级项目符号（母版样式继承 —— 橙色圆点）
        bullet: !!(p as any).bullet,
        bulletChar: (p as any).bulletChar,
        bulletColor: (p as any).bulletColor,
        numbered: !!(p as any).numbered,
        runs: autoSpaceRuns((p.runs || []).map((r) => ({
          text: r.text || '',
          color: r.color,
          fontSize: r.sizePt ? ptToPx(r.sizePt) : undefined,
          bold: r.bold,
          italic: r.italic,
          underline: r.underline,
          font: r.font,
        }))),
      }))
      // round58：line 几何 —— 细长 rect 用描边渲染（填充空、border=线色）
      const isLine = s.geom === 'line' || s.geom === 'straightConnector1'
      return {
        type: isPic ? 'rect' : (isLine ? 'rect' : (GEOM_MAP[s.geom || ''] || 'rect')),
        x: (s.x || 0) * SX,
        y: (s.y || 0) * SX,
        w: (s.cx || 0) * SX,
        h: (s.cy || 0) * SX,
        fill: isLine ? '' : fill,
        stroke: isLine ? (s.lineColor || s.fill || '#000000') : (s.lineColor || undefined),
        strokeWidth: isLine ? Math.max(1, s.lineWpt || 1) : (s.lineWpt || undefined),
        text: isPic ? '' : (s.text || ''),
        shadow: !!s.shadow,
        glow: !!s.glow,
        glowColor: s.glowColor || undefined,
        gradient: s.gradient || '',
        rotation: s.rotation || 0,
        fontSize: s.sizePt ? ptToPx(s.sizePt) : undefined,
        fontBold: !!s.bold,
        fontColor: s.color || undefined,
        font: s.font || undefined,
        textAlign: s.align === 'l' ? 'left' : s.align === 'r' ? 'right' : s.align === 'c' ? 'center' : 'left',
        vAlign: s.vanchor === 't' ? 'top' : s.vanchor === 'b' ? 'bottom' : s.vanchor === 'ctr' ? 'middle' : undefined,
        paras: paras.length ? paras : undefined,
        noDecor: true,
        bullet: !!s.bullet,
        numbered: !!s.numbered,
        // round58：行距 —— MS 对 CJK 的单倍行距渲染 ≈1.25em（字体内 leading），
        // 浏览器 normal ≈1.15 偏密（VLM 终审"行距过紧/字号偏小"观感）
        lineHeight: s.lineHeight && s.lineHeight !== 1 ? s.lineHeight : 1.25,
        indent: s.indent || undefined,
        link: s.link || undefined,
        groupId: s.groupId || undefined,
      }
    })
  }
  const LAYOUTS = useMemo(() => LAYOUT_DEFS.map(l => ({ ...l, name: t(`slide.layout.${l.id}`) })), [t])
  const PRESET_COLORS = useMemo(() => PRESET_COLOR_DEFS.map((v, i) => ({ value: v, name: t(['color.white','color.lightGray','color.beige','color.skyBlue','color.mint','color.pink','color.darkGray','color.indigo'][i]) })), [t])
  const TRANSITIONS = useMemo(() => TRANSITION_DEFS.map(id => ({ id, name: id === '' ? t('transition.none') : t(`transition.${id === 'cut' ? 'switch' : id}`) })), [t])
  const SHAPES = useMemo(() => SHAPE_DEFS.map(s => ({ ...s, name: t(`slide.shape.${s.type === 'roundRect' ? 'rounded' : s.type === 'rightArrow' ? 'arrow' : s.type === 'star5' ? 'star' : s.type}`) })), [t])
  const ENTRANCE_ANIMS = useMemo(() => ENTRANCE_ANIM_DEFS.map(e => ({ effect: e, name: e === 'fade' ? t('anim.fadeIn') : e === 'fly' ? t('anim.flyIn') : e === 'zoom' ? t('anim.zoom') : e === 'wipe' ? t('anim.wipe') : t('anim.bounce') })), [t])
  const EMPHASIS_ANIMS = useMemo(() => EMPHASIS_ANIM_DEFS.map(e => ({ effect: e, name: e === 'pulse' ? t('anim.pulse') : t('anim.spin') })), [t])
  const EXIT_ANIMS = useMemo(() => EXIT_ANIM_DEFS.map((e, i) => ({ effect: e, name: e === 'fade' ? t('anim.fadeOut') : e === 'fly' ? t('anim.flyOut') : t('anim.shrink') })), [t])
  const ART_PRESETS = useMemo(() => ART_PRESET_DEFS.map((p, i) => ({ name: t(['art.purple','art.blue','art.green','art.orange','art.red','art.white'][i]), color: p.color, gradient: (p as any).gradient || '', shadow: !!(p as any).shadow, glow: !!(p as any).glow, outline: (p as any).outline || '' })), [t])

  const [slides, setSlides] = useState<Slide[]>(() => {
    if (initialSlides && initialSlides.length) {
      // round58：背景纹理图共享（openroute 只随首页传，其余页引用同串）
      const firstBgImgSlide = initialSlides.find(x => (x as any).bgImg) as any
      const firstBgImg: string | undefined = firstBgImgSlide?.bgImg
      return initialSlides.map((s, i) => {
        const pageW = (s.pageW && s.pageW > 0 ? s.pageW : 12192000) as number
        const pageH = (s.pageH && s.pageH > 0 ? s.pageH : 6858000) as number
        return {
          id: i + 1,
          title: s.title || (i === 0 ? t('slide.titleDefault') : t('slide.contentSlide')),
          content: s.content || (i === 0 ? t('slide.subtitleDefault') : t('slide.contentPlaceholder')),
          bg: s.bg || '#ffffff',
          bgImg: (s as any).bgImg || firstBgImg,
          bgImgTileW: (s as any).bgImgTileW,
          bgImgTileH: (s as any).bgImgTileH,
          deco: emuShapesToItems((s as any).masterShapes, pageW, pageH),
          layout: 'blank', // 文件打开的幻灯片全部内容都在 shapes 里，用 blank 布局避免默认标题/正文输入框与形状层重叠
          transition: (s as any).transition || (i === 0 ? 'fade' : ''),
          notes: s.notes || '',
          // round71：还原标题/正文文字样式（写盘端 slidesToData 同名字段透传）
          titleStyle: (s as any).titleStyle,
          contentStyle: (s as any).contentStyle,
          // round73：还原选定文字富文本（sizePt→画布 px 与 shape paras 同换算；
          // spc 为 pt×100 直存）
          titleParas: fieldParasFromData((s as any).titleParas, pageW),
          contentParas: fieldParasFromData((s as any).contentParas, pageW),
          shapes: emuShapesToItems(s.shapes, pageW, pageH),
          artTexts: [],
          animations: [],
        }
      })
    }
    return [
      { id: 1, title: t('slide.titleDefault'), content: t('slide.subtitleDefault'), bg: '#ffffff', layout: 'title', transition: 'fade', notes: '', shapes: [], artTexts: [], animations: [] },
      { id: 2, title: t('slide.contentSlide'), content: t('slide.contentPlaceholder'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] },
    ]
  })
  const [active, setActive] = useState(0)

  // round57：幻灯片浏览视图（概览网格）
  const [browseMode, setBrowseMode] = useState(false)
  // round57：PPT 打印视图构建（打印预览 / 实际打印共用）—— 从 renderPreview 原样抽出。
  // renderPrint 始终提供：实际打印走纸张卡流（每版 slidesPerPage 张 + zoom 校准 + 分卡分页），
  // 修复此前实际打印永远只打当前画布（MS PPT 默认打印全部幻灯片）。
  const buildPptPrintView = (settings: any): React.ReactNode => {
          const per = settings.slidesPerPage || 1
          const showNotes = settings.pptContent === 'notes'
          const showOutline = settings.pptContent === 'outline'
          // 网格列数（对标 MS PPT 讲义布局：2→1列, 3→3列, 4→2列, 6→3列, 9→3列）
          const cols = per <= 1 ? 1 : per === 2 ? 1 : per === 3 ? 3 : per === 4 ? 2 : per === 6 ? 3 : 3
          // 单张幻灯片缩略图缩放比（画布 808 宽 → 纸张格宽，见下方 K2）
          // 单张幻灯片缩略图（复用 SlideThumb，与主画布/左侧面板一致的真实渲染）
          const aspect = deckH / deckW

          if (showNotes) {
            return (
              <div className="space-y-2">
                {slides.map((s, i) => (
                  <div key={i} className="p-2 border rounded" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{s.title || `Slide ${i + 1}`}</div>
                    <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text-muted)' }}>{s.notes || '—'}</div>
                  </div>
                ))}
              </div>
            )
          }
          if (showOutline) {
            return (
              <div className="space-y-1">
                {slides.map((s, i) => (
                  <div key={i} className="text-xs" style={{ color: 'var(--color-text)' }}>{i + 1}. {s.title || `Slide ${i + 1}`}</div>
                ))}
              </div>
            )
          }

          // 每页纸排 per 张，多页纸纵向堆叠（对标 MS PPT 讲义视图）
          // round55：纸张卡片按【真实纸张】尺寸渲染（PAPER_SIZES × 方向 × 1.5 预览
          // 缩放 + settings.margins 边距）—— 之前是固定 padding 的小卡片，纸张
          // 大小/横竖切换对预览毫无作用（用户报告：打印预览按钮全无效）。
          // round56：页码范围「当前页」→ 只预览当前幻灯片（MS PPT 打印当前幻灯片）
          const pslides = (settings.pageRange === 'current' || settings.pageRange === 'selection') && slides[active] ? [slides[active]] : slides
          const papers: Slide[][] = []
          for (let i = 0; i < pslides.length; i += per) papers.push(pslides.slice(i, i + per))
          const paper = PAPER_SIZES[settings.paperSize] || PAPER_SIZES.A4
          const pageWpx = (settings.orientation === 'landscape' ? paper.h : paper.w) * 1.5
          const pageHpx = (settings.orientation === 'landscape' ? paper.w : paper.h) * 1.5
          const pad = `${settings.margins.top * 1.5}px ${settings.margins.right * 1.5}px ${settings.margins.bottom * 1.5}px ${settings.margins.left * 1.5}px`
          const cellW = (pageWpx - (settings.margins.left + settings.margins.right) * 1.5) / cols
          const thumbW = Math.max(40, cellW - 8)
          const K2 = thumbW / 808
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '8px 0 16px' }}>
              {papers.map((paperSlides, pi) => (
                <div key={pi} className="print-paper" style={{ width: pageWpx, minHeight: pageHpx, background: '#fff', boxShadow: '0 4px 16px rgba(15,23,42,0.18)', padding: pad, boxSizing: 'border-box', position: 'relative' }}>
                  {/* round66：讲义母版四要素（页眉/页脚/日期/页码 —— 讲义母版视图编辑，
                      打印讲义时应用到每张纸的页缘；与 MS PPT 讲义打印一致） */}
                  <div data-testid="handout-print-dt" style={{ position: 'absolute', left: 10, top: 4, fontSize: handout.fontSize, color: handout.color }}>{handout.date}</div>
                  <div data-testid="handout-print-hdr" style={{ position: 'absolute', right: 10, top: 4, fontSize: handout.fontSize, color: handout.color }}>{handout.header}</div>
                  <div data-testid="handout-print-ftr" style={{ position: 'absolute', left: 10, bottom: 4, fontSize: handout.fontSize, color: handout.color }}>{handout.footer}</div>
                  {handout.pageOn && <div data-testid="handout-print-num" style={{ position: 'absolute', right: 10, bottom: 4, fontSize: handout.fontSize, color: handout.color }}>{pi + 1}</div>}
                  <div className="flex flex-wrap justify-center items-start" style={{ gap: 8 }}>
                    {paperSlides.map((s, i) => <SlideThumb key={i} slide={s} deco={s.deco} width={thumbW} aspect={aspect} />)}
                    {Array.from({ length: per - paperSlides.length }).map((_, k) => (
                      <div key={'e' + k} style={{ width: thumbW, height: (808 * aspect) * K2, flex: '0 0 auto' }} />
                    ))}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 10, color: '#94a3b8', marginTop: 6 }}>- {pi + 1} -</div>
                </div>
              ))}
            </div>
          )
  }

  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  // Ribbon 折叠（对齐 MS Office：仅保留选项卡栏；三编辑器共享同一持久化键）
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sam-ribbon-collapsed') === '1' } catch { return false }
  })
  const setRibbonCollapsedPersist = (v: boolean) => { try { localStorage.setItem('sam-ribbon-collapsed', v ? '1' : '0') } catch { /* ignore */ }; setRibbonCollapsed(v) }
  // === 母版（对齐 MS PPT 母版视图）：母版形状层随首页 slide 数据解析；
  // 母版视图下画布编辑母版形状；普通视图下母版形状作为装饰底层渲染（不可选中）。
  const [masterShapes, setMasterShapes] = useState<ShapeItem[]>(() => {
    const first = (initialSlides && initialSlides[0]) as any
    return emuShapesToItems(first?.masterShapes, first?.pageW || 12192000, first?.pageH || 6858000)
  })
  const [masterView, setMasterView] = useState(false)
  // round66：讲义母版（对齐 MS PPT 讲义母版视图）：页眉/页脚/日期/页码四占位符。
  // 状态随 deck 持有（打印讲义时应用）；初始从 initialSlides[0].handoutMaster 恢复（保存往返）。
  const [handoutView, setHandoutView] = useState(false)
  const [handout, setHandout] = useState<HandoutMaster>(() => {
    const first = (initialSlides && initialSlides[0]) as any
    return normalizeHandout(first?.handoutMaster)
  })
  // 幻灯片页面尺寸（EMU）——设计选项卡的宽屏/标准/自定义真实生效
  const [deckW, setDeckW] = useState(() => {
    const first = (initialSlides && initialSlides[0]) as any
    return first?.pageW && first.pageW > 0 ? Number(first.pageW) : DECK_W_169
  })
  const [deckH, setDeckH] = useState(() => {
    const first = (initialSlides && initialSlides[0]) as any
    return first?.pageH && first.pageH > 0 ? Number(first.pageH) : DECK_H_169
  })
  const [zoom, setZoom] = useState(100)
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoPlaySec, setAutoPlaySec] = useState(5)
  const [presenting, setPresenting] = useState(false)
  const [presentSlide, setPresentSlide] = useState(0)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showAnimPanel, setShowAnimPanel] = useState(false)
  const [pendingSound, setPendingSound] = useState<string>('none')
  const [showArtPanel, setShowArtPanel] = useState(false)
  const [showChartPanel, setShowChartPanel] = useState(false)
  // 二级颜色弹出菜单 — 统一 click 触发，避免 hover 残留导致重叠
  const [showColorPopup, setShowColorPopup] = useState(false)
  // round71：色板 hex 输入草稿（48 色块 + 自定义色输入）
  const [colorHexDraft, setColorHexDraft] = useState('#000000')
  const [showInsertSlide, setShowInsertSlide] = useState(false)
  // 弹出面板互斥：同时只允许一个面板打开，避免多个弹出菜单重叠
  type PanelName = 'shape' | 'anim' | 'art' | 'color' | 'chart'
  const openPanel = (which: PanelName) => {
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowAnimPanel(which === 'anim' ? !showAnimPanel : false)
    setShowArtPanel(which === 'art' ? !showArtPanel : false)
    setShowColorPopup(which === 'color' ? !showColorPopup : false)
    setShowChartPanel(which === 'chart' ? !showChartPanel : false)
  }
  const closeAllPanels = () => { setShowShapePanel(false); setShowAnimPanel(false); setShowArtPanel(false); setShowColorPopup(false); setShowInsertSlide(false); setShowChartPanel(false) }
  const anyPanelOpen = showShapePanel || showAnimPanel || showArtPanel || showColorPopup || showInsertSlide || showChartPanel
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  // 多选权威集合：selectedEls 为全部选中成员，selectedEl 恒为主选（集合最后一个），
  // 供字体/颜色等只认单选的面板沿用。单选入口 setSelectedEl 同步清空多选集合。
  const [selectedEl, _setSelectedElRaw] = useState<SelEl | null>(null)
  const [selectedEls, setSelectedEls] = useState<SelEl[]>([])
  const setSelectedEl = (sel: SelEl | null) => {
    _setSelectedElRaw(sel)
    setSelectedEls(sel ? [sel] : [])
  }
  const [dragInfo, setDragInfo] = useState<{ startX: number; startY: number; origX: number; origY: number; mode: 'move' | 'resize' | 'rotate'; items?: { type: 'shape' | 'art'; index: number; x: number; y: number }[] } | null>(null)
  // 右键上下文菜单 + 剪切板（对标 MS PPT 元素右键菜单）
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'shape' | 'art'; index: number } | null>(null)
  const clipboardRef = useRef<{ type: 'shape' | 'art'; data: ShapeItem | ArtTextItem } | null>(null)
  // 文本内联编辑（双击元素编辑文字，对标 MS PPT）
  const [editing, setEditing] = useState<{ type: 'shape' | 'art'; index: number } | null>(null)
  const editAreaRef = useRef<HTMLTextAreaElement | null>(null)
  // round71：标题/正文输入框焦点跟踪 —— 三控件（颜色/字号/字体）对"正在编辑的
  // 标题或正文"生效的依据。点画布空白清空（颜色作用于 shape 的旧语义保留）。
  const [focusField, setFocusField] = useState<'title' | 'content' | null>(null)
  // 最新 slides 镜像，供历史栈与快捷键读取，避免闭包陈旧导致撤销无效
  const slidesRef = useRef(slides)
  slidesRef.current = slides

  // 缩略图宽度：面板 w-40(160px)/lg:w-48(192px)，扣除内边距与边框后实际内容宽 144/176
  const [thumbWidth, setThumbWidth] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches ? 176 : 144))
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const fn = (e: MediaQueryListEvent) => setThumbWidth(e.matches ? 176 : 144)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  // 撤销/重做历史栈
  const [past, setPast] = useState<Slide[][]>([])
  const [future, setFuture] = useState<Slide[][]>([])
  // 文本输入合并：连续击键（<800ms 间隔）只压栈一次，undo 一次回退整段输入
  const lastTextRecordTs = useRef(0)
  // 注意：必须在调用时同步捕获快照。setPast 的 updater 是在渲染期才执行的，
  // 若此时同批次已并入新的 slides 更新，slidesRef.current 会读到“未来”的状态，
  // 导致拖拽撤销只回退半步。同步取值保证快照 = 动作发生前的状态。
  const recordHistory = () => {
    lastTextRecordTs.current = 0
    const snap = slidesRef.current
    setPast(p => [...p, snap])
    setFuture([])
  }
  const recordTextHistory = () => {
    const now = Date.now()
    if (now - lastTextRecordTs.current > 800) recordHistory()
    lastTextRecordTs.current = now
  }
  // 拖拽压栈标记：首次实际移动时压栈（避免纯点选产生冗余历史）
  const dragRecordedRef = useRef(false)
  const undo = () => {
    if (!past.length) return
    const prev = past[past.length - 1]
    const cur = slidesRef.current
    setPast(p => p.slice(0, -1))
    setFuture(f => [cur, ...f])
    setSlides(prev)
  }
  const redo = () => {
    if (!future.length) return
    const next = future[0]
    const cur = slidesRef.current
    setFuture(f => f.slice(1))
    setPast(p => [...p, cur])
    setSlides(next)
  }

  const insertSlide = (at: number, layout: 'title' | 'section' | 'blank' | 'content') => {
    recordHistory()
    const n = slides.length + 1
    let slide: Slide
    if (layout === 'title') {
      slide = { id: Date.now(), title: t('slide.titleSlide'), content: t('slide.subtitleHere'), bg: '#1e293b', layout: 'title', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else if (layout === 'section') {
      slide = { id: Date.now(), title: t('slide.sectionSlide'), content: '', bg: '#312e81', layout: 'section', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else if (layout === 'blank') {
      slide = { id: Date.now(), title: t('slide.slideN', { n }), content: '', bg: '#ffffff', layout: 'blank', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else {
      slide = { id: Date.now(), title: t('slide.slideN', { n }), content: t('slide.addContentHere'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    }
    setSlides(s => { const next = [...s]; next.splice(at + 1, 0, slide); return next })
    setActive(at + 1)
    setShowInsertSlide(false)
  }
  const addSlide = () => insertSlide(slides.length - 1, 'content')
  const deleteSlide = (idx: number) => { if (slides.length <= 1) return; recordHistory(); setSlides(s => s.filter((_, i) => i !== idx)); if (active >= idx && active > 0) setActive(active - 1) }
  const duplicateSlide = (idx: number) => { recordHistory(); setSlides(s => { const copy = { ...s[idx], id: Date.now() }; const next = [...s]; next.splice(idx + 1, 0, copy); return next }); setActive(idx + 1) }
  const updateActive = (patch: Partial<Slide>, record = true) => {
    // 母版视图：形状变更重定向到母版层（对齐 MS PPT 母版编辑语义）
    if (masterView && patch.shapes !== undefined) { if (record) recordHistory(); setMasterShapes(patch.shapes as ShapeItem[]); return }
    if (masterView && patch.bg !== undefined) { return } // 母版背景暂不编辑，避免与页面背景混淆
    if (record) {
      // 纯文本字段（标题/正文/备注）的连续编辑合并为一个撤销块
      const keys = Object.keys(patch)
      const textOnly = keys.length > 0 && keys.every(k => k === 'title' || k === 'content' || k === 'notes')
      if (textOnly) recordTextHistory(); else recordHistory()
    }
    setSlides(s => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  }
  const switchSlide = (i: number) => { if (i === active) return; setActive(i) }
  // 母版视图下画布操作对象：形状层指向 masterShapes（复用全部形状编辑/拖拽/右键逻辑）
  const currentBase = slides[active] || slides[0]
  const current = masterView
    ? { ...currentBase, shapes: masterShapes, layout: 'blank' as const, animations: [] }
    : currentBase
  const isDark = current.bg === '#1e293b' || current.bg === '#312e81'
  // 画布像素高度：宽 808 固定，高随页面比例（等比坐标系）
  const canvasH = Math.round(808 * (deckH / deckW))

  // 把内部 Slide[]（px 坐标）转换为可保存的 SlideData[]（EMU 坐标），供 App 保存 pptx
  const slidesToData = useMemo(() => {
    // 等比坐标：x/y 同尺度（units = EMU·6464/deckW），与 emuShapesToItems 互逆
    const PAGE_W = deckW
    const PAGE_H = deckH
    const SX = PAGE_W / 6464
    const toEMUx = (px: number) => Math.round(px * SX)
    const toEMUy = (py: number) => Math.round(py * SX)
    return (src: Slide[]): SlideData[] => src.map((s, i) => {
      const shapes: SlideShape[] = []
      for (const sh of s.shapes) {
        const isPic = typeof sh.fill === 'string' && sh.fill.startsWith('url(')
        let img: string | undefined
        if (isPic) {
          const m = sh.fill.match(/^url\(\s*["']?(.*?)["']?\s*\)$/)
          img = m ? m[1] : undefined
        }
        shapes.push({
          kind: isPic ? 'pic' : 'text',
          type: sh.type,
          x: toEMUx(sh.x),
          y: toEMUy(sh.y),
          cx: toEMUx(sh.w),
          cy: toEMUy(sh.h),
          fill: isPic ? undefined : (sh.fill || ''),
          text: sh.text,
          color: sh.fontColor,
          font: sh.font,
          // 画布 px → 磅（与加载时的 ptToPx 互逆），修复以前直接把 px 当磅写回的问题
          sizePt: sh.fontSize ? Math.round(sh.fontSize * 72 * PAGE_W / (914400 * 808)) : undefined,
          bold: sh.fontBold,
          align: sh.textAlign === 'left' ? 'l' : sh.textAlign === 'right' ? 'r' : sh.textAlign === 'center' ? 'c' : 'l',
          vanchor: sh.vAlign === 'top' ? 't' : sh.vAlign === 'bottom' ? 'b' : 'ctr',
          img,
          gradient: sh.gradient || undefined,
          shadow: sh.shadow || undefined,
          glow: sh.glow || undefined,
          glowColor: sh.glowColor || undefined,
          rotation: sh.rotation || undefined,
          bullet: sh.bullet || undefined,
          numbered: sh.numbered || undefined,
          lineHeight: sh.lineHeight || undefined,
          indent: sh.indent || undefined,
          link: sh.link || undefined,
          groupId: sh.groupId || undefined,
          paras: sh.paras && sh.paras.length ? sh.paras.map(p => ({
            align: p.align,
            runs: (p.runs || []).map(r => ({
              text: r.text,
              color: r.color,
              sizePt: r.fontSize ? Math.round(r.fontSize * 72 * PAGE_W / (914400 * 808)) : undefined,
              bold: r.bold,
              italic: r.italic,
              underline: r.underline,
              font: r.font,
              // round73：删除线 + 字符间距（选定文字格式落盘）
              strike: (r as any).strike || undefined,
              spc: (r as any).spc != null ? Math.round((r as any).spc * 72 * PAGE_W / (914400 * 808)) : undefined,
            })),
          })) : undefined,
        })
      }
      // 艺术字也作为文本形状保存
      for (const art of s.artTexts) {
        shapes.push({
          kind: 'text',
          type: 'rect',
          x: toEMUx(art.x),
          y: toEMUy(art.y),
          cx: toEMUx(art.w),
          cy: toEMUy(art.h),
          fill: '',
          text: art.text,
          color: art.color,
          sizePt: art.fontSize,
          bold: true,
          align: 'c',
          vanchor: 'ctr',
        })
      }
      return {
        title: s.title,
        content: s.content,
        // round71：标题/正文文字样式随盘透传（读取端 353 行同名字段还原）
        titleStyle: (s as any).titleStyle || undefined,
        contentStyle: (s as any).contentStyle || undefined,
        // round73：选定文字富文本（runs 带 bold/italic/underline/strike/color/sizePt/font/spc）——
        // 写盘端占位符逐 run 写出；读取端还原回 titleParas/contentParas
        titleParas: (s as any).titleParas || undefined,
        contentParas: (s as any).contentParas || undefined,
        notes: s.notes,
        bg: s.bg,
        shapes,
        transition: s.transition || undefined,
        pageW: PAGE_W,
        pageH: PAGE_H,
        // 母版形状随首页写盘（对齐 MS PPT slideMaster spTree；写盘端 buildMasterXML 消费）
        masterShapes: i === 0 ? masterShapes.map((msh) => {
          const isPic = typeof msh.fill === 'string' && msh.fill.startsWith('url(')
          let img: string | undefined
          if (isPic) {
            const m = msh.fill.match(/^url\(\s*["']?(.*?)["']?\s*\)$/)
            img = m ? m[1] : undefined
          }
          return {
            kind: isPic ? 'pic' : 'text',
            type: msh.type,
            x: toEMUx(msh.x), y: toEMUy(msh.y), cx: toEMUx(msh.w), cy: toEMUy(msh.h),
            fill: isPic ? undefined : (msh.fill || ''),
            text: msh.text, color: msh.fontColor, font: msh.font,
            sizePt: msh.fontSize ? Math.round(msh.fontSize * 72 * PAGE_W / (914400 * 808)) : undefined,
            bold: msh.fontBold,
            italic: (msh as any).italic,
            align: msh.textAlign === 'left' ? 'l' : msh.textAlign === 'right' ? 'r' : msh.textAlign === 'center' ? 'c' : 'l',
            vanchor: msh.vAlign === 'top' ? 't' : msh.vAlign === 'bottom' ? 'b' : 'ctr',
            img,
            gradient: msh.gradient || undefined,
            rotation: msh.rotation || undefined,
          } as SlideShape
        }) : undefined,
        // round66：讲义母版随首页携带（页眉/页脚/日期/页码/字号/颜色 —— 保存往返）
        handoutMaster: i === 0 ? { ...handout } : undefined,
      }
    })
  }, [deckW, deckH, masterShapes, handout])

  // 幻灯片变化时回传给 App（用于保存）
  useEffect(() => {
    onSlidesChange?.(slidesToData(slides))
  }, [slides, onSlidesChange, slidesToData])

  // 形状操作（坐标均为画布逻辑单位：1px = PXU 单位）
  const addShape = (type: string) => {
    const newShape: ShapeItem = { type, x: (200 + Math.random()*100) * PXU, y: (200 + Math.random()*60) * PXU, w: 200 * PXU, h: 120 * PXU, fill: '#4f46e5', text: '', shadow: false, glow: false, gradient: '', rotation: 0 }
    updateActive({ shapes: [...current.shapes, newShape] })
    setShowShapePanel(false)
  }
  // 动画引用清理：删除形状/艺术字后，指向被删下标的条目移除，
  // 其余按最新下标重映射（shape_N / art_N → 新 N）
  const remapAnimsAfterDelete = (anims: AnimItem[], delShapes: Set<number>, delArts: Set<number>): AnimItem[] => {
    const shiftIdx = (idx: number, del: Set<number>) => {
      let ni = idx
      for (const d of del) {
        if (d === idx) return -1
        if (d < idx) ni--
      }
      return ni
    }
    const out: AnimItem[] = []
    for (const a of anims) {
      const ms = /^shape_(\d+)$/.exec(a.target)
      if (ms) {
        const ni = shiftIdx(parseInt(ms[1], 10), delShapes)
        if (ni >= 0) out.push({ ...a, target: `shape_${ni}` })
        continue
      }
      const ma = /^art_(\d+)$/.exec(a.target)
      if (ma) {
        const ni = shiftIdx(parseInt(ma[1], 10), delArts)
        if (ni >= 0) out.push({ ...a, target: `art_${ni}` })
        continue
      }
      out.push(a)
    }
    return out
  }
  // 删除元素后修正选中集合：被删成员移出，同类型下标 > idx 的左移；主选若被删则取集合末尾
  const adjustSelectionAfterRemoval = (type: 'shape' | 'art', idx: number) => {
    const remap = (els: SelEl[]) => els
      .filter(e => !(e.type === type && e.index === idx))
      .map(e => e.type === type && e.index > idx ? { ...e, index: e.index - 1 } : e)
    const base = selectedEls.length ? selectedEls : (selectedEl ? [selectedEl] : [])
    const next = remap(base)
    setSelectedEls(next)
    _setSelectedElRaw(next.length ? next[next.length - 1] : null)
  }
  const removeShape = (idx: number) => {
    updateActive({
      shapes: current.shapes.filter((_, i) => i !== idx),
      animations: remapAnimsAfterDelete(current.animations, new Set([idx]), new Set()),
    })
    adjustSelectionAfterRemoval('shape', idx)
  }
  const updateShape = (idx: number, patch: Partial<ShapeItem>, record = true) => {
    const newShapes = current.shapes.map((s, i) => i === idx ? { ...s, ...patch } : s)
    updateActive({ shapes: newShapes }, record)
  }

  // 把样式应用到形状：文件打开的形状文字样式存放在 paras 的每个 run 上，
  // 只改顶层属性会被 run 级样式覆盖（表现为工具栏按钮"无效"），
  // 因此同时同步所有 run / 段落对齐，保证所见即所得。
  type ShapeRun = NonNullable<ShapeItem['paras']>[number]['runs'][number]
  const styleShape = (idx: number, patch: Partial<ShapeItem>, runStyle?: (r: ShapeRun) => Partial<ShapeRun>, paraAlign?: string) => {
    const sh = current.shapes[idx]
    const next: Partial<ShapeItem> = { ...patch }
    if (sh.paras && sh.paras.length) {
      next.paras = sh.paras.map(p => ({
        ...p,
        align: paraAlign || p.align,
        runs: (p.runs || []).map(r => runStyle ? { ...r, ...runStyle(r) } : r),
      }))
    }
    updateShape(idx, next)
  }

  // 字号放大/缩小：同步顶层与所有 run（有 paras 的形状 run 级字号生效）
  // round73：RichField 有选区 → 只步进选定文字；仅聚焦 → 整段基线步进
  const bumpFontSize = (delta: number) => {
    const sel = richSelection()
    if (sel) {
      const paras = parasOfField(sel.field)
      // 选区内基准字号（首个相交 run）→ 步进
      let basePx: number | undefined
      let off = 0
      outer: for (const p of paras) for (const r of p.runs) {
        const rs = off, re = off + r.text.length
        off = re
        if (Math.min(re, sel.end) - Math.max(rs, sel.start) > 0 && r.fontSize) { basePx = r.fontSize; break outer }
      }
      const st = textStyleOf(sel.field)
      if (basePx === undefined) basePx = (st.fontSize ? ptToPxUI(st.fontSize) : undefined) || (sel.field === 'title' ? ptToPxUI(32) : ptToPxUI(18))
      const next = Math.max(6, basePx + delta)
      applyRunPatch(sel.field, sel, r => ({ fontSize: next }))
      return
    }
    if (focusField) {
      const key = focusField === 'title' ? 'titleStyle' : 'contentStyle'
      const cur = ((current as any)[key] || {}).fontSize || (focusField === 'title' ? 32 : 18)
      applyTextStyle(focusField, { fontSize: Math.max(8, cur + delta) })
      return
    }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'art') {
      const at = current.artTexts[selectedEl.index]
      updateArtText(selectedEl.index, { fontSize: Math.max(8, (at.fontSize || 36) + delta) })
      return
    }
    const sh = current.shapes[selectedEl.index]
    const patch: Partial<ShapeItem> = {}
    if (sh.fontSize) patch.fontSize = Math.max(6, sh.fontSize + delta)
    if (sh.paras && sh.paras.some(p => (p.runs || []).some(r => r.fontSize))) {
      patch.paras = sh.paras.map(p => ({ ...p, runs: (p.runs || []).map(r => ({ ...r, fontSize: r.fontSize ? Math.max(6, r.fontSize + delta) : r.fontSize })) }))
    } else if (!patch.fontSize) {
      patch.fontSize = Math.max(6, 16 + delta)
    }
    updateShape(selectedEl.index, patch)
  }
  // === 字号数字输入（对齐 MS PPT：可直接键入 pt 值回车生效）===
  // 画布 808px 对应页面宽 deckW(EMU)，shape.fontSize 存画布 px，艺术字 fontSize 存 pt 直存
  const pxToPtUI = (px: number) => Math.round(px * 72 * deckW / (914400 * 808))
  const ptToPxUI = (pt: number) => Math.max(6, Math.round(pt * 914400 * 808 / (72 * deckW)))
  // 当前选中元素的字号（pt 显示值）；未选择或混合字号时返回空串
  // round71：标题/正文聚焦时显示其 style 字号（无值给布局默认 pt：标题 32 / 正文 18）
  const activeFontSizePt = (() => {
    if (focusField) {
      const key = focusField === 'title' ? 'titleStyle' : 'contentStyle'
      const v = ((current as any)[key] || {}).fontSize
      return v ? String(Math.round(v)) : (focusField === 'title' ? '32' : '18')
    }
    if (!selectedEl) return ''
    if (selectedEl.type === 'art') {
      const at = current.artTexts[selectedEl.index]
      return at?.fontSize ? String(Math.round(at.fontSize)) : ''
    }
    const sh = current.shapes[selectedEl.index]
    if (!sh) return ''
    const sizes = new Set<number>()
    if (sh.fontSize) sizes.add(sh.fontSize)
    ;(sh.paras || []).forEach(p => (p.runs || []).forEach(r => { if (r.fontSize) sizes.add(r.fontSize) }))
    if (sizes.size === 1) return String(pxToPtUI([...sizes][0]))
    return ''
  })()
  // 将 pt 字号应用到选中元素（shape 同步顶层与全部 run，艺术字直存 pt）
  // round73：RichField 有选区 → 只改选定文字；仅聚焦 → 整段基线 style.fontSize
  const applyFontSizePt = (pt: number) => {
    const npt = Math.max(8, Math.min(400, Math.round(pt)))
    const sel = richSelection()
    if (sel) { setRunStyle(sel.field, { fontSize: ptToPxUI(npt) }); return }
    if (focusField) { applyTextStyle(focusField, { fontSize: npt }); return }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'art') { updateArtText(selectedEl.index, { fontSize: npt }); return }
    const sh = current.shapes[selectedEl.index]
    if (!sh) return
    const px = ptToPxUI(npt)
    const hasRunSizes = !!(sh.paras && sh.paras.some(p => (p.runs || []).some(r => r.fontSize)))
    const patch: Partial<ShapeItem> = {}
    if (hasRunSizes) {
      patch.paras = sh.paras!.map(p => ({ ...p, runs: (p.runs || []).map(r => ({ ...r, fontSize: r.fontSize ? px : r.fontSize })) }))
      if (sh.fontSize) patch.fontSize = px
    } else {
      patch.fontSize = px
    }
    updateShape(selectedEl.index, patch)
  }

  // ════ round71：三路文字样式（shape 文字 / 艺术字 / 标题·正文聚焦文本）════
  // 标题/正文聚焦时颜色/字号/字体/加粗直接写 titleStyle/contentStyle（主诉①③：
  // 旧版三控件只认 selectedEl=shape，对标题正文全部无效）。
  // round72：patch 扩展 bold/align/lineHeight/indent/bullet/numbered —— 全部
  // ribbon 文字命令对聚焦文本生效（旧版弹「请先选择元素」）。
  const applyTextStyle = (field: 'title' | 'content', patch: Partial<NonNullable<Slide['titleStyle']>>) => {
    const key = field === 'title' ? 'titleStyle' : 'contentStyle'
    const cur = (current as any)[key] || {}
    updateActive({ [key]: { ...cur, ...patch } } as Partial<Slide>)
  }
  // round72：聚焦文本样式读取（未设置字段给布局默认 —— 标题粗/居中、正文细）
  const textStyleOf = (field: 'title' | 'content'): Required<NonNullable<Slide['titleStyle']>> => {
    const key = field === 'title' ? 'titleStyle' : 'contentStyle'
    const st = (current as any)[key] || {}
    return {
      color: st.color,
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      bold: st.bold ?? (field === 'title'),
      align: st.align ?? (field === 'title' ? 'center' as const : 'left' as const),
      lineHeight: st.lineHeight,
      indent: st.indent,
      bullet: st.bullet,
      numbered: st.numbered,
      charSpacing: st.charSpacing,
    }
  }
  // ════ round73：选定文字命令引擎 ════
  // 选区在 RichField（contentEditable）内时：把选区映射到 paras 的 run 拆分
  // （字符区间 → 段/偏移 → 拆 run 应用样式再合并相邻同样式 run —— 与 shape
  // 的 paras 结构一致，写盘直接消费）。无选区时回退整段全部 run。
  //
  // 落点：titleParas/contentParas（新富文本字段）。若字段为空（纯文本用户）
  // 先从 title/content + style 基线合成初始 paras，保证任何命令后都有富文本。
  const parasOfField = (field: 'title' | 'content'): TextPara[] => {
    const pkey = field === 'title' ? 'titleParas' : 'contentParas'
    const existing = (current as any)[pkey] as TextPara[] | undefined
    if (existing && existing.length) return existing
    const st = textStyleOf(field)
    const plain = field === 'title' ? current.title : current.content
    const pxSize = st.fontSize ? ptToPxUI(st.fontSize) : undefined
    return (plain || '').split('\n').filter(l => l !== '').map(l => ({
      runs: [{
        text: l,
        bold: st.bold,
        color: st.color,
        fontSize: pxSize,
        font: st.fontFamily,
      }],
    }))
  }
  // run 样式合并（相邻同样式合并，写盘/渲染更紧凑）
  const mergeRuns = (runs: TextRun[]): TextRun[] => {
    const out: TextRun[] = []
    for (const r of runs) {
      if (!r.text) continue
      const prev = out[out.length - 1]
      if (prev
        && (prev.bold || false) === (r.bold || false)
        && (prev.italic || false) === (r.italic || false)
        && (prev.underline || false) === (r.underline || false)
        && (prev.strike || false) === (r.strike || false)
        && (prev.color || '') === (r.color || '')
        && (prev.fontSize || 0) === (r.fontSize || 0)
        && (prev.font || '') === (r.font || '')
        && (prev.spc ?? 0) === (r.spc ?? 0)) {
        prev.text += r.text
      } else {
        out.push({ ...r })
      }
    }
    return out
  }
  // 当前选区（在 RichField 内且非折叠）→ { field, 全文字符区间 }；否则 null
  const richSelection = (): { field: 'title' | 'content'; start: number; end: number } | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
    const anchorNode = sel.anchorNode
    const fieldEl = anchorNode instanceof HTMLElement
      ? (anchorNode.closest('[data-richfield]') as HTMLElement | null)
      : (anchorNode?.parentElement?.closest('[data-richfield]') as HTMLElement | null)
    if (!fieldEl) return null
    const field = fieldEl.getAttribute('data-richfield') as 'title' | 'content'
    // 选区在全文字符坐标中的区间：遍历 DOM 文本节点累计偏移
    const walk = (n: Node): number => {
      let off = 0
      for (const c of Array.from(n.childNodes)) {
        if (c === anchorNode || (c.contains && c.contains(anchorNode))) {
          return off + (c === anchorNode ? (sel.anchorOffset || 0) : walk(c))
        }
        off += (c.textContent || '').length
      }
      return off
    }
    const start = walk(fieldEl)
    const focusNode = sel.focusNode
    let end = start
    if (focusNode) {
      const walk2 = (n: Node): number => {
        let off = 0
        for (const c of Array.from(n.childNodes)) {
          if (c === focusNode || (c.contains && c.contains(focusNode))) {
            return off + (c === focusNode ? (sel.focusOffset || 0) : walk2(c))
          }
          off += (c.textContent || '').length
        }
        return off
      }
      end = walk2(fieldEl)
    }
    return { field, start: Math.min(start, end), end: Math.max(start, end) }
  }
  // 选区/整段应用 run 样式：patch(r) 返回新 run 字段
  //   sel 为 null 时应用到全部 run（整段语义 —— MS PPT 无选区点 B = 整段切换）
  const applyRunPatch = (field: 'title' | 'content', sel: { start: number; end: number } | null, patch: (r: TextRun) => Partial<TextRun>, toggle?: (r: TextRun) => boolean) => {
    const paras = parasOfField(field)
    let off = 0
    let anyApplied = false
    const nextParas = paras.map(p => {
      let runs: TextRun[] = []
      for (const r of p.runs) {
        const len = r.text.length
        const rs = off, re = off + len
        off = re
        if (sel == null || re <= sel.start || rs >= sel.end) { runs.push(r); continue }
        // 与选区相交：拆前中后三段
        const pre = rs < sel.start ? r.text.slice(0, sel.start - rs) : ''
        const mid = r.text.slice(Math.max(0, sel.start - rs), Math.min(len, sel.end - rs))
        const post = re > sel.end ? r.text.slice(sel.end - rs) : ''
        if (pre) runs.push({ ...r, text: pre })
        if (mid) { runs.push({ ...r, ...patch(r), text: mid }); anyApplied = true }
        if (post) runs.push({ ...r, text: post })
      }
      return { ...p, runs: mergeRuns(runs) }
    })
    // 切换类命令的“反向”判定：选区全部已加粗 → 取消（对齐 MS）
    void toggle
    if (sel != null && !anyApplied) {
      // 选区只在段间隙（空选）—— 全部 run 应用（等同整段）
    }
    const pkey = field === 'title' ? 'titleParas' : 'contentParas'
    updateActive({ [pkey]: nextParas } as Partial<Slide>)
    return nextParas
  }
  // 切换类选区命令（bold/italic/underline/strike）：选区内文字切换（全已开→取消；
  // 否则全开）；无选区时整段基线 style 切换（对齐 MS：光标无选区 = 整段属性，
  // 且空文本无 runs 也有语义）
  const toggleRunStyle = (field: 'title' | 'content', key: 'bold' | 'italic' | 'underline' | 'strike') => {
    const sel = richSelection()
    if (!sel) {
      // 无选区：整段基线（titleStyle/contentStyle 的 bold/italic 等）
      if (!focusField) return false
      const st = textStyleOf(focusField)
      const cur = (st as any)[key] as boolean
      applyTextStyle(focusField, { [key]: !cur } as any)
      return true
    }
    const paras = parasOfField(sel.field)
    let allOn = true
    let seen = false
    let off = 0
    for (const p of paras) for (const r of p.runs) {
      const rs = off, re = off + r.text.length
      off = re
      const inter = Math.min(re, sel.end) - Math.max(rs, sel.start)
      if (inter > 0 && r.text.trim()) {
        seen = true
        if (!r[key]) allOn = false
      }
    }
    const turnOn = !(seen && allOn)
    applyRunPatch(sel.field, sel, () => ({ [key]: turnOn }) as Partial<TextRun>)
    return true
  }
  // 设置类选区命令（颜色/字号/字体/字符间距）：直接赋值到选区 runs
  const setRunStyle = (field: 'title' | 'content', patch: Partial<TextRun>): boolean => {
    const sel = richSelection()
    const targetField = sel?.field ?? field
    if (!targetField) return false
    applyRunPatch(targetField, sel, () => patch)
    return true
  }
  // round73：RichField 输入提交 —— paras 落库 + 纯文本 title/content 同步
  // （缩略图/大纲/放映读纯文本；写盘端 paras 优先）。null = 清空。
  const commitFieldParas = (field: 'title' | 'content', paras: TextPara[] | null) => {
    const pkey = field === 'title' ? 'titleParas' : 'contentParas'
    const tkey = field === 'title' ? 'title' : 'content'
    if (!paras || !paras.length) {
      // 清空：paras 置空 + 纯文本空
      updateActive({ [pkey]: undefined, [tkey]: '' } as Partial<Slide>, true)
      return
    }
    const text = paras.map(p => p.runs.map(r => r.text).join('')).join('\n')
    updateActive({ [pkey]: paras, [tkey]: text } as Partial<Slide>, true)
  }
  // round73：字符间距 —— 选区优先写 run.spc；无选区写 style.charSpacing（整段）
  // spc = pt×100（OOXML rPr@spc 同语义；0/undefined = 常规）
  const activeCharSpacing = (): number => {
    const sel = richSelection()
    const field = sel?.field || focusField
    if (field) {
      const paras = (current as any)[field === 'title' ? 'titleParas' : 'contentParas'] as TextPara[] | undefined
      if (paras && paras.length) {
        const spcs = new Set<number>()
        if (sel) {
          let off = 0
          for (const p of paras) for (const r of p.runs) {
            const rs = off, re = off + r.text.length
            off = re
            if (Math.min(re, sel.end) - Math.max(rs, sel.start) > 0 && r.text.trim()) spcs.add(r.spc ?? 0)
          }
        } else {
          for (const p of paras) for (const r of p.runs) if (r.text.trim()) spcs.add(r.spc ?? 0)
        }
        if (spcs.size === 1) return [...spcs][0]
        return 0
      }
      return textStyleOf(field).charSpacing || 0
    }
    return 0
  }
  const applyCharSpacing = (spc: number) => {
    const sel = richSelection()
    const field = sel?.field || focusField
    if (field) {
      if (sel) { setRunStyle(field, { spc: spc || undefined }); return }
      applyTextStyle(field, { charSpacing: spc || undefined })
      return
    }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'shape') updateShape(selectedEl.index, { charSpacing: spc || undefined } as any)
  }
  // 颜色三路分发（含 run 级同步，否则 paras 渲染被 run 颜色覆盖看不到变化）
  // round73：RichField 有选区 → 只改选定文字（run 拆分）；
  // 仅聚焦（无选区）→ 整段基线 style.color（对齐 MS PPT：光标无选区=整段）
  const applyFontColor = (c: string) => {
    const sel = richSelection()
    if (sel) { setRunStyle(sel.field, { color: c }); closeAllPanels(); return }
    if (focusField) { applyTextStyle(focusField, { color: c }); closeAllPanels(); return }
    if (!selectedEl) { softHint(); closeAllPanels(); return }
    if (selectedEl.type === 'shape') styleShape(selectedEl.index, { fontColor: c }, () => ({ color: c }))
    else updateArtText(selectedEl.index, { color: c })
    closeAllPanels()
  }
  // 字体三路分发：shape 写顶层 font + run.font；标题/正文写 style；艺术字写 font
  // round73：有选区 → 选定文字 runs；无选区 → 整段基线 style.fontFamily
  const applyFontFamily = (f: string) => {
    const sel = richSelection()
    if (sel) { setRunStyle(sel.field, { font: f || undefined }); return }
    if (focusField) { applyTextStyle(focusField, { fontFamily: f || undefined }); return }
    if (!selectedEl) return
    if (selectedEl.type === 'shape') styleShape(selectedEl.index, { font: f || undefined }, () => ({ font: f || undefined }))
    else updateArtText(selectedEl.index, { font: f || undefined } as any)
  }
  // 标题/正文加粗（round72：整段切换；round73：选区内文字切换 —— 用户主诉
  // 「选定文字调整而非元素整体」）
  const applyTextBold = () => {
    if (!toggleRunStyle(focusField || 'content', 'bold')) {
      // focusField 为 null 且无选区（shape 分支已在 ribbon 处理）—— 不动作
    }
  }
  // ════ round72：段落命令三路分发 ════
  // 加粗/对齐/缩进/行距/项目符号/编号 —— 标题/正文聚焦文本（style 字段）、
  // shape 文字（含 paras/run 同步）、艺术字（bold/align 可存）全部生效。
  // 旧版这些按钮只认 selectedEl，标题/正文必然弹「请先选择元素」。
  const softHint = () => { alert(t('slide.clickTextOrShape') || '请先点击标题/正文文字，或选中形状/艺术字') }
  // 对齐
  const applyAlign = (a: 'left' | 'center' | 'right') => {
    if (focusField) { applyTextStyle(focusField, { align: a }); return }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'shape') styleShape(selectedEl.index, { textAlign: a }, undefined, a === 'left' ? 'l' : a === 'center' ? 'c' : 'r')
    else updateArtText(selectedEl.index, { align: a } as any)
  }
  // 缩进步进（step = +1 / -1）
  const applyIndent = (step: number) => {
    if (focusField) { const st = textStyleOf(focusField); applyTextStyle(focusField, { indent: Math.max(0, (st.indent || 0) + step) }); return }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { indent: Math.max(0, (sh.indent || 0) + step) }) }
  }
  // 行距（聚焦文本 / shape）
  const applyLineHeight = (lh: number) => {
    if (focusField) { applyTextStyle(focusField, { lineHeight: lh }); return }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'shape') updateShape(selectedEl.index, { lineHeight: lh })
  }
  // 项目符号 / 编号（聚焦文本生效；shape 走旧逻辑）
  const applyBullet = (kind: 'bullet' | 'numbered') => {
    if (focusField) {
      const st = textStyleOf(focusField)
      const on = kind === 'bullet' ? !st.bullet : !st.numbered
      applyTextStyle(focusField, kind === 'bullet' ? { bullet: on, numbered: false } : { numbered: on, bullet: false })
      return
    }
    if (!selectedEl) { softHint(); return }
    if (selectedEl.type === 'shape') {
      const sh = current.shapes[selectedEl.index]
      updateShape(selectedEl.index, kind === 'bullet' ? { bullet: !sh.bullet, numbered: false } : { numbered: !sh.numbered, bullet: false })
    }
  }
  // 当前字体（三路读取，用于选择器回显）
  const activeFontFamily = (() => {
    if (focusField) {
      const key = focusField === 'title' ? 'titleStyle' : 'contentStyle'
      return ((current as any)[key] || {}).fontFamily || ''
    }
    if (!selectedEl) return ''
    if (selectedEl.type === 'shape') return current.shapes[selectedEl.index]?.font || ''
    return (current.artTexts[selectedEl.index] as any)?.font || ''
  })()

  // 艺术字操作
  const addArtText = async (preset: any) => {
    const text = await askText(t('slide.prompt.wordArt'), 'SamOffice')
    if (!text) return
    const newArt: ArtTextItem = {
      text, x: 100 * PXU, y: 100 * PXU, w: 400 * PXU, h: 80 * PXU,
      fontSize: 36, color: preset.color, gradient: preset.gradient || '',
      shadow: preset.shadow || false, glow: preset.glow || false, outline: preset.outline || '', rotation: 0,
    }
    updateActive({ artTexts: [...current.artTexts, newArt] })
    setShowArtPanel(false)
  }
  const removeArtText = (idx: number) => {
    updateActive({
      artTexts: current.artTexts.filter((_, i) => i !== idx),
      animations: remapAnimsAfterDelete(current.animations, new Set(), new Set([idx])),
    })
    adjustSelectionAfterRemoval('art', idx)
  }

  // 图表插入：根据数据在离屏 canvas 上绘制柱状图/折线图/饼图，作为图片形状插入（可保存到 pptx）
  const CHART_PALETTE = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']
  const insertChart = (chartType: 'bar' | 'line' | 'pie', dataStr: string) => {
    const nums = dataStr.split(/[,，\s]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && isFinite(n))
    if (!nums.length) { alert(t('slide.chartBadData') || '请输入逗号分隔的数字，如：12,28,40'); return }
    const W = 420, H = 260
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    const maxV = Math.max(...nums, 0.0001)
    const pad = 34
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#475569'
    if (chartType === 'pie') {
      const total = nums.reduce((a, b) => a + b, 0) || 1
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - pad
      let ang = -Math.PI / 2
      nums.forEach((v, i) => {
        const a2 = ang + (v / total) * Math.PI * 2
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, ang, a2); ctx.closePath()
        ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length]; ctx.fill()
        const mid = (ang + a2) / 2
        ctx.fillStyle = '#334155'; ctx.textAlign = 'center'
        ctx.fillText(`${Math.round((v / total) * 100)}%`, cx + Math.cos(mid) * (r * 0.65), cy + Math.sin(mid) * (r * 0.65) + 4)
        ang = a2
      })
    } else {
      const iw = W - pad * 2, ih = H - pad * 1.6
      // 网格线
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
      for (let g = 0; g <= 4; g++) {
        const y = pad * 0.6 + (ih * g) / 4
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke()
        ctx.textAlign = 'right'; ctx.fillText(String(Math.round(maxV * (1 - g / 4))), pad - 6, y + 4)
      }
      const bw = iw / nums.length
      nums.forEach((v, i) => {
        const x = pad + bw * i
        const hgt = (v / maxV) * ih
        ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length]
        if (chartType === 'bar') {
          ctx.fillRect(x + bw * 0.18, pad * 0.6 + ih - hgt, bw * 0.64, hgt)
        } else {
          const cx2 = x + bw / 2, cy2 = pad * 0.6 + ih - hgt
          if (i > 0) {
            const pv = nums[i - 1]
            const px2 = pad + bw * (i - 1) + bw / 2, py2 = pad * 0.6 + ih - (pv / maxV) * ih
            ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.5
            ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(cx2, cy2); ctx.stroke()
          }
          ctx.beginPath(); ctx.arc(cx2, cy2, 4, 0, Math.PI * 2); ctx.fill()
        }
      })
    }
    const url = cv.toDataURL('image/png')
    const newShape: ShapeItem = {
      type: 'rect', x: (200 + Math.random() * 60) * PXU, y: (120 + Math.random() * 60) * PXU,
      w: W * PXU, h: H * PXU, fill: `url(${url})`, text: '', shadow: true, glow: false, gradient: '', rotation: 0,
    }
    updateActive({ shapes: [...current.shapes, newShape] })
    setShowChartPanel(false)
  }
  const updateArtText = (idx: number, patch: Partial<ArtTextItem>, record = true) => {
    const newArts = current.artTexts.map((a, i) => i === idx ? { ...a, ...patch } : a)
    updateActive({ artTexts: newArts }, record)
  }

  // 叠放层次（z-order，对标 MS PPT：置于顶层/底层、上移/下移一层）
  const reorderShape = (idx: number, to: 'front' | 'back' | 'forward' | 'backward') => {
    const shapes = [...current.shapes]
    const [item] = shapes.splice(idx, 1)
    if (to === 'front') shapes.push(item)
    else if (to === 'back') shapes.unshift(item)
    else if (to === 'forward') shapes.splice(Math.min(idx + 1, shapes.length), 0, item)
    else if (to === 'backward') shapes.splice(Math.max(idx - 1, 0), 0, item)
    updateActive({ shapes })
  }
  const reorderArt = (idx: number, to: 'front' | 'back' | 'forward' | 'backward') => {
    const arts = [...current.artTexts]
    const [item] = arts.splice(idx, 1)
    if (to === 'front') arts.push(item)
    else if (to === 'back') arts.unshift(item)
    else if (to === 'forward') arts.splice(Math.min(idx + 1, arts.length), 0, item)
    else if (to === 'backward') arts.splice(Math.max(idx - 1, 0), 0, item)
    updateActive({ artTexts: arts })
  }

  // ---------- 多选 / 组合 ----------
  const sameSel = (a: SelEl, b: SelEl) => a.type === b.type && a.index === b.index
  // 组内全部成员（形状）的选择项
  const groupShapeSels = (gid: string): SelEl[] =>
    current.shapes.map((_, i) => ({ type: 'shape' as const, index: i }))
      .filter(sel => current.shapes[sel.index]?.groupId === gid)
  // 统一选择入口：shift 点击切换成员（组员按整组切换），普通点击整组/单成员选中；
  // 主选恒为集合最后一个。返回新的选中集合（供拖拽 items 捕获）。
  // round73：点选形状/艺术字 = 目标切换 —— 清空 focusField（旧版残留时，
  // 随后的字体/颜色命令误走标题/正文分支而非选中形状，round71 e2e 复现）。
  const pickSelection = (members: SelEl[], primary: SelEl, shift?: boolean): SelEl[] => {
    if (focusField) setFocusField(null)
    if (shift) {
      const allIn = members.every(m => selectedEls.some(c => sameSel(c, m)))
      const next = allIn
        ? selectedEls.filter(c => !members.some(m => sameSel(m, c)))
        : [...selectedEls, ...members.filter(m => !selectedEls.some(c => sameSel(c, m)))]
      setSelectedEls(next)
      _setSelectedElRaw(next.length ? next[next.length - 1] : null)
      return next
    }
    const already = members.every(m => selectedEls.some(c => sameSel(c, m)))
    if (already && selectedEls.length > 1) {
      // 已在多选中：保留集合，仅把主选切到点击成员并移到末尾
      const next = [...selectedEls.filter(c => !sameSel(c, primary)), primary]
      setSelectedEls(next)
      _setSelectedElRaw(primary)
      return next
    }
    setSelectedEls(members)
    _setSelectedElRaw(primary)
    return members
  }
  // 拖拽前捕获所有选中成员的原始坐标（绝对定位，避免闭包陈旧）
  const dragItemsOf = (sels: SelEl[]) => sels.map(s => ({
    type: s.type,
    index: s.index,
    x: s.type === 'shape' ? (current.shapes[s.index]?.x || 0) : (current.artTexts[s.index]?.x || 0),
    y: s.type === 'shape' ? (current.shapes[s.index]?.y || 0) : (current.artTexts[s.index]?.y || 0),
  }))
  // 拖拽移动：对所有选中成员应用同一位移（内部坐标单位，1px=8 单位）
  const applyMoveDelta = (items: { type: 'shape' | 'art'; index: number; x: number; y: number }[], dxu: number, dyu: number) => {
    setSlides(s => s.map((sl, si) => {
      if (si !== active) return sl
      return {
        ...sl,
        shapes: sl.shapes.map((sp, i) => {
          const it = items.find(v => v.type === 'shape' && v.index === i)
          return it ? { ...sp, x: Math.max(0, it.x + dxu), y: Math.max(0, it.y + dyu) } : sp
        }),
        artTexts: sl.artTexts.map((a, i) => {
          const it = items.find(v => v.type === 'art' && v.index === i)
          return it ? { ...a, x: Math.max(0, it.x + dxu), y: Math.max(0, it.y + dyu) } : a
        }),
      }
    }))
  }
  // 删除全部选中（Delete/Backspace）；动画引用随删除重映射（见 remapAnimsAfterDelete）
  const deleteSelection = () => {
    const els = selectedEls.length ? selectedEls : (selectedEl ? [selectedEl] : [])
    if (!els.length) return
    recordHistory()
    const delShapes = new Set(els.filter(e => e.type === 'shape').map(e => e.index))
    const delArts = new Set(els.filter(e => e.type === 'art').map(e => e.index))
    setSlides(s => s.map((sl, si) => si !== active ? sl : {
      ...sl,
      shapes: sl.shapes.filter((_, i) => !delShapes.has(i)),
      artTexts: sl.artTexts.filter((_, i) => !delArts.has(i)),
      animations: remapAnimsAfterDelete(sl.animations, delShapes, delArts),
    }))
    setSelectedEl(null)
  }
  // 组合：给全部选中的形状成员赋同一个 groupId（≥2 个形状）
  const groupSelection = () => {
    const idxs = (selectedEls.length ? selectedEls : (selectedEl ? [selectedEl] : []))
      .filter(e => e.type === 'shape').map(e => e.index)
    if (idxs.length < 2) { alert(tf('slide.groupNeed2', '请先选中至少两个形状再组合')); return }
    const gid = `g${Date.now()}`
    const set = new Set(idxs)
    updateActive({ shapes: current.shapes.map((s, i) => set.has(i) ? { ...s, groupId: gid } : s) })
  }
  // 取消组合：清掉主选所在组全部成员的 groupId（不打乱数组顺序）
  const ungroupSelection = () => {
    const gid = selectedEl?.type === 'shape' ? current.shapes[selectedEl.index]?.groupId : undefined
    if (!gid) { alert(tf('slide.ungroupNeed', '请选中组内形状后再取消组合')); return }
    updateActive({ shapes: current.shapes.map(s => s.groupId === gid ? { ...s, groupId: undefined } : s) })
  }
  // 渲染层选中框：所有选中成员都画框（主选另有缩放/旋转手柄）
  const isSelEl = (type: 'shape' | 'art', index: number) => selectedEls.some(e => e.type === type && e.index === index)
  // 组合/取消组合按钮可用性
  const selShapeCount = selectedEls.filter(e => e.type === 'shape').length
  const primaryGrouped = !!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.groupId)

  // 剪切 / 复制 / 粘贴（元素级，对标 MS PPT 右键菜单）
  const copySelected = () => {
    if (!selectedEl) return
    if (selectedEl.type === 'shape') clipboardRef.current = { type: 'shape', data: { ...current.shapes[selectedEl.index] } }
    else clipboardRef.current = { type: 'art', data: { ...current.artTexts[selectedEl.index] } }
  }
  const cutSelected = () => {
    if (!selectedEl) return
    copySelected()
    if (selectedEl.type === 'shape') removeShape(selectedEl.index)
    else removeArtText(selectedEl.index)
    setSelectedEl(null)
  }
  const pasteClipboard = () => {
    const clip = clipboardRef.current
    if (!clip) return
    if (clip.type === 'shape') {
      const copy = { ...(clip.data as ShapeItem), x: (clip.data as ShapeItem).x + 16, y: (clip.data as ShapeItem).y + 16 }
      const shapes = [...current.shapes, copy]
      updateActive({ shapes })
      setSelectedEl({ type: 'shape', index: shapes.length - 1 })
    } else {
      const copy = { ...(clip.data as ArtTextItem), x: (clip.data as ArtTextItem).x + 16, y: (clip.data as ArtTextItem).y + 16 }
      const arts = [...current.artTexts, copy]
      updateActive({ artTexts: arts })
      setSelectedEl({ type: 'art', index: arts.length - 1 })
    }
  }

  // 内联文本编辑：双击文字元素进入编辑，对标 MS PPT 直接改字
  const isTextEditable = (type: 'shape' | 'art', index: number) => {
    if (type === 'art') return true
    const sh = current.shapes[index]
    return sh && !sh.media // 图片/视频等媒体无文字
  }
  const startEdit = (type: 'shape' | 'art', index: number, e?: React.MouseEvent) => {
    if (!isTextEditable(type, index)) return
    e?.stopPropagation()
    setSelectedEl({ type, index })
    setEditing({ type, index })
    setTimeout(() => {
      editAreaRef.current?.focus()
      editAreaRef.current?.select()
    }, 0)
  }
  const commitEdit = () => {
    if (!editing) return
    const val = editAreaRef.current?.value ?? ''
    if (editing.type === 'shape') {
      const sh = current.shapes[editing.index]
      if (sh) {
        const patch: Partial<ShapeItem> = { text: val }
        if (sh.paras && sh.paras.length) {
          // 有 paras 的形状：编辑后用第一个非空 run 的样式重建单段，
          // 否则画布继续渲染旧 paras，看到的仍是编辑前的文字
          const first = sh.paras.flatMap(p => p.runs || []).find(r => (r.text || '').trim()) || sh.paras[0]?.runs?.[0]
          patch.paras = [{ runs: [{ text: val, color: first?.color, fontSize: first?.fontSize, bold: first?.bold, italic: first?.italic, underline: first?.underline, font: first?.font }] }]
        }
        updateShape(editing.index, patch)
      }
    } else {
      updateArtText(editing.index, { text: val })
    }
    setEditing(null)
  }

  // 声音特效引擎（Web Audio 合成，无需外部资源）
  const playSound = (type?: string) => {
    if (!type || type === 'none') return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = (playSound as any)._ac || ((playSound as any)._ac = new Ctx())
      const now = ac.currentTime
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.connect(gain); gain.connect(ac.destination)
      const presets: Record<string, { f: number; f2: number; d: number; t: OscillatorType }> = {
        click: { f: 880, f2: 440, d: 0.08, t: 'square' },
        laser: { f: 1200, f2: 200, d: 0.18, t: 'sawtooth' },
        chime: { f: 660, f2: 990, d: 0.4, t: 'sine' },
        applause: { f: 300, f2: 120, d: 0.3, t: 'triangle' },
        whoosh: { f: 200, f2: 800, d: 0.25, t: 'sine' },
      }
      const p = presets[type] || presets.click
      osc.type = p.t
      osc.frequency.setValueAtTime(p.f, now)
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, p.f2), now + p.d)
      gain.gain.setValueAtTime(0.001, now)
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, now + p.d)
      osc.start(now); osc.stop(now + p.d + 0.02)
    } catch { /* 忽略音频错误 */ }
  }

  // 动画操作（目标：优先当前选中元素，其次最后一个形状；无形状时提示）
  const addAnimation = (effect: string, category: string) => {
    if (!current.shapes.length) { alert(t('slide.pleaseSelect') || '请先插入并选中元素'); setShowAnimPanel(false); return }
    const targetIdx = selectedEl?.type === 'shape' ? selectedEl.index : current.shapes.length - 1
    const target = `shape_${targetIdx}`
    const newAnim: AnimItem = { target, effect, category, delay: current.animations.length * 300, sound: pendingSound }
    updateActive({ animations: [...current.animations, newAnim] })
    setShowAnimPanel(false)
  }
  const removeAnimation = (idx: number) => { updateActive({ animations: current.animations.filter((_, i) => i !== idx) }) }

  // 放映控制
  const [presentAnimStep, setPresentAnimStep] = useState(0)
  const startPresent = () => { setPresenting(true); setPresentSlide(active); setPresentAnimStep(0) }
  // 动画按添加顺序逐步触发（入场→强调→退出的自然顺序）
  const nextPresent = () => {
    const seq = presentingSlide.animations
    if (presentAnimStep < seq.length) {
      const step = presentAnimStep
      setPresentAnimStep(step + 1)
      playSound(seq[step]?.sound)
    } else if (presentSlide < slides.length - 1) {
      setPresentSlide(presentSlide + 1); setPresentAnimStep(0)
    } else {
      setPresenting(false)
    }
  }
  const prevPresent = () => { if (presentAnimStep > 0) setPresentAnimStep(0); else if (presentSlide > 0) { setPresentSlide(presentSlide - 1); setPresentAnimStep(0) } }

  // 自动放映：按设定间隔驱动动画/翻页（修复“自动播放”只是摆设的问题）
  useEffect(() => {
    if (!presenting || !autoPlay) return
    const timer = window.setInterval(() => nextPresent(), Math.max(1, autoPlaySec) * 1000)
    return () => window.clearInterval(timer)
  }, [presenting, autoPlay, autoPlaySec, presentSlide, presentAnimStep, slides.length])

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('slide.ribbon.home') }, { id: 'insert', label: t('slide.ribbon.insert') }, { id: 'design', label: t('slide.ribbon.design') },
    { id: 'modern', label: 'Modern' }, { id: 'animations', label: t('slide.ribbon.animation') }, { id: 'transition', label: t('slide.ribbon.transition') }, { id: 'view', label: t('slide.ribbon.view') },
  ]

  const presentingSlide = slides[presentSlide] || slides[0]

  // 全局拖拽/缩放/旋转处理 (mouse capture on window so movement outside the element still tracks)
  useEffect(() => {
    if (!dragInfo || !selectedEl) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragInfo.startX
      const dy = e.clientY - dragInfo.startY
      // 首次实际移动时压栈，记录拖拽前状态（纯点选不产生历史）
      if (!dragRecordedRef.current && (dx !== 0 || dy !== 0)) {
        dragRecordedRef.current = true
        recordHistory()
      }
      if (dragInfo.mode === 'move') {
        // 多选拖拽：对所有选中成员应用同一位移（内部坐标单位 1px=8）
        const items = dragInfo.items && dragInfo.items.length
          ? dragInfo.items
          : [{ type: selectedEl.type, index: selectedEl.index, x: dragInfo.origX, y: dragInfo.origY }]
        applyMoveDelta(items, dx * 8, dy * 8)
      } else if (selectedEl.type === 'shape') {
        if (dragInfo.mode === 'resize') {
          updateShape(selectedEl.index, { w: Math.max(20, dragInfo.origX + dx * 8), h: Math.max(20, dragInfo.origY + dy * 8) }, false)
        } else if (dragInfo.mode === 'rotate') {
          updateShape(selectedEl.index, { rotation: dragInfo.origX + dx }, false)
        }
      } else {
        if (dragInfo.mode === 'rotate') {
          updateArtText(selectedEl.index, { rotation: dragInfo.origX + dx }, false)
        }
      }
    }
    const onUp = () => { setDragInfo(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragInfo, selectedEl, active])

  // round30：键盘导航。
  // 放映模式：←/↑/PageUp 上一动画或上一页，→/↓/回车/空格/PageDn 下一动画或
  // 下一页，Home/End 跳首/尾页（对标 MS PPT 放映快捷键）。
  // 编辑模式：←/→ 切换幻灯片（输入框聚焦/内联编辑时除外，避免与文字编辑冲突）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (presenting) { setPresenting(false); e.preventDefault(); return }
        if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
        return
      }
      // ---- 放映模式导航（round30）----
      if (presenting) {
        switch (e.key) {
          case 'ArrowRight': case 'ArrowDown': case 'PageDown': case 'Enter': case ' ':
            e.preventDefault(); nextPresent(); return
          case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
            e.preventDefault(); prevPresent(); return
          case 'Home':
            e.preventDefault(); setPresentSlide(0); setPresentAnimStep(0); return
          case 'End':
            e.preventDefault(); setPresentSlide(Math.max(0, slides.length - 1)); setPresentAnimStep(0); return
        }
        return
      }
      // ---- 编辑模式切页（round30）：←/→ 切换当前幻灯片 ----
      const tag = (e.target as HTMLElement)?.tagName
      const focusInField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (!focusInField && !editing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        switchSlide(e.key === 'ArrowLeft' ? Math.max(0, active - 1) : Math.min(slides.length - 1, active + 1))
        return
      }
      // Ctrl+Z/Y 全局接管撤销/重做：焦点在输入框（标题/正文等）时也要能撤销整个编辑动作；
      // 仅内联编辑文本域（editing 打开）时交给浏览器原生行为，避免非受控 textarea 不同同步
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      // 删除键删除全部选中（文本编辑中/输入框内除外）
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editing && !inField && (selectedEls.length > 0 || selectedEl)) {
        e.preventDefault()
        deleteSelection()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') { if (!editing) { e.preventDefault(); if (e.shiftKey) redo(); else undo() } return }
        if (k === 'y') { if (!editing) { e.preventDefault(); redo() } return }
        if (k === 'c') { if (!inField && selectedEl) { e.preventDefault(); copySelected() } return }
        if (k === 'x') { if (!inField && selectedEl) { e.preventDefault(); cutSelected() } return }
        if (k === 'v') { if (!inField) { e.preventDefault(); pasteClipboard() } return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyPanelOpen, presenting, past.length, future.length, selectedEl, selectedEls, editing, active, slides.length, presentSlide, presentAnimStep])

  // 点击/滚动/ESC 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])


  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)', position: 'relative' }}>
      {/* Ribbon Tab 栏 — 可横向滚动，右侧页码固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45 }}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(t => (
            <button key={t.id} onClick={() => { closeAllPanels(); setRibbonTab(t.id) }} data-testid={`ribbon-tab-${t.id}`} className="ribbon-tab-btn px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
          ))}
        </div>
        <span className="text-xs flex-shrink-0 px-2" data-testid="slide-page-indicator" style={{ color: 'var(--color-text-muted)' }}>{active + 1} / {slides.length}</span>
        {/* Ribbon 整体折叠/展开（对齐 MS Office） */}
        <button onClick={() => setRibbonCollapsedPersist(!ribbonCollapsed)} data-testid="ribbon-collapse" type="button"
          className="toolbar-btn flex-shrink-0"
          title={ribbonCollapsed ? (t('ribbon.expand') || '展开功能区') : (t('ribbon.collapse') || '折叠功能区')}>{ribbonCollapsed ? '⌄' : '⌃'}</button>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单 */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区（整体折叠时不渲染，仅保留选项卡栏） */}
      {!ribbonCollapsed && (
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('slide.edit')}>
            <RibbonButton icon="↶" label={t('slide.undo')} onClick={undo} disabled={!past.length} />
            <RibbonButton icon="↷" label={t('slide.redo')} onClick={redo} disabled={!future.length} />
          </RibbonGroup>
          {/* 排列：叠放层次（作用主选）+ 组合/取消组合（多选形状） */}
          <RibbonGroup label={tf('slide.arrange', '排列')}>
            <RibbonButton icon="⤒" label={t('slide.bringToFront')} disabled={!selectedEl} onClick={() => { if (!selectedEl) return; if (selectedEl.type === 'shape') reorderShape(selectedEl.index, 'front'); else reorderArt(selectedEl.index, 'front') }} />
            <RibbonButton icon="↑" label={t('slide.bringForward')} disabled={!selectedEl} onClick={() => { if (!selectedEl) return; if (selectedEl.type === 'shape') reorderShape(selectedEl.index, 'forward'); else reorderArt(selectedEl.index, 'forward') }} />
            <RibbonButton icon="↓" label={t('slide.sendBackward')} disabled={!selectedEl} onClick={() => { if (!selectedEl) return; if (selectedEl.type === 'shape') reorderShape(selectedEl.index, 'backward'); else reorderArt(selectedEl.index, 'backward') }} />
            <RibbonButton icon="⤓" label={t('slide.sendToBack')} disabled={!selectedEl} onClick={() => { if (!selectedEl) return; if (selectedEl.type === 'shape') reorderShape(selectedEl.index, 'back'); else reorderArt(selectedEl.index, 'back') }} />
            <RibbonButton icon="⊞" label={tf('slide.group', '组合')} disabled={selShapeCount < 2} onClick={groupSelection} title={tf('slide.groupNeed2', '请先选中至少两个形状再组合')} />
            <RibbonButton icon="⊟" label={tf('slide.ungroup', '取消组合')} disabled={!primaryGrouped} onClick={ungroupSelection} title={tf('slide.ungroupNeed', '请选中组内形状后再取消组合')} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.slides')}>
            <div className="relative">
              <RibbonButton icon="＋" label={t('slide.new')} onClick={() => setShowInsertSlide(v => !v)} />
              {showInsertSlide && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.5rem', zIndex: 50, width: 220 }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('slide.insertSlideTip')}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => insertSlide(active, 'title')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">🎬 {t('slide.layoutTitle')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutTitleDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'section')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">📑 {t('slide.layoutSection')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutSectionDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'content')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">📄 {t('slide.layoutContent')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutContentDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'blank')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">⬜ {t('slide.layoutBlank')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutBlankDesc')}</div>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <RibbonButton icon="⎘" label={t('slide.copy')} onClick={() => duplicateSlide(active)} />
            <RibbonButton icon="✕" label={t('slide.delete')} onClick={() => deleteSlide(active)} disabled={slides.length <= 1} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.layoutGroup')}>
            {LAYOUTS.map(l => <RibbonButton key={l.id} icon={l.icon} label={l.name} onClick={() => updateActive({ layout: l.id as Slide['layout'] })} active={current.layout === l.id} />)}
          </RibbonGroup>
          <RibbonGroup label={t('slide.font')}>
            {/* round71：字体 family 选择器 —— 对 shape 文字（顶层+run）/艺术字/
                标题/正文聚焦文本三路生效。旧版完全无字体控件（用户主诉③）。 */}
            <select
              value={activeFontFamily || ''}
              onChange={(e) => applyFontFamily(e.target.value)}
              title={t('slide.fontFamily') || '字体'}
              className="text-xs rounded-md px-1 py-1 ribbon-input"
              style={{ width: 110, height: 26, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <option value="">{t('slide.fontDefault') || '默认字体'}</option>
              {['宋体', '黑体', '楷体', '仿宋', '微软雅黑', '等线', '华文彩云', '隶书',
                'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Consolas', 'Space Grotesk'].map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
            {/* round73：加粗/斜体/下划线/删除线 —— 选定文字优先（RichField 选区内
                run 拆分）；无选区回退整段；shape 切换所有 run 含 paras；艺术字 bold。
                旧版只有加粗且仅元素整体，用户主诉「要支持选定文字调整」。 */}
            <RibbonButton icon="B" label={t('slide.bold')} onClick={() => { if (focusField || richSelection()) { applyTextBold(); return }; if (!selectedEl) { softHint(); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; const runs = (sh.paras || []).flatMap(p => p.runs || []); const makeBold = runs.some(r => r.text && !r.bold) || (!runs.length && !sh.fontBold); styleShape(selectedEl.index, { fontBold: makeBold }, () => ({ bold: makeBold })) } else { const at = current.artTexts[selectedEl.index]; updateArtText(selectedEl.index, { bold: !(at as any).bold } as any) } }} />
            {/* round73：斜体（选定文字） */}
            <RibbonButton icon={<span style={{ fontStyle: 'italic', fontWeight: 700 }}>I</span> as any} label={t('slide.italic')} onClick={() => { if (focusField || richSelection()) { toggleRunStyle(focusField || 'content', 'italic'); return }; if (!selectedEl) { softHint(); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; const runs = (sh.paras || []).flatMap(p => p.runs || []); const makeIt = runs.some(r => r.text && !r.italic) || (!runs.length && !(sh as any).italic); styleShape(selectedEl.index, { italic: makeIt } as any, () => ({ italic: makeIt })) } else { const at = current.artTexts[selectedEl.index]; updateArtText(selectedEl.index, { italic: !(at as any).italic } as any) } }} />
            {/* round73：下划线（选定文字） */}
            <RibbonButton icon={<span style={{ textDecoration: 'underline', fontWeight: 700 }}>U</span> as any} label={t('slide.underline')} onClick={() => { if (focusField || richSelection()) { toggleRunStyle(focusField || 'content', 'underline'); return }; if (!selectedEl) { softHint(); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; const runs = (sh.paras || []).flatMap(p => p.runs || []); const makeUl = runs.some(r => r.text && !r.underline) || (!runs.length && !(sh as any).underline); styleShape(selectedEl.index, { underline: makeUl } as any, () => ({ underline: makeUl })) } else { const at = current.artTexts[selectedEl.index]; updateArtText(selectedEl.index, { underline: !(at as any).underline } as any) } }} />
            {/* round73：删除线（选定文字） */}
            <RibbonButton icon={<span style={{ textDecoration: 'line-through', fontWeight: 700 }}>S</span> as any} label={t('slide.strike')} onClick={() => { if (focusField || richSelection()) { toggleRunStyle(focusField || 'content', 'strike'); return }; if (selectedEl?.type === 'shape') { const sh = current.shapes[selectedEl.index]; const runs = (sh.paras || []).flatMap(p => p.runs || []); const makeSt = runs.some(r => r.text && !(r as any).strike) || (!runs.length && !(sh as any).strike); styleShape(selectedEl.index, { strike: makeSt } as any, () => ({ strike: makeSt }) as any) } else if (!selectedEl) { softHint() } }} />
            <div className="relative">
              {/* round71：颜色 —— 对 shape 文字/艺术字/标题/正文聚焦文本三路生效
                  （旧版只认 selectedEl=shape → 标题正文改色无效，用户主诉①）。 */}
              <RibbonButton icon="🎨" label={t('slide.color')} onClick={() => openPanel('color')} />
              {showColorPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.625rem', zIndex: 50 }}>
                  {/* round71：色板扩充 —— 旧版仅 8 色太少；48 色块 + hex 输入（用户主诉②） */}
                  <div className="grid grid-cols-12 gap-1">
                    {PALETTE_COLORS.map(c => (
                      <button key={c} onClick={() => applyFontColor(c)} className="w-5 h-5 rounded-md border transition-transform hover:scale-110" style={{ background: c, borderColor: 'var(--color-border)' }} title={c} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <input value={colorHexDraft} onChange={e => setColorHexDraft(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { const v = colorHexDraft.trim(); if (/^#[0-9a-fA-F]{3,8}$/.test(v)) applyFontColor(v) } }} placeholder="#000000" className="text-xs px-1.5 py-1 rounded border flex-1 ribbon-input" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)', width: 76 }} />
                    <button onClick={() => { const v = colorHexDraft.trim(); if (/^#[0-9a-fA-F]{3,8}$/.test(v)) applyFontColor(v); else alert('请输入 #RRGGBB 格式') }} className="text-xs px-2 py-1 rounded border" style={{ background: 'var(--color-primary)', color: 'white', borderColor: 'transparent' }}>{t('doc.ok') || '应用'}</button>
                  </div>
                </div>
              )}
            </div>
            {/* 字号输入框：可直接键入 pt 数字回车生效（对齐 MS PPT），下拉提供常用字号。
                round71：无选中/聚焦文本时不再只认 shape —— 标题/正文聚焦时直接写入样式。 */}
            <Dropdown
              className="text-xs rounded-md px-2 ribbon-input"
              style={{ width: 64, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
              editable
              inputMode="numeric"
              inputValue={activeFontSizePt}
              placeholder="18"
              onInputChange={(raw) => { const n = parseFloat(raw.trim()); if (!isNaN(n) && n > 0) applyFontSizePt(n) }}
              value={activeFontSizePt}
              onChange={(v) => { const n = parseFloat(v); if (!isNaN(n) && n > 0) applyFontSizePt(n) }}
              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96].map(n => ({ label: String(n), value: String(n) }))}
              title={t('slide.fontSize')}
            />
            {/* 字号调整：放大 / 缩小（同步顶层与所有 run） */}
            <RibbonButton icon="A+" label={t('slide.fontSizeUp')} onClick={() => bumpFontSize(2)} />
            <RibbonButton icon="A-" label={t('slide.fontSizeDown')} onClick={() => bumpFontSize(-2)} />
            {/* round73：字符间距（新增控件 —— 用户主诉）。选定文字优先：选区 runs
                写 spc；无选区写 style.charSpacing 整段。pt×100（OOXML spc 语义）。 */}
            <div className="flex items-center gap-0.5" title={t('slide.charSpacingTip') || '先选定文字再调整间距'}>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>AV</span>
              <select value={String(activeCharSpacing())} onChange={(e) => applyCharSpacing(parseFloat(e.target.value) || 0)} className="text-xs rounded-md px-1 py-1 ribbon-input" style={{ width: 58, height: 26, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <option value="0">0</option>
                <option value="50">0.5</option>
                <option value="100">1.0</option>
                <option value="200">2.0</option>
                <option value="300">3.0</option>
                <option value="500">5.0</option>
              </select>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.paragraph')}>
            {/* 行距（round72：三路 —— 聚焦文本 style.lineHeight / shape；旧版弹「请先选择元素」） */}
            <div className="flex items-center gap-0.5">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('slide.lineSpacing')}</span>
              <select value={focusField ? String(textStyleOf(focusField).lineHeight || 1) : String(current.shapes[selectedEl?.type === 'shape' ? selectedEl.index : 0]?.lineHeight || 1)} onChange={(e) => applyLineHeight(parseFloat(e.target.value) || 1)} className="text-xs rounded-md px-1 py-1 ribbon-input" style={{ width: 64, height: 26, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <option value="1">1.0</option>
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="2">2.0</option>
                <option value="2.5">2.5</option>
              </select>
            </div>
            {/* 缩进（round72：三路生效） */}
            <RibbonButton icon="→|" label={t('slide.indentMore')} onClick={() => applyIndent(1)} />
            <RibbonButton icon="|←" label={t('slide.indentLess')} onClick={() => applyIndent(-1)} />
            {/* 项目符号 / 编号（round72：三路生效） */}
            <RibbonButton icon="•" label={t('slide.bulletList')} onClick={() => applyBullet('bullet')} />
            <RibbonButton icon="1." label={t('slide.numberedList')} onClick={() => applyBullet('numbered')} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.paragraph')}>
            {/* 对齐（round72：三路 —— 聚焦文本写 style.align；shape 同时写 paras 每段 align） */}
            <RibbonButton icon="⬅" label={t('slide.alignLeft')} onClick={() => applyAlign('left')} />
            <RibbonButton icon="⬌" label={t('slide.alignCenter')} onClick={() => applyAlign('center')} />
            <RibbonButton icon="➡" label={t('slide.alignRight')} onClick={() => applyAlign('right')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('slide.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('slide.shapes')} onClick={() => openPanel('shape')} />
              {showShapePanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {SHAPES.map(s => (
                      <button key={s.type} onClick={() => addShape(s.type)} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 60 }}>
                        <span style={{ fontSize: '20px' }}>{s.icon}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.wordArt')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('slide.wordArt')} onClick={() => openPanel('art')} />
              {showArtPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {ART_PRESETS.map(p => (
                      <button key={p.name} onClick={() => addArtText(p)} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 80 }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: p.color, textShadow: p.shadow ? '2px 2px 4px rgba(0,0,0,0.3)' : 'none' }}>Aa</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.illustration')}>
            <RibbonButton icon="🖼" label={t('slide.image')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const newShape: ShapeItem = {
                    type: 'rect', x: 200 * PXU, y: 150 * PXU, w: 240 * PXU, h: 180 * PXU,
                    fill: `url(${reader.result})`,
                    text: '', shadow: false, glow: false, gradient: '', rotation: 0,
                  }
                  updateActive({ shapes: [...current.shapes, newShape] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
            <RibbonButton icon="📊" label={t('slide.chart')} onClick={() => openPanel('chart')} title={t('slide.chart')} />
            {showChartPanel && (
              <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50, width: 240, padding: '0.6rem' }}>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('slide.chartData')}</div>
                <input id="sam-chart-data" type="text" defaultValue="12,28,40,65" className="w-full text-xs rounded-md px-2 py-1 mb-2 ribbon-input" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                <div className="grid grid-cols-3 gap-1">
                  {(['bar', 'line', 'pie'] as const).map(ct => (
                    <button key={ct} onClick={() => insertChart(ct, (document.getElementById('sam-chart-data') as HTMLInputElement)?.value || '')}
                      className="px-2 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>
                      {ct === 'bar' ? '📊' : ct === 'line' ? '📈' : '🥧'} {ct === 'bar' ? t('slide.chartBar') : ct === 'line' ? t('slide.chartLine') : t('slide.chartPie')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <RibbonButton icon="🎬" label={t('slide.video')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'video/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  recordHistory()
                  updateActive({ shapes: [...current.shapes, { type: 'rect', x: 160 * PXU, y: 120 * PXU, w: 480 * PXU, h: 270 * PXU, fill: '', text: '', shadow: false, glow: false, gradient: '', rotation: 0, media: { type: 'video', src: String(reader.result) } } as ShapeItem] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
            <RibbonButton icon="🔊" label={t('slide.audio')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'audio/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  recordHistory()
                  updateActive({ shapes: [...current.shapes, { type: 'rect', x: 280 * PXU, y: 200 * PXU, w: 240 * PXU, h: 48 * PXU, fill: '#1f2937', text: file.name, shadow: false, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 11, media: { type: 'audio', src: String(reader.result) } } as ShapeItem] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.flowchart')}>
            <RibbonButton icon="🔀" label={t('slide.flowchart')} onClick={() => {
              const newShapes: ShapeItem[] = [
                { type: 'roundRect', x: 20 * PXU, y: 200 * PXU, w: 150 * PXU, h: 60 * PXU, fill: '#4f46e5', text: t('slide.flow.start'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'rect', x: 220 * PXU, y: 200 * PXU, w: 150 * PXU, h: 60 * PXU, fill: '#10b981', text: t('slide.flow.process'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'diamond', x: 420 * PXU, y: 200 * PXU, w: 150 * PXU, h: 60 * PXU, fill: '#f59e0b', text: t('slide.flow.decision'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'roundRect', x: 620 * PXU, y: 200 * PXU, w: 160 * PXU, h: 60 * PXU, fill: '#ef4444', text: t('slide.flow.end'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
              ]
              updateActive({ shapes: [...current.shapes, ...newShapes] })
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.link')}>
            <RibbonButton icon="🔗" label={t('slide.hyperlink')} onClick={async () => {
              if (!selectedEl || selectedEl.type !== 'shape') { softHint(); return }
              const url = await askText('URL:', current.shapes[selectedEl.index]?.link || 'https://')
              if (!url) return
              updateShape(selectedEl.index, { link: url })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.link)} title={t('slide.hyperlinkTitle') || '为选中元素添加超链接'} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.text')}>
            <RibbonButton icon="📝" label={t('slide.footnote')} onClick={async () => {
              const n = await askText(t('slide.prompt.notes'), current.notes || '')
              if (n === null) return
              const txt = n.trim()
              if (!txt) return
              const shapes = current.shapes || []
              const idx = shapes.findIndex(s => s.isFootnote)
              if (idx >= 0) {
                updateShape(idx, { text: txt })
              } else {
                updateActive({ shapes: [...shapes, { type: 'rect', x: 16 * PXU, y: (canvasH - 22) * PXU, w: 776 * PXU, h: 16 * PXU, fill: '', text: txt, fontSize: 10, fontBold: false, fontColor: '#64748b', textAlign: 'left', isFootnote: true } as ShapeItem] })
              }
            }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'design' && (<>
          {/* MS Office 风格主题 */}
          <RibbonGroup label={t('slide.theme')}>
            <div className="flex items-center gap-1 px-1">
              {[
                { id: 'office', name: 'Office', bg: '#ffffff', c1: '#1F4E79', c2: '#2E75B6' },
                { id: 'facets', name: 'Facets', bg: '#0F172A', c1: '#6366F1', c2: '#22D3EE' },
                { id: 'gallery', name: 'Gallery', bg: '#431407', c1: '#F59E0B', c2: '#EC4899' },
                { id: 'slice', name: 'Slice', bg: '#0C4A6E', c1: '#06B6D4', c2: '#FBBF24' },
                { id: 'depth', name: 'Depth', bg: '#064E3B', c1: '#10B981', c2: '#84CC16' },
              ].map(th => (
                <button key={th.id} onClick={() => updateActive({ bg: th.bg })} className="w-12 h-12 rounded-lg border-2 flex flex-col items-center justify-center text-[8px]"
                  style={{ background: th.bg, borderColor: current.bg === th.bg ? 'var(--color-primary)' : 'var(--color-border)', color: th.bg === '#ffffff' ? '#000' : '#fff' }}
                  title={th.name}>
                  <div style={{ background: th.c1, width: '80%', height: '4px', borderRadius: '2px', marginBottom: '2px' }} />
                  <div style={{ background: th.c2, width: '80%', height: '4px', borderRadius: '2px' }} />
                </button>
              ))}
            </div>
          </RibbonGroup>
          {/* MS Office 风格变体 */}
          <RibbonGroup label={t('slide.variants')}>
            <div className="flex items-center gap-1 px-1">
              {['#1F4E79', '#2E75B6', '#5B9BD5', '#9DC3E6'].map(c => (
                <button key={c} onClick={() => updateActive({ bg: c })} className="w-8 h-8 rounded-md border-2"
                  style={{ background: c, borderColor: current.bg === c ? 'var(--color-primary)' : 'var(--color-border)' }} />
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.background')}>
            <div className="flex items-center gap-1 px-2">
              {PRESET_COLORS.map(c => (
                <button key={c.value} onClick={() => updateActive({ bg: c.value })} className="w-7 h-7 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: c.value, borderColor: current.bg === c.value ? 'var(--color-primary)' : 'var(--color-border)' }} title={c.name} />
              ))}
            </div>
            <RibbonButton icon="🎨" label={t('slide.bgFormat')} onClick={async () => {
              const color = await askText(t('slide.bgFormatPrompt'), current.bg)
              if (color) updateActive({ bg: color })
            }} title={t('slide.bgFormatTitle')} />
            <RibbonButton icon="🖼" label={t('slide.bgImage')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => updateActive({ bg: `url(${reader.result})` })
                reader.readAsDataURL(file)
              }
              input.click()
            }} title={t('slide.bgImageTitle')} />
          </RibbonGroup>
          {/* MS Office 风格幻灯片大小 */}
          <RibbonGroup label={t('slide.slideSize')}>
            <RibbonButton icon="📺" label={t('slide.widescreen')} onClick={() => { recordHistory(); setDeckW(DECK_W_169); setDeckH(DECK_H_169) }} active={deckW === DECK_W_169 && deckH === DECK_H_169} title={t('slide.widescreenTitle')} />
            <RibbonButton icon="🖥" label={t('slide.standard')} onClick={() => { recordHistory(); setDeckW(DECK_W_43); setDeckH(DECK_H_43) }} active={deckW === DECK_W_43 && deckH === DECK_H_43} title={t('slide.standardTitle')} />
            <RibbonButton icon="⚙️" label={t('slide.customSize')} onClick={async () => {
              const wpx = await askText(t('slide.customSize') + ' (px, 96dpi):', String(Math.round(deckW / 9525)))
              if (!wpx) return
              const hpx = await askText('height (px):', String(Math.round(deckH / 9525)))
              if (!hpx) return
              const w = Math.round(parseFloat(wpx) * 9525), h = Math.round(parseFloat(hpx) * 9525)
              if (!w || !h || w < 10 || h < 10) { alert('Invalid size'); return }
              recordHistory(); setDeckW(w); setDeckH(h)
            }} title={t('slide.customSizeTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.shapeStyle')}>
            {/* 效果按钮作用于当前选中元素（未选时提示），不再默默作用于最后一个形状 */}
            <RibbonButton icon="🌈" label={t('slide.gradient')} onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { gradient: sh.gradient ? '' : '6366f1,818cf8' })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.gradient)} />
            <RibbonButton icon="💫" label={t('slide.glow')} onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { glow: !sh.glow, glowColor: sh.glowColor || (sh.fill && !sh.fill.startsWith('url') ? sh.fill : '#818cf8') })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.glow)} />
            <RibbonButton icon="🌑" label={t('slide.shadow')} onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { shadow: !sh.shadow })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.shadow)} />
            <RibbonButton icon="🔄" label={t('slide.rotate')} onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { rotation: ((sh.rotation || 0) + 15) % 360 })
            }} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'modern' && (<>
          {/* 主题预设 */}
          <RibbonGroup label="Theme">
            <div className="flex items-center gap-1 px-1">
              {[
                { id: 'aurora', name: 'Aurora', bg: '#0B1120', c1: '#6366F1', c2: '#22D3EE' },
                { id: 'midnight', name: 'Midnight', bg: '#020617', c1: '#818CF8', c2: '#F472B6' },
                { id: 'ocean', name: 'Ocean', bg: '#0C4A6E', c1: '#06B6D4', c2: '#FBBF24' },
                { id: 'sunset', name: 'Sunset', bg: '#431407', c1: '#F59E0B', c2: '#EC4899' },
                { id: 'minimal', name: 'Minimal', bg: '#FFFFFF', c1: '#0F172A', c2: '#6366F1' },
              ].map(th => (
                <button key={th.id} onClick={() => updateActive({ bg: th.bg })} className="w-12 h-12 rounded-lg border-2 transition-transform hover:scale-110 flex flex-col items-center justify-center text-[8px] font-bold"
                  style={{ background: th.bg, borderColor: current.bg === th.bg ? 'var(--color-primary)' : 'var(--color-border)', color: th.bg === '#FFFFFF' ? '#0F172A' : '#F8FAFC' }}
                  title={th.name}>
                  <span style={{ color: th.c1 }}>●</span>
                  <span style={{ color: th.c2 }}>●</span>
                </button>
              ))}
            </div>
          </RibbonGroup>

          {/* 渐变背景 */}
          <RibbonGroup label="Gradient BG">
            <div className="flex items-center gap-1 px-1">
              {[
                { name: 'Indigo', colors: '0B1120,131C30' },
                { name: 'Aurora', colors: '1e1b4b,312e81' },
                { name: 'Ocean', colors: '0C4A6E,0E7490' },
                { name: 'Sunset', colors: '431407,9A3412' },
                { name: 'Forest', colors: '064E3B,065F46' },
              ].map(g => (
                <button key={g.name} onClick={() => {
                  // 渐变背景通过两个色叠加近似: 用第一色作 bg
                  const c1 = g.colors.split(',')[0]
                  updateActive({ bg: '#' + c1 })
                }} className="w-10 h-10 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: `linear-gradient(135deg, #${g.colors.split(',')[0]}, #${g.colors.split(',')[1]})`, borderColor: 'var(--color-border)' }}
                  title={g.name + ' 渐变'} />
              ))}
            </div>
          </RibbonGroup>

          {/* 现代组件 */}
          <RibbonGroup label="Components">
            <RibbonButton icon="📊" label="KPI Card" onClick={() => {
              const x = (200 + current.shapes.length * 50) * PXU
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200 * PXU, w: 300 * PXU, h: 180 * PXU, fill: '#1A2540', stroke: '#334155', strokeWidth: 2, text: '10x', fontSize: 28, fontBold: true, fontColor: '#818CF8', font: 'Space Grotesk', shadow: true, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                  { type: 'rect', x: x + 30 * PXU, y: 230 * PXU, w: 60 * PXU, h: 8 * PXU, fill: '#6366F1', stroke: '', strokeWidth: 0, text: '', fontSize: 0, fontBold: false, fontColor: '', font: '', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                  { type: 'rect', x, y: 310 * PXU, w: 300 * PXU, h: 30 * PXU, fill: '', stroke: '', strokeWidth: 0, text: 'PERF GAIN', fontSize: 10, fontBold: true, fontColor: '#94A3B8', font: 'Inter', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="💡" label="Glass Card" onClick={() => {
              const x = (200 + current.shapes.length * 30) * PXU
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200 * PXU, w: 350 * PXU, h: 200 * PXU, fill: '#1A2540', stroke: '#334155', strokeWidth: 2, text: 'Glass Card', fontSize: 16, fontBold: true, fontColor: '#F8FAFC', font: 'Space Grotesk', shadow: true, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="📝" label="Code Block" onClick={() => {
              const x = (200 + current.shapes.length * 30) * PXU
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200 * PXU, w: 400 * PXU, h: 150 * PXU, fill: '#0B1120', stroke: '#1e293b', strokeWidth: 2, text: 'fmt.Println("Hello")', fontSize: 12, fontBold: false, fontColor: '#86EFAC', font: 'Consolas', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="🏷️" label="Pill" onClick={() => {
              const x = (200 + current.shapes.length * 30) * PXU
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200 * PXU, w: 120 * PXU, h: 30 * PXU, fill: '#6366F1', stroke: '', strokeWidth: 0, text: 'NEW', fontSize: 9, fontBold: true, fontColor: '#FFFFFF', font: 'Inter', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="✨" label="Glow Text" onClick={() => {
              const x = (200 + current.shapes.length * 30) * PXU
              updateActive({
                shapes: [...current.shapes,
                  { type: 'rect', x, y: 200 * PXU, w: 400 * PXU, h: 60 * PXU, fill: '', stroke: '', strokeWidth: 0, text: 'Glow Title', fontSize: 28, fontBold: true, fontColor: '#F8FAFC', font: 'Space Grotesk', shadow: false, glow: true, glowColor: '#6366F1', glowRadius: 60000, gradient: '', rotation: 0 },
                ]
              })
            }} />
          </RibbonGroup>

          {/* 玻璃质感 */}
          <RibbonGroup label="Effects">
            <RibbonButton icon="🔮" label="Glass" onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { glow: !sh.glow, glowColor: sh.glowColor || '#94a3b8' })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.glow)} />
            <RibbonButton icon="🌗" label="Shadow" onClick={() => {
              if (selectedEl?.type !== 'shape') { softHint(); return }
              const sh = current.shapes[selectedEl.index]
              updateShape(selectedEl.index, { shadow: !sh.shadow })
            }} active={!!(selectedEl?.type === 'shape' && current.shapes[selectedEl.index]?.shadow)} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'animations' && (<>
          <RibbonGroup label={t('slide.entranceAnim')}>
            <div className="relative">
              <RibbonButton icon="➡" label={t('slide.enter')} onClick={() => openPanel('anim')} />
              {showAnimPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, top: '100%', zIndex: 50 }}>
                  <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.enter')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {ENTRANCE_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'entrance')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.emphasis')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EMPHASIS_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'emphasis')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.exit')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EXIT_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'exit')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.sound')}</div>
                  <div className="flex items-center gap-1">
                    <select value={pendingSound} onChange={(e) => setPendingSound(e.target.value)} className="text-xs rounded-md px-1 py-1 ribbon-input" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                      <option value="none">{t('slide.soundNone')}</option>
                      <option value="click">{t('slide.soundClick')}</option>
                      <option value="laser">{t('slide.soundLaser')}</option>
                      <option value="chime">{t('slide.soundChime')}</option>
                      <option value="applause">{t('slide.soundApplause')}</option>
                      <option value="whoosh">{t('slide.soundWhoosh')}</option>
                    </select>
                    <button onClick={() => playSound(pendingSound)} className="px-2 py-1 text-xs rounded-md" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>▶</button>
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.animPane')}>
            <div className="flex flex-col gap-0.5 max-h-[48px] overflow-y-auto">
              {current.animations.length === 0 ? (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.noAnim')}</span>
              ) : current.animations.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: a.category === 'entrance' ? '#10b981' : a.category === 'emphasis' ? '#f59e0b' : '#ef4444' }}>●</span>
                  <span>{a.effect}</span>
                  <button onClick={() => removeAnimation(i)} className="text-[8px] opacity-50 hover:opacity-100">✕</button>
                </div>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.timing')}>
            <RibbonButton icon="⏱" label={autoPlay ? `${t('slide.auto')}${autoPlaySec}s` : t('slide.manual')} onClick={() => setAutoPlay(!autoPlay)} active={autoPlay} />
            {autoPlay && (
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={String(autoPlaySec)}
                onChange={v => setAutoPlaySec(parseInt(v))}
                options={[
                  { label: '3s', value: '3' },
                  { label: '5s', value: '5' },
                  { label: '10s', value: '10' },
                  { label: '15s', value: '15' },
                ]}
              />
            )}
          </RibbonGroup>
        </>)}

        {ribbonTab === 'transition' && (<>
          <RibbonGroup label={t('slide.transitionEffect')}>
            <div className="flex items-center gap-1 px-2">
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => updateActive({ transition: t.id })} className="px-3 py-1.5 text-xs rounded-md transition-colors"
                  style={{ background: current.transition === t.id ? 'var(--color-primary-light)' : 'transparent', color: current.transition === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{t.name}</button>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.notes')}>
            <RibbonButton icon="📝" label={t('slide.speakerNotes')} onClick={async () => { const n = await askText(t('slide.prompt.notes'), current.notes); if (n !== null) updateActive({ notes: n }) }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('slide.masterView') || '母版视图'}>
            {/* 对齐 MS PPT：母版视图下画布编辑母版形状，普通视图每页底层渲染母版装饰 */}
            <RibbonButton icon="🧬" label={masterView ? (t('slide.exitMaster') || '退出母版视图') : (t('slide.masterView') || '幻灯片母版')}
              onClick={() => { setMasterView(!masterView); setHandoutView(false); setSelectedEl(null) }} active={masterView}
              title={t('slide.masterTitle') || '母版形状会出现在每页幻灯片底层，保存后写盘 slideMaster1'} />
            {/* round66：讲义母版（对齐 MS PPT「讲义母版视图」—— 母版家族三件套补齐）。
                讲义母版编辑页眉/页脚/日期/页码四占位符的文本/字号/颜色；打印讲义时应用。 */}
            <RibbonButton icon="🗒" label={handoutView ? (t('slide.exitHandoutMaster') || '退出讲义母版') : (t('slide.handoutMaster') || '讲义母版')}
              onClick={() => { setHandoutView(!handoutView); setMasterView(false); setSelectedEl(null) }} active={handoutView}
              title={t('slide.handoutTitle') || '讲义页的页眉/页脚/日期/页码，打印讲义时应用'} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.zoom')}>
            <RibbonButton icon="−" label={t('slide.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label={t('slide.zoomIn')} onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.navigation')}>
            <RibbonButton icon="←" label={t('slide.prev')} onClick={() => switchSlide(Math.max(0, active - 1))} disabled={active === 0} />
            <RibbonButton icon="→" label={t('slide.next')} onClick={() => switchSlide(Math.min(slides.length - 1, active + 1))} disabled={active === slides.length - 1} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.slideshow')}>
            <RibbonButton icon="▶" label={t('slide.fromStart')} onClick={() => { setActive(0); startPresent() }} />
            <RibbonButton icon="▶" label={t('slide.fromCurrent')} onClick={startPresent} />
          </RibbonGroup>
          {/* MS Office 风格打印 */}
          <RibbonGroup label={t('print.title')}>
            <RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintDialogOpen(true)} data-testid="ppt-print-btn" title={t('print.title')} />
          <RibbonButton icon="▦" label={t('view.slideSorter')} onClick={() => setBrowseMode(true)} data-testid="ppt-browse-btn" title={t('view.slideSorter')} /></RibbonGroup>
        </>)}
      </div>
      )}

      {/* 打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="ppt"
        printSelector=".slide-canvas"
        renderPrint={(settings) => buildPptPrintView(settings)}
        renderPreview={(settings) => buildPptPrintView(settings)}
      />

      {/* round57：幻灯片浏览视图 —— 覆盖层（常驻 display 切换）。
          MS PPT 幻灯片浏览：概览网格，点击卡片跳转该页并返回编辑。 */}
      <div
        key="ppt-browse-view"
        style={{
          display: browseMode ? 'flex' : 'none',
          position: 'fixed', inset: 0, zIndex: 60, background: 'var(--color-bg)',
          flexDirection: 'column',
        }}
        data-testid="ppt-browse-view"
      >
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>▦ {t('view.slideSorter')}</span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{tf('view.slidesTotal', `共 ${slides.length} 张`, { n: slides.length })}</span>
          </div>
          <button
            data-testid="ppt-browse-back"
            onClick={() => setBrowseMode(false)}
            className="px-3 py-1.5 text-xs rounded-md font-medium"
            style={{ background: 'var(--color-primary)', color: 'white' }}
          >← {t('view.backToEdit')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6" data-testid="ppt-browse-wrap">
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {slides.map((sl, i) => (
              <div
                key={sl.id}
                data-testid={`ppt-browse-card-${i}`}
                onClick={() => { switchSlide(i); setBrowseMode(false) }}
                className="cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:shadow-lg"
                style={{ borderColor: i === active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div style={{ background: sl.bg }}>
                  <SlideThumb slide={sl} deco={sl.deco} width={240} aspect={deckH / deckW} />
                </div>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>{i + 1}. {sl.title || `Slide ${i + 1}`}</span>
                  {sl.notes ? <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>🗒</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 左侧缩略图 */}
        <div className="w-40 lg:w-48 flex-shrink-0 overflow-auto p-2 border-r" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{t('slide.slides')}</span>
            <button onClick={addSlide} className="text-sm font-medium px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>+</button>
          </div>
          <div className="space-y-2">
            {slides.map((s, i) => (
              <div key={s.id} onClick={() => switchSlide(i)} className={`group relative p-1.5 border-2 rounded-lg cursor-pointer transition-all ${i === active ? 'shadow-md' : 'hover:shadow-sm'}`}
                style={{ borderColor: i === active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}>
                {/* 真实迷你画布：完整渲染形状/文字样式/图片，修复缩略图只剩裸文字 */}
                <div className="rounded overflow-hidden relative" style={{ background: s.bg }}>
                  <SlideThumb slide={s} deco={s.deco} width={thumbWidth} aspect={deckH / deckW} />
                  {s.animations.length > 0 && (
                    <div className="absolute top-0.5 right-0.5 text-[8px] px-1 rounded" style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}>✨{s.animations.length}</div>
                  )}
                </div>
                <div className="absolute -top-2 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); duplicateSlide(i) }} className="w-5 h-5 rounded-full bg-slate-600 text-white text-[10px] flex items-center justify-center">⎘</button>
                  {slides.length > 1 && <button onClick={e => { e.stopPropagation(); deleteSlide(i) }} className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center">×</button>}
                </div>
                <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: i === active ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: i === active ? 'white' : 'var(--color-text-muted)' }}>{i + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间画布（高度随页面比例：宽 808 固定，高 = 808·pageH/pageW） */}
        <div className="flex-1 flex items-center justify-center p-3 sm:p-6 overflow-auto min-h-0" style={{ background: 'var(--color-bg-alt)' }}>
          {handoutView ? (
            /* round66：讲义母版视图（对齐 MS PPT「讲义母版」）—— A4 纵向纸张编辑卡：
               四占位符（日期左上/页眉右上/页脚左下/页码右下）+ 样式（字号/颜色），
               中央为讲义缩略布局示意（浅色幻灯片框 + 虚线提示区）。 */
            <div className="handout-master-canvas bg-white shadow-xl rounded-lg animate-fade-in relative flex flex-col"
              style={{ width: 595, height: 842, flexShrink: 0 }}>
              {/* 顶部两占位：日期（左）/ 页眉（右） */}
              <div className="flex items-start justify-between px-8 pt-6" style={{ gap: 16 }}>
                <label className="flex flex-col items-start" style={{ minWidth: 0 }}>
                  <span className="text-[9px] opacity-50 mb-0.5">{t('slide.handoutDtLabel') || '日期'}</span>
                  <input data-testid="handout-date" value={handout.date} onChange={e => setHandout(h => ({ ...h, date: e.target.value }))}
                    className="text-xs outline-none bg-transparent border-b border-dashed py-0.5" style={{ width: 170, color: handout.color, fontSize: handout.fontSize, borderColor: 'var(--color-border)' }}
                    placeholder="2026-11-24" />
                </label>
                <label className="flex flex-col items-end text-right" style={{ minWidth: 0 }}>
                  <span className="text-[9px] opacity-50 mb-0.5">{t('slide.handoutHdrLabel') || '页眉'}</span>
                  <input data-testid="handout-header" value={handout.header} onChange={e => setHandout(h => ({ ...h, header: e.target.value }))}
                    className="text-xs outline-none bg-transparent border-b border-dashed py-0.5 text-right" style={{ width: 170, color: handout.color, fontSize: handout.fontSize, borderColor: 'var(--color-border)' }}
                    placeholder={t('slide.handoutHdrLabel') || '页眉'} />
                </label>
              </div>
              {/* 中央：讲义缩略布局示意（1/2/3/4/6/9 张每页的排布示意线框） */}
              <div className="flex-1 flex items-center justify-center px-10 py-6">
                <div className="w-full h-full rounded border-2 border-dashed flex items-center justify-center text-[10px]"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
                  {t('slide.handoutPreview') || '讲义页预览（A4 纵向）'} · {slides.length} {t('slide.slideCount') || '页'}
                </div>
              </div>
              {/* 底部两占位：页脚（左）/ 页码（右） */}
              <div className="flex items-end justify-between px-8 pb-6" style={{ gap: 16 }}>
                <label className="flex flex-col items-start" style={{ minWidth: 0 }}>
                  <span className="text-[9px] opacity-50 mb-0.5">{t('slide.handoutFtrLabel') || '页脚'}</span>
                  <input data-testid="handout-footer" value={handout.footer} onChange={e => setHandout(h => ({ ...h, footer: e.target.value }))}
                    className="text-xs outline-none bg-transparent border-b border-dashed py-0.5" style={{ width: 170, color: handout.color, fontSize: handout.fontSize, borderColor: 'var(--color-border)' }}
                    placeholder={t('slide.handoutFtrLabel') || '页脚'} />
                </label>
                <label className="flex flex-col items-end text-right" style={{ minWidth: 0 }}>
                  <span className="text-[9px] opacity-50 mb-0.5">{t('slide.handoutNumLabel') || '页码'}</span>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" data-testid="handout-pageon" checked={handout.pageOn} onChange={e => setHandout(h => ({ ...h, pageOn: e.target.checked }))} />
                    <span data-testid="handout-page-sample" className="border-b border-dashed py-0.5" style={{ minWidth: 40, textAlign: 'right', color: handout.color, fontSize: handout.fontSize, borderColor: 'var(--color-border)' }}>1</span>
                  </div>
                </label>
              </div>
              {/* 样式工具行（字号 + 颜色） */}
              <div className="flex items-center gap-4 px-8 pb-5 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text)' }}>
                  <span className="opacity-60">{t('slide.handoutFontLabel') || '字号 (pt)'}</span>
                  <input type="number" min={6} max={36} data-testid="handout-fontsize" value={handout.fontSize}
                    onChange={e => setHandout(h => ({ ...h, fontSize: Math.max(6, Math.min(36, Number(e.target.value) || 10)) }))}
                    className="w-14 rounded border px-1 py-0.5 text-[10px]" style={{ borderColor: 'var(--color-border)' }} />
                </label>
                <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text)' }}>
                  <span className="opacity-60">{t('slide.handoutColorLabel') || '文字颜色'}</span>
                  <input type="color" data-testid="handout-color" value={handout.color} onChange={e => setHandout(h => ({ ...h, color: e.target.value }))}
                    className="h-5 w-8 rounded border" style={{ borderColor: 'var(--color-border)' }} />
                </label>
              </div>
            </div>
          ) : (
          <>
          {/* slide-canvas：打印选择器锚点（PrintDialog printSelector 与 e2e 依赖） */}
          <div className="slide-canvas bg-white shadow-xl rounded-lg animate-fade-in relative overflow-hidden"
            style={{ width: 808, height: canvasH, background: current.bg, boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12)', transform: `scale(${zoom / 100})`, transformOrigin: 'center', flexShrink: 0 }}>
            {/* round58：背景纹理层（bgRef → 主题 blipFill + duotone；multiply 近似双色调） */}
            {current.bgImg && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...bgImgStyle(current.bgImg, current.bgImgTileW, current.bgImgTileH) }} />}
            <div className="absolute inset-0 flex flex-col p-6 sm:p-10 md:p-14 relative" onMouseDown={e => { setSelectedEl(null); if (e.target === e.currentTarget) setFocusField(null) }}>
              {/* 文字内容（round73：标题/正文改为 contentEditable 富文本 RichField ——
                  支持选定文字调整字体/字号/颜色/加粗/斜体/下划线/删除线/字符间距，
                  旧 input/textarea 只能整段样式。纯文本 title/content 与 paras 双轨同步。） */}
              {current.layout === 'title' && (
                <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10">
                  <RichField field="title" paras={current.titleParas} plain={current.title} renderKey={`t-${active}`} className="text-2xl sm:text-3xl md:text-4xl text-center bg-transparent w-full" style={{ letterSpacing: '-0.02em', ...fieldStyleToCSS(current.titleStyle, 'title', isDark, ptToPxUI) }} placeholder={t('slide.placeholder.title')} onFocus={() => setFocusField('title')} onInput={(ps) => commitFieldParas('title', ps)} />
                  <RichField field="content" paras={current.contentParas} plain={current.content} renderKey={`c-${active}`} className="text-sm sm:text-base md:text-lg text-center mt-3 bg-transparent w-full" style={fieldStyleToCSS(current.contentStyle, 'content', isDark, ptToPxUI)} placeholder={t('slide.placeholder.subtitle')} onFocus={() => setFocusField('content')} onInput={(ps) => commitFieldParas('content', ps)} />
                </div>
              )}
              {current.layout === 'content' && (
                <>
                  <RichField field="title" paras={current.titleParas} plain={current.title} renderKey={`t-${active}`} className="text-xl sm:text-2xl mb-4 bg-transparent relative z-10" style={fieldStyleToCSS(current.titleStyle, 'title', isDark, ptToPxUI)} placeholder={t('slide.placeholder.title')} onFocus={() => setFocusField('title')} onInput={(ps) => commitFieldParas('title', ps)} />
                  <div className="w-12 h-1 rounded mb-4" style={{ background: 'var(--color-primary)' }}></div>
                  <RichField field="content" paras={current.contentParas} plain={current.content} renderKey={`c-${active}`} className="flex-1 text-sm sm:text-base bg-transparent relative z-10" style={{ ...fieldStyleToCSS(current.contentStyle, 'content', isDark, ptToPxUI), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} placeholder={t('slide.placeholder.content')} onFocus={() => setFocusField('content')} onInput={(ps) => commitFieldParas('content', ps)} />
                </>
              )}
              {current.layout === 'section' && (
                <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10 px-10">
                  <div className="w-14 h-1.5 rounded mb-5" style={{ background: 'var(--color-primary)' }}></div>
                  <RichField field="title" paras={current.titleParas} plain={current.title} renderKey={`t-${active}`} className="text-3xl sm:text-4xl text-center bg-transparent w-full" style={fieldStyleToCSS(current.titleStyle, 'title', isDark, ptToPxUI)} placeholder={t('slide.placeholder.title')} onFocus={() => setFocusField('title')} onInput={(ps) => commitFieldParas('title', ps)} />
                  <RichField field="content" paras={current.contentParas} plain={current.content} renderKey={`c-${active}`} className="text-sm sm:text-base text-center mt-4 bg-transparent w-full" style={fieldStyleToCSS(current.contentStyle, 'content', isDark, ptToPxUI)} placeholder={t('slide.placeholder.subtitle')} onFocus={() => setFocusField('content')} onInput={(ps) => commitFieldParas('content', ps)} />
                </div>
              )}
              {current.layout === 'blank' && !current.shapes.length && (
                <RichField field="content" paras={current.contentParas} plain={current.content} renderKey={`c-${active}`} className="flex-1 text-sm bg-transparent relative z-10" style={{ ...fieldStyleToCSS(current.contentStyle, 'content', isDark, ptToPxUI), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} placeholder={t('slide.placeholder.blank')} onFocus={() => setFocusField('content')} onInput={(ps) => commitFieldParas('content', ps)} />
              )}

              {/* 母版/版式装饰层（对齐 MS PPT：每页底层渲染该页版式的非占位符形状；
                  母版视图下不重复渲染。round58 二轮：per-slide deco —— 之前首页
                  装饰泄漏到所有页（无装饰页出现多余分隔线） */}
              {!masterView && (current.deco || []).length > 0 && (
                <div className="absolute inset-0" style={{ zIndex: 15, pointerEvents: 'none' }}>
                  {(current.deco || []).map((msh, mi) => (
                    <div key={'m' + mi} className="absolute" style={{
                      left: `${msh.x / 8}px`, top: `${msh.y / 8}px`, width: `${msh.w / 8}px`, height: `${msh.h / 8}px`,
                      transform: msh.rotation ? `rotate(${msh.rotation}deg)` : '',
                    }}>
                      <div style={{
                        width: '100%', height: '100%',
                        justifyContent: msh.vAlign === 'top' ? 'flex-start' : msh.vAlign === 'bottom' ? 'flex-end' : 'center',
                        display: 'flex', flexDirection: 'column',
                        background: msh.gradient ? `linear-gradient(135deg, #${msh.gradient.split(',')[0]}, #${msh.gradient.split(',')[1]})` : msh.fill,
                        borderRadius: msh.type === 'roundRect' ? '8px' : msh.type === 'ellipse' ? '50%' : msh.type === 'can' ? '50% / 12%' : '0',
                        clipPath: SHAPE_CLIP[msh.type],
                        border: msh.stroke ? `${Math.max(1, msh.strokeWidth || 1)}px solid ${msh.stroke}` : 'none',
                        color: msh.fontColor || (msh.fill && !msh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
                        fontSize: msh.fontSize ? `${msh.fontSize}px` : '12px',
                        fontWeight: msh.fontBold ? 700 : 400,
                        fontStyle: (msh as any).italic ? 'italic' : undefined,
                        textAlign: msh.textAlign || 'center',
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>{msh.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* 形状渲染层 — zIndex 20 > 文字内容 z-10，确保形状可点击选中/拖拽 */}
              {current.shapes.map((sh, i) => (
                <div key={i} className="absolute flex items-center justify-center group cursor-move"
                  onMouseDown={(e) => { if (editing?.type === 'shape' && editing?.index === i) return; e.stopPropagation(); const sel = pickSelection(sh.groupId ? groupShapeSels(sh.groupId) : [{ type: 'shape', index: i }], { type: 'shape', index: i }, e.shiftKey); dragRecordedRef.current = false; setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.x, origY: sh.y, mode: 'move', items: dragItemsOf(sel.length ? sel : [{ type: 'shape', index: i }]) }) }}
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit('shape', i) }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); pickSelection(sh.groupId ? groupShapeSels(sh.groupId) : [{ type: 'shape', index: i }], { type: 'shape', index: i }, e.shiftKey); setContextMenu({ x: e.clientX, y: e.clientY, type: 'shape', index: i }) }}
                  style={{
                    left: `${sh.x / 8}px`, top: `${sh.y / 8}px`, width: `${sh.w / 8}px`, height: `${sh.h / 8}px`,
                    transform: sh.rotation ? `rotate(${sh.rotation}deg)` : '',
                    zIndex: 20,
                    outline: isSelEl('shape', i) ? '2px solid var(--color-primary)' : 'none',
                    outlineOffset: '2px',
                  }}>
                  {/* 形状内容层 — clip-path 只作用于形状本身，不影响手柄 */}
                  <div className="absolute inset-0 flex flex-col" style={{
                    justifyContent: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
                    background: sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill,
                    backgroundSize: sh.fill.startsWith('url') ? 'cover' : undefined,
                    backgroundRepeat: sh.fill.startsWith('url') ? 'no-repeat' : undefined,
                    backgroundPosition: sh.fill.startsWith('url') ? 'center' : undefined,
                    borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : sh.type === 'can' ? '50% / 12%' : '0',
                    // 几何裁剪：统一用 SHAPE_CLIP 表（主画布与缩略图一致，新增流程图形状自动生效）
                    clipPath: SHAPE_CLIP[sh.type],
                    boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
                    filter: sh.glow ? `drop-shadow(0 0 ${Math.min(28, Math.max(4, (sh.glowRadius || 60000) / 5000))}px ${sh.glowColor || (sh.fill && !sh.fill.startsWith('url') ? sh.fill : '#818cf8')})` : 'none',
                    border: sh.stroke
                      ? `${Math.max(1, sh.strokeWidth || 1)}px solid ${sh.stroke}`
                      : (sh.noDecor ? 'none' : (sh.type === 'rect' || sh.type === 'roundRect' ? '1px solid rgba(0,0,0,0.1)' : 'none')),
                    color: sh.fontColor || (sh.fill && !sh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
                    fontSize: sh.fontSize ? `${sh.fontSize}px` : '12px',
                    fontFamily: sh.font || undefined,
                    fontWeight: sh.fontBold ? 700 : 400,
                    textAlign: sh.textAlign || 'center',
                    lineHeight: sh.lineHeight || 1.2,
                    paddingLeft: sh.indent ? `${sh.indent * 12}px` : undefined,
                    width: '100%',
                    // round29：display 必须保持 flex —— 内联 block 会覆盖
                    // className 的 flex，justify-content:center（垂直对齐
                    // vanchor ctr）随之失效，文字全部堆到框顶（装备工业
                    // PPT 标题应在 40-47% 中央却渲染在 22-28%）。
                    display: 'flex',
                  }}>
                    {sh.media && sh.media.type === 'video' && (
                      <video src={sh.media.src} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', pointerEvents: 'none' }} />
                    )}
                    {sh.media && sh.media.type === 'audio' && (
                      <div className="w-full h-full flex items-center px-2"><audio src={sh.media.src} controls style={{ width: '100%', pointerEvents: 'none' }} /></div>
                    )}
                    {editing?.type === 'shape' && editing?.index === i ? (
                      <textarea ref={editAreaRef} defaultValue={sh.text} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); commitEdit() } }} className="w-full h-full outline-none bg-transparent resize-none" style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', textAlign: (sh.textAlign || 'center') as any, lineHeight: 'inherit', background: 'rgba(255,255,255,0.15)', padding: 2 }} />
                    ) : sh.text && !(sh.media && (sh.media.type === 'video' || sh.media.type === 'audio')) && (<span style={{ pointerEvents: 'none', display: 'block', textShadow: sh.fill && !sh.fill.startsWith('url') ? '0 1px 2px rgba(0,0,0,0.3)' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {sh.paras && sh.paras.some(p => p.runs && p.runs.length) ? (
                        sh.paras.map((p, pi) => {
                          const pnum = (p as any).numbered ? 1 + (sh.paras || []).slice(0, pi).filter((q: any) => q.numbered).length : 0
                          const pbullet = (p as any).bullet || pnum > 0
                          return (
                          <div key={pi} style={{ width: '100%', display: pbullet ? 'flex' : undefined, gap: pbullet ? 10 : undefined, textAlign: pbullet ? undefined : (p.align === 'c' ? 'center' : p.align === 'r' ? 'right' : 'left') }}>
                            {pbullet && <span style={{ color: (p as any).bulletColor || undefined, flex: '0 0 auto' }}>{pnum > 0 ? `${pnum}.` : ((p as any).bulletChar || '•')}</span>}
                            <span style={{ display: (p as any).bullet ? 'block' : undefined, flex: (p as any).bullet ? 1 : undefined, textAlign: (p as any).bullet ? (p.align === 'c' ? 'center' : p.align === 'r' ? 'right' : 'left') : undefined }}>
                            {((p.runs && p.runs.length) ? p.runs : [{ text: '' } as any]).map((r, ri) => (
                              <span key={ri} style={{
                                color: r.color || undefined,
                                fontSize: r.fontSize ? `${Math.max(8, r.fontSize)}px` : undefined,
                                fontWeight: r.bold ? 700 : undefined,
                                fontStyle: r.italic ? 'italic' : undefined,
                                textDecoration: r.underline ? 'underline' : undefined,
                                fontFamily: r.font || undefined,
                                whiteSpace: 'pre-wrap',
                              }}>{r.text}</span>
                            ))}
                            </span>
                          </div>
                          )
                        })
                      ) : sh.bullet
                        ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>•</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                        : sh.numbered
                        ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>{li + 1}.</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                        : sh.text}
                    </span>)}
                    {sh.link && (
                      <a href={sh.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        title={sh.link}
                        className="absolute bottom-0.5 right-1 text-[10px] no-underline"
                        style={{ pointerEvents: 'auto', color: '#60a5fa' }}>🔗</a>
                    )}
                  </div>
                  <button onClick={() => removeShape(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
                  {selectedEl?.type === 'shape' && selectedEl?.index === i && <>
                    <div onMouseDown={(e) => { e.stopPropagation(); dragRecordedRef.current = false; setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.w, origY: sh.h, mode: 'resize' }) }} className="absolute -bottom-1 -right-1 w-3 h-3 bg-white border-2 rounded-full cursor-se-resize" style={{ borderColor: 'var(--color-primary)', zIndex: 22 }} />
                    <div onMouseDown={(e) => { e.stopPropagation(); dragRecordedRef.current = false; setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.rotation || 0, origY: 0, mode: 'rotate' }) }} className="absolute -top-6 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 rounded-full cursor-grab" style={{ borderColor: 'var(--color-primary)', zIndex: 22 }} />
                  </>}
                </div>
              ))}

              {/* 艺术字渲染层 — zIndex 21 > 文字内容 z-10 */}
              {current.artTexts.map((at, i) => (
                <div key={i} className="absolute group cursor-move" onMouseDown={(e) => { if (editing?.type === 'art' && editing?.index === i) return; e.stopPropagation(); const sel = pickSelection([{ type: 'art', index: i }], { type: 'art', index: i }, e.shiftKey); dragRecordedRef.current = false; setDragInfo({ startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, mode: 'move', items: dragItemsOf(sel.length ? sel : [{ type: 'art', index: i }]) }) }} onDoubleClick={(e) => { e.stopPropagation(); startEdit('art', i) }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); pickSelection([{ type: 'art', index: i }], { type: 'art', index: i }, e.shiftKey); setContextMenu({ x: e.clientX, y: e.clientY, type: 'art', index: i }) }} style={{ left: `${at.x / 8}px`, top: `${at.y / 8}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '', zIndex: 21, outline: isSelEl('art', i) ? '2px solid var(--color-primary)' : 'none', outlineOffset: '4px' }}>
                  {editing?.type === 'art' && editing?.index === i ? (
                    <textarea ref={editAreaRef} defaultValue={at.text} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); commitEdit() } }} className="outline-none bg-transparent resize-none" style={{ fontSize: `${at.fontSize / 2.5}px`, fontWeight: 700, color: at.color, textAlign: 'center', background: 'rgba(255,255,255,0.15)', padding: 2, minWidth: 80 }} />
                  ) : (
                  <span style={{
                    fontSize: `${at.fontSize / 2.5}px`, fontWeight: 700,
                    color: at.color,
                    background: at.gradient ? `linear-gradient(135deg, #${at.gradient.split(',')[0]}, #${at.gradient.split(',')[1]})` : undefined,
                    WebkitBackgroundClip: at.gradient ? 'text' : undefined,
                    WebkitTextFillColor: at.gradient ? 'transparent' : undefined,
                    textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none',
                    filter: at.glow ? `drop-shadow(0 0 6px ${at.color})` : 'none',
                    WebkitTextStroke: at.outline ? `1px #${at.outline}` : 'none',
                  }}>{at.text}</span>
                  )}
                  <button onClick={() => removeArtText(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
                  {selectedEl?.type === 'art' && selectedEl?.index === i && <div onMouseDown={(e) => { e.stopPropagation(); dragRecordedRef.current = false; setDragInfo({ startX: e.clientX, startY: e.clientY, origX: at.rotation || 0, origY: 0, mode: 'rotate' }) }} className="absolute -top-6 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 rounded-full cursor-grab" style={{ borderColor: 'var(--color-primary)' }} />}
                </div>
              ))}

              {/* 动画指示器 */}
              {current.animations.length > 0 && (
                <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(79,70,229,0.1)', color: 'var(--color-primary)' }}>
                  ✨ {current.animations.length}
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-1.5 text-xs flex items-center gap-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>{t('slide.ready')}</span>
        <div className="flex-1" />
        <span>{t('slide.slideNum')} #{active + 1} / {slides.length}</span>
        {current.shapes.length > 0 && <span>📊 {t('slide.shapesCount')} {current.shapes.length}</span>}
        {current.animations.length > 0 && <span>✨ {t('slide.animsCount')} {current.animations.length}</span>}
        {current.transition && <span style={{ color: 'var(--color-primary)' }}>{t('slide.transitionLabel')}{TRANSITIONS.find(t => t.id === current.transition)?.name}</span>}
        {current.notes && <span>📝 {t('slide.notes')}</span>}
        {autoPlay && <span style={{ color: 'var(--color-primary)' }}>⏱ {t('slide.auto')} {autoPlaySec}s</span>}
        <button onClick={startPresent} className="btn btn-primary btn-sm">▶ {t('slide.play')}</button>
      </div>

      {/* 元素右键上下文菜单 — 对标 MS PPT（复制/剪切/粘贴、叠放层次等） */}
      {contextMenu && (
        <div className="fixed z-[100]" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="min-w-[180px] py-1 rounded-md shadow-lg border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <MenuItem label={t('slide.editText')} icon="✎" onClick={() => { startEdit(contextMenu.type, contextMenu.index); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <MenuItem label={t('slide.cut')} icon="✂" onClick={() => { cutSelected(); setContextMenu(null) }} />
            <MenuItem label={t('slide.copy')} icon="⧉" onClick={() => { copySelected(); setContextMenu(null) }} />
            <MenuItem label={t('slide.paste')} icon="📋" disabled={!clipboardRef.current} onClick={() => { pasteClipboard(); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            {/* 组合/取消组合：≥2 个形状可组合；点击成员已整组选中（pickSelection） */}
            <MenuItem label={tf('slide.group', '组合')} icon="⊞" disabled={selShapeCount < 2} onClick={() => { groupSelection(); setContextMenu(null) }} />
            <MenuItem label={tf('slide.ungroup', '取消组合')} icon="⊟" disabled={!(contextMenu.type === 'shape' && current.shapes[contextMenu.index]?.groupId)} onClick={() => { ungroupSelection(); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <div className="px-3 py-1 text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layer')}</div>
            <MenuItem label={t('slide.bringToFront')} icon="⤒" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'front'); else reorderArt(contextMenu.index, 'front'); setContextMenu(null) }} />
            <MenuItem label={t('slide.bringForward')} icon="↑" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'forward'); else reorderArt(contextMenu.index, 'forward'); setContextMenu(null) }} />
            <MenuItem label={t('slide.sendBackward')} icon="↓" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'backward'); else reorderArt(contextMenu.index, 'backward'); setContextMenu(null) }} />
            <MenuItem label={t('slide.sendToBack')} icon="⤓" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'back'); else reorderArt(contextMenu.index, 'back'); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <MenuItem label={t('slide.delete')} icon="🗑" danger onClick={() => { deleteSelection(); setContextMenu(null) }} />
          </div>
        </div>
      )}

      {/* 全屏放映模式 — 动画序列（入场→强调→退出）逐击触发，完整渲染形状样式 */}
      {presenting && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: '#000' }} onClick={nextPresent}>
          <div style={{ transform: `scale(${Math.min(window.innerWidth / 808, window.innerHeight / canvasH)})`, transformOrigin: 'center' }}>
          <div key={presentSlide} className={`relative overflow-hidden sl-trans-${presentingSlide.transition || 'none'}`} style={{ width: 808, height: canvasH, background: presentingSlide.bg }}>
            <div className="absolute inset-0">
              {/* round30：标题/正文层与编辑画布同构 —— 仅 title/content/section
                  布局渲染；文件打开的幻灯片 layout='blank'，内容全在 shapes 里，
                  旧代码无条件渲染 h1/p 导致双份内容 + 样式错乱 */}
              {(presentingSlide.layout === 'title' || presentingSlide.layout === 'section') && (
                <div className="absolute inset-0 flex flex-col justify-center items-center p-12 text-center">
                  <h1 className="text-5xl font-bold mb-6" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{presentingSlide.title}</h1>
                  {presentingSlide.content && <p className="text-xl" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#cbd5e1' : '#64748b' }}>{presentingSlide.content}</p>}
                </div>
              )}
              {presentingSlide.layout === 'content' && (
                <div className="absolute inset-0 flex flex-col p-12">
                  <h1 className="text-3xl font-bold mb-4" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{presentingSlide.title}</h1>
                  {presentingSlide.content && <p className="text-xl mt-2" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#cbd5e1' : '#64748b', whiteSpace: 'pre-wrap' }}>{presentingSlide.content}</p>}
                </div>
              )}
              {/* 母版装饰层（与编辑画布一致：底层渲染，播放同样可见） */}
              {masterShapes.map((msh, mi) => (
                <div key={'m' + mi} className="absolute" style={{
                  left: `${msh.x / 8}px`, top: `${msh.y / 8}px`, width: `${msh.w / 8}px`, height: `${msh.h / 8}px`,
                  transform: msh.rotation ? `rotate(${msh.rotation}deg)` : '',
                }}>
                  <div style={{
                    width: '100%', height: '100%',
                    justifyContent: msh.vAlign === 'top' ? 'flex-start' : msh.vAlign === 'bottom' ? 'flex-end' : 'center',
                    display: 'flex', flexDirection: 'column',
                    background: msh.gradient ? `linear-gradient(135deg, #${msh.gradient.split(',')[0]}, #${msh.gradient.split(',')[1]})` : msh.fill,
                    borderRadius: msh.type === 'roundRect' ? '8px' : msh.type === 'ellipse' ? '50%' : msh.type === 'can' ? '50% / 12%' : '0',
                    clipPath: SHAPE_CLIP[msh.type],
                    border: msh.stroke ? `${Math.max(1, msh.strokeWidth || 1)}px solid ${msh.stroke}` : 'none',
                    color: msh.fontColor || (msh.fill && !msh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
                    fontSize: msh.fontSize ? `${msh.fontSize}px` : '12px',
                    fontWeight: msh.fontBold ? 700 : 400,
                    fontStyle: (msh as any).italic ? 'italic' : undefined,
                    textAlign: msh.textAlign || 'center',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{msh.text}</div>
                </div>
              ))}
              {presentingSlide.shapes.map((sh, i) => {
                // 动画序列：按 animations 数组顺序逐步触发；入场未到隐藏，强调播放一次，退出后消失
                const seq = presentingSlide.animations
                const idxOf = (a: AnimItem) => seq.indexOf(a)
                const myEnt = seq.filter(a => a.category === 'entrance' && a.target === `shape_${i}`)
                const myEmph = seq.filter(a => a.category === 'emphasis' && a.target === `shape_${i}`)
                const myExit = seq.filter(a => a.category === 'exit' && a.target === `shape_${i}`)
                const revealed = myEnt.length === 0 || myEnt.every(a => idxOf(a) < presentAnimStep)
                const justEnt = myEnt.find(a => idxOf(a) === presentAnimStep - 1)
                const justEmph = myEmph.find(a => idxOf(a) === presentAnimStep - 1)
                const exited = myExit.some(a => idxOf(a) < presentAnimStep)
                const justExit = myExit.find(a => idxOf(a) === presentAnimStep - 1)
                const animClass = (justEnt && `sl-anim-${justEnt.effect}`) || (justEmph && `sl-anim-${justEmph.effect}`) || (justExit && `sl-anim-exit-${justExit.effect}`) || ''
                if (exited && !justExit) return null
                const bg2 = sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill
                const hasParas = !!(sh.paras && sh.paras.some(p => p.runs && p.runs.length))
                return (
                <div key={i} className={`absolute flex flex-col ${animClass}`} style={{
                  left: `${sh.x / 8}px`, top: `${sh.y / 8}px`, width: `${sh.w / 8}px`, height: `${sh.h / 8}px`,
                  transform: sh.rotation ? `rotate(${sh.rotation}deg)` : undefined,
                  justifyContent: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
                  opacity: revealed ? undefined : 0,
                  background: bg2,
                  backgroundSize: bg2.startsWith('url') ? 'cover' : undefined,
                  backgroundRepeat: bg2.startsWith('url') ? 'no-repeat' : undefined,
                  backgroundPosition: bg2.startsWith('url') ? 'center' : undefined,
                  borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : sh.type === 'can' ? '50% / 12%' : '0',
                  // round30：clipPath 与编辑画布统一走 SHAPE_CLIP 表（旧 roundRect
                  // 的 inset 写法与画布 8px 圆角不一致；ellipse 兜底重复）
                  clipPath: SHAPE_CLIP[sh.type],
                  boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
                  filter: sh.glow ? `drop-shadow(0 0 ${Math.min(28, Math.max(4, (sh.glowRadius || 60000) / 5000))}px ${sh.glowColor || (sh.fill && !sh.fill.startsWith('url') ? sh.fill : '#818cf8')})` : 'none',
                  // round30：边框对齐编辑画布 —— 无描边时 rect/roundRect 有 1px
                  // 浅描边（noDecor 关闭），此前播放态 'none' 与编辑态不同
                  border: sh.stroke
                    ? `${Math.max(1, sh.strokeWidth || 1)}px solid ${sh.stroke}`
                    : (sh.noDecor ? 'none' : (sh.type === 'rect' || sh.type === 'roundRect' ? '1px solid rgba(0,0,0,0.1)' : 'none')),
                  color: sh.fontColor || (sh.fill && !sh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
                  fontSize: sh.fontSize ? `${sh.fontSize}px` : '12px',
                  fontFamily: sh.font || undefined,
                  fontWeight: sh.fontBold ? 700 : 400,
                  textAlign: sh.textAlign || 'center', lineHeight: sh.lineHeight || 1.2, paddingLeft: sh.indent ? `${sh.indent * 12}px` : undefined, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{sh.media && sh.media.type === 'video' && (
                  <video src={sh.media.src} controls autoPlay={false} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
                )}
                {sh.media && sh.media.type === 'audio' && (
                  <div className="w-full h-full flex items-center px-2"><audio src={sh.media.src} controls style={{ width: '100%' }} /></div>
                )}
                {!sh.media && (hasParas ? sh.paras!.map((p, pi) => (
                  <div key={pi} style={{ width: '100%', textAlign: (p.align === 'c' ? 'center' : p.align === 'r' ? 'right' : p.align === 'l' ? 'left' : undefined) as any }}>
                    {(p.runs && p.runs.length ? p.runs : [{ text: '' } as any]).map((r, ri) => (
                      <span key={ri} style={{ color: r.color || undefined, fontSize: r.fontSize ? `${Math.max(8, r.fontSize)}px` : undefined, fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? 'italic' : undefined, textDecoration: r.underline ? 'underline' : undefined, fontFamily: r.font || undefined, whiteSpace: 'pre-wrap' }}>{r.text}</span>
                    ))}
                  </div>
                )) : sh.bullet
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>•</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : sh.numbered
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>{li + 1}.</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block', width: '100%', textShadow: sh.fill && !sh.fill.startsWith('url') ? '0 1px 2px rgba(0,0,0,0.3)' : 'none' }}>{sh.text}</span>)}</div>
                )
              })}
              {presentingSlide.artTexts.map((at, i) => (
                <div key={i} className="absolute" style={{ left: `${at.x / 8}px`, top: `${at.y / 8}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '' }}>
                  {/* round30：字号对齐编辑画布（/2.5），旧 /2 放映态偏大 25% */}
                  <span style={{ fontSize: `${at.fontSize / 2.5}px`, fontWeight: 700, color: at.color,
                    background: at.gradient ? `linear-gradient(135deg, #${at.gradient.split(',')[0]}, #${at.gradient.split(',')[1]})` : undefined,
                    WebkitBackgroundClip: at.gradient ? 'text' : undefined,
                    WebkitTextFillColor: at.gradient ? 'transparent' : undefined,
                    textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none',
                    filter: at.glow ? `drop-shadow(0 0 6px ${at.color})` : 'none',
                    WebkitTextStroke: at.outline ? `1px #${at.outline}` : 'none' }}>{at.text}</span>
                </div>
              ))}
            </div>
            {/* 放映控制栏 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <button onClick={e => { e.stopPropagation(); prevPresent() }} className="text-white text-sm px-2" disabled={presentSlide === 0}>←</button>
              <span className="text-white text-xs">{presentSlide + 1} / {slides.length}</span>
              <button onClick={e => { e.stopPropagation(); nextPresent() }} className="text-white text-sm px-2" disabled={presentSlide === slides.length - 1}>→</button>
              <button onClick={e => { e.stopPropagation(); setPresenting(false) }} className="text-white text-sm px-2">✕</button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
