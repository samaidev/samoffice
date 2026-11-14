import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { EditorState, NodeSelection, TextSelection, Plugin } from 'prosemirror-state'
import { DOMSerializer, DOMParser as PMDOMParser } from 'prosemirror-model'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { schema } from './schema'
import { createPaginationPlugin } from './pagination'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import { BUILTIN_STYLES, BUILTIN_STYLE_MAP, AppStyle, StyleFormat, styleDefToFormat, outlineLevelFromName } from './styles'
import { spellCheckPlugin, setSpellErrors } from './spellPlugin'
import { searchPlugin, doSearch, doReplace, doReplaceAll, nextMatch, prevMatch, getSearchState } from './searchPlugin'
import { mergeCells, splitCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn, setCellAlign, setCellVAlign, setCellBorders } from './tableCommands'
import { tableEditing, CellSelection, cellAround } from 'prosemirror-tables'
import { DocTableView, createTableDragResizePlugin, autoFitTable } from './tablePlugins'
import { useI18n } from '../../i18n'
import { CN_FONT_SIZES, resolveFontSizeInput } from '../../lib/cnFontSizes'
import { PrintDialog } from '../../components/PrintDialog'
import { Dropdown } from '../../components/Dropdown'
import { Ruler } from '../../components/Ruler'
import { MathEditorModal } from './MathEditorModal'
import { TextBoxStylePanel } from './TextBoxStylePanel'
import {
  IconAlignLeft, IconAlignCenter, IconAlignRight, IconAlignJustify,
  IconBulletList, IconNumberList, IconIndentInc, IconIndentDec,
  IconLineSpacing, IconSpaceBefore, IconSpaceAfter,
  IconSuperscript, IconSubscript,
  IconFontColor, IconHighlight, IconShading,
  IconVAlignTop, IconVAlignMiddle, IconVAlignBottom, IconTextDirection,
} from './ribbonIcons'
import type { Document, SpellError, PageNumberConfig, HeaderFooterContent, Backend } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
  zoom?: number
  onZoomChange?: (z: number) => void
  backend?: Backend
  onToast?: (msg: string) => void
}

type RibbonTab = 'home' | 'insert' | 'layout' | 'review' | 'view'

const LINE_HEIGHTS = [{ name: '1.0', value: '1.0' }, { name: '1.5', value: '1.5' }, { name: '1.75', value: '1.75' }, { name: '2.0', value: '2.0' }, { name: '固定28pt (公文)', value: '28pt' }, { name: '固定30pt', value: '30pt' }]
// 文字颜色：去重（旧数组有两个 #6B7280）并扩充为 18 色三行，对齐 MS Word 常用色盘
const COLORS = ['#000000','#7F7F7F','#8C4510','#1F3864','#2E75B6','#217046',
                '#404040','#595959','#C45911','#FFC000','#548235','#7030A0',
                '#808080','#BFBFBF','#F2F2F2','#D6DCE4','#DEEBF7','#E2EFD9']
const HL_COLORS = ['#fef08a','#fed7aa','#fca5a5','#bbf7d0','#bfdbfe','#fbcfe8','#e9d5ff','#d4d4d8']

function readBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

// ============ 表格行/列选择插件（对齐 MS Word） ============
// MS Word 交互：鼠标悬停在表格行首左侧边缘出现箭头，单击选中整行；
// 悬停在首行顶部边缘出现下箭头，单击选中整列；按下后拖动可扩展多行/多列。
// 之前只依赖 prosemirror-tables 的框选，用户无法快速选中整行/整列。
function createTableRowColSelectPlugin() {
  let dragMode: '' | 'row' | 'col' = ''
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view: any, event: Event) => {
          const e = event as MouseEvent
          if (e.button !== 0) return false
          const td = (e.target as HTMLElement)?.closest?.('td,th') as HTMLElement | null
          if (!td) return false
          const rect = td.getBoundingClientRect()
          const inFirstCol = !(td.previousElementSibling as HTMLElement | null)?.matches?.('td,th')
          const inFirstRow = !(td.parentElement as HTMLElement | null)?.previousElementSibling?.matches?.('tr')
          const nearLeft = e.clientX - rect.left < 6
          const nearTop = e.clientY - rect.top < 6
          if (!((nearLeft && inFirstCol) || (nearTop && inFirstRow))) return false
          dragMode = nearTop && inFirstRow ? 'col' : 'row'
          const cellPosOf = (el: HTMLElement): any => {
            try {
              const $pos = view.state.doc.resolve(view.posAtDOM(el, 0))
              // posAtDOM 给的是单元格内部位置，必须用 cellAround 归一化到单元格起点
              return cellAround($pos)
            } catch { return null }
          }
          const $anchorCell = cellPosOf(td)
          if (!$anchorCell) return false
          const applySelection = (headEl: HTMLElement | null) => {
            if (!headEl) return
            const $headCell = cellPosOf(headEl)
            if (!$headCell) return
            try {
              // rowSelection / colSelection 以锚点行/列展开为整行/整列矩形选区
              const final = dragMode === 'row'
                ? CellSelection.rowSelection($anchorCell, $headCell)
                : CellSelection.colSelection($anchorCell, $headCell)
              view.dispatch(view.state.tr.setSelection(final).scrollIntoView())
            } catch { /* 跨表格或位置无效时忽略 */ }
          }
          applySelection(td)
          const move = (ev: MouseEvent) => {
            if (!dragMode) return
            const el = (ev.target as HTMLElement)?.closest?.('td,th') as HTMLElement | null
            if (el) applySelection(el)
          }
          const up = () => {
            dragMode = ''
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
          e.preventDefault()
          return true
        },
      },
    },
  })
}

// ============ 尾随空段落插件（对齐 MS Word） ============
// Word 文档在表格之后永远保留一个段落标记，否则表格后无法点击定位光标输入
// 新文本（用户报告：插入表格后点击表格下方空白处无法输入新内容）。
// 此插件保证文档最后一个块不是表格/列表：若是则自动在末尾补一个空段落。
function createTrailingParagraphPlugin() {
  return new Plugin({
    appendTransaction: (_trs: any, _old: any, newState: any) => {
      const doc = newState.doc
      const last = doc.lastChild
      if (!last) return null
      if (last.type.name === 'paragraph') return null
      if (last.type.name === 'text_box' || last.type.name === 'footnote_section') return null
      const pos = doc.content.size
      return newState.tr.insert(pos, newState.schema.nodes.paragraph.create()).setMeta('addToHistory', false)
    },
  })
}

function RibbonButton({ icon, label, onClick, active, disabled, title, ...rest }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} {...rest}
      // 对齐 MS Office：点击功能区按钮不夺走编辑器焦点（防止原生选区被浏览器折叠、
      // ProseMirror DOMObserver 把 CellSelection 压塌成光标 —— 表格全选后点功能区丢选区的根因）
      onMouseDown={(e: any) => { if (!disabled) e.preventDefault() }}
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

// === 颜色选择面板（共用）：色块网格 + 自动/无色 + 自定义色 ===
// 此前颜色按钮只是"透明按钮+底边框色条"，看起来像空的残缺色块（用户反馈"颜色块按钮显示不全"），
// 弹出面板也只有几个色块。统一为：图标按钮（A+色条）+ 面板带"自动/其他颜色"。
function ColorGrid({ colors, onPick, onClear, clearLabel, customLabel }: { colors: string[]; onPick: (c: string) => void; onClear?: () => void; clearLabel?: string; customLabel?: string }) {
  const [custom, setCustom] = useState('#ff0000')
  return (
    <div style={{ minWidth: 216 }}>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(9, 20px)' }}>
        {colors.map(c => (
          <button key={c} type="button" title={c} onClick={() => onPick(c)}
            className="rounded transition-transform hover:scale-110"
            style={{ width: 20, height: 20, background: c, border: '1px solid rgba(0,0,0,0.18)' }} />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        {onClear && (
          <button type="button" className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}
            onClick={onClear}>{clearLabel || '自动'}</button>
        )}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
          {customLabel || '其他颜色'}
          <input type="color" value={custom} onChange={e => { setCustom(e.target.value); onPick(e.target.value) }}
            className="w-7 h-6 rounded cursor-pointer border-0 p-0" />
        </label>
      </div>
    </div>
  )
}

// === 悬浮格式工具栏（对齐 MS Word 选中文本时弹出的 mini toolbar） ===
// 修复点：1) 用 ref 实测宽度做边界收敛，旧版硬编码 300px 在扩充按钮后估不准；
// 2) 颜色面板默认向下弹出，空间不足时自动翻转到上方（旧版固定向上，贴近顶部时被裁剪）；
// 3) 补齐 MS Word mini 栏应有的高频按钮：字号、字色、高亮、对齐、标题。
// SelectionMiniToolbar 已于 round17 移除：悬浮格式工具栏与选区位置冲突、遮挡正文，干扰编辑。
// 加粗/字号/颜色等格式功能保留在 Ribbon「开始」选项卡与右键菜单。

function StyleEditor({ name, initial, onCancel, onSave }: { name: string; initial: StyleFormat; onCancel: () => void; onSave: (f: StyleFormat) => void }) {
  const { t } = useI18n()
  const [fontSize, setFontSize] = useState(initial.fontSize || '')
  const [bold, setBold] = useState(!!initial.bold)
  const [italic, setItalic] = useState(!!initial.italic)
  const [color, setColor] = useState(initial.color || '#000000')
  const [align, setAlign] = useState(initial.align || 'left')
  const save = () => {
    const f: StyleFormat = { bold, italic, color, align }
    if (fontSize) f.fontSize = fontSize
    onSave(f)
  }
  return (
    <div className="style-editor">
      <div className="style-editor-title">{name}</div>
      <label className="style-field"><span>{t('doc.fontSize')}</span><input value={fontSize} onChange={(e) => setFontSize(e.target.value)} placeholder="15px" /></label>
      <label className="style-field"><span>{t('doc.bold')}</span><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /></label>
      <label className="style-field"><span>{t('doc.italic')}</span><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /></label>
      <label className="style-field"><span>{t('doc.color')}</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <label className="style-field"><span>{t('doc.align')}</span>
        <Dropdown
          className="ribbon-input"
          style={{ width: 140, height: 26 }}
          value={align}
          onChange={v => setAlign(v)}
          options={[
            { label: t('doc.alignLeft'), value: 'left' },
            { label: t('doc.alignCenter'), value: 'center' },
            { label: t('doc.alignRight'), value: 'right' },
            { label: t('doc.alignJustify'), value: 'justify' },
          ]}
        />
      </label>
      <div className="style-editor-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('doc.cancel')}</button>
        <button className="btn btn-primary btn-sm" onClick={save}>{t('doc.save')}</button>
      </div>
    </div>
  )
}

const PAGE_NUM_FORMATS = [
  { label: '第 {n} 页', value: '第 {n} 页' },
  { label: '第 {n} / 共 {total} 页', value: '第 {n} / 共 {total} 页' },
  { label: '{n}', value: '{n}' },
  { label: 'Page {n} of {total}', value: 'Page {n} of {total}' },
  { label: '— {n} —', value: '— {n} —' },
]

// 页眉/页脚编辑对话框（对齐 MS Word：文字 + 对齐/字号/加粗/斜体/颜色）
function HeaderFooterDialog({ target, initial, labels, onClose, onSave }: {
  target: 'header' | 'footer'
  initial: HeaderFooterContent
  labels: { title: string; text: string; align: string; fontSize: string; ok: string; cancel: string; clear: string }
  onClose: () => void
  onSave: (content: HeaderFooterContent) => void
}) {
  const [text, setText] = useState(initial.text || '')
  const [align, setAlign] = useState<string>(initial.align || 'center')
  const [fontSize, setFontSize] = useState<string>(initial.fontSize ? String(initial.fontSize) : '9')
  const [bold, setBold] = useState(!!initial.bold)
  const [italic, setItalic] = useState(!!initial.italic)
  const [color, setColor] = useState(initial.color ? `#${initial.color}` : '#595959')
  const save = () => {
    const sizeN = parseFloat(fontSize)
    onSave({
      text: text.trim(),
      align,
      fontSize: !isNaN(sizeN) && sizeN > 0 ? sizeN : undefined,
      bold, italic,
      color: color.replace('#', ''),
      fontFamily: initial.fontFamily,
    })
  }
  const selStyle = { background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' } as const
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 430 }}>
        <div className="modal-title">{labels.title}</div>
        <label className="pn-field" style={{ alignItems: 'flex-start' }}>
          <span style={{ marginTop: 4 }}>{labels.text}</span>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            className="text-xs px-2 py-1 rounded border flex-1" style={selStyle} />
        </label>
        <label className="pn-field"><span>{labels.align}</span>
          <select value={align} onChange={e => setAlign(e.target.value)} className="text-xs px-1 py-1 rounded border" style={{ ...selStyle, width: 140 }}>
            <option value="left">⬅ {labels.align === 'Align' ? 'Left' : '左对齐'}</option>
            <option value="center">↔ {labels.align === 'Align' ? 'Center' : '居中'}</option>
            <option value="right">➡ {labels.align === 'Align' ? 'Right' : '右对齐'}</option>
          </select>
        </label>
        <label className="pn-field"><span>{labels.fontSize}</span>
          <input type="number" min={6} max={48} step={0.5} value={fontSize} onChange={e => setFontSize(e.target.value)}
            className="text-xs px-1 py-1 rounded border" style={{ ...selStyle, width: 80 }} />
        </label>
        <label className="pn-field"><span>&nbsp;</span>
          <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text)' }}>
            <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={bold} onChange={e => setBold(e.target.checked)} /><b>B</b></label>
            <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={italic} onChange={e => setItalic(e.target.checked)} /><i>I</i></label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-7 h-6 cursor-pointer rounded border" style={{ borderColor: 'var(--color-border)' }} title="Color" />
          </span>
        </label>
        <div className="flex justify-end gap-2 mt-2">
          <button className="btn btn-sm" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}
            onClick={() => { onSave({ text: '' }); }}>{labels.clear}</button>
          <button className="btn btn-sm" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={onClose}>{labels.cancel}</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!text.trim()}>{labels.ok}</button>
        </div>
      </div>
    </div>
  )
}

function PageNumberDialog({ value, onClose, onSave }: {
  value: PageNumberConfig | null
  onClose: () => void
  onSave: (pn: PageNumberConfig) => void
}) {
  const { t } = useI18n()
  const [format, setFormat] = useState(value?.format || '第 {n} 页')
  const [align, setAlign] = useState<('left' | 'center' | 'right')>((value?.align as any) || 'center')
  const [fontSize, setFontSize] = useState(value?.fontSize ? String(value.fontSize / 2) : '9')
  const [color, setColor] = useState(value?.fontColor || '#000000')
  const [bold, setBold] = useState(!!value?.bold)
  const [italic, setItalic] = useState(!!value?.italic)
  const [firstDiff, setFirstDiff] = useState(!!value?.firstPageDifferent)
  const [enabled, setEnabled] = useState(!!value?.enabled)
  const save = () => {
    onSave({
      enabled, format, align,
      fontSize: Math.round(parseFloat(fontSize) * 2) || 18,
      fontColor: color, bold, italic, firstPageDifferent: firstDiff,
    })
  }
  const preview = (format || '第 {n} 页').replace('{n}', '1').replace('{total}', '3')
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-title">{t('doc.pageNumSettings')}</div>
        <div className="pn-form">
          <label className="pn-field"><span>{t('doc.enabled')}</span><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.pnFormat')}</span>
            <Dropdown
              className="ribbon-input"
              style={{ width: 180, height: 26 }}
              value={format}
              onChange={v => setFormat(v)}
              options={PAGE_NUM_FORMATS.map(f => ({ label: f.label, value: f.value }))}
            />
          </label>
          <label className="pn-field"><span>{t('doc.align')}</span>
            <Dropdown
              className="ribbon-input"
              style={{ width: 140, height: 26 }}
              value={align}
              onChange={v => setAlign(v as any)}
              options={[
                { label: t('doc.alignLeft'), value: 'left' },
                { label: t('doc.alignCenter'), value: 'center' },
                { label: t('doc.alignRight'), value: 'right' },
              ]}
            />
          </label>
          <label className="pn-field"><span>{t('doc.fontSize')}</span><input value={fontSize} onChange={(e) => setFontSize(e.target.value)} placeholder="9" /></label>
          <label className="pn-field"><span>{t('doc.color')}</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          <label className="pn-field"><span>{t('doc.bold')}</span><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.italic')}</span><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.firstPageDifferent')}</span><input type="checkbox" checked={firstDiff} onChange={(e) => setFirstDiff(e.target.checked)} /></label>
          <div className="pn-preview" style={{
            textAlign: align, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
            fontSize: `${fontSize}px`, color,
          }}>{preview}</div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('doc.cancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={save}>{t('doc.save')}</button>
        </div>
      </div>
    </div>
  )
}

function ParagraphDialog({ value, onClose, onSave }: {
  value: any
  onClose: () => void
  onSave: (d: any) => void
}) {
  const { t } = useI18n()
  const [d, setD] = useState<any>(value || {})
  const set = (k: string, v: any) => setD((prev: any) => ({ ...prev, [k]: v }))
  const lineNeedsValue = d.lineKind === 'multiple' || d.lineKind === 'exact' || d.lineKind === 'atLeast'
  const outlineOpts = [{ v: 0, l: t('doc.paraBody') }]
  for (let i = 1; i <= 9; i++) outlineOpts.push({ v: i, l: `${t('doc.outlineLevel')} ${i}` })
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <div className="modal-title">{t('doc.paraDialog')}</div>
        <div className="pn-form">
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraIndent')}</legend>
            <label className="pn-field"><span>{t('doc.paraLeft')}</span><input type="number" value={d.indentLeft || 0} onChange={e => set('indentLeft', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            <label className="pn-field"><span>{t('doc.paraRight')}</span><input type="number" value={d.indentRight || 0} onChange={e => set('indentRight', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            <label className="pn-field"><span>{t('doc.paraSpecial')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 140, height: 26 }}
                value={d.special || 'none'}
                onChange={v => set('special', v)}
                options={[
                  { label: t('doc.paraNone'), value: 'none' },
                  { label: t('doc.paraFirstLine'), value: 'firstLine' },
                  { label: t('doc.paraHanging'), value: 'hanging' },
                ]}
              />
            </label>
            {d.special && d.special !== 'none' && (
              <label className="pn-field"><span>{t('doc.paraBy')}</span><input type="number" value={d.specialBy || 0} onChange={e => set('specialBy', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            )}
          </fieldset>
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraSpacing')}</legend>
            <label className="pn-field"><span>{t('doc.paraBefore')}</span><input type="number" value={d.spaceBefore || 0} onChange={e => set('spaceBefore', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPt')}</span></label>
            <label className="pn-field"><span>{t('doc.paraAfter')}</span><input type="number" value={d.spaceAfter || 0} onChange={e => set('spaceAfter', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPt')}</span></label>
            <label className="pn-field"><span>{t('doc.paraLine')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 140, height: 26 }}
                value={d.lineKind || 'single'}
                onChange={v => set('lineKind', v)}
                options={[
                  { label: t('doc.paraLineSingle'), value: 'single' },
                  { label: t('doc.paraLine15'), value: '1.5' },
                  { label: t('doc.paraLineDouble'), value: 'double' },
                  { label: t('doc.paraLineMultiple'), value: 'multiple' },
                  { label: t('doc.paraLineExact'), value: 'exact' },
                  { label: t('doc.paraLineAtLeast'), value: 'atLeast' },
                ]}
              />
            </label>
            {lineNeedsValue && (
              <label className="pn-field"><span>{t('doc.paraLineValue')}</span><input type="number" step="0.5" value={d.lineValue || 1} onChange={e => set('lineValue', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{d.lineKind === 'multiple' ? '' : t('doc.paraPt')}</span></label>
            )}
          </fieldset>
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraBreak')}</legend>
            <label className="pn-field"><span>{t('doc.paraKeepLines')}</span><input type="checkbox" checked={!!d.keepLines} onChange={e => set('keepLines', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraKeepWithNext')}</span><input type="checkbox" checked={!!d.keepWithNext} onChange={e => set('keepWithNext', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraPageBreakBefore')}</span><input type="checkbox" checked={!!d.pageBreakBefore} onChange={e => set('pageBreakBefore', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraOutline')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 160, height: 26 }}
                value={String(d.outlineLevel || 0)}
                onChange={v => set('outlineLevel', Number(v))}
                options={outlineOpts.map(o => ({ label: o.l, value: String(o.v) }))}
              />
            </label>
          </fieldset>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('doc.paraCancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(d)}>{t('doc.paraOk')}</button>
        </div>
      </div>
    </div>
  )
}

// 从 PM 文档中提取批注数据（对齐 MS Word 右侧批注栏：批注锚点在正文，批注卡片显示在右侧对应位置）
function extractComments(doc: any): { id: string; author: string; text: string; pos: number }[] {
  const out: { id: string; author: string; text: string; pos: number }[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'comment_mark' && node.attrs && node.attrs.text) {
      out.push({ id: node.attrs.id, author: node.attrs.author || 'User', text: node.attrs.text, pos })
    }
  })
  return out
}

// 从 PM 文档中提取脚注数据（脚注区在编辑器内隐藏渲染，这里仅取数据用于页底脚注区展示/编辑）。
// sectionPos：隐藏脚注区中 footnote_item 的位置（用于编辑/删除）；
// refPos：正文中 footnote 引用标记的位置（用于判断脚注应显示在哪一页）。
type FootnoteData = { num: number; text: string; sectionPos: number; refPos: number }
function extractFootnotes(doc: any): FootnoteData[] {
  const refs: Record<number, number> = {}
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'footnote') {
      const num = Number(node.attrs.num) || 0
      if (num > 0) refs[num] = pos
    }
  })
  const out: FootnoteData[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'footnote_section') {
      node.forEach((child: any, offset: number) => {
        if (child.type.name === 'footnote_item') {
          const num = Number(child.attrs.num) || 1
          out.push({ num, text: child.textContent || '', sectionPos: pos + 1 + offset, refPos: refs[num] ?? -1 })
        }
      })
    }
  })
  return out
}

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck, zoom: zoomProp, onZoomChange, backend, onToast }: Props) {
  const { t, lang } = useI18n()

  // 系统字体库 — 通过 queryLocalFonts() 补充系统已安装字体。
  // 注意：queryLocalFonts 在 WebView2 下返回的 family 多为英文/音译名（如 SimSun），
  // 不会包含「宋体」这类中文显示名；所以不能整体覆盖，要与内置中文字体合并且去重。
  const BUILTIN_FONTS = [
    '宋体', '黑体', '楷体', '仿宋', '微软雅黑', '等线',
    'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei', 'Microsoft JhengHei',
    'Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Georgia', 'Verdana',
    'Tahoma', 'Trebuchet MS', 'Courier New', 'Consolas', 'Lucida Console',
  ]
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  useEffect(() => {
    const w = window as any
    if (w.queryLocalFonts) {
      w.queryLocalFonts().then((fonts: any[]) => {
        if (fonts && fonts.length) {
          const names = Array.from(new Set(fonts.map((f: any) => f.family)))
          setSystemFonts(names)
        }
      }).catch(() => {})
    }
  }, [])

  // 字体下拉列表：内置中文字体优先（保证「宋体/黑体」等一定出现且不被截断），
  // 系统枚举字体作为补充放在后面并限制数量。下拉菜单本身可滚动 (maxHeight 280)。
  // 注意：真实环境 queryLocalFonts 可能返回大量大小写变体（如 "arial"/"Arial"、"cambria"/"Cambria"），
  // 必须与内置字体一起按大小写不敏感去重，否则 FONTS 会出现重复 value → React 渲染菜单时 key 冲突 → removeChild 崩溃。
  const FONT_CAP = 400
  const allFontNames = [...BUILTIN_FONTS, ...systemFonts]
  const seenFont = new Set<string>()
  const dedupedFonts: string[] = []
  for (const f of allFontNames) {
    const key = String(f).toLowerCase()
    if (seenFont.has(key)) continue
    seenFont.add(key)
    dedupedFonts.push(f)
  }
  const FONTS = [
    { name: t('doc.font.default'), value: '' },
    ...dedupedFonts.sort().slice(0, FONT_CAP).map(f => ({ name: f, value: f, fontFamily: f })),
  ]
  // 字号下拉：中文语言显示 MS Word 中文字号（初号～八号），英文显示数值；
  // 值仍是 px 字符串（与内部 fontSize mark 一致）
  const FONT_SIZES = lang === 'zh'
    ? CN_FONT_SIZES.map(s => ({ name: s.name, value: `${s.px}px`, title: `${s.name}（${s.pt}pt / ${s.px}px）` }))
    : [
        { name: '12', value: '12px' }, { name: '15', value: '15px' },
        { name: '18', value: '18px' }, { name: '24', value: '24px' }, { name: '32', value: '32px' },
      ]

  const editorRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const sheetsLayerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 标记当前是否处于 PM DOMObserver.flush 调用栈内（用于识别 Chromium 回卷选区后的伪同步事务）
  const inDomObserverFlushRef = useRef(false)
  // 当前选区是否包含可选中文本（用于右键菜单复制/剪切的可用态）
  const hasSelection = () => {
    const v = viewRef.current
    if (!v) return false
    const sel = v.state.selection
    if (sel.empty) return false
    return !(sel instanceof NodeSelection)
  }
  // 读取选区/光标处生效的字符格式标记（供格式刷暂存）
  const getActiveMarks = (): Record<string, any> => {
    const v = viewRef.current; if (!v) return {}
    const { state } = v
    const { from, to, empty } = state.selection
    const marks: Record<string, any> = {}
    if (!empty) {
      // 遍历选区内所有文本节点，收集其字符格式标记
      state.doc.nodesBetween(from, to, (node: any) => {
        if (node.isText && node.marks) {
          node.marks.forEach((m: any) => { marks[m.type.name] = m.attrs })
        }
      })
    } else {
      // 仅光标（未选词/段落）：读取光标处生效的字符 marks（兼容“光标置于格式文本上即暂存”）
      const $pos = state.doc.resolve(from)
      $pos.marks().forEach((m: any) => { marks[m.type.name] = m.attrs })
    }
    return marks
  }
  // 格式刷：暂存源格式标记，等待应用到下一次选区。
  // lock=false → 单击模式（应用一次后自动解除，等同 MS Office 单击格式刷）
  // lock=true  → 双击锁定模式（可连续多次应用，等同 MS Office 双击格式刷）
  // 用 ref 持有最新值，避免 ProseMirror Plugin 闭包捕获到过期的 state。
  const [formatPainter, setFormatPainter] = useState<{ marks: Record<string, any>; lock: boolean } | null>(null)
  const formatPainterRef = useRef<{ marks: Record<string, any>; lock: boolean } | null>(null)
  const setPainter = (v: { marks: Record<string, any>; lock: boolean } | null) => {
    formatPainterRef.current = v
    setFormatPainter(v)
  }
  // 格式刷单击/双击的区分：浏览器双击会先触发两次 click 再触发 dblclick，
  // 若不处理会导致两次单击把 lock 态改乱、双击无法关闭。用短延时合并——单击延迟执行，
  // 若期间发生双击则取消单击，由 onDoubleClick 统一处理（进入/退出锁定）。
  const painterClickTimer = useRef<number | null>(null)
  const handlePainterClick = () => {
    if (painterClickTimer.current) return
    painterClickTimer.current = window.setTimeout(() => {
      painterClickTimer.current = null
      // 单击：未激活则开启（非锁定），已激活则关闭
      if (formatPainterRef.current) setPainter(null)
      else setPainter({ marks: getActiveMarks(), lock: false })
    }, 220)
  }
  const handlePainterDouble = () => {
    if (painterClickTimer.current) { clearTimeout(painterClickTimer.current); painterClickTimer.current = null }
    // 双击：已在锁定模式则关闭，否则进入锁定模式
    if (formatPainterRef.current?.lock) setPainter(null)
    else setPainter({ marks: getActiveMarks(), lock: true })
  }
  // 单击模式：套用后延迟清除格式刷。用防抖而非立即清除，
  // 否则拖选过程中 appendTransaction 每次 mousemove 都会触发并立即清空，导致只刷中前一小段。
  const painterClearTimer = useRef<number | null>(null)
  const schedulePainterClear = () => {
    if (painterClearTimer.current) clearTimeout(painterClearTimer.current)
    painterClearTimer.current = window.setTimeout(() => {
      painterClearTimer.current = null
      setPainter(null)
    }, 350)
  }
  // Esc 退出格式刷锁定模式
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && formatPainterRef.current?.lock) setPainter(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 将当前选区序列化为 HTML 并写入系统剪贴板（HTML + 纯文本双格式）；cut=true 时同时删除选区
  const serializeSelectionToClipboard = (v: any, cut: boolean) => {
    const sel = v.state.selection
    if (sel.empty) return
    // 优先用原生 DOM Selection 克隆选中片段，避免 ProseMirror DOMSerializer
    // 在个别节点 toDOM 下触发 document.createElement 异常（见复制报错）。
    let html = ''
    let plain = ''
    try {
      const domSel = (window as any).getSelection()
      if (domSel && domSel.rangeCount > 0) {
        const range = domSel.getRangeAt(0)
        const clone = range.cloneContents()
        const div = (window as any).document.createElement('div')
        div.appendChild(clone)
        html = div.innerHTML
        plain = range.toString()
      }
    } catch { /* ignore */ }
    // 兜底：用 ProseMirror 文本区间取纯文本
    if (!plain) {
      plain = v.state.doc.textBetween(sel.from, sel.to, '\n\n')
    }
    try {
      (window as any).runtime.SetClipboardHtml(html, plain)
    } catch { /* ignore */ }
    if (cut) { v.dispatch(v.state.tr.delete(sel.from, sel.to).scrollIntoView()) }
  }
  // 实测编辑器内容高度，用于让“页面”随内容自动增高，避免多页文档被裁切
  const [pageContentH, setPageContentH] = useState(0)
  // 页底脚注区数据（从 PM 文档提取，避免在正文中渲染脚注）
  const [footnotes, setFootnotes] = useState<FootnoteData[]>([])
  // 每个顶级块所在的页码（由分页引擎回报），用于把脚注显示在引用所在页底部
  const [blockPages, setBlockPages] = useState<number[]>([])
  const blockPagesRef = useRef<number[]>([])  // 供 generateTOC/updateTocPageNumbers 同步读取最新页码
  // 目录页码自动回填：分页引擎每次回报页码即刷新 TOC 条目（等价 MS Word“更新域”）。
  // updateTocPageNumbers 无变化时不派发事务，因此不会形成 dispatch→重算 死循环。
  useEffect(() => {
    if (blockPages.length === 0) return
    const timer = setTimeout(() => updateTocPageNumbers(), 60)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPages])
  // 将脚注按“引用所在页”分组，使脚注显示在对应页底部而非文档末尾
  const footnotesByPage = useMemo(() => {
    const map: Record<number, FootnoteData[]> = {}
    const view = viewRef.current
    if (!view || blockPages.length === 0) return map
    const froms: number[] = []
    view.state.doc.forEach((_n: any, from: number) => froms.push(from))
    for (const f of footnotes) {
      if (f.refPos < 0) continue
      let k = 0
      for (let i = 0; i < froms.length; i++) {
        if (froms[i] <= f.refPos) k = i
        else break
      }
      const pg = blockPages[k] ?? 0
      ;(map[pg] ||= []).push(f)
    }
    return map
  }, [footnotes, blockPages])
  // 右侧批注栏数据（对齐 MS Word：批注锚点在正文，卡片显示在右侧对应位置）
  const [comments, setComments] = useState<{ id: string; author: string; text: string; pos: number }[]>([])
  const [activeComment, setActiveComment] = useState<string | null>(null)

  const editFootnote = (f: FootnoteData) => {
    const v = viewRef.current
    if (!v) return
    const newText = prompt(t('doc.prompt.footnote') || '编辑脚注内容：', f.text)
    if (newText === null) return
    const node = v.state.doc.nodeAt(f.sectionPos)
    if (!node || node.type.name !== 'footnote_item') return
    const item = schema.nodes.footnote_item.create({ num: f.num }, newText ? schema.text(newText) : null)
    v.dispatch(v.state.tr.replaceWith(f.sectionPos, f.sectionPos + node.nodeSize, item))
  }
  const deleteFootnote = (f: FootnoteData) => {
    const v = viewRef.current
    if (!v) return
    const node = v.state.doc.nodeAt(f.sectionPos)
    if (!node || node.type.name !== 'footnote_item') return
    v.dispatch(v.state.tr.delete(f.sectionPos, f.sectionPos + node.nodeSize))
  }
  // 复制脚注内容到剪贴板（优先 Clipboard API，回退 execCommand）
  const copyFootnote = (f: FootnoteData) => {
    const text = `${f.num}. ${f.text || ''}`
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
      } else {
        fallbackCopy(text)
      }
    } catch {
      fallbackCopy(text)
    }
  }
  const fallbackCopy = (text: string) => {
    const docAny = document as any
    const ta = docAny.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    docAny.body.appendChild(ta)
    ta.select()
    try { docAny.execCommand('copy') } catch { /* ignore */ }
    docAny.body.removeChild(ta)
  }
  // 批注卡片编辑态：正在编辑的批注 id（null 表示只读查看）
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const editComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const idx = comments.findIndex(c => c.id === id); if (idx < 0) return
    const cur = comments[idx]
    const newText = prompt(t('doc.prompt.comment') || '编辑批注：', cur.text)
    if (newText === null) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    const item = schema.nodes.comment_mark.create({ id: cur.id, author: cur.author, text: newText })
    const tr = v.state.tr.replaceWith(cur.pos, cur.pos + node.nodeSize, item)
    v.dispatch(tr); v.focus()
    try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
  }
  const deleteComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const cur = comments.find(c => c.id === id); if (!cur) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    v.dispatch(v.state.tr.delete(cur.pos, cur.pos + node.nodeSize))
    setActiveComment(null)
    try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
  }
  const goToComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const cur = comments.find(c => c.id === id); if (!cur) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    setActiveComment(id)
    const from = cur.pos
    const to = cur.pos + node.nodeSize
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)))
    v.focus()
  }
  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  // 用 ref 持有最新 document，供 ProseMirror 闭包（dispatchTransaction）读取，避免捕获到过期的 props。
  const documentRef = useRef<any>(document)
  documentRef.current = document
  const trackChangesRef = useRef(false)
  // 记录本组件最近一次通过 onChange 向外发出的 UDM 引用，
  // 用于区分「外部加载了新文档」与「自身编辑回流」，避免把用户编辑覆盖回旧内容。
  const lastEmittedRef = useRef<any>(null)
  const [pageNumber, setPageNumber] = useState<PageNumberConfig | null>(() => {
    const pn = (document as any)?.pageNumber
    return pn ? { ...pn } : null
  })
  const pageNumberRef = useRef<PageNumberConfig | null>(pageNumber)
  pageNumberRef.current = pageNumber
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [styles, setStyles] = useState<Record<string, StyleFormat>>(() => {
    const init: Record<string, StyleFormat> = {}
    for (const s of (document.styles || [])) init[s.name] = styleDefToFormat(s.props)
    return init
  })
  const [showStyles, setShowStyles] = useState(false)
  const [styleSearch, setStyleSearch] = useState('')
  const [editingStyle, setEditingStyle] = useState<string | null>(null)
  const stylesRef = useRef(styles); stylesRef.current = styles


  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set())
  const [activeAttrs, setActiveAttrs] = useState<any>({})
  const [cellVAlign, setCellVAlignState] = useState('')  // 当前单元格垂直对齐（表格工具栏高亮用）
  const [activeFont, setActiveFont] = useState('')
  const [activeFontSize, setActiveFontSize] = useState('')
  const [activeColor, setActiveColor] = useState('')
  const [activeCharSpacing, setActiveCharSpacing] = useState('')
  const [activeIsImage, setActiveIsImage] = useState(false)
  const [activeIsShape, setActiveIsShape] = useState(false)
  // 当前选中的 text_box 节点（用于浮动属性面板）
  const [activeTextBox, setActiveTextBox] = useState<{ node: any; pos: number } | null>(null)
  const [, setTick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatch, setActiveMatch] = useState(-1)
  const [zoomInternal, setZoomInternal] = useState<number>(() => {
    try { const z = parseInt(localStorage.getItem('samoffice_zoom') || '100', 10); return isNaN(z) ? 100 : Math.max(50, Math.min(300, z)) } catch { return 100 }
  })
  const zoom = zoomProp ?? zoomInternal
  const setZoom = (z: number) => {
    const v = Math.max(50, Math.min(300, z))
    setZoomInternal(v)
    try { localStorage.setItem('samoffice_zoom', String(v)) } catch { /* ignore */ }
    if (onZoomChange) onZoomChange(v)
  }
  const [trackChanges, setTrackChanges] = useState(false)
  trackChangesRef.current = trackChanges
  const [printPreview, setPrintPreview] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [inTable, setInTable] = useState(false)
  // 表格边框工具（对齐 MS Word 表格工具“边框”预设）：预设下拉 + 线色 + 线宽
  const [showTableBorderMenu, setShowTableBorderMenu] = useState(false)
  const [tableBorderColor, setTableBorderColor] = useState('#000000')
  const [tableBorderWidth, setTableBorderWidth] = useState(1)
  const [watermark, setWatermark] = useState('')
  // 自动调整下拉（对齐 MS Word 表格工具「自动调整」：根据内容/根据窗口/固定列宽）
  const [showAutoFitMenu, setShowAutoFitMenu] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  // 右键菜单触发时，光标/点击是否落在 text_box（文本框/形状）上
  const [contextMenuOnTextBox, setContextMenuOnTextBox] = useState(false)
  const contextMenuBoxRef = useRef<HTMLElement | null>(null)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showArtPanel, setShowArtPanel] = useState(false)
  // 独立公式编辑器弹窗（全屏模态）
  const [showMathModal, setShowMathModal] = useState(false)
  const [mathEdit, setMathEdit] = useState<{ latex: string; inline: boolean; pos: number | null }>({ latex: '', inline: false, pos: null })
  // 独立的“插入符号”小面板（与公式弹窗分开，不复用）
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [symbolCategory, setSymbolCategory] = useState<'greek' | 'latin' | 'circled' | 'roman' | 'math' | 'arrows'>('greek')
  // 二级颜色/底纹/背景弹出菜单 — 统一改为 click 触发，避免 hover 残留导致重叠
  const [showColorPopup, setShowColorPopup] = useState(false)
  const [showHighlightPopup, setShowHighlightPopup] = useState(false)
  const [showShadingPopup, setShowShadingPopup] = useState(false)
  const [showBgColorPopup, setShowBgColorPopup] = useState(false)
  // 迷你工具栏颜色弹出菜单 (统一改为 click 触发，与主 ribbon 保持一致)
  const [showMiniColorPopup, setShowMiniColorPopup] = useState(false)
  // 弹出面板互斥：打开任一面板时关闭其他面板，避免多个弹出菜单重叠
  type PanelName = 'shape' | 'art' | 'color' | 'highlight' | 'shading' | 'bgColor'
  const openPanel = (which: PanelName) => {
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowArtPanel(which === 'art' ? !showArtPanel : false)
    setShowColorPopup(which === 'color' ? !showColorPopup : false)
    setShowHighlightPopup(which === 'highlight' ? !showHighlightPopup : false)
    setShowShadingPopup(which === 'shading' ? !showShadingPopup : false)
    setShowBgColorPopup(which === 'bgColor' ? !showBgColorPopup : false)
  }
  const closeAllPanels = () => {
    setShowShapePanel(false); setShowArtPanel(false)
    setShowColorPopup(false); setShowHighlightPopup(false)
    setShowShadingPopup(false); setShowBgColorPopup(false)
    setShowMathModal(false); setShowSymbolPanel(false)
  }
  // 公式弹窗与符号面板的互斥切换（与 ribbon 其他弹出面板独立）
  const openPanel2 = (which: 'formula' | 'symbol') => {
    setShowMathModal(which === 'formula' ? !showMathModal : false)
    setShowSymbolPanel(which === 'symbol' ? !showSymbolPanel : false)
    setShowShapePanel(false); setShowArtPanel(false)
    setShowColorPopup(false); setShowHighlightPopup(false)
    setShowShadingPopup(false); setShowBgColorPopup(false)
  }
  const anyPanelOpen = showShapePanel || showArtPanel || showColorPopup || showHighlightPopup || showShadingPopup || showBgColorPopup || showMathModal || showSymbolPanel
  // 护眼/背景色: white / #c7edcc (护眼绿) / #f5f5dc (豆沙) / #faf3e0 (米黄)
  const [bgColor, setBgColor] = useState<string>(() => {
    try { return localStorage.getItem('samoffice_bg_color') || '#ffffff' } catch { return '#ffffff' }
  })
  const setBgColorPersist = (c: string) => { try { localStorage.setItem('samoffice_bg_color', c) } catch { /* ignore */ }; setBgColor(c) }
  // View 标签页: 标尺 / 网格线 / 导航窗口 / 拆分窗口 / 护眼模式（均持久化到 localStorage）
  const [showRuler, setShowRuler] = useState<boolean>(() => readBool('samoffice_show_ruler'))
  const [showGridlines, setShowGridlines] = useState<boolean>(() => readBool('samoffice_show_gridlines'))
  const [showNavPane, setShowNavPane] = useState<boolean>(() => readBool('samoffice_show_nav'))
  const [splitWindow, setSplitWindow] = useState<boolean>(() => readBool('samoffice_split_win'))
  const persistBool = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ } }
  const setShowRulerPersist = (v: boolean) => { persistBool('samoffice_show_ruler', v); setShowRuler(v) }
  const setShowGridlinesPersist = (v: boolean) => { persistBool('samoffice_show_gridlines', v); setShowGridlines(v) }
  const setShowNavPanePersist = (v: boolean) => { persistBool('samoffice_show_nav', v); setShowNavPane(v) }
  const setSplitWindowPersist = (v: boolean) => { persistBool('samoffice_split_win', v); setSplitWindow(v) }
  const [eyeCareMode, setEyeCareMode] = useState<boolean>(() => {
    try { return localStorage.getItem('samoffice_eye_care') === '1' } catch { return false }
  })
  const setEyeCarePersist = (ec: boolean) => { try { localStorage.setItem('samoffice_eye_care', ec ? '1' : '0') } catch { /* ignore */ }; setEyeCareMode(ec) }
  const [showPageNumDialog, setShowPageNumDialog] = useState(false)
  const [showParaDialog, setShowParaDialog] = useState(false)
  const [paraDraft, setParaDraft] = useState<any>({})
  // 并排对比：右侧只读文档视图（含目标文档与名称）
  const [compareTarget, setCompareTarget] = useState<{ name: string; doc: Document } | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const compareViewRef = useRef<EditorView | null>(null)
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const syncLockRef = useRef(false)
  // 差异高亮集合（按段落文本匹配）：右侧新增段落、左侧被删段落
  const diffAddRef = useRef<Set<string>>(new Set())
  const diffDelRef = useRef<Set<string>>(new Set())
  const [protectedMode, setProtectedMode] = useState(false)
  // 已解锁的文档保护哈希（空表示当前未处于受保护态，或已解锁）。
  // 打开带保护的文档时该值为空，需输入正确密码后填入对应哈希才能编辑。
  const unlockHashRef = useRef<string>('')
  // 解锁密码输入弹窗
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockError, setUnlockError] = useState(false)
  // 简单稳定的字符串哈希（用于密码校验，盘上仅存哈希不存明文）
  const hashPwd = (s: string): string => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
  }
  // 显示编辑标记 (段落标记 ¶ / 分页符等)
  const [showMarks, setShowMarks] = useState<boolean>(() => readBool('samoffice_show_marks'))
  const setShowMarksPersist = (v: boolean) => { persistBool('samoffice_show_marks', v); setShowMarks(v) }
  // Ribbon 折叠（对齐 MS Office：仅保留选项卡栏，再次点击展开；三编辑器共享同一持久化键）
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sam-ribbon-collapsed') === '1' } catch { return false }
  })
  const setRibbonCollapsedPersist = (v: boolean) => { try { localStorage.setItem('sam-ribbon-collapsed', v ? '1' : '0') } catch { /* ignore */ }; setRibbonCollapsed(v) }
  // 文档级设置 (页眉/页脚/页边距/分栏/行号)
  const [docHeader, setDocHeader] = useState('')
  // 页眉/页脚样式与页脚富文本（对齐 MS Word：解析自 docx，可编辑，保存写回）
  const [docHeaderFmt, setDocHeaderFmt] = useState<HeaderFooterContent>({})
  const [docFooterHF, setDocFooterHF] = useState<HeaderFooterContent>({ text: '' })
  // 页眉页脚编辑对话框：target 指定当前编辑的是页眉还是页脚
  const [showHFDialog, setShowHFDialog] = useState<null | { target: 'header' | 'footer' }>(null)
  // 打开文档时从 UDM 初始化页眉/页脚（含样式），无则保持空
  useEffect(() => {
    const h = (document as any)?.header as HeaderFooterContent | undefined
    const f = (document as any)?.footer as HeaderFooterContent | undefined
    if (h && h.text) { setDocHeader(h.text); setDocHeaderFmt({ align: h.align, fontSize: h.fontSize, bold: h.bold, italic: h.italic, color: h.color, fontFamily: h.fontFamily }) }
    else { setDocHeader(''); setDocHeaderFmt({}) }
    setDocFooterHF(f && f.text ? { text: f.text, align: f.align, fontSize: f.fontSize, bold: f.bold, italic: f.italic, color: f.color, fontFamily: f.fontFamily } : { text: '' })
  }, [document])
  // 应用页眉/页脚编辑：更新本地状态并写回 UDM（随保存写盘 docx header1.xml/footer1.xml）
  const applyHF = (target: 'header' | 'footer', content: HeaderFooterContent) => {
    const v = viewRef.current
    const base: any = documentRef.current ?? document
    let updated: any
    if (target === 'header') {
      setDocHeader(content.text || '')
      setDocHeaderFmt(content)
      updated = { ...base, header: content.text ? content : undefined }
    } else {
      setDocFooterHF(content)
      updated = { ...base, footer: content.text ? content : undefined }
    }
    documentRef.current = updated
    lastEmittedRef.current = updated
    onChange?.(updated)
    if (v) v.focus()
  }
  // 默认页边距采用 Word「普通」预设：上下 2.54cm、左右 3.18cm（96dpi 下分别为 96px / 120px）
  const [docMargins, setDocMargins] = useState({ top: 96, bottom: 96, left: 120, right: 120 })
  const [pageSize, setPageSize] = useState<'A4'|'A3'|'A5'|'B5'|'Letter'|'Legal'>('A4')
  const [orientation, setOrientation] = useState<'portrait'|'landscape'>('portrait')
  const [docColumns, setDocColumns] = useState(1)
  // 纸张物理尺寸（mm）→ 屏幕像素（96dpi: 1mm ≈ 3.7795px）
  const PAGE_SIZES_MM: Record<string, [number, number]> = {
    A4: [210, 297], A3: [297, 420], A5: [148, 210], B5: [176, 250],
    Letter: [215.9, 279.4], Legal: [215.9, 355.6],
  }
  const mmToPx = (mm: number) => Math.round(mm * 96 / 25.4)
  const [pwMm, phMm] = PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.A4
  const pageWidthPx = mmToPx(orientation === 'landscape' ? phMm : pwMm)
  const pageHeightPx = mmToPx(orientation === 'landscape' ? pwMm : phMm)
  // 页面设置持久化：UDM.pageSetup（twips），保存/加载随文档走（此前纸张/页边距/分栏刷新即丢）
  const pageSetupRef = useRef<any>(null)
  pageSetupRef.current = {
    widthTwips: Math.round((orientation === 'landscape' ? phMm : pwMm) * 1440 / 25.4),
    heightTwips: Math.round((orientation === 'landscape' ? pwMm : phMm) * 1440 / 25.4),
    orientation,
    marginTop: Math.round(docMargins.top * 15),
    marginRight: Math.round(docMargins.right * 15),
    marginBottom: Math.round(docMargins.bottom * 15),
    marginLeft: Math.round(docMargins.left * 15),
    cols: docColumns,
  }
  // 打开文档时应用已保存的页面设置
  useEffect(() => {
    const ps = (document as any)?.pageSetup
    if (!ps || typeof ps !== 'object') return
    try {
      if (ps.orientation === 'landscape' || ps.orientation === 'portrait') setOrientation(ps.orientation)
      const wTw = Number(ps.widthTwips) || 0, hTw = Number(ps.heightTwips) || 0
      if (wTw > 0 && hTw > 0) {
        const mmW = (ps.orientation === 'landscape' ? hTw : wTw) * 25.4 / 1440
        const mmH = (ps.orientation === 'landscape' ? wTw : hTw) * 25.4 / 1440
        const names = Object.keys(PAGE_SIZES_MM) as (keyof typeof PAGE_SIZES_MM)[]
        const hit = names.find(n => Math.abs(PAGE_SIZES_MM[n][0] - mmW) < 3 && Math.abs(PAGE_SIZES_MM[n][1] - mmH) < 3)
        if (hit) setPageSize(hit as any)
      }
      const m = (px: any) => (Number(px) > 0 ? Math.round(Number(px) / 15) : undefined)
      const mt = m(ps.marginTop), mr = m(ps.marginRight), mb = m(ps.marginBottom), ml = m(ps.marginLeft)
      if (mt || mr || mb || ml) setDocMargins({ top: mt ?? 96, bottom: mb ?? 96, left: ml ?? 120, right: mr ?? 120 })
      if (Number(ps.cols) > 0) setDocColumns(Number(ps.cols))
    } catch { /* 忽略损坏的 pageSetup */ }
  }, [document])
  const [docLineNumbers, setDocLineNumbers] = useState(false)
  const [pmBlockCount, setPmBlockCount] = useState(1)

  // ===== 页面视图（Word 式独立纸页 + 页间留白 + 内容自动顺次流到下一页）=====
  const [pageCount, setPageCount] = useState(1)
  const [bodyTop, setBodyTop] = useState(0)
  // 收起页间空白（对齐 MS Word 双击页间空白）：true 时页面拼接，页界仅余一条细分隔线，
  // 双击分隔线恢复。视图级状态，不随文档保存。
  const [whiteSpaceHidden, setWhiteSpaceHidden] = useState(false)
  // 由分页引擎回报的每张纸页矩形（编辑器相对坐标），用于绘制背景纸页层，保证与内容严格对齐
  const [pageRects, setPageRects] = useState<{ top: number; height: number }[]>([])
  // 分页引擎回报的真实内容底部（内容盒坐标系）：纸张层据此裁掉尾部无内容纸，
  // 根除“文末大量空白页”（.doc 导入的尾部空段落 / 瞬态测量虚增不再产生幽灵纸）。
  const [contentMaxY, setContentMaxY] = useState(0)
  const pageContentPerPage = Math.max(50, pageHeightPx - docMargins.top - docMargins.bottom)
  const pageGap = Math.max(16, Math.round(pageHeightPx * 0.03))
  const metricsRef = useRef({ pageContentPerPage, gap: pageGap, marginTop: docMargins.top, marginBottom: docMargins.bottom, pageHeightPx, zoom: zoom / 100, collapse: whiteSpaceHidden })
  metricsRef.current = { pageContentPerPage, gap: pageGap, marginTop: docMargins.top, marginBottom: docMargins.bottom, pageHeightPx, zoom: zoom / 100, collapse: whiteSpaceHidden }
  // 可见纸页：contentMaxY（>0 时）之后的纸页没有任何内容 —— 不渲染，
  // 避免文档尾部空段落/瞬态虚增撑出的整页空白（“文本后面大量空白页”）。
  // 过滤只裁尾部（前缀保留），脚注按页索引 footnotesByPage[i] 不受影响。
  // collapse 模式下纸页 top 含 marginTop 偏移（页 i>0 的 top = marginTop + i*per），需先扣除。
  const visibleRects = contentMaxY > 0
    ? pageRects.filter((r) => r.top - (whiteSpaceHidden ? docMargins.top : 0) < contentMaxY + 1)
    : pageRects

  // 容器高度随纸页与留白自动增高，避免多页文档被裁切
  const pageRefMinH = visibleRects.length
    ? Math.max(...visibleRects.map((r) => bodyTop + r.top + r.height)) + 24
    : pageHeightPx

  // 测量编辑器内容实际高度，使“页面”容器随内容增高（多页文档不再被裁切）。
  // 同时监听缩放变化后重新测量。
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const measure = () => {
      // scrollHeight 为内容布局高度（不受 CSS zoom 影响，浏览器以未缩放像素返回）
      const h = el.scrollHeight
      setPageContentH((prev) => (Math.abs(prev - h) > 1 ? h : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [document, zoom, pageSize, orientation, pageContentH > 0])

  // 测量编辑器正文区域相对“页面”容器的顶部偏移，用于对齐背景纸页层
  useEffect(() => {
    const pr = pageRef.current
    const er = editorRef.current
    if (!pr || !er) return
    const measureTop = () => {
      const a = pr.getBoundingClientRect()
      const b = er.getBoundingClientRect()
      // getBoundingClientRect 返回缩放后像素，而 pageRects 的 top 是布局像素（offset 体系，
      // 不受 CSS scale 影响）。纸页层与内容层同处 scale 包裹层内，bodyTop 必须归一为布局像素，
      // 否则 zoom≠100% 时纸页背景与正文错位（文字落入页间空白）。
      const t = (b.top - a.top) / (zoom / 100)
      setBodyTop((prev) => (Math.abs(prev - t) > 0.5 ? t : prev))
      ;(window as any).__bodyTop = { bodyTop: Math.round(t), zoom, pageContentPerPage: Math.round(pageContentPerPage), editorPaddingTop: docMargins.top, editorRectHeight: Math.round(er.offsetHeight), editorPaddingBottom: docMargins.bottom }
    }
    const id = requestAnimationFrame(measureTop)
    return () => cancelAnimationFrame(id)
  }, [document, zoom, pageSize, orientation, pageWidthPx, pageHeightPx, docMargins, showRuler, docHeader, docColumns])

  // 边距 / 缩放 / 分栏等影响分页的布局变化后，强制重新计算分页
  // whiteSpaceHidden（页间空白收起/展开）改变页步长，同样需要重分页
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const id = requestAnimationFrame(() =>
      v.dispatch(v.state.tr.setMeta('forcePaginate', true).setMeta('addToHistory', false)),
    )
    return () => cancelAnimationFrame(id)
  }, [zoom, pageSize, orientation, docMargins, pageWidthPx, pageHeightPx, docColumns, whiteSpaceHidden])

  // 供 tablePlugins（AutoFit/拖拽）读取缩放比例：getBoundingClientRect 返回视觉像素，
  // 布局坐标 = 视觉坐标 / (zoom/100)
  useEffect(() => {
    ;(window as any).__docZoom = zoom / 100
  }, [zoom])


  useEffect(() => {
    if (!editorRef.current) return
    const doc = udmToProseMirror(document, schema)
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo, 'Mod-b': toggleMark(schema.marks.bold), 'Mod-i': toggleMark(schema.marks.italic), 'Mod-u': toggleMark(schema.marks.underline), 'Mod-f': () => { setSearchOpen(true); return true },
          // 对齐 MS Word：光标在表格内时按 Esc 把光标移到表格之后（退出表格编辑）
          'Escape': (state, dispatch) => {
            const $pos = state.selection.$from
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'table') {
                if (dispatch) {
                  const after = $pos.after(d)
                  dispatch(state.tr.setSelection(TextSelection.create(state.doc, Math.min(after, state.doc.content.size))).scrollIntoView())
                }
                return true
              }
            }
            return false
          } }),
        keymap(baseKeymap), history(),
        inputRules({ rules: [
          textblockTypeInputRule(/^#\s$/, schema.nodes.heading, () => ({ level: 1 })),
          textblockTypeInputRule(/^##\s$/, schema.nodes.heading, () => ({ level: 2 })),
          textblockTypeInputRule(/^###\s$/, schema.nodes.heading, () => ({ level: 3 })),
          wrappingInputRule(/^\s*-\s$/, schema.nodes.bullet_list),
          wrappingInputRule(/^\s*\d+\.\s$/, schema.nodes.ordered_list),
          wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
          textblockTypeInputRule(/^```\s$/, schema.nodes.code_block),
        ]}),
        tableEditing(), spellCheckPlugin(), searchPlugin(),
        // 表格边框拖拽（对齐 MS Word）：竖直边框调列宽、水平边框调行高，
        // 悬停边框显示 col-resize / row-resize 光标，拖拽实时跟随、松开提交事务。
        // （columnResizing 已移除：其 TableView 由 DocTableView 接替，且它仅在首行提供
        //   拖拽把手，与 Word「任意行边框皆可拖」的行为不一致。）
        // zoom 经 window.__docZoom 读取（插件创建后 props 不会随 React 重渲染更新，
        // 直接闭包捕获 zoom 会在缩放后读到旧值）。
        createTableDragResizePlugin(() => (window as any).__docZoom || 1),
        createTableRowColSelectPlugin(), createTrailingParagraphPlugin(),
        createPaginationPlugin(() => metricsRef.current, setPageCount, (rects: { top: number; height: number }[], maxY: number) => { setPageRects(rects); setContentMaxY(maxY) }, (pages: number[]) => { blockPagesRef.current = pages; setBlockPages(pages) }),
        // 差异对比高亮（左侧：被删除段落标红），仅在并排对比时生效
        diffDecorationPlugin(diffDelRef),
        // 格式刷：暂存源格式后，下一次在目标选区上直接套用源 marks。
        // 单击模式（lock=false）套用一次即解除；锁定模式（lock=true）可连续套用。
        new Plugin({
          appendTransaction: (_transactions: any, _oldState: any, newState: any) => {
            const fp = formatPainterRef.current
            if (!fp) return null
            const names = Object.keys(fp.marks)
            if (names.length === 0) return null // 源格式为空，无意义，跳过
            const sel = newState.selection
            if (sel instanceof NodeSelection) return null
            // 目标范围：拖选则取选区；仅光标（单击）则套用到光标所在文本块（段落），符合 Office 单击格式刷行为
            let from: number, to: number
            if (sel.empty) {
              const pos = Math.min(sel.from, newState.doc.content.size)
              const $pos = newState.doc.resolve(pos)
              from = $pos.start()
              to = $pos.end()
            } else {
              from = sel.from
              to = sel.to
            }
            if (from >= to) return null
            let tr: any = newState.tr
            let added = 0
            for (const name of names) {
              const attrs = (fp.marks as any)[name]
              const m = (schema.marks as any)[name]; if (!m) continue
              tr = tr.addMark(from, to, m.create(attrs || {}))
              added++
            }
            // 注意：appendTransaction 运行在 ProseMirror 应用 transaction 的同步流程中（DOM 处于中间态）。
            // 此处绝不能同步调用 React setState（setPainter），否则 React 重渲染会与 ProseMirror 竞争同一 DOM 子树，
            // 导致 "Failed to execute 'removeChild'" 崩溃。必须用 queueMicrotask 推迟到 DOM 更新完成之后。
            if (added === 0) return null
            if (!fp.lock) schedulePainterClear()
            return tr
          },
        }),
      ]
    })
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: {
        image: (node: any, view: any, getPos: any) => {
          const dom = window.document.createElement('div')
          // 应用环绕（float/wrapMode）与嵌入型样式，使文字环绕生效。
          // wrapMode 对齐 MS Word 六种环绕：inline 嵌入型 | left/right 四周型 |
          // topBottom 上下型 | behind 衬于文字下方 | front 浮于文字上方。
          // 旧文档兼容：float:left/right → 四周型；float:center 或无 float → 嵌入型。
          const applyFloat = (n: any) => {
            let mode: string = n.attrs.wrapMode || ''
            if (!mode) {
              const fl = n.attrs.float || ''
              if (fl === 'left' || fl === 'right') mode = fl
              else mode = 'inline'
            }
            const w = n.attrs.width || 300
            // 先重置，再按模式设置
            dom.style.cssText = 'position: relative; max-width: 100%;'
            if (mode === 'left' || mode === 'right') {
              dom.style.display = 'block'
              dom.style.float = mode
              dom.style.margin = mode === 'left' ? '4px 12px 4px 0' : '4px 0 4px 12px'
            } else if (mode === 'topBottom') {
              // 上下型：块级居中，不占满宽 → 用 inline-block + clear 双侧实现上下留白
              dom.style.display = 'block'
              dom.style.clear = 'both'
              dom.style.textAlign = 'center'
              dom.style.margin = '6px auto'
              dom.style.width = w + 'px'
            } else if (mode === 'behind' || mode === 'front') {
              // 衬于文字下方 / 浮于文字上方：0 高锚点 + 绝对定位，正文文字从下方/上方流过
              dom.style.display = 'block'
              dom.style.height = '0'
              dom.style.width = w + 'px'
              dom.style.margin = mode === 'front' ? '0 auto' : '0 auto'
              const inner = dom.querySelector('img') as HTMLElement | null
              if (inner) {
                inner.style.position = 'absolute'
                inner.style.top = '0'
                inner.style.left = '50%'
                inner.style.transform = 'translateX(-50%)'
                inner.style.zIndex = mode === 'front' ? '10' : '0'
                if (mode === 'behind') inner.style.opacity = '0.85'
              }
              return
            } else {
              // 嵌入型：独占一行居中
              dom.style.display = 'block'
              dom.style.float = 'none'
              dom.style.margin = '4px auto'
              dom.style.textAlign = 'center'
            }
            // 恢复非绝对定位的图片样式（behind/front 之外的分支）
            const inner = dom.querySelector('img') as HTMLElement | null
            if (inner) {
              inner.style.position = 'relative'
              inner.style.top = ''
              inner.style.left = ''
              inner.style.transform = ''
              inner.style.zIndex = ''
              inner.style.opacity = ''
            }
          }
          applyFloat(node)
          dom.style.position = 'relative'
          dom.style.maxWidth = '100%'
          const img = window.document.createElement('img')
          img.src = node.attrs.src
          img.alt = node.attrs.alt || ''
          // 禁止 <img> 原生拖拽：否则浏览器会把图片作为内存 blob File 塞进
          // dataTransfer，配合 Wails EnableFileDrop 触发 window 级 OnFileDrop →
          // ResolveFilePaths，报 "File object is not a file on the disk"。
          // 节点拖拽改由 ProseMirror 自身（自定义 dataTransfer 类型，不含 Files）处理。
          img.draggable = false
          img.addEventListener('dragstart', (e: DragEvent) => e.preventDefault())
          img.style.maxWidth = '100%'
          img.style.display = 'block'
          img.style.cursor = 'pointer'
          let w = node.attrs.width || 300
          let h = node.attrs.height || 0
          img.style.width = w + 'px'
          // 若节点带有确定高度（插入时已按自然比例算出），从首帧就固定高度，
          // 无需等图片 load，分页引擎首帧即可测得稳定高度，避免加载后重分页抖动。
          if (h && h > 0) {
            img.style.height = h + 'px'
          }
          dom.appendChild(img)
          // Resize handle
          const handle = window.document.createElement('div')
          handle.style.position = 'absolute'
          handle.style.bottom = '-4px'
          handle.style.right = '-4px'
          handle.style.width = '12px'
          handle.style.height = '12px'
          handle.style.background = '#4f46e5'
          handle.style.border = '2px solid white'
          handle.style.borderRadius = '2px'
          handle.style.cursor = 'nwse-resize'
          handle.style.zIndex = '100'
          handle.style.display = 'none'
          dom.appendChild(handle)
          // Show handle when selected
          const checkSelected = () => {
            const sel = view.state.selection
            if (sel instanceof NodeSelection && sel.from === getPos()) {
              handle.style.display = 'block'
              dom.style.outline = '2px solid #4f46e5'
              dom.style.outlineOffset = '2px'
            } else {
              handle.style.display = 'none'
              dom.style.outline = 'none'
            }
          }
          // Drag to resize
          let resizing = false, startX = 0, startW = 0
          handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            resizing = true
            startX = e.clientX
            startW = w
          })
          window.document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!resizing) return
            const diff = e.clientX - startX
            const newW = Math.max(50, startW + diff)
            img.style.width = newW + 'px'
            w = newW
          })
          window.document.addEventListener('mouseup', () => {
            if (!resizing) return
            resizing = false
            // Commit the new width to the document
            const pos = getPos()
            if (pos != null) {
              const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: w })
              view.dispatch(tr)
              scheduleCheck()
            }
          })
          // Click to select
          dom.addEventListener('click', (e: MouseEvent) => {
            const pos = getPos()
            if (pos != null) {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
              view.focus()
              scheduleCheck()
            }
          })
          // 仅在图片“首帧高度为 0（节点未带确定高度）”时，load 后才需要重分页。
          // 插入时已写入 width/height 的节点，load 不会改变渲染高度，无需重分页，
          // 避免 load → forcePaginate → 布局变化 → 再次 load 触发的死循环/闪烁。
          let repaginateTimer: any = null
          const repaginate = () => {
            if (h && h > 0) return // 已有确定高度，跳过
            if (repaginateTimer) clearTimeout(repaginateTimer)
            repaginateTimer = setTimeout(() => {
              try {
                const p = getPos()
                if (p != null) {
                  view.dispatch(view.state.tr.setMeta('forcePaginate', true).setMeta('addToHistory', false))
                }
              } catch { /* ignore */ }
            }, 120)
          }
          img.addEventListener('load', repaginate)
          img.addEventListener('error', repaginate)
          // 选择高亮：仅做只读检查，绝不重写 view.dispatch（原实现覆盖 view.dispatch
          // 会造成多图时层层包裹、并污染分页插件的 dispatch，属于反模式）。
          const scheduleCheck = () => setTimeout(checkSelected, 0)
          return {
            dom,
            // nodeView 更新（如切换环绕、改宽度、选中态变化）时同步样式与高亮。
            // 必须重设 float/wrap 样式，否则 attrs 变化后 DOM 不刷新，环绕失效。
            update: (n2: any, _view: any) => {
              applyFloat(n2)
              const w2 = n2.attrs.width || 300
              const h2 = n2.attrs.height || 0
              if (w2 !== w) {
                w = w2
                img.style.width = w + 'px'
              }
              if (h2 !== h) {
                h = h2
                img.style.height = h > 0 ? h + 'px' : ''
              }
              scheduleCheck()
              return true
            },
          }
        },
        math: (node, _view, getPos) => {
          const dom = window.document.createElement(node.attrs.inline ? 'span' : 'div')
          dom.className = 'sam-math' + (node.attrs.inline ? ' sam-math-inline' : '')
          const render = () => {
            const latex = node.attrs.latex || ''
            if ((window as any).katex && latex) {
              try {
                ;(window as any).katex.render(latex, dom, { displayMode: !node.attrs.inline, throwOnError: false })
                dom.classList.remove('sam-math-error')
              } catch {
                dom.textContent = latex
                dom.classList.add('sam-math-error')
              }
            } else {
              dom.textContent = latex ? `⟨formula:${latex}⟩` : '公式'
            }
            dom.setAttribute('data-latex', latex)
            dom.title = '双击编辑公式'
            dom.style.cursor = 'pointer'
          }
          render()
          dom.addEventListener('dblclick', (e) => {
            e.preventDefault()
            // 打开富公式编辑模态框，预填当前公式并定位到该节点，确认后替换原节点。
            // 注意：getPos 返回该 math 节点的绝对位置，比按 latex 全文搜索定位更可靠
            // （同文档存在多个相同 latex 的公式时旧逻辑会误改第一个）。
            const pos = typeof getPos === 'function' ? getPos() : null
            setMathEdit({
              latex: node.attrs.latex || '',
              inline: !!node.attrs.inline,
              pos: typeof pos === 'number' ? pos : null,
            })
            setShowMathModal(true)
          })
          return {
            dom,
            stopEvent: () => true,
            ignoreMutation: () => true,
          }
        },
        footnote_section: () => {
          // 脚注区在编辑器正文内隐藏渲染，实际显示在页面底部的脚注区
          const dom = window.document.createElement('div')
          dom.style.display = 'none'
          return { dom, contentDOM: dom }
        },
        // 表格 NodeView（对齐 MS Word）：div.tableWrapper > table > colgroup + tbody，
        // 支持固定列宽（拖拽边框/AutoFit 后切 table-layout:fixed），
        // 并承载左上角全选手柄（悬停显示、点击全选表格）。
        table: (node: any, view: any, getPos: any) => new DocTableView(node, view, getPos),
      },
      dispatchTransaction(tr) {
        const prevSel = view.state.selection
        // === 修复“全选表格后选择状态莫名丢失”：拦截 DOMObserver 源的 CellSelection 压塌 ===
        // Chromium 在选区内有节点变动（分页装饰 / 拼写装饰重渲染）时会自行回卷 DOM 选区，
        // PM 的 DOMObserver.flush 忠实同步这个回卷结果 —— 把活的 CellSelection 压塌成光标
        // （特征：docChanged=false、selectionSet、meta 为空、来自 flush 调用栈）。
        // 仅对从 flush 栈内派发的这类事务恢复原选区；用户主动操作（Esc/点空白/点其它单元格）
        // 不经过 flush 栈，不受影响。
        if (inDomObserverFlushRef.current && tr.selectionSet && !tr.docChanged &&
            (tr as any).getMeta('pointer') === undefined && (tr as any).getMeta('app') === undefined && Object.keys((tr as any).meta || {}).length === 0 &&
            prevSel instanceof CellSelection && !(tr.selection instanceof CellSelection)) {
          tr = tr.setSelection(prevSel)
        }
        const ns = view.state.apply(tr); view.updateState(ns)
        // 只有真正改动了文档内容才向外 emit。
        // 拼写检查装饰、选区变化等事务 docChanged=false，若也走 emit，
        // 会用 proseMirrorToUDM 的裸输出（只含 meta/blocks）覆盖 App 的 doc，
        // 把 protect / pageNumber 等文档级配置冲掉——这正是"设了密码保存后重开却没保护"的根因。
        if (onChangeRef.current && tr.docChanged) {
          const udm = proseMirrorToUDM(ns.doc, { pageNumber: pageNumberRef.current ?? undefined })
          const overrides = stylesRef.current
          if (Object.keys(overrides).length) {
            ;(udm as any).styles = Object.keys(overrides).map((name) => ({ name, type: 'paragraph', props: overrides[name] }))
          }
          // 透传文档保护信息，避免编辑时丢失密码锁定配置
          const curProtect = (documentRef.current as any)?.protect
          if (curProtect) (udm as any).protect = curProtect
          // proseMirrorToUDM 会把 meta 重置为 { title: 'Untitled' }（PM 文档里不含 meta），
          // 直接回流会把原文档标题冲掉——保存后文件标题变成 Untitled。透传原 meta。
          const curMeta = (documentRef.current as any)?.meta
          if (curMeta) (udm as any).meta = curMeta
          // 透传页面设置（纸张/方向/页边距/分栏），Go 写器据此输出 sectPr
          ;(udm as any).pageSetup = pageSetupRef.current
          lastEmittedRef.current = udm
          onChangeRef.current(udm)
        }
        // 仅文档内容真实变化时才触发拼写检查 —— 旧版对所有事务（含 spell 装饰事务自身）
        // 无条件调用，形成 "spell 事务 → onSpellCheck → setSpellErrors(新数组引用) →
        // spell 事务" 的 518ms 死循环（500ms 防抖 + 请求耗时）。循环中装饰反复重建、
        // 表格 NodeView 被连续重绘（实测静置 4s 重建 5 次+），点击/选区在 DOM 重建间隙
        // 全部落空 —— "表格内文字无法编辑/无法全选/样式无法应用"的统一根因。
        if (tr.docChanged && onSpellCheckRef.current) onSpellCheckRef.current(ns.doc.textContent)
        updateActiveState(ns)
        if (ns.doc.childCount !== pmBlockCount) setPmBlockCount(ns.doc.childCount)
        try { setFootnotes(extractFootnotes(ns.doc)) } catch (e) { /* ignore */ }
        try { setComments(extractComments(ns.doc)) } catch (e) { /* ignore */ }
        const ss = getSearchState(view); if (ss) { setMatchCount(ss.matches.length); setActiveMatch(ss.activeIndex) }
      },
      handleDOMEvents: {
        focus: () => { setFocused(true); return false },
        blur: () => { setFocused(false); return false },
        mouseup: () => {
          // round17：Mini 浮动工具栏已移除（干扰编辑），不再在选区时弹出
          return false
        },
        contextmenu: (view: any, e: any) => {
          e.preventDefault()
          const target = e.target as HTMLElement | null
          const box = (target && target.closest && target.closest('.text-box')) as HTMLElement | null
          contextMenuBoxRef.current = box
          setContextMenuOnTextBox(!!box)
          setShowContextMenu(true)
          setContextMenuPos({ x: e.clientX, y: e.clientY })
          return false
        },

        click: (_view: any, event: any) => {
          const el = event.target as HTMLElement
          const link = el?.closest?.('.sam-toc-link') as HTMLElement | null
          if (link) {
            const tid = link.getAttribute('data-target')
            if (tid) { jumpToHeading(tid); return true }
          }
          const cm = el?.closest?.('.comment-mark') as HTMLElement | null
          if (cm) {
            const cid = cm.getAttribute('data-comment-id')
            if (cid) {
              setActiveComment(cid)
              const card = window.document.getElementById(`comment-card-${cid}`)
              if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
          }
          return false
        },
      },
      // === 修订追踪：输入时标记插入、删除时保留为删除线 ===
      handleTextInput(view, from, to, text) {
        if (!trackChangesRef.current) return false
        const { schema, tr } = view.state
        const insertMark = schema.marks.insert_track
        if (from !== to) {
          // 替换选区：原选区标记为删除，新文本标记为插入
          const hasDelete = view.state.doc.rangeHasMark(from, to, schema.marks.delete_track)
          if (!hasDelete) tr.addMark(from, to, schema.marks.delete_track.create({ author: 'User' }))
        }
        const insFrom = from !== to ? from : from
        tr.insertText(text, from, to)
        tr.addMark(insFrom, insFrom + text.length, insertMark.create({ author: 'User' }))
        tr.setSelection(TextSelection.create(tr.doc, insFrom + text.length))
        view.dispatch(tr)
        return true
      },
      handleKeyDown(view, event) {
        if (!trackChangesRef.current) return false
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false
        const { state } = view
        const { schema } = state
        const delMark = schema.marks.delete_track
        const { from, to, empty } = state.selection
        let start = from, end = to
        if (empty) {
          if (event.key === 'Backspace') {
            if (from === 0) return false
            // 跳过块边界
            const $from = state.doc.resolve(from)
            if ($from.parentOffset === 0) return false
            start = from - 1; end = from
          } else {
            const $from = state.doc.resolve(from)
            if ($from.parentOffset === $from.parent.content.size) return false
            start = from; end = from + 1
          }
        }
        // 若该范围已是删除线，则真正删除（第二次退格生效）
        const already = state.doc.rangeHasMark(start, end, delMark)
        if (already) {
          const tr = state.tr.delete(start, end)
          tr.setSelection(TextSelection.create(tr.doc, event.key === 'Backspace' ? start : start))
          view.dispatch(tr)
          return true
        }
        const tr = state.tr.addMark(start, end, delMark.create({ author: 'User' }))
        const cursor = event.key === 'Backspace' ? start : end
        tr.setSelection(TextSelection.create(tr.doc, cursor))
        view.dispatch(tr)
        return true
      },
    })
    viewRef.current = view; ;(window as any).__pmView = view
    // 拼写面板点击定位（App 层调用）：在文档中找 word 首次出现 → 选中 + 滚动 + 闪烁。
    // 返回 false 表示未找到（App 层提示）。挂在 window 上与 __pmView 同生命周期。
    // 注意：绝不能闭包捕获 view —— React StrictMode 双挂载时 cleanup 顺序不定，
    // 最终留在 window 上的可能是【旧实例（已 destroy）】的函数，其 view.state.doc
    // 是过期空文档 → 永远 no-hit。每次调用时从 viewRef.current 取当前活跃 view。
    ;(window as any).__docJumpToWord = (word: string): boolean => {
      try {
        const v = viewRef.current
        if (!word || !v) return false
        const w = word.toLowerCase()
        let hit: { from: number; to: number } | null = null
        // 注意：descendants 回调 return false = 不深入该节点子树。
        // 非文本节点（段落/表格等容器）必须 return true 才能继续深入找文本，
        // 只有已命中时才 return false 提前剪枝。
        v.state.doc.descendants((node: any, pos: number) => {
          if (hit) return false
          if (!node.isText || !node.text) return true
          const idx = node.text.toLowerCase().indexOf(w)
          if (idx >= 0) hit = { from: pos + idx, to: pos + idx + word.length }
          return !hit
        })
        if (!hit) return false
        const h = hit as { from: number; to: number }
        v.dispatch(v.state.tr
          .setSelection(TextSelection.create(v.state.doc, h.from, h.to))
          .scrollIntoView())
        v.focus()
        // 闪烁高亮：给包含该词的拼写错误装饰 DOM 加动画类（样式见 index.css）
        try {
          v.dom.querySelectorAll('.spell-error').forEach((el) => {
            if (el.textContent && el.textContent.toLowerCase().includes(w)) {
              el.classList.add('spell-jump-flash')
              setTimeout(() => el.classList.remove('spell-jump-flash'), 1600)
            }
          })
        } catch { /* 忽略 */ }
        return true
      } catch { return false }
    }
    // 包装 DOMObserver.flush：标记"伪同步事务"的调用来源（配合 dispatchTransaction 恢复被压塌的 CellSelection）
    try {
      const dv = view as any
      if (dv?.domObserver?.flush) {
        const origFlush = dv.domObserver.flush.bind(dv.domObserver)
        dv.domObserver.flush = (...args: any[]) => {
          inDomObserverFlushRef.current = true
          try { return origFlush(...args) } finally { inDomObserverFlushRef.current = false }
        }
      }
    } catch { /* 旧版本 PM 无 domObserver 时跳过 */ }
    try { setFootnotes(extractFootnotes(doc)) } catch (e) { /* ignore */ }
    try { setComments(extractComments(doc)) } catch (e) { /* ignore */ }
    lastEmittedRef.current = document
    return () => { view.destroy(); viewRef.current = null; (window as any).__docJumpToWord = undefined }
  }, [])

  // 当外部（打开文件 / 新建文档）替换了 document prop 时，同步到编辑器视图。
  // 若该 document 正是本组件刚通过 onChange 发出的引用，则说明是自身编辑回流，跳过以避免光标重置与内容抖动。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (document === lastEmittedRef.current) return
    lastEmittedRef.current = document
    const pn = (document as any)?.pageNumber
    setPageNumber(pn ? { ...pn } : null)
    const newDoc = udmToProseMirror(document, schema)
    const newState = EditorState.create({ doc: newDoc, plugins: view.state.plugins })
    view.updateState(newState)
    // 新文档加载后同步右侧批注栏（udm.comments 中的批注经 convert 已变回 comment_mark）
    try { setComments(extractComments(newDoc)) } catch (e) { /* ignore */ }
    if (onSpellCheckRef.current) onSpellCheckRef.current(newDoc.textContent)
  }, [document])

  // 并排对比：当对比目标变化时，挂载/重建右侧只读视图，并计算差异高亮集合
  useEffect(() => {
    if (!compareTarget || !compareRef.current) {
      // 退出对比：清空差异集合并刷新左侧装饰
      diffAddRef.current = new Set()
      diffDelRef.current = new Set()
      refreshDiffDecorations()
      return
    }
    const leftTexts = collectParagraphTexts(viewRef.current)
    const pmDoc = udmToProseMirror(compareTarget.doc, schema)
    const state = EditorState.create({
      doc: pmDoc,
      plugins: [
        // 右侧只读视图：差异高亮（新增段落标绿）
        diffDecorationPlugin(diffAddRef),
      ],
    })
    const view = new EditorView(compareRef.current, {
      state,
      editable: () => false,
      // 只读视图不需要丰富的编辑插件；保持轻量
    })
    compareViewRef.current = view
    // 计算差异：右侧新增、左侧被删
    const rightTexts = collectParagraphTexts(view)
    const { add, del } = computeDiffSets(leftTexts, rightTexts)
    diffAddRef.current = add
    diffDelRef.current = del
    refreshDiffDecorations()
    return () => { view.destroy(); compareViewRef.current = null }
  }, [compareTarget])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: any = {}
    if ($from.parent.type.name === 'paragraph' || $from.parent.type.name === 'heading') { Object.assign(attrs, { align: $from.parent.attrs.align, lineHeight: $from.parent.attrs.lineHeight, indent: $from.parent.attrs.indent, indentLeft: $from.parent.attrs.indentLeft, firstLine: $from.parent.attrs.firstLine, spaceBefore: $from.parent.attrs.spaceBefore, spaceAfter: $from.parent.attrs.spaceAfter, border: $from.parent.attrs.border, shading: $from.parent.attrs.shading, rtl: $from.parent.attrs.rtl, letterSpacing: $from.parent.attrs.letterSpacing, dropCap: $from.parent.attrs.dropCap }) }
    let f = '', sz = '', c = '', cs = ''
    const collect = (m: any) => { marks.add(m.type.name); if (m.type.name === 'fontFamily') f = m.attrs.font; if (m.type.name === 'fontSize') sz = m.attrs.size; if (m.type.name === 'textColor') c = m.attrs.color; if (m.type.name === 'charSpacing') cs = m.attrs.value }
    if (empty) { state.storedMarks?.forEach(collect); $from.marks().forEach(collect) } else { state.doc.nodesBetween(from, to, (n) => n.marks.forEach(collect)) }
    if ($from.parent.type.name === 'heading') marks.add(`heading-${$from.parent.attrs.level}`)
    let isInTable = false
    let cellVa = ''
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d)
      if (n.type.name === 'table_cell' && !cellVa) cellVa = n.attrs.vAlign || ''
      if (n.type.name === 'table') { isInTable = true; break }
    }
    setInTable(isInTable); setActiveMarks(marks); setActiveAttrs(attrs); setActiveFont(f); setActiveFontSize(sz); setActiveColor(c); setActiveCharSpacing(cs)
    setCellVAlignState(cellVa)
    // Track if cursor is on an image or shape node (for float/wrap buttons)
    const sel = state.selection
    const selNode = sel instanceof NodeSelection ? sel.node : null
    setActiveIsImage(!!selNode && selNode.type.name === 'image')
    setActiveIsShape(!!selNode && selNode.type.name === 'text_box')
    setActiveTextBox(selNode && selNode.type.name === 'text_box' ? { node: selNode, pos: sel.from } : null)
    setTick(t => t + 1)
  }

  // 表格工具栏状态兜底同步：点击表格外的空白区/页边距时 DOM 选区变化不产生 PM 事务，
  // inTable 会卡在 true —— 用户看到的“表格编辑模式无法退出”。监听 selectionchange 刷新。
  // 注意：组件内 document 被 props.document（UDM 文档）遮蔽，必须用 window.document。
  // 加固：编辑器失焦（如点击功能区/工具栏）时浏览器可能折叠 DOM 选区，但 PM 状态里的
  // 表格选区（CellSelection）依然有效 —— 此时保持工具栏，对齐 Word“全选表格后点功能区
  // 仍保持全选”。仅当 PM 选区也不再指向表格时才清 inTable。
  useEffect(() => {
    const onSelChange = () => {
      const v = viewRef.current
      const pmDom = v?.dom as HTMLElement | undefined
      if (!pmDom) return
      const anchor = window.getSelection()?.anchorNode
      if (!anchor || !pmDom.contains(anchor)) {
        const sel = v!.state.selection as any
        let stillTable = false
        try {
          if (sel && sel.$anchorCell && sel.$headCell) stillTable = true
          else if (sel && sel.$from) {
            for (let d = sel.$from.depth; d > 0; d--) {
              if (sel.$from.node(d).type.name === 'table') { stillTable = true; break }
            }
          }
        } catch { /* ignore */ }
        if (!stillTable) setInTable(false)
        return
      }
      const el = anchor.nodeType === 1 ? (anchor as HTMLElement) : anchor.parentElement
      setInTable(!!el?.closest?.('table'))
    }
    window.document.addEventListener('selectionchange', onSelChange)
    return () => window.document.removeEventListener('selectionchange', onSelChange)
  }, [])

  // ============ 样式系统 ============
  const resolveStyle = (name: string): StyleFormat => {
    if (styles[name]) return styles[name]
    const b = BUILTIN_STYLE_MAP[name]
    return b ? b.format : {}
  }

  const allStyles: AppStyle[] = useMemo(() => {
    const list: AppStyle[] = BUILTIN_STYLES.map((s) => ({ ...s, format: styles[s.name] ?? s.format }))
    const customNames = Object.keys(styles).filter((n) => !BUILTIN_STYLE_MAP[n])
    for (const n of customNames) list.push({ name: n, type: 'paragraph', builtin: false, format: styles[n] })
    return list
  }, [styles])

  const applyStyleMarks = (tr: any, from: number, to: number, fmt: StyleFormat) => {
    if (from >= to) return
    const m = schema.marks
    if (fmt.bold !== undefined) { if (fmt.bold) tr.addMark(from, to, m.bold.create()); else tr.removeMark(from, to, m.bold) }
    if (fmt.italic !== undefined) { if (fmt.italic) tr.addMark(from, to, m.italic.create()); else tr.removeMark(from, to, m.italic) }
    if (fmt.fontSize) { tr.removeMark(from, to, m.fontSize); tr.addMark(from, to, m.fontSize.create({ size: fmt.fontSize })) }
    if (fmt.color) { tr.removeMark(from, to, m.textColor); tr.addMark(from, to, m.textColor.create({ color: fmt.color })) }
    if (fmt.fontFamily) { tr.removeMark(from, to, m.fontFamily); tr.addMark(from, to, m.fontFamily.create({ font: fmt.fontFamily })) }
  }

  const applyStyle = (name: string, explicit?: StyleFormat) => {
    const v = viewRef.current
    if (!v) return
    const fmt = explicit ?? resolveStyle(name)
    const { state, dispatch } = v
    const tr = state.tr
    const { from, to } = state.selection
    const targets: { pos: number; node: any }[] = []
    state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if ((node.type.name === 'paragraph' || node.type.name === 'heading') && state.doc.resolve(pos).parent.type.name === 'doc') { targets.push({ pos, node }); return false }
      return true
    })
    for (const { pos, node } of targets) {
      const start = pos
      const end = pos + node.nodeSize
      if (fmt.outlineLevel && fmt.outlineLevel > 0) {
        tr.setBlockType(start, end, schema.nodes.heading, { level: fmt.outlineLevel, id: node.attrs.id || '', style: name, align: fmt.align ?? node.attrs.align })
      } else {
        tr.setBlockType(start, end, schema.nodes.paragraph, { style: name, align: fmt.align ?? node.attrs.align })
      }
      applyStyleMarks(tr, start + 1, end - 1, fmt)
    }
    if (targets.length) { dispatch(tr); v.focus() }
    setShowStyles(false)
  }

  const updateStyleEverywhere = (name: string, fmt: StyleFormat) => {
    const v = viewRef.current
    if (!v) return
    const { state, dispatch } = v
    const tr = state.tr
    const positions: number[] = []
    state.doc.descendants((node: any, pos: number) => {
      if ((node.type.name === 'paragraph' || node.type.name === 'heading') && node.attrs.style === name) positions.push(pos)
    })
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos)!
      const start = pos
      const end = pos + node.nodeSize
      const newAttrs: any = { ...node.attrs, align: fmt.align ?? node.attrs.align, style: name }
      tr.setNodeMarkup(pos, null, newAttrs)
      applyStyleMarks(tr, start + 1, end - 1, fmt)
    }
    if (positions.length) { dispatch(tr); v.focus() }
    setStyles((prev) => ({ ...prev, [name]: fmt }))
  }

  const createStyleFromSelection = () => {
    const v = viewRef.current
    if (!v) return
    const name = prompt(t('doc.newStyleName') || '样式名称')
    if (!name) return
    const { state } = v
    const { $from } = state.selection
    const block = $from.parent
    const text = block.firstChild
    const marks = text ? text.marks : []
    const bold = marks.find((m: any) => m.type.name === 'bold')
    const italic = marks.find((m: any) => m.type.name === 'italic')
    const size = marks.find((m: any) => m.type.name === 'fontSize')
    const color = marks.find((m: any) => m.type.name === 'textColor')
    const font = marks.find((m: any) => m.type.name === 'fontFamily')
    const fmt: StyleFormat = {}
    if (bold) fmt.bold = true
    if (italic) fmt.italic = true
    if (size) fmt.fontSize = size.attrs.size
    if (color) fmt.color = color.attrs.color
    if (font) fmt.fontFamily = font.attrs.font
    if (block.attrs.align) fmt.align = block.attrs.align
    const lvl = outlineLevelFromName(name)
    if (lvl) fmt.outlineLevel = lvl
    setStyles((prev) => ({ ...prev, [name]: fmt }))
    applyStyle(name, fmt)
  }

  const jumpToHeading = (tid: string) => {
    const v = viewRef.current
    if (!v || !tid) return
    const { state } = v
    let found = -1
    state.doc.descendants((node: any, pos: number) => {
      if (node.attrs.id === tid && (node.type.name === 'heading' || node.type.name === 'paragraph')) { found = pos; return false }
    })
    if (found >= 0) {
      const tr = state.tr.setSelection(TextSelection.create(state.doc, found + 1))
      v.dispatch(tr)
      v.focus()
      const dom = v.nodeDOM(found) as HTMLElement | null
      dom?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // 判定目录相关段落：标题段（style='Table of Contents'）或条目段（style='TOC Entry'/含 tocLink）
  const isTocRelatedPara = (node: any): boolean => {
    if (node.type.name !== 'paragraph') return false
    if (node.attrs.style === 'Table of Contents' || node.attrs.style === 'TOC Entry') return true
    let hasLink = false
    node.content.forEach((c: any) => { if (c.type.name === 'tocLink') hasLink = true })
    return hasLink
  }

  // 收集全部标题（heading 或段落型标题），附顶层块序号（对应分页引擎 blockPages 下标）
  const collectHeadings = (doc: any) => {
    const heads: { level: number; text: string; id: string; blockIndex: number }[] = []
    let idx = -1
    doc.forEach((node: any) => {
      idx++
      const lvl = node.type.name === 'heading' ? Math.max(1, node.attrs.level || 1)
        : node.type.name === 'paragraph' ? (node.attrs.outlineLevel || outlineLevelFromName(node.attrs.style || '') || 0) : 0
      if (lvl > 0) heads.push({ level: lvl, text: node.textContent || `标题 ${lvl}`, id: node.attrs.id || '', blockIndex: idx })
    })
    return heads
  }

  // 依据分页引擎回报的每块页码，把页码回填到 tocLink.page（等价 MS Word“更新域”）。
  // 无变化时不派发事务，因此不会形成 dispatch→重算→dispatch 死循环。
  const updateTocPageNumbers = () => {
    const v = viewRef.current; if (!v) return
    const pages = blockPagesRef.current
    if (!pages || pages.length === 0) return
    const { state, dispatch } = v
    const idPage = new Map<string, string>()
    let idx = -1
    state.doc.forEach((node: any) => {
      idx++
      const lvl = node.type.name === 'heading' ? Math.max(1, node.attrs.level || 1)
        : node.type.name === 'paragraph' ? (node.attrs.outlineLevel || outlineLevelFromName(node.attrs.style || '') || 0) : 0
      if (lvl > 0 && node.attrs.id) idPage.set(node.attrs.id, String((pages[idx] != null ? pages[idx] : idx) + 1))
    })
    const tr = state.tr
    let changed = false
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name !== 'tocLink') return true
      const target = node.attrs.target
      if (!target) return false
      const pg = idPage.get(target)
      if (pg != null && pg !== String(node.attrs.page || '')) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, page: pg })
        changed = true
      }
      return false
    })
    if (changed) dispatch(tr)
  }

  const generateTOC = () => {
    const v = viewRef.current
    if (!v) return
    const { state, dispatch } = v
    // 标题判定：heading 节点，或带 outlineLevel 的段落，或样式名匹配 Heading 模式。
    // WYSIWYG 里用「标题样式」写的文字是 paragraph + style，不是 heading 节点。
    // 1) 为缺少 id 的标题（含段落型标题）分配稳定 id
    const tr0 = state.tr
    state.doc.descendants((node: any, pos: number) => {
      const lvl = node.type.name === 'heading' ? Math.max(1, node.attrs.level || 1)
        : node.type.name === 'paragraph' ? (node.attrs.outlineLevel || outlineLevelFromName(node.attrs.style || '') || 0) : 0
      if (lvl > 0 && !node.attrs.id) {
        tr0.setNodeMarkup(pos, null, { ...node.attrs, id: 'h-' + Math.random().toString(36).slice(2, 9) })
      }
    })
    if (tr0.docChanged) dispatch(tr0)
    // 2) 收集标题（提纲级别），生成多级编号
    const headings = collectHeadings(v.state.doc)
    if (headings.length === 0) { alert(t('doc.noHeadingsForToc')); return }
    const counters: number[] = []
    const numbered = headings.map((h) => {
      const lvl = Math.max(1, h.level)
      counters[lvl] = (counters[lvl] || 0) + 1
      for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0
      const num = counters.slice(1, lvl + 1).filter((x) => x).join('.')
      return { ...h, num }
    })
    // 3) 组装目录节点：标题 + 条目（点线引导符/页码由 tocLink toDOM + CSS 渲染，对齐 MS Word 目录外观）
    const pageOf = (blockIndex: number) => {
      const pg = blockPagesRef.current[blockIndex]
      return pg != null ? String(pg + 1) : ''
    }
    const title = schema.nodes.paragraph.create(
      { style: 'Table of Contents' },
      schema.text(t('doc.tocTitle'), [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })])
    )
    const nodes: any[] = [title]
    numbered.forEach((h) => {
      const indent = '\u3000'.repeat(Math.max(0, h.level - 1))
      const label = `${h.num}  ${h.text}`
      const link = schema.nodes.tocLink.create({ target: h.id, label: indent + label, page: pageOf(h.blockIndex), level: h.level })
      nodes.push(schema.nodes.paragraph.create({ style: 'TOC Entry' }, link))
    })
    // 4) 计算插入位置：
    //    a) 文档已有目录 → 原地替换（“更新目录”不搬家，对齐 MS Word 更新域行为）
    //    b) 无目录 → 插到光标处（光标在空段落则替换该段；否则插到当前顶层块之后）
    let replaceFrom = -1, replaceTo = -1
    const blocks: { node: any; from: number; to: number }[] = []
    v.state.doc.forEach((node: any, _offset: number, pos: number) => {
      blocks.push({ node, from: pos, to: pos + node.nodeSize })
    })
    for (const b of blocks) {
      if (isTocRelatedPara(b.node)) { replaceFrom = b.from; replaceTo = b.to; break }
    }
    const tr = v.state.tr
    if (replaceFrom >= 0) {
      // 扩展到连续目录段末尾（旧目录可能夹空行）
      for (const b of blocks) {
        if (b.from >= replaceTo && isTocRelatedPara(b.node)) replaceTo = b.to
      }
      tr.replaceWith(replaceFrom, replaceTo, nodes)
    } else {
      let insertAt = 0
      try {
        const { $from } = v.state.selection
        if ($from.depth >= 1) {
          const topFrom = $from.before(1), topTo = $from.after(1)
          const topNode = v.state.doc.nodeAt(topFrom)
          if (topNode && topNode.type.name === 'paragraph' && topNode.childCount === 0) {
            // 空段落：替换它
            tr.delete(topFrom, topTo)
            insertAt = topFrom
          } else {
            insertAt = topTo
          }
        }
      } catch { insertAt = 0 }
      let pos = insertAt
      nodes.forEach((n) => { tr.insert(pos, n); pos += n.nodeSize })
    }
    dispatch(tr)
    v.focus()
    // 5) 插入改变了分页 → 分页引擎回报新页码后自动回填（useEffect[blockPages] 也会触发）
    requestAnimationFrame(() => updateTocPageNumbers())
    setTimeout(() => updateTocPageNumbers(), 120)
    setTimeout(() => updateTocPageNumbers(), 400)
  }

  const insertManualToc = () => {
    const v = viewRef.current
    if (!v) return
    const text = prompt(t('doc.prompt.tocEntry'))
    if (!text) return
    const lines = text.split('\n').filter((l) => l.trim())
    const tr = v.state.tr
    const title = schema.nodes.paragraph.create(
      { style: 'Table of Contents' },
      schema.text(t('doc.tocTitle'), [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })])
    )
    const nodes: any[] = [title]
    lines.forEach((line) => {
      const level = line.startsWith('  ') ? 2 : 1
      const indent = ' '.repeat(level - 1)
      nodes.push(schema.nodes.paragraph.create({ style: 'TOC Entry' }, schema.text(indent + line.trim())))
    })
    let pos = v.state.selection.from
    nodes.forEach((n) => { tr.insert(pos, n); pos += n.nodeSize })
    v.dispatch(tr); v.focus()
  }

  const styleDesc = (fmt: StyleFormat) => {
    const parts: string[] = []
    if (fmt.fontSize) parts.push(fmt.fontSize)
    if (fmt.bold) parts.push(t('doc.bold'))
    if (fmt.italic) parts.push(t('doc.italic'))
    if (fmt.color) parts.push(fmt.color)
    if (fmt.align) parts.push(fmt.align)
    return parts.join(' · ')
  }

  // 将页码模板中的占位符替换为真实页码：{n}/{N}→当前页，{total}/{NUMPAGES}/{TOTAL}→总页数
  const fillPageNumber = (fmt: string | undefined, n: number, total: number) => {
    const f = fmt || '第 {n} 页'
    return f
      .replace(/\{n\}/gi, String(n))
      .replace(/\{total\}/gi, String(total))
      .replace(/\{NUMPAGES\}/gi, String(total))
  }

  // 主动向外 emit 当前文档（携带最新页码配置）。
  // 用于「仅修改页码设置、未编辑正文」时，确保 pageNumber 写回 doc 以免保存丢失。
  const emitDoc = (pn?: PageNumberConfig | null) => {
    const v = viewRef.current
    if (!v || !onChangeRef.current) return
    const cfg = pn === undefined ? pageNumberRef.current : pn
    if (pn !== undefined) pageNumberRef.current = pn
    const out = proseMirrorToUDM(v.state.doc, { pageNumber: cfg ?? undefined })
    // proseMirrorToUDM 只还原正文，样式与保护配置不在 PM 文档里，
    // 必须与 dispatchTransaction 一样显式透传，否则会被这次 emit 抹掉
    // （典型后果：设过密码保护后改一次页码/页面设置，保存出去的文件就没有保护了）。
    const overrides = stylesRef.current
    if (Object.keys(overrides).length) {
      ;(out as any).styles = Object.keys(overrides).map((name) => ({ name, type: 'paragraph', props: overrides[name] }))
    }
    const curProtect = (documentRef.current as any)?.protect
    if (curProtect) (out as any).protect = curProtect
    const curMeta = (documentRef.current as any)?.meta
    if (curMeta) (out as any).meta = curMeta
    lastEmittedRef.current = out // 标记为自身 emit，避免同步 effect 误触发重建
    onChangeRef.current(out)
  }

  const exec = (cmd: string) => {
    const v = viewRef.current; if (!v) return; const sel = v.state.selection
    const selNode = sel instanceof NodeSelection ? sel.node : null
    switch (cmd) {
      case 'bold': toggleMark(schema.marks.bold)(v.state, v.dispatch); break
      case 'italic': toggleMark(schema.marks.italic)(v.state, v.dispatch); break
      case 'underline': toggleMark(schema.marks.underline)(v.state, v.dispatch); break
      case 'strikethrough': toggleMark(schema.marks.strikethrough)(v.state, v.dispatch); break
      case 'superscript': toggleMark(schema.marks.superscript)(v.state, v.dispatch); break
      case 'subscript': toggleMark(schema.marks.subscript)(v.state, v.dispatch); break
      case 'code': toggleMark(schema.marks.code)(v.state, v.dispatch); break
      case 'h1': setBlockType(schema.nodes.heading, { level: 1 })(v.state, v.dispatch); break
      case 'h2': setBlockType(schema.nodes.heading, { level: 2 })(v.state, v.dispatch); break
      case 'h3': setBlockType(schema.nodes.heading, { level: 3 })(v.state, v.dispatch); break
      case 'paragraph': setBlockType(schema.nodes.paragraph)(v.state, v.dispatch); break
      case 'bulletList': wrapIn(schema.nodes.bullet_list)(v.state, v.dispatch); break
      case 'orderedList': wrapIn(schema.nodes.ordered_list)(v.state, v.dispatch); break
      case 'quote': wrapIn(schema.nodes.blockquote)(v.state, v.dispatch); break
      // 段落对齐（供悬浮工具栏/右键菜单复用；主 ribbon 直接调 setParaAttr）
      case 'alignLeft': setParaAttr('align', 'left'); break
      case 'alignCenter': setParaAttr('align', 'center'); break
      case 'alignRight': setParaAttr('align', 'right'); break
      case 'alignJustify': setParaAttr('align', 'justify'); break
      case 'codeBlock': setBlockType(schema.nodes.code_block)(v.state, v.dispatch); break
      case 'undo': undo(v.state, v.dispatch); break
      case 'redo': redo(v.state, v.dispatch); break
      case 'copy': { v.focus(); serializeSelectionToClipboard(v, false); setShowContextMenu(false); break }
      case 'cut': { v.focus(); serializeSelectionToClipboard(v, true); setShowContextMenu(false); break }
      case 'paste': {
        v.focus()
        ;(async () => {
          try {
            const html = await (window as any).runtime.GetClipboardHtml()
            if (html && html.trim()) {
              const nativeDoc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
              const slice = PMDOMParser.fromSchema(schema).parseSlice(nativeDoc.body)
              v.dispatch(v.state.tr.replaceSelection(slice).scrollIntoView())
            } else {
              const t2 = await (window as any).runtime.ClipboardGetText()
              if (t2) v.dispatch(v.state.tr.insertText(t2).scrollIntoView())
            }
          } catch { /* ignore */ }
        })()
        setShowContextMenu(false); break
      }
      case 'formatPainter': {
        // 单击格式刷：未激活则开启（非锁定），已激活则关闭（toggle）
        if (formatPainterRef.current) setPainter(null)
        else setPainter({ marks: getActiveMarks(), lock: false })
        break
      }
      case 'clearFormat': {
        const { state, dispatch } = v
        const { from, to } = state.selection
        const tr = state.tr
        // 修复：schema 中的颜色 mark 名是 textColor（此前写成 fontColor，颜色永远清不掉）
        const markNames = ['bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', 'code', 'fontSize', 'fontFamily', 'textColor', 'highlight', 'charSpacing', 'link', 'wordArt']
        markNames.forEach((n) => { const m = (state.schema.marks as any)[n]; if (m) tr.removeMark(from, to, m) })
        dispatch(tr); v.focus(); break
      }
      case 'pageBreak': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create({ restart: false, startNumber: 1 }))); break
      case 'pageBreakRestart': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create({ restart: true, startNumber: 1 }))); break
      case 'horizontalRule': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create())); break
      case 'textBox': { const cell = schema.nodes.paragraph.create(null, schema.text(t('doc.textBoxDefault'))); v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.text_box.create(null, cell))); break }
      case 'shape:rect':
      case 'shape:roundRect':
      case 'shape:ellipse':
      case 'shape:triangle':
      case 'shape:diamond':
      case 'shape:rightArrow':
      case 'shape:star5':
      case 'shape:heart': {
        const shapeType = cmd.split(':')[1]
        const cell = schema.nodes.paragraph.create(null, schema.text(t('doc.textBoxDefault')))
        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.text_box.create({ shape: shapeType }, cell)))
        break
      }
      case 'imgFloatLeft': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'left', wrapMode: 'left' })); break }
      case 'imgFloatRight': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'right', wrapMode: 'right' })); break }
      case 'imgFloatCenter': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'center', wrapMode: 'inline' })); break }
      case 'imgFloatNone': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: '', wrapMode: 'inline' })); break }
      case 'imgToggleWrap': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, wrap: !selNode.attrs.wrap })); break }
      // 对齐 MS Word 六种环绕方式：inline/left/right/topBottom/behind/front
      // 用法 exec('imgWrapMode:behind') 等
      case 'imgWrapMode': { if (selNode && selNode.type.name === 'image') {
        const mode = cmd.split(':')[1] || 'inline'
        const floatMap: Record<string, string> = { inline: '', left: 'left', right: 'right', topBottom: 'center', behind: '', front: '' }
        v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: floatMap[mode] ?? '', wrap: mode !== 'behind' && mode !== 'front', wrapMode: mode }))
      } break }
      case 'shapeFloatLeft': { if (selNode && selNode.type.name === 'text_box') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'left' })); break }
      case 'shapeFloatRight': { if (selNode && selNode.type.name === 'text_box') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'right' })); break }
      case 'tableAlignLeft': { alignTable(v, 'left'); break }
      case 'tableAlignCenter': { alignTable(v, 'center'); break }
      case 'tableAlignRight': { alignTable(v, 'right'); break }
      case 'footnote': {
        const text = prompt(t('doc.prompt.footnote') || '输入脚注内容'); if (!text) break
        const { state, dispatch } = v
        let footnoteCount = 0
        state.doc.descendants(node => { if (node.type.name === 'footnote') footnoteCount++ })
        const num = footnoteCount + 1
        const tr = state.tr
        // 1) 在光标处插入脚注引用
        tr.replaceSelectionWith(schema.nodes.footnote.create({ content: text, num }))
        // 2) 追加到已有脚注区或新建脚注区（同一事务，避免反复 reconcile 卡死）
        const doc = tr.doc
        let target = -1
        doc.descendants((node: any, pos: number) => { if (node.type.name === 'footnote_section') target = pos })
        if (target >= 0) {
          const section = doc.nodeAt(target)!
          tr.insert(target + section.nodeSize - 1, schema.nodes.footnote_item.create({ num }, schema.text(text)))
        } else {
          const item = schema.nodes.footnote_item.create({ num }, schema.text(text))
          const section = schema.nodes.footnote_section.create(null, item)
          tr.insert(doc.content.size, section)
        }
        dispatch(tr)
        v.focus()
        break
      }
      case 'bookmark': { const name = prompt(t('doc.prompt.bookmark')); if (name) v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.bookmark.create({ name }))); break }
      case 'comment': {
        const text = prompt(t('doc.prompt.comment'))
        if (text && !sel.empty) {
          const id = Date.now().toString()
          const node = schema.nodes.comment_mark.create({ id, author: 'User', text })
          v.dispatch(v.state.tr.insert(sel.to, node))
          v.focus()
          // 新建批注后自动打开对应批注卡片编辑框（对齐 MS Word 审阅窗格）
          try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
          setActiveComment(id)
          setEditingComment(id)
        }
        break
      }
      case 'insertTable': { const rows = parseInt(prompt(t('doc.prompt.rows'), '3') || '3'); const cols = parseInt(prompt(t('doc.prompt.cols'), '3') || '3'); if (rows > 0 && cols > 0) { const tr = []; for (let r = 0; r < rows; r++) { const cells = []; for (let c = 0; c < cols; c++) { const headerText = r === 0 ? `列${c+1}` : ''; const content = headerText ? schema.text(headerText) : null; cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, content))) } tr.push(schema.nodes.table_row.create(null, cells)) } v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tr))) } break }
      case 'dropCap': setParaAttr('dropCap', !activeAttrs.dropCap); break
      case 'toggleRTL': setParaAttr('rtl', !activeAttrs.rtl); break
    }
    v.focus(); setShowMiniColorPopup(false); setShowContextMenu(false)
  }

  // === 修订：收集所有 insert_track / delete_track 变更区间 ===
  const findChanges = (doc: any) => {
    const changes: { from: number; to: number; type: 'insert' | 'delete' }[] = []
    let cur: { from: number; to: number; type: 'insert' | 'delete' } | null = null
    doc.descendants((node: any, pos: number) => {
      if (!node.isText) return
      const ins = node.marks.find((m: any) => m.type.name === 'insert_track')
      const del = node.marks.find((m: any) => m.type.name === 'delete_track')
      const type = ins ? 'insert' : del ? 'delete' : null
      if (!type) { cur = null; return }
      const from = pos, to = pos + node.nodeSize
      if (cur && cur.type === type && cur.to === from) { cur.to = to }
      else { if (cur) changes.push(cur); cur = { from, to, type } }
    })
    if (cur) changes.push(cur)
    return changes
  }

  // 接受单条变更：插入→保留（去标记）；删除→真正删除文字
  const acceptChange = (change: { from: number; to: number; type: string }) => {
    const v = viewRef.current; if (!v) return
    const tr = v.state.tr
    if (change.type === 'insert') tr.removeMark(change.from, change.to, v.state.schema.marks.insert_track)
    else { tr.delete(change.from, change.to) }
    v.dispatch(tr); v.focus()
  }
  // 拒绝单条变更：插入→删除文字；删除→保留原字（去标记）
  const rejectChange = (change: { from: number; to: number; type: string }) => {
    const v = viewRef.current; if (!v) return
    const tr = v.state.tr
    if (change.type === 'insert') tr.delete(change.from, change.to)
    else tr.removeMark(change.from, change.to, v.state.schema.marks.delete_track)
    v.dispatch(tr); v.focus()
  }

  const acceptAll = () => {
    const v = viewRef.current; if (!v) return
    let tr = v.state.tr
    const changes = findChanges(v.state.doc)
    // 从后往前处理，避免位置偏移：删除类先删，插入类去标记
    changes.filter(c => c.type === 'delete').reverse().forEach(c => { tr = tr.delete(c.from, c.to) })
    changes.filter(c => c.type === 'insert').forEach(c => { tr = tr.removeMark(c.from, c.to, v.state.schema.marks.insert_track) })
    v.dispatch(tr); v.focus()
  }
  const rejectAll = () => {
    const v = viewRef.current; if (!v) return
    let tr = v.state.tr
    const changes = findChanges(v.state.doc)
    changes.filter(c => c.type === 'insert').reverse().forEach(c => { tr = tr.delete(c.from, c.to) })
    changes.filter(c => c.type === 'delete').forEach(c => { tr = tr.removeMark(c.from, c.to, v.state.schema.marks.delete_track) })
    v.dispatch(tr); v.focus()
  }

  // 跳转到上/下一条变更
  const gotoChange = (dir: 1 | -1) => {
    const v = viewRef.current; if (!v) return
    const changes = findChanges(v.state.doc)
    if (!changes.length) return
    const pos = v.state.selection.from
    let target: { from: number; to: number; type: string } | undefined
    if (dir === 1) target = changes.find(c => c.to > pos)
    else { for (let i = changes.length - 1; i >= 0; i--) { if (changes[i].from < pos) { target = changes[i]; break } } }
    if (!target) target = dir === 1 ? changes[0] : changes[changes.length - 1]
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, target.from, target.to)))
    v.focus()
  }
  // 对当前光标处的变更进行接受/拒绝
  const acceptCurrent = () => {
    const v = viewRef.current; if (!v) return
    const pos = v.state.selection.from
    const c = findChanges(v.state.doc).find(ch => ch.from <= pos && ch.to >= pos)
    if (c) acceptChange(c)
  }
  const rejectCurrent = () => {
    const v = viewRef.current; if (!v) return
    const pos = v.state.selection.from
    const c = findChanges(v.state.doc).find(ch => ch.from <= pos && ch.to >= pos)
    if (c) rejectChange(c)
  }

  const setParaAttr = (attr: string, value: any, focusAfter = true) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value })
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); if (focusAfter) v.focus() }
  }
  // 段落边框辅助：border 为空格分隔的方向集合（'all' 为四边别名）
  const borderHas = (b: string, side: string) => {
    const s = (b || '').split(/\s+/).filter(Boolean)
    return s.includes('all') || s.includes(side)
  }
  const toggleBorderSide = (side: string) => {
    const cur = activeAttrs.border || ''
    const sides = cur === 'all' ? ['top', 'right', 'bottom', 'left'] : cur.split(/\s+/).filter(Boolean)
    const idx = sides.indexOf(side)
    if (idx >= 0) sides.splice(idx, 1); else sides.push(side)
    setParaAttr('border', sides.length ? sides.join(' ') : '')
  }
  const toggleBorderAll = () => setParaAttr('border', borderHas(activeAttrs.border, 'all') ? '' : 'all')
  // 缩进增减（按字符单位 em，贴近 Word 的“增加/减少缩进量”）
  // 段前/段后间距快捷调节（pt）
  const changeSpace = (which: 'before' | 'after', delta: number) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const key = which === 'before' ? 'spaceBefore' : 'spaceAfter'
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        const cur = Number(node.attrs[key]) || 0
        const next = Math.max(0, Math.min(120, cur + delta))
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: next })
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); v.focus() }
  }
  // 打开"段落"对话框：读取当前段落/标题的格式属性作为初值
  const openParaDialog = () => {
    const v = viewRef.current; if (!v) return
    const { $from } = v.state.selection
    const a = $from.parent.attrs
    setParaDraft({
      indentLeft: Number(a.indentLeft) || 0,
      indentRight: Number(a.indentRight) || 0,
      special: a.firstLine ? 'firstLine' : (a.hanging ? 'hanging' : 'none'),
      specialBy: Number(a.firstLine) || Number(a.hanging) || 0,
      spaceBefore: Number(a.spaceBefore) || 0,
      spaceAfter: Number(a.spaceAfter) || 0,
      lineKind: a.lineSpacingKind || (a.lineHeight ? '' : 'single'),
      lineValue: a.lineSpacingValue || (a.lineHeight ? parseFloat(a.lineHeight) || 1 : 1),
      keepLines: !!a.keepLines, keepWithNext: !!a.keepWithNext, pageBreakBefore: !!a.pageBreakBefore,
      outlineLevel: Number(a.outlineLevel) || 0,
    })
    setShowParaDialog(true)
  }
  // 将对话框中的段落格式应用到选区覆盖的所有段落/标题
  const applyParagraphFormat = (d: any) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        const attrs = {
          ...node.attrs,
          indentLeft: Number(d.indentLeft) || 0,
          indentRight: Number(d.indentRight) || 0,
          firstLine: d.special === 'firstLine' ? (Number(d.specialBy) || 0) : 0,
          hanging: d.special === 'hanging' ? (Number(d.specialBy) || 0) : 0,
          spaceBefore: Number(d.spaceBefore) || 0,
          spaceAfter: Number(d.spaceAfter) || 0,
          lineSpacingKind: d.lineKind || '',
          lineSpacingValue: (d.lineKind === 'multiple' || d.lineKind === 'exact' || d.lineKind === 'atLeast') ? (Number(d.lineValue) || 1) : 0,
          keepLines: !!d.keepLines, keepWithNext: !!d.keepWithNext, pageBreakBefore: !!d.pageBreakBefore,
          outlineLevel: Number(d.outlineLevel) || 0,
        }
        tr.setNodeMarkup(pos, undefined, attrs)
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); v.focus() }
  }
  // Align the entire table that contains the cursor
  const alignTable = (v: EditorView, align: 'left' | 'center' | 'right') => {
    const { $from } = v.state.selection
    let tablePos = -1, tableNode: any = null
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'table') { tablePos = $from.before(d); tableNode = node; break }
    }
    if (tableNode) {
      // Wrap table in a paragraph with align, or set margin auto for center
      const tr = v.state.tr
      // Set table alignment via attribute on the table node
      v.dispatch(tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, align }))
      v.focus()
    }
  }
  const setFont = (font: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const m = schema.marks.fontFamily
    if (!font) {
      // 清除字体
      if (empty) {
        const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
        dispatch(state.tr.setStoredMarks(stored.filter(mk => mk.type !== m)))
      } else {
        dispatch(state.tr.removeMark(from, to, m))
      }
      v.focus(); return
    }
    // 关键：始终设置为目标字体（先移除旧 fontFamily 再添加新），不能用 toggleMark——
    // 否则选区已有任意字体时 toggleMark 会误判为"已存在"而移除，导致第一次点击跳回默认、需点两次。
    const mark = m.create({ font })
    if (empty) {
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      dispatch(state.tr.setStoredMarks([...stored.filter(mk => mk.type !== m), mark]))
    } else {
      dispatch(state.tr.removeMark(from, to, m).addMark(from, to, mark))
    }
    v.focus()
  }
  const setFontSize = (size: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const mark = schema.marks.fontSize.create({ size })
    if (empty) {
      // 无选区：存入 storedMarks，待下次输入生效（不在每次按键时抢占焦点）
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      const filtered = stored.filter(m => m.type !== schema.marks.fontSize)
      dispatch(state.tr.setStoredMarks([...filtered, mark]))
    } else {
      // 有选区：移除旧 fontSize 后再添加，避免使用 toggleMark 误删/不生效
      dispatch(state.tr.removeMark(from, to, schema.marks.fontSize).addMark(from, to, mark))
    }
    // 注意：输入过程中不调用 v.focus()，否则焦点会被抢回编辑器，
    // 导致后续输入的数字被当作正文内容写入（艺术字内容变成输入数值的现象）。
  }
  // 字号加减：直接读取编辑器当前选区/光标处的真实有效字号作为基准（不依赖可能滞后的 activeFontSize 状态）
  const bumpFontSize = (delta: number) => {
    const v = viewRef.current; if (!v) return
    const { state } = v
    const { empty, from, $from } = state.selection
    let cur = NaN
    const readSize = (s: string) => {
      const num = parseFloat(s)
      if (isNaN(num)) return NaN
      // 兼容旧文档可能残留的 pt 单位：pt 需换算成 px 再作基准
      return s.includes('pt') ? num * 96 / 72 : num
    }
    if (empty) {
      const ms = state.storedMarks ? state.storedMarks : $from.marks()
      const fm = ms.find(m => m.type.name === 'fontSize')
      if (fm) cur = readSize(fm.attrs.size)
    } else {
      const fm = state.doc.nodeAt(from)?.marks.find(m => m.type.name === 'fontSize')
      if (fm) cur = readSize(fm.attrs.size)
    }
    const base = isNaN(cur) ? 15 : cur
    const next = Math.max(1, Math.round(base + delta))
    setFontSize(`${next}px`)
    v.focus()
  }
  // 字符间距（字间距）：与字号一样是字符级标记，作用于选区/后续输入
  const setCharSpacing = (val: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const trimmed = (val || '').trim()
    if (!trimmed) { // 清空字间距
      if (!empty) dispatch(state.tr.removeMark(from, to, schema.marks.charSpacing))
      return
    }
    // 仅数字视为 px，否则按原 CSS 值（如 0.5pt / 2px）处理
    const value = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed
    const mark = schema.marks.charSpacing.create({ value })
    if (empty) {
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      const filtered = stored.filter(m => m.type !== schema.marks.charSpacing)
      dispatch(state.tr.setStoredMarks([...filtered, mark]))
    } else {
      dispatch(state.tr.removeMark(from, to, schema.marks.charSpacing).addMark(from, to, mark))
    }
  }
  const setTextColor = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.textColor, { color })(v.state, v.dispatch); v.focus() }
  // 「自动」= 移除字体颜色标记（对齐 MS Word 字体颜色面板的自动项）
  const clearTextColor = () => {
    const v = viewRef.current; if (!v) return
    const { from, to } = v.state.selection
    const tr = v.state.tr.removeMark(from, to, schema.marks.textColor)
    v.dispatch(tr); v.focus()
  }
  const setHighlight = (color: string) => {
    const v = viewRef.current; if (!v) return
    const { from, to } = v.state.selection
    if (!color) { v.dispatch(v.state.tr.removeMark(from, to, schema.marks.highlight)); v.focus(); return }
    toggleMark(schema.marks.highlight, { color })(v.state, v.dispatch); v.focus()
  }
  const handleSearch = () => { const v = viewRef.current; if (!v || !searchQuery) return; doSearch(v, searchQuery, false) }
  const handleReplace = () => { const v = viewRef.current; if (!v) return; doReplace(v, searchQuery, replaceQuery, false) }
  const handleReplaceAll = () => {
    const v = viewRef.current
    if (!v) return
    const count = doReplaceAll(v, searchQuery, replaceQuery, false)
    if (count > 0) onToast?.(t('doc.replacedCount', { count }))
  }
  const handlePrint = () => { setPrintPreview(false); setTimeout(() => window.print(), 100) }
  const insertFormula = () => {
    // 打开独立公式编辑器弹窗（若有选中 math 节点则预填用于编辑）
    const v = viewRef.current
    let init = { latex: '', inline: false, pos: null as number | null }
    if (v) {
      const sel = v.state.selection
      const node = sel instanceof NodeSelection ? sel.node : null
      if (node && node.type.name === 'math') {
        init = { latex: node.attrs.latex || '', inline: !!node.attrs.inline, pos: sel.from }
      }
    }
    setMathEdit(init)
    setShowMathModal(true)
  }
  const insertSymbol = (sym: string) => {
    const v = viewRef.current; if (!v) return
    v.dispatch(v.state.tr.replaceSelectionWith(schema.text(sym)))
    v.focus()
  }
  // 更新选中 text_box 节点的样式属性（边框宽度/线型/颜色/填充/圆角/形状）
  const updateTextBox = (attrs: Record<string, any>) => {
    const v = viewRef.current; if (!v) return
    const cur = activeTextBox
    if (!cur) return
    const old = cur.node
    const newNode = schema.nodes.text_box.create({ ...old.attrs, ...attrs }, old.content)
    const tr = v.state.tr.replaceWith(cur.pos, cur.pos + old.nodeSize, newNode)
    v.dispatch(tr)
    v.focus()
    // 同步浮动面板状态
    setActiveTextBox({ node: newNode, pos: cur.pos })
  }
  // 右键菜单"编辑样式"：选中被右键的文本框/形状（NodeSelection），使浮动样式面板弹出
  const editTextBoxStyle = () => {
    const v = viewRef.current
    const box = contextMenuBoxRef.current
    setShowContextMenu(false)
    if (!v || !box) return
    // 用文本框中心坐标定位其内部 pos，再向上回溯到 text_box 节点的起始位置
    const rect = box.getBoundingClientRect()
    const at = v.posAtCoords({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 })
    if (!at) return
    const $pos = v.state.doc.resolve(at.pos)
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'text_box') {
        const pos = $pos.before(d)
        v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)))
        v.focus()
        return
      }
    }
  }
  // 公式弹窗插入/更新
  const handleMathInsert = (latex: string, inline: boolean) => {
    const v = viewRef.current; if (!v) { setShowMathModal(false); return }
    const mathNode = schema.nodes.math.create({ latex, inline })
    const tr = v.state.tr
    if (mathEdit.pos != null) {
      // 编辑已有公式：替换原节点
      const old = v.state.doc.nodeAt(mathEdit.pos)
      if (old) tr.replaceWith(mathEdit.pos, mathEdit.pos + old.nodeSize, mathNode)
    } else {
      tr.replaceSelectionWith(mathNode)
    }
    v.dispatch(tr)
    v.focus()
    setShowMathModal(false)
  }

  // 从文件 base64 中提取纯文本（txt/md/json 直接解码；docx 提取 <w:t> 文本）
  const extractFileText = (b64: string, fileName: string): string => {
    try {
      const bin = atob(b64)
      if (/\.docx$/i.test(fileName)) {
        const texts = [...bin.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((m) => m[1]).join(' ')
        return texts || bin
      }
      // 尝试 UTF-8 解码（处理多字节）
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff
      const dec = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      return dec || bin
    } catch {
      return atob(b64)
    }
  }

  // 收集文档所有顶级块（段落/标题/列表项等）的纯文本，用于差异对比
  const collectParagraphTexts = (v: EditorView | null): string[] => {
    const out: string[] = []
    if (!v) return out
    v.state.doc.descendants((node) => {
      if (node.isBlock && node.isTextblock) {
        const txt = node.textContent.trim()
        if (txt) out.push(txt)
        return false
      }
      return true
    })
    return out
  }

  // 计算差异集合：rightAdds（右侧有、左侧无）、leftDels（左侧有、右侧无）
  const computeDiffSets = (left: string[], right: string[]) => {
    const add = new Set<string>()
    const del = new Set<string>()
    const lset = new Set(left)
    const rset = new Set(right)
    right.forEach((t) => { if (!lset.has(t)) add.add(t) })
    left.forEach((t) => { if (!rset.has(t)) del.add(t) })
    return { add, del }
  }

  // 差异高亮插件：根据传入的段落文本集合，对匹配的文本块添加背景装饰
  const diffDecorationPlugin = (setRef: React.MutableRefObject<Set<string>>) => {
    return new Plugin({
      props: {
        decorations: (state: any) => {
          const set = setRef.current
          if (set.size === 0) return DecorationSet.empty
          const decos: any[] = []
          state.doc.descendants((node: any, pos: number) => {
            if (node.isBlock && node.isTextblock) {
              const txt = node.textContent.trim()
              if (txt && set.has(txt)) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: set === diffAddRef.current ? 'diff-add' : 'diff-del' }))
              }
              return false
            }
            return true
          })
          return DecorationSet.create(state.doc, decos)
        },
      },
    })
  }

  // 触发两侧视图重新计算差异装饰
  const refreshDiffDecorations = () => {
    const lv = viewRef.current, rv = compareViewRef.current
    if (lv) lv.dispatch(lv.state.tr.setMeta('diffUpdate', true).setMeta('addToHistory', false))
    if (rv) rv.dispatch(rv.state.tr.setMeta('diffUpdate', true).setMeta('addToHistory', false))
  }

  const runCompare = async () => {
    try {
      const path = await backend?.openFileDialog?.()
      if (!path) return
      // 复用后端解析能力，得到完整 UDM 文档（保留富文本结构）
      const result: any = backend?.openFile ? await backend.openFile(path) : null
      const doc: Document | undefined = result?.document
      if (!doc) { alert(t('doc.compareError') + ': ' + (t('doc.compareUnsupported') || 'unsupported file')); return }
      setCompareTarget({ name: path.split(/[\\/]/).pop() || path, doc })
    } catch (e: any) {
      alert(t('doc.compareError') + ': ' + (e?.message || e))
    }
  }

  // 同步滚动：按滚动百分比同步两侧
  const syncScroll = (from: 'left' | 'right') => {
    if (syncLockRef.current) return
    const left = leftScrollRef.current
    const right = compareRef.current
    if (!left || !right) return
    syncLockRef.current = true
    if (from === 'left') {
      const ratio = left.scrollTop / Math.max(1, left.scrollHeight - left.clientHeight)
      right.scrollTop = ratio * Math.max(0, right.scrollHeight - right.clientHeight)
    } else {
      const ratio = right.scrollTop / Math.max(1, right.scrollHeight - right.clientHeight)
      left.scrollTop = ratio * Math.max(0, left.scrollHeight - left.clientHeight)
    }
    requestAnimationFrame(() => { syncLockRef.current = false })
  }

  const toggleProtect = () => {
    const v = viewRef.current; if (!v) return
    if (!protectedMode) {
      // 设置保护：输入密码，将哈希写入 document.protect 并持久化
      const pwd = prompt(t('doc.protectSetPwd'))
      if (!pwd) return
      const hash = hashPwd(pwd)
      // 用 ref 取最新文档，避免闭包捕获到旧 props 而把刚编辑的正文回退
      const base: any = documentRef.current ?? document
      const updated: any = { ...base, protect: { enabled: true, hash } }
      // 立刻同步 ref：React 重渲染是异步的，期间若有事务 emit，
      // 读到旧 ref 就会把刚设置的保护冲掉。
      documentRef.current = updated
      lastEmittedRef.current = updated
      onChange?.(updated)
      unlockHashRef.current = hash
      setProtectedMode(true)
      v.setProps({ editable: () => false })
    } else {
      // 取消保护：需要先验证密码
      const pwd = prompt(t('doc.protectEnterPwd'))
      if (pwd == null) return
      if (hashPwd(pwd) === (document.protect?.hash ?? '')) {
        const base: any = documentRef.current ?? document
        const updated: any = { ...base, protect: { enabled: false, hash: document.protect?.hash ?? '' } }
        documentRef.current = updated
        lastEmittedRef.current = updated
        onChange?.(updated)
        unlockHashRef.current = ''
        setProtectedMode(false)
        setShowUnlock(false)
        v.setProps({ editable: () => true })
      } else {
        alert(t('doc.protectWrongPwd'))
      }
    }
  }

  // 打开受保护文档时，若尚未解锁则进入只读并弹出密码框
  useEffect(() => {
    if (document.protect?.enabled) {
      if (unlockHashRef.current !== document.protect.hash) {
        setProtectedMode(true)
        setShowUnlock(true)
        const v = viewRef.current
        if (v) v.setProps({ editable: () => false })
      }
    }
  }, [document])

  // 提交解锁密码
  const submitUnlock = () => {
    const v = viewRef.current; if (!v) return
    if (hashPwd(unlockInput) === (document.protect?.hash ?? '')) {
      unlockHashRef.current = document.protect!.hash
      setProtectedMode(false)
      setShowUnlock(false)
      setUnlockInput('')
      setUnlockError(false)
      v.setProps({ editable: () => true })
    } else {
      setUnlockError(true)
    }
  }
  const insertWordArt = () => { const text = prompt(t('doc.prompt.wordArt')); if (text) { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '36px' }), schema.marks.textColor.create({ color: '#4f46e5' })])))); v.focus() } }
  const applyWatermark = () => { const wm = prompt(t('doc.prompt.watermark'), watermark); if (wm !== null) setWatermark(wm) }
  const insertImage = () => {
    // 注意：组件作用域内 document 是 UDM Document prop，DOM 对象须用 window.document
    const input = window.document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return
      const r = new FileReader()
      r.onload = () => {
        const v = viewRef.current
        if (!v) return
        const src = r.result as string
        // 先解码以拿到图片自然尺寸，给节点写入确定的 width/height，
        // 这样分页引擎从首帧就能测到稳定高度，避免 load 后重分页抖动/循环。
        const probe = new Image()
        probe.onload = () => {
          const W = probe.naturalWidth || 300
          const H = probe.naturalHeight || 200
          // 默认宽度限制在页面内容区合理范围内（与默认 300 一致，最大不超过内容宽）
          const maxW = Math.min(300, Math.max(80, Math.round(pageContentPerPage - docMargins.left - docMargins.right) - 24))
          const width = Math.min(W, maxW)
          const height = Math.round((width * H) / W)
          if (v.state.doc) {
            v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.image.create({ src, width, height, float: '', wrap: true })))
            v.focus()
          }
        }
        probe.onerror = () => {
          // 解码失败也至少给出默认尺寸，避免高度为 0
          if (v.state.doc) {
            v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.image.create({ src, width: 300, height: 200, float: '', wrap: true })))
            v.focus()
          }
        }
        probe.src = src
      }
      r.readAsDataURL(f)
    }
    input.click()
  }
  const insertLink = () => { const url = prompt('URL:'); if (url) { const v = viewRef.current; if (!v) return; const sel = v.state.selection; if (!sel.empty) v.dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.link.create({ href: url }))) } }

  // 拼写装饰同步：仅当错误【内容】真正变化时才 dispatch —— 引用相同或内容一致时
  // 直接跳过（v.updateState(v.state) + setTick 会整体重渲染，旧版每次 fetch 回包都执行，
  // 是 spell 事务高频重建装饰/NodeView 的放大器）。
  const lastSpellSigRef = useRef('')
  useEffect(() => {
    if (!viewRef.current) return
    const sig = spellErrors.map(e => e.word).join('\u0001') + '#' + spellErrors.length
    if (sig === lastSpellSigRef.current) return
    lastSpellSigRef.current = sig
    const v = viewRef.current
    v.dispatch(setSpellErrors(v.state.tr, spellErrors))
  }, [spellErrors])

  // 键盘缩放: Ctrl+= 放大, Ctrl+- 缩小, Ctrl+0 重置 (仅当焦点不在输入框时, 或允许组合键)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(zoom + 10) }
      else if (e.key === '-') { e.preventDefault(); setZoom(zoom - 10) }
      else if (e.key === '0') { e.preventDefault(); setZoom(100) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // Ctrl+Z / Ctrl+Y / Ctrl+B / Ctrl+I / Ctrl+U 窗口级兜底（对齐 MS Word：
  // 焦点不在正文时（如刚点过 Ribbon 按钮、页眉提示框关闭后）也能撤销/重做/加粗）。
  // 焦点在 ProseMirror 内时由编辑器 keymap 处理（此处 hasFocus 直接放行，避免重复执行）；
  // 焦点在输入框/文本域时交给原生控件，不拦截。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = (e.key || '').toLowerCase()
      if (k !== 'z' && k !== 'y' && k !== 'b' && k !== 'i' && k !== 'u') return
      const v = viewRef.current
      if (!v) return
      if (v.hasFocus()) return // 编辑器自己会处理
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (k === 'z' && !e.shiftKey) { undo(v.state, v.dispatch); v.focus() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { redo(v.state, v.dispatch); v.focus() }
      else if (k === 'b') { toggleMark(schema.marks.bold)(v.state, v.dispatch, v) }
      else if (k === 'i') { toggleMark(schema.marks.italic)(v.state, v.dispatch, v) }
      else if (k === 'u') { toggleMark(schema.marks.underline)(v.state, v.dispatch, v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape 关闭所有弹出层（右键菜单、mini工具栏、形状/艺术字/颜色/底纹/背景面板）
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showContextMenu) { setShowContextMenu(false); e.preventDefault() }
      else if (showMiniColorPopup) { setShowMiniColorPopup(false); e.preventDefault() }
      else if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
      else if (searchOpen) { setSearchOpen(false); e.preventDefault() }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showContextMenu, showMiniColorPopup, anyPanelOpen, searchOpen])

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('doc.ribbon.home') }, { id: 'insert', label: t('doc.ribbon.insert') }, { id: 'layout', label: t('doc.ribbon.layout') }, { id: 'review', label: t('doc.ribbon.review') }, { id: 'view', label: t('doc.ribbon.view') },
  ]

  return (
    <div className="flex flex-col h-full" style={{ position: 'relative' }}>
      {searchOpen && (
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap animate-fade-in" style={{ background: 'var(--color-bg-alt)', borderBottom: '1px solid var(--color-border)' }}>
          <input type="text" placeholder={t('doc.findPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="text-sm" style={{ width: 160 }} />
          <button onClick={handleSearch} className="btn btn-outline btn-sm">{t('doc.find')}</button>
          <button onClick={prevMatch} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↑</button>
          <button onClick={nextMatch} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↓</button>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{matchCount > 0 ? `${activeMatch + 1}/${matchCount}` : t('doc.noMatch')}</span>
          <div className="toolbar-divider" />
          <input type="text" placeholder={t('doc.replacePlaceholder')} value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} className="text-sm" style={{ width: 160 }} />
          <button onClick={handleReplace} className="btn btn-outline btn-sm" disabled={matchCount === 0}>{t('doc.replace')}</button>
          <button onClick={handleReplaceAll} className="btn btn-primary btn-sm" disabled={matchCount === 0}>{t('doc.replaceAll')}</button>
          <div className="flex-1" />
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); doSearch(viewRef.current!, '', false) }} className="btn btn-ghost btn-sm">✕</button>
        </div>
      )}

      {/* Ribbon Tab 栏 — 可横向滚动，右侧操作按钮固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45, '--wails-draggable': 'drag' as any } as any}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(tab => (
            <button key={tab.id} onClick={() => { closeAllPanels(); setRibbonTab(tab.id) }} data-testid={`ribbon-tab-${tab.id}`} className="ribbon-tab-btn px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === tab.id ? 'var(--color-primary-50)' : 'transparent' }}>{tab.label}</button>
          ))}
        </div>
        <button onClick={() => setSearchOpen(!searchOpen)} data-testid="doc-search-toggle" className="toolbar-btn flex-shrink-0" title={t('doc.find') + ' (Ctrl+F)'} type="button">🔍</button>
        <button onClick={() => setTrackChanges(!trackChanges)} className={`toolbar-btn flex-shrink-0 ${trackChanges ? 'active' : ''}`} title={t('doc.trackChanges')} type="button">✏️</button>
        {/* Ribbon 整体折叠/展开（对齐 MS Office） */}
        <button onClick={() => setRibbonCollapsedPersist(!ribbonCollapsed)} data-testid="ribbon-collapse" type="button"
          className="toolbar-btn flex-shrink-0"
          title={ribbonCollapsed ? (t('ribbon.expand') || '展开功能区') : (t('ribbon.collapse') || '折叠功能区')}>{ribbonCollapsed ? '⌄' : '⌃'}</button>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单（fixed inset-0 会拦截 header 点击） */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区（整体折叠时不渲染，仅保留选项卡栏） */}
      {!ribbonCollapsed && (
      <div
        className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '72px', position: 'relative', zIndex: 45, '--wails-draggable': 'drag' as any } as any}
        // 点击功能区按钮时不要抢走编辑器的焦点，否则选中的文本选区会被清空，
        // 导致无法对同一段选中文本连续执行多次操作（加粗后再改字号/颜色等）。
        onMouseDown={(e) => { const el = e.target as HTMLElement; if (el.closest('button')) e.preventDefault() }}
      >
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('doc.clipboard')}>
            <RibbonButton icon="↶" label={t('doc.undo')} onClick={() => exec('undo')} title="Ctrl+Z" />
            <RibbonButton icon="↷" label={t('doc.redo')} onClick={() => exec('redo')} title="Ctrl+Y" />
            <RibbonButton icon="🖌" label={t('doc.formatPainter')} onClick={handlePainterClick} onDoubleClick={handlePainterDouble} active={!!formatPainter} title={t('doc.formatPainter') + (formatPainter?.lock ? '（锁定：连续刷，再次双击或 Esc 退出）' : '（单击开启/关闭，双击锁定连续刷）')} />
            <RibbonButton icon="⌫" label={t('doc.clearFormat')} onClick={() => exec('clearFormat')} title={t('doc.clearFormat')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.font')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Dropdown
                className="text-xs rounded-md px-2 ribbon-input"
                style={{ width: 110, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={activeFont}
                onChange={v => setFont(v)}
                options={(() => {
                  const opts = FONTS.map(f => ({ label: f.name, value: f.value, fontFamily: (f as any).fontFamily }))
                  // 文档里实际使用的字体（可能不在预置列表，如解析进来的中文/旧格式值）也要能选中显示
                  if (activeFont && !opts.some(o => o.value === activeFont)) {
                    opts.push({ label: activeFont, value: activeFont, fontFamily: activeFont })
                  }
                  return opts
                })()}
              />
                <button onClick={() => bumpFontSize(-1)} className="toolbar-btn" title={t('doc.fontSize') + ' -'} type="button" style={{ width: 24, height: 26, fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>-</button>
                <button onClick={() => bumpFontSize(1)} className="toolbar-btn" title={t('doc.fontSize') + ' +'} type="button" style={{ width: 24, height: 26, fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>+</button>
                <Dropdown
                  className="text-xs rounded-md px-2 ribbon-input"
                  style={{ width: 76, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  inputMode="numeric"
                  inputValue={activeFontSize.replace(/px$/, '')}
                  placeholder={t('doc.size.body').replace('px', '')}
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setFontSize(''); return }
                    // 支持中文字号名（初号/小四…）或纯数字（视为 px）
                    const resolved = resolveFontSizeInput(v)
                    if (resolved) { setFontSize(resolved); return }
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeFontSize}
                  onChange={(v) => setFontSize(v)}
                  options={FONT_SIZES.map(s => ({ label: s.name, value: s.value }))}
                  title={t('doc.fontSize')}
                />
                {/* 字间距：与字号一样支持输入数字（数值视为 px），作用于选区/后续输入 */}
                <Dropdown
                  className="text-xs rounded-md px-2 ribbon-input"
                  style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  inputMode="numeric"
                  inputValue={activeCharSpacing.replace(/px$/, '')}
                  placeholder="0"
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setCharSpacing(''); return }
                    const num = parseFloat(v)
                    if (!isNaN(num)) setCharSpacing(`${num}px`)
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeCharSpacing}
                  onChange={(v) => setCharSpacing(v)}
                  options={['0px', '0.5px', '1px', '1.5px', '2px', '3px', '-1px', '-0.5px'].map(s => ({ label: s, value: s }))}
                  title={t('doc.charSpacing')}
                  testId="charSpacing"
                />
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => exec('bold')} className={`toolbar-btn ${activeMarks.has('bold') ? 'active' : ''}`} title={t('doc.bold') + ' Ctrl+B'} type="button" style={{ width: 28, height: 26 }}><b>B</b></button>
                <button onClick={() => exec('italic')} className={`toolbar-btn ${activeMarks.has('italic') ? 'active' : ''}`} title={t('doc.italic') + ' Ctrl+I'} type="button" style={{ width: 28, height: 26 }}><i>I</i></button>
                <button onClick={() => exec('underline')} className={`toolbar-btn ${activeMarks.has('underline') ? 'active' : ''}`} title={t('doc.underline') + ' Ctrl+U'} type="button" style={{ width: 28, height: 26 }}><u>U</u></button>
                <button onClick={() => exec('strikethrough')} className={`toolbar-btn ${activeMarks.has('strikethrough') ? 'active' : ''}`} title={t('doc.strikethrough')} type="button" style={{ width: 28, height: 26 }}><s>S</s></button>
                <button onClick={() => exec('superscript')} className={`toolbar-btn ${activeMarks.has('superscript') ? 'active' : ''}`} title={t('doc.superscript')} type="button" style={{ width: 28, height: 26 }}><IconSuperscript /></button>
                <button onClick={() => exec('subscript')} className={`toolbar-btn ${activeMarks.has('subscript') ? 'active' : ''}`} title={t('doc.subscript')} type="button" style={{ width: 28, height: 26 }}><IconSubscript /></button>
                {/* 字体颜色：A 图标 + 当前色色条，面板含自动/其他颜色（对齐 MS Word） */}
                <div className="relative">
                  <button className="toolbar-btn" title={t('doc.textColor')} type="button" style={{ width: 28, height: 26 }} onClick={() => openPanel('color')}>
                    <IconFontColor color={activeColor || '#111111'} />
                  </button>
                  {showColorPopup && (
                    <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                      <ColorGrid colors={COLORS} onPick={c => { setTextColor(c); closeAllPanels() }} onClear={clearTextColor} clearLabel={t('doc.autoColor')} customLabel={t('doc.customColor')} />
                    </div>
                  )}
                </div>
                {/* 突出显示（高亮）：荧光笔图标 + 色条 */}
                <div className="relative">
                  <button className="toolbar-btn" title={t('doc.highlight')} type="button" style={{ width: 28, height: 26 }} onClick={() => openPanel('highlight')}>
                    <IconHighlight />
                  </button>
                  {showHighlightPopup && (
                    <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                      <ColorGrid colors={HL_COLORS} onPick={c => { setHighlight(c); closeAllPanels() }} onClear={() => { setHighlight(''); closeAllPanels() }} clearLabel={t('doc.noColor')} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.paragraph')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-0.5">
                <RibbonButton icon="¶" label={t('doc.body')} onClick={() => exec('paragraph')} active={activeMarks.size === 0 || (activeMarks.size === 1 && !Array.from(activeMarks).some(m => m.startsWith('heading')))} />
                <RibbonButton icon="H1" label={t('doc.heading1')} onClick={() => exec('h1')} active={activeMarks.has('heading-1')} />
                <RibbonButton icon="H2" label={t('doc.heading2')} onClick={() => exec('h2')} active={activeMarks.has('heading-2')} />
                <RibbonButton icon="H3" label={t('doc.heading3')} onClick={() => exec('h3')} active={activeMarks.has('heading-3')} />
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setParaAttr('align', 'left')} className={`toolbar-btn ${activeAttrs.align === 'left' ? 'active' : ''}`} title={t('doc.alignLeft')} type="button" style={{ width: 28, height: 26 }}><IconAlignLeft /></button>
                <button onClick={() => setParaAttr('align', 'center')} className={`toolbar-btn ${activeAttrs.align === 'center' ? 'active' : ''}`} title={t('doc.alignCenter')} type="button" style={{ width: 28, height: 26 }}><IconAlignCenter /></button>
                <button onClick={() => setParaAttr('align', 'right')} className={`toolbar-btn ${activeAttrs.align === 'right' ? 'active' : ''}`} title={t('doc.alignRight')} type="button" style={{ width: 28, height: 26 }}><IconAlignRight /></button>
                <button onClick={() => setParaAttr('align', 'justify')} className={`toolbar-btn ${activeAttrs.align === 'justify' ? 'active' : ''}`} title={t('doc.alignJustify')} type="button" style={{ width: 28, height: 26 }}><IconAlignJustify /></button>
                <div className="toolbar-divider" />
                <button onClick={() => exec('bulletList')} className="toolbar-btn" title={t('doc.bulletList')} type="button" style={{ width: 28, height: 26 }}><IconBulletList /></button>
                <button onClick={() => exec('orderedList')} className="toolbar-btn" title={t('doc.orderedList')} type="button" style={{ width: 28, height: 26 }}><IconNumberList /></button>
                <button onClick={() => setParaAttr('indent', Math.min(8, (activeAttrs.indent || 0) + 1))} className="toolbar-btn" title={t('doc.indentMore')} type="button" style={{ width: 28, height: 26 }}><IconIndentInc /></button>
                <button onClick={() => setParaAttr('indent', Math.max(0, (activeAttrs.indent || 0) - 1))} className="toolbar-btn" title={t('doc.indentLess')} type="button" style={{ width: 28, height: 26 }}><IconIndentDec /></button>
              </div>
              <div className="flex items-center gap-1">
                <RibbonButton icon="⚙" label={t('doc.paraDialog')} onClick={openParaDialog} title={t('doc.paraDialog')} active={showParaDialog} />
                <Dropdown
                  className="text-xs rounded-md px-2 py-1 ribbon-input"
                  style={{ width: 92, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  inputValue={activeAttrs.lineHeight || ''}
                  title={t('doc.lineSpacing')}
                  placeholder="1.5"
                  inputMode="text"
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setParaAttr('lineHeight', ''); return }
                    // 带单位（pt/px）：固定值行距，如 28pt
                    if (/^\d+(?:\.\d+)?\s*(pt|px)$/i.test(v)) {
                      setParaAttr('lineHeight', v.replace(/\s+/g, '').toLowerCase())
                      return
                    }
                    // 纯数字：倍数行距，如 1.5、2
                    const num = parseFloat(v)
                    if (!isNaN(num) && num > 0) setParaAttr('lineHeight', String(num))
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeAttrs.lineHeight || ''}
                  onChange={v => setParaAttr('lineHeight', v)}
                  options={[{ label: t('doc.lineSpacing'), value: '' }, ...LINE_HEIGHTS.map(l => ({ label: l.name, value: l.value }))]}
                />
                <Dropdown
                  className="text-xs rounded-md px-2 py-1 ribbon-input"
                  style={{ width: 92, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  testId="paraLetterSpacing"
                  inputMode="numeric"
                  inputValue={activeAttrs.letterSpacing ? activeAttrs.letterSpacing.replace(/px$/, '') : ''}
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setParaAttr('letterSpacing', '', false); return }
                    const num = parseFloat(v)
                    if (!isNaN(num)) setParaAttr('letterSpacing', `${num}px`, false)
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeAttrs.letterSpacing || ''}
                  onChange={v => setParaAttr('letterSpacing', v)}
                  options={[
                    { label: t('doc.charSpacing'), value: '' },
                    { label: t('doc.spacing.loose'), value: '0.5px' },
                    { label: t('doc.spacing.looser'), value: '1px' },
                    { label: t('doc.spacing.tight'), value: '-0.5px' },
                  ]}
                />
                <button onClick={() => changeSpace('before', 6)} className="toolbar-btn" title={t('doc.spaceBefore')} type="button" style={{ width: 28, height: 26 }}><IconSpaceBefore /></button>
                <button onClick={() => changeSpace('after', 6)} className="toolbar-btn" title={t('doc.spaceAfter')} type="button" style={{ width: 28, height: 26 }}><IconSpaceAfter /></button>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.styles')}>
            <RibbonButton icon="🎨" label={t('doc.styleGallery')} onClick={() => setShowStyles(true)} title={t('doc.styleGallery')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('doc.table')}><RibbonButton icon="📊" label={t('doc.table')} onClick={() => exec('insertTable')} /></RibbonGroup>
          <RibbonGroup label={t('doc.image')}>
            <RibbonButton icon="🖼" label={t('doc.image')} onClick={insertImage} />
            {/* 文字环绕（对齐 MS Word 六种：嵌入型/四周型左右/上下型/衬于文字下方/浮于文字上方） */}
            <Dropdown
              className="ribbon-input"
              style={{ width: 128, height: 26 }}
              value={(() => {
                // 当前选中图片的环绕方式（未选中图片时显示默认嵌入型）
                const sel = viewRef.current?.state.selection
                const n = sel instanceof NodeSelection ? sel.node : null
                if (!n || n.type.name !== 'image') return 'inline'
                return n.attrs.wrapMode || (n.attrs.float === 'left' ? 'left' : n.attrs.float === 'right' ? 'right' : 'inline')
              })()}
              onChange={(v2: string) => exec('imgWrapMode:' + v2)}
              options={[
                { label: t('doc.wrapInline') || '嵌入型', value: 'inline' },
                { label: t('doc.wrapSquareLeft') || '四周型-左环绕', value: 'left' },
                { label: t('doc.wrapSquareRight') || '四周型-右环绕', value: 'right' },
                { label: t('doc.wrapTopBottom') || '上下型环绕', value: 'topBottom' },
                { label: t('doc.wrapBehind') || '衬于文字下方', value: 'behind' },
                { label: t('doc.wrapFront') || '浮于文字上方', value: 'front' },
              ]}
            />
            <RibbonButton icon="—" label={t('doc.horizontalRule')} onClick={() => exec('horizontalRule')} />
            <RibbonButton icon="⏎" label={t('doc.pageBreak')} onClick={() => exec('pageBreak')} />
            <RibbonButton icon="🔄" label={t('doc.pageBreakRestart')} onClick={() => exec('pageBreakRestart')} title={t('doc.pageBreakRestartTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('doc.shapes')} onClick={() => openPanel('shape')} />
              {showShapePanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{t:'rect',i:'▭',n:t('doc.shape.rect')},{t:'roundRect',i:'▢',n:t('doc.shape.rounded')},{t:'ellipse',i:'⬭',n:t('doc.shape.ellipse')},{t:'triangle',i:'△',n:t('doc.shape.triangle')},
                     {t:'diamond',i:'◇',n:t('doc.shape.diamond')},{t:'rightArrow',i:'→',n:t('doc.shape.arrow')},{t:'star5',i:'★',n:t('doc.shape.star')},{t:'heart',i:'♥',n:t('doc.shape.heart')}].map(s => (
                      <button key={s.t} onClick={() => { exec('shape:' + s.t); setShowShapePanel(false) }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
                        <span style={{ fontSize: '20px' }}>{s.i}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{s.n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.wordArt')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('doc.wordArt')} onClick={() => openPanel('art')} />
              {showArtPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { name: t('art.shadow') || '阴影', style: 'shadow', color: '#4f46e5', preview: 'text-shadow: 2px 2px 4px rgba(0,0,0,0.4)' },
                      { name: t('art.gradient') || '渐变', style: 'gradient', color: '#667eea', preview: 'background: linear-gradient(135deg,#667eea,#764ba2); -webkit-background-clip:text; -webkit-text-fill-color:transparent' },
                      { name: t('art.glow') || '发光', style: 'glow', color: '#10b981', preview: 'text-shadow: 0 0 10px rgba(16,185,129,0.6)' },
                      { name: t('art.outline') || '描边', style: 'outline', color: '#3b82f6', preview: '-webkit-text-stroke: 1px #3b82f6; -webkit-text-fill-color:transparent' },
                      { name: t('art.3d') || '3D', style: '3d', color: '#f59e0b', preview: 'text-shadow: 1px 1px 0 #ccc, 2px 2px 0 #bbb, 3px 3px 6px rgba(0,0,0,0.3)' },
                      { name: t('art.red') || '红字', style: 'shadow', color: '#ef4444', preview: 'color:#ef4444; text-shadow:2px 2px 4px rgba(0,0,0,0.3)' },
                    ].map(p => (
                      <button key={p.name} onClick={() => {
                        const text = prompt(t('doc.prompt.wordArt')); if (!text) return
                        const v = viewRef.current; if (!v) return
                        const marks: any[] = [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '36px' }), schema.marks.wordArt.create({ style: p.style })]
                        if (p.style !== 'gradient' && p.style !== 'outline') marks.push(schema.marks.textColor.create({ color: p.color }))
                        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, marks))))
                        v.focus(); setShowArtPanel(false)
                      }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 72 }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: p.color, textShadow: p.style === 'shadow' ? '2px 2px 4px rgba(0,0,0,0.4)' : p.style === 'glow' ? '0 0 10px ' + p.color : p.style === '3d' ? '1px 1px 0 #ccc, 2px 2px 0 #bbb, 3px 3px 6px rgba(0,0,0,0.3)' : 'none' }}>{p.name.charAt(0)}a</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.flowchart')}>
            <RibbonButton icon="🔀" label={t('doc.flowchart')} onClick={() => {
              const v = viewRef.current; if (!v) return
              const rows = [
                [t('flow.step'), t('flow.content')],
                [t('flow.start'), t('flow.userInput')],
                [t('flow.process'), t('flow.aiAnalysis')],
                [t('flow.decision'), t('flow.complete')],
                [t('flow.end'), t('flow.output')],
              ]
              const tableRows = rows.map((row, r) => schema.nodes.table_row.create(null,
                row.map(cell => schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, schema.text(cell))))
              ))
              v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tableRows)))
              v.focus()
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.text')}>
            <RibbonButton icon="📦" label={t('doc.textBox')} onClick={() => exec('textBox')} />
            <RibbonButton icon="Σ" label={t('doc.formula')} onClick={insertFormula} data-testid="insert-formula" />
            <div className="relative inline-block">
            <RibbonButton icon="Ω" label={t('doc.symbols')} onClick={() => openPanel2('symbol')} data-testid="insert-symbol" />
            {showSymbolPanel && (
              <div className="absolute left-0 top-full" style={{ zIndex: 50, padding: '12px', minWidth: 360, marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {[
                    { k: 'greek', l: t('sym.greek') || '希腊' },
                    { k: 'latin', l: t('sym.latin') || '拉丁' },
                    { k: 'circled', l: t('sym.circled') || '圈号' },
                    { k: 'roman', l: t('sym.roman') || '罗马' },
                    { k: 'math', l: t('sym.math') || '数学' },
                    { k: 'arrows', l: t('sym.arrows') || '箭头' },
                  ].map(c => (
                    <button key={c.k} onClick={() => setSymbolCategory(c.k as any)} className="text-xs px-2 py-1 rounded" style={{ background: symbolCategory === c.k ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: symbolCategory === c.k ? 'white' : 'var(--color-text)' }}>{c.l}</button>
                  ))}
                </div>
                <div className="grid grid-cols-8 gap-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {symbolCategory === 'greek' && 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                  {symbolCategory === 'latin' && 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                  {symbolCategory === 'circled' && '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳⓪ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙ'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                  {symbolCategory === 'roman' && 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                  {symbolCategory === 'math' && '±×÷·∗∘∝∞∠∡∇∂√∫∮∑∏⊕⊗⊥∥≡≅≈≠≤≥≪≫∈∉∩∪⊂⊃⊆⊇∅∀∃¬∧∨⇒⇔'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                  {symbolCategory === 'arrows' && '←↑→↓↔↕↖↗↘↙⇄⇅⇒⇐⇔⇑⇓⇕⟶⟵⟷'.split('').map((s, i) => (
                    <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.link')}>
            <RibbonButton icon="⚓" label={t('doc.bookmark')} onClick={() => exec('bookmark')} />
            <RibbonButton icon="🔗" label={t('doc.hyperlink')} onClick={insertLink} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.toc') || '目录'}>
            <RibbonButton icon="📑" label={t('doc.autoToc')} onClick={() => generateTOC()} title={t('doc.autoTocTitle')} />
            <RibbonButton icon="🔄" label={t('doc.updateToc')} onClick={() => generateTOC()} title={t('doc.updateTocTitle')} />
            <RibbonButton icon="📋" label={t('doc.manualToc')} onClick={() => insertManualToc()} title={t('doc.manualTocTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.annotation')}>
            <RibbonButton icon="📝" label={t('doc.footnote')} onClick={() => exec('footnote')} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'layout' && (<>
          <RibbonGroup label={t('doc.border')}>
            <RibbonButton icon="▢" label={t('doc.tblBorderAll')} onClick={toggleBorderAll} active={borderHas(activeAttrs.border, 'all')} />
            <RibbonButton icon="▔" label={t('doc.tblBorderTop')} onClick={() => toggleBorderSide('top')} active={borderHas(activeAttrs.border, 'top')} />
            <RibbonButton icon="▕" label={t('doc.tblBorderRight')} onClick={() => toggleBorderSide('right')} active={borderHas(activeAttrs.border, 'right')} />
            <RibbonButton icon="▁" label={t('doc.tblBorderBottom')} onClick={() => toggleBorderSide('bottom')} active={borderHas(activeAttrs.border, 'bottom')} />
            <RibbonButton icon="▏" label={t('doc.tblBorderLeft')} onClick={() => toggleBorderSide('left')} active={borderHas(activeAttrs.border, 'left')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.shading')}>
            <div className="relative">
              <button className="toolbar-btn" title={t('doc.shading')} type="button" style={{ width: 32, height: 28 }} onClick={() => openPanel('shading')}>
                <IconShading color={activeAttrs.shading || 'var(--color-text-muted)'} />
              </button>
              {showShadingPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.625rem', zIndex: 50 }}>
                  <div className="grid grid-cols-6 gap-1.5">
                    {['','#f1f5f9','#fef3c7','#dbeafe','#dcfce7','#fce7f3'].map(c => <button key={c} onClick={() => { setParaAttr('shading', c); closeAllPanels() }} className="w-6 h-6 rounded-md transition-transform hover:scale-110" style={{ background: c || 'white', border: '1px solid var(--color-border)' }} type="button" />)}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.layout')}>
            <RibbonButton icon="🅰" label={t('doc.dropCap')} onClick={() => exec('dropCap')} active={activeAttrs.dropCap} />
            <RibbonButton icon="⇄" label="RTL" onClick={() => exec('toggleRTL')} active={activeAttrs.rtl} />
            <RibbonButton icon="💧" label={t('doc.watermark')} onClick={applyWatermark} />
          </RibbonGroup>
          {/* MS Office 风格页面设置 */}
          <RibbonGroup label={t('doc.pageSetup')}>
            <div className="flex flex-col gap-1">
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={pageSize}
                onChange={v => setPageSize(v as any)}
                options={[
                  { label: 'A4', value: 'A4' },
                  { label: 'A3', value: 'A3' },
                  { label: 'A5', value: 'A5' },
                  { label: 'B5', value: 'B5' },
                  { label: 'Letter', value: 'Letter' },
                  { label: 'Legal', value: 'Legal' },
                ]}
              />
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={orientation}
                onChange={v => setOrientation(v as any)}
                options={[
                  { label: t('doc.portrait'), value: 'portrait' },
                  { label: t('doc.landscape'), value: 'landscape' },
                ]}
              />
            </div>
            <RibbonButton icon="📄" label={t('doc.margins')} onClick={() => {
              const preset = prompt(t('doc.marginsPrompt') + ' (top,bottom,left,right cm)', '2.54,2.54,2.54,2.54')
              if (preset) {
                const parts = preset.split(',').map(s => parseFloat(s.trim()))
                if (parts.length === 4 && parts.every(v => !isNaN(v) && v > 0)) {
                  // cm → px (1cm ≈ 37.8px)
                  setDocMargins({ top: Math.round(parts[0] * 37.8), bottom: Math.round(parts[1] * 37.8), left: Math.round(parts[2] * 37.8), right: Math.round(parts[3] * 37.8) })
                }
              }
            }} title={t('doc.marginsTitle')} />
            <RibbonButton icon="ǁ" label={t('doc.columns')} onClick={() => {
              const n = parseInt(prompt(t('doc.columnsPrompt'), '2') || '1')
              if (n > 0 && n <= 4) setDocColumns(n)
            }} title={t('doc.columnsTitle')} />
            <RibbonButton icon="🔢" label={t('doc.lineNumber')} onClick={() => setDocLineNumbers(!docLineNumbers)} active={docLineNumbers} title={t('doc.lineNumberTitle')} />
            <RibbonButton icon="📑" label={t('doc.pageBreakInsert')} onClick={() => exec('pageBreak')} title={t('doc.pageBreakInsertTitle')} />
          </RibbonGroup>
          {/* 页眉页脚 / 页码 */}
          <RibbonGroup label={t('doc.headerFooter')}>
            <RibbonButton icon="📄" label={t('doc.header')} active={!!docHeader} onClick={() => setShowHFDialog({ target: 'header' })} title={t('doc.headerTitle')} />
            <RibbonButton icon="📎" label={t('doc.footer')} active={!!docFooterHF.text} onClick={() => setShowHFDialog({ target: 'footer' })} title={t('doc.footerTitle')} />
            <RibbonButton icon="🔢" label={t('doc.pageNum')} onClick={() => setShowPageNumDialog(true)} active={!!pageNumber?.enabled} title={t('doc.pageNumTitle')} />
          </RibbonGroup>
          <RibbonGroup label="公文 GB/T 9704">
            <RibbonButton icon="📜" label="公文模板" onClick={() => {
              // 应用政府公文标准排版: 3号仿宋 + 固定28磅 + 首行缩进2字符
              setParaAttr('lineHeight', '28pt')
              setParaAttr('firstLine', 2)
              setParaAttr('align', 'justify')
            }} title="应用 GB/T 9704-2012 政府公文标准排版" />
            <RibbonButton icon="🇨" label="红头线" onClick={() => setParaAttr('border', activeAttrs.border === 'redBottom' ? '' : 'redBottom')} active={activeAttrs.border === 'redBottom'} title="红色分隔线" />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'review' && (<>
          <RibbonGroup label={t('doc.proofing')}>
            <RibbonButton icon="🔍" label={t('doc.findReplace')} onClick={() => setSearchOpen(!searchOpen)} />
            <RibbonButton icon={spellErrors.length > 0 ? '❗' : '✓'} label={spellErrors.length > 0 ? `${t('doc.spell')}(${spellErrors.length})` : t('doc.spell')} onClick={() => {
              if (spellErrors.length > 0) {
                // 跳到下一个拼写错误：优先用文档中带 spell-error 装饰的词，
                // 依次向后找第一个不在当前选区之前的（旧实现误用 searchPlugin 的
                // matches —— 拼写词不在查找匹配里，几乎永远弹“无错误”）。
                const v = viewRef.current; if (!v) return
                const words = spellErrors.map(e => e.word).filter(Boolean)
                let jumped = false
                const selTo = v.state.selection.to
                // 从当前光标之后找第一个仍存在于文档中的错误词
                for (const w of words) {
                  const lw = w.toLowerCase()
                  let hit: { from: number; to: number } | null = null
                  // descendants 回调 return false = 不深入子树；容器节点须 return true（见 __docJumpToWord 注释）
                  v.state.doc.descendants((node: any, pos: number) => {
                    if (hit) return false
                    if (!node.isText || !node.text) return true
                    const idx = node.text.toLowerCase().indexOf(lw)
                    if (idx >= 0 && pos + idx >= selTo) hit = { from: pos + idx, to: pos + idx + w.length }
                    return !hit
                  })
                  if (!hit) { // 光标后没有：允许从头找（wrap around）
                    v.state.doc.descendants((node: any, pos: number) => {
                      if (hit) return false
                      if (!node.isText || !node.text) return true
                      const idx = node.text.toLowerCase().indexOf(lw)
                      if (idx >= 0) hit = { from: pos + idx, to: pos + idx + w.length }
                      return !hit
                    })
                  }
                  if (hit) {
                    const h = hit as { from: number; to: number }
                    v.dispatch(v.state.tr
                      .setSelection(TextSelection.create(v.state.doc, h.from, h.to))
                      .scrollIntoView())
                    v.focus()
                    jumped = true
                    break
                  }
                }
                if (!jumped) alert(t('doc.spellNoErrors') || 'No spelling errors')
              } else {
                // Trigger spell check
                const v = viewRef.current; if (!v) return
                if (onSpellCheckRef.current) onSpellCheckRef.current(v.state.doc.textContent)
              }
            }} title={spellErrors.length > 0 ? (t('doc.spellJumpTitle') || 'Jump to next spelling error') : (t('doc.spellRunTitle') || 'Run spell check')} />
            <RibbonButton icon="🌐" label={t('doc.translate')} onClick={() => {
              const text = viewRef.current?.state.doc.textContent || ''
              if (text) window.open(`https://translate.google.com/?text=${encodeURIComponent(text.slice(0, 500))}`, '_blank')
            }} title={t('doc.translateTitle')} />
            <RibbonButton icon="🔊" label={t('doc.readAloud')} onClick={() => {
              const text = viewRef.current?.state.doc.textContent || ''
              if (text && 'speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance(text.slice(0, 1000))
                u.lang = 'zh-CN'
                speechSynthesis.speak(u)
              }
            }} title={t('doc.readAloudTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.revision')}>
            <RibbonButton icon="✏️" label={t('doc.revisionMode')} onClick={() => setTrackChanges(!trackChanges)} active={trackChanges} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.changesNav')}>
            <RibbonButton icon="◀" label={t('doc.prevChange')} onClick={() => gotoChange(-1)} title={t('doc.prevChangeTitle')} />
            <RibbonButton icon="▶" label={t('doc.nextChange')} onClick={() => gotoChange(1)} title={t('doc.nextChangeTitle')} />
            <RibbonButton icon="✓" label={t('doc.accept')} onClick={acceptCurrent} title={t('doc.acceptTitle')} />
            <RibbonButton icon="✗" label={t('doc.reject')} onClick={rejectCurrent} title={t('doc.rejectTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.changesAll')}>
            <RibbonButton icon="📥" label={t('doc.acceptAll')} onClick={acceptAll} title={t('doc.acceptAllTitle')} />
            <RibbonButton icon="📤" label={t('doc.rejectAll')} onClick={rejectAll} title={t('doc.rejectAllTitle')} />
          </RibbonGroup>
          {/* MS Office 风格字数统计 (详细) */}
          <RibbonGroup label={t('doc.wordCount')}>
            <div className="flex flex-col items-center justify-center px-3 py-1 text-xs rounded-md" style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-alt)' }}>
              <div className="flex gap-3 items-baseline">
                <div className="text-center">
                  <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-primary)' }}>{viewRef.current?.state.doc.textContent.length || 0}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.chars')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/\s+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.words')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/[。！？.!?]+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.sentences')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/\n+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.paragraphs')}</div>
                </div>
              </div>
            </div>
          </RibbonGroup>
          {/* 比较与保护 */}
          <RibbonGroup label={t('doc.compareProtect')}>
            <RibbonButton icon="⚖️" label={t('doc.compare')} onClick={runCompare} active={!!compareTarget} title={t('doc.compareTitle')} />
            <RibbonButton icon="🔒" label={t('doc.protect')} onClick={toggleProtect} active={protectedMode} title={protectedMode ? t('doc.protectOn') : t('doc.protectTitle')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('doc.zoom')}>
            <RibbonButton icon="−" label={t('doc.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 10))} />
            <div className="flex flex-col items-center px-1">
              <input
                type="number"
                value={zoom}
                min={50}
                max={300}
                onChange={e => {
                  const v = parseInt(e.target.value) || 100
                  setZoom(Math.max(50, Math.min(300, v)))
                }}
                className="text-center text-xs rounded w-12 px-1 py-0.5"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                title={t('doc.zoom')}
              />
              <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>%</span>
            </div>
            <RibbonButton icon="+" label={t('doc.zoomIn')} onClick={() => setZoom(Math.min(300, zoom + 10))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          {/* 背景色 / 护眼模式 */}
          <RibbonGroup label={t('doc.pageBg')}>
            <div className="relative">
              <button className="toolbar-btn" title={t('doc.pageBg')} type="button" style={{ width: 40, height: 32, background: bgColor }} onClick={() => openPanel('bgColor')} />
              {showBgColorPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.625rem', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['#ffffff', t('doc.bgWhite')], ['#c7edcc', t('doc.bgEyeGreen')], ['#f5f5dc', t('doc.bgBeige')], ['#faf3e0', t('doc.bgCream')], ['#e8e8e8', t('doc.bgGray')], ['#fff5e6', t('doc.bgWarm')]].map(([c, n]) => (
                      <button key={c} onClick={() => { setBgColorPersist(c as string); setEyeCarePersist(c === '#c7edcc'); closeAllPanels() }} className="flex flex-col items-center gap-0.5 p-1 rounded transition-colors hover:bg-slate-100" title={n as string}>
                        <span className="w-7 h-7 rounded border" style={{ background: c, border: '1px solid var(--color-border)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <RibbonButton icon="👁" label={t('doc.eyeCare')} onClick={() => { const ec = !eyeCareMode; setEyeCarePersist(ec); setBgColorPersist(ec ? '#c7edcc' : '#ffffff') }} active={eyeCareMode} title={t('doc.eyeCareTitle')} />
          </RibbonGroup>
          {/* 显示编辑标记 (¶ 段落标记 / 分页符) */}
          <RibbonGroup label={t('doc.show')}>
            <RibbonButton icon="¶" label={t('doc.showMarks')} onClick={() => setShowMarksPersist(!showMarks)} active={showMarks} title={t('doc.showMarksTitle')} />
            <RibbonButton icon="📏" label={t('doc.ruler')} onClick={() => setShowRulerPersist(!showRuler)} active={showRuler} title={t('doc.rulerTitle')} />
            <RibbonButton icon="📐" label={t('doc.gridlines')} onClick={() => setShowGridlinesPersist(!showGridlines)} active={showGridlines} title={t('doc.gridlinesTitle')} />
            <RibbonButton icon="🗂" label={t('doc.navPane')} onClick={() => setShowNavPanePersist(!showNavPane)} active={showNavPane} title={t('doc.navPaneTitle')} />
          </RibbonGroup>
          {/* 窗口 */}
          <RibbonGroup label={t('doc.window')}>
            <RibbonButton icon="🪟" label={t('doc.newWindow')} onClick={() => { const go = (window as any).go?.main?.App; if (go?.NewWindow) go.NewWindow(); else if ((window as any).runtime?.WindowNew) (window as any).runtime.WindowNew() }} title={t('doc.newWindowTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.preview')}><RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintDialogOpen(true)} data-testid="word-print-btn" /></RibbonGroup>
        </>)}
      </div>
      )}

      {/* 表格工具栏 */}
      {inTable && (
        <div className="px-3 py-1 flex items-center gap-1 flex-shrink-0 animate-fade-in" style={{ background: 'var(--color-primary-light)', borderBottom: '1px solid var(--color-border)' }}
          // 对齐 MS Office：点击表格工具栏（含边框/自动调整下拉）不夺走编辑器焦点。
          // 否则浏览器折叠原生选区、PM DOMObserver 同步后 CellSelection 被清 ——
          // “全选表格后点边框，选择状态消失且边框不生效”的根因。
          // input/select/textarea 需要真实焦点行为，跳过。
          onMouseDown={(e: any) => { const t = e.target as HTMLElement; if (!t.closest?.('input, select, textarea')) e.preventDefault() }}>
          <span className="text-xs font-medium px-2" style={{ color: 'var(--color-primary)' }}>{t('doc.tableTools')}</span>
          <button onClick={() => mergeCells(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.merge')} type="button">⊟</button>
          <button onClick={() => splitCell(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.split')} type="button">⊞</button>
          <div className="toolbar-divider" />
          <button onClick={() => addRowAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.addRow')} type="button">↧+</button>
          <button onClick={() => addColumnAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.addColumn')} type="button">↦+</button>
          <button onClick={() => deleteRow(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.deleteRow')} type="button">↧✕</button>
          <button onClick={() => deleteColumn(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.deleteColumn')} type="button">↦✕</button>
          <div className="toolbar-divider" />
          {/* 边框（对齐 MS Word）：预设菜单 + 线色 + 线宽，作用于选区（单格/多格/整行/整列） */}
          <div className="relative">
            <button onClick={() => setShowTableBorderMenu(v => !v)} className={`toolbar-btn ${showTableBorderMenu ? 'active' : ''}`}
              title={t('doc.tblBorders') || '边框'} type="button">▦</button>
            {showTableBorderMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 90 }} onMouseDown={() => setShowTableBorderMenu(false)} />
                <div className="absolute top-full left-0 mt-1 py-1.5 rounded-lg shadow-xl" style={{ zIndex: 95, background: 'var(--color-surface)', border: '1px solid var(--color-border)', width: 190 }}>
                  {([
                    ['all', t('doc.tblBorderAll') || '所有框线'],
                    ['outer', t('doc.tblBorderOuter') || '外侧框线'],
                    ['inner', t('doc.tblBorderInner') || '内部框线'],
                    ['none', t('doc.tblBorderNone') || '无框线'],
                    ['top', t('doc.tblBorderTop') || '上框线'],
                    ['bottom', t('doc.tblBorderBottom') || '下框线'],
                    ['left', t('doc.tblBorderLeft') || '左框线'],
                    ['right', t('doc.tblBorderRight') || '右框线'],
                    ['innerH', t('doc.tblBorderInnerH') || '内部横线'],
                    ['innerV', t('doc.tblBorderInnerV') || '内部竖线'],
                  ] as [string, string][]).map(([preset, label]) => (
                    <button key={preset} type="button"
                      onClick={() => { setCellBorders(viewRef.current!.state, viewRef.current!.dispatch, preset, { color: tableBorderColor, width: tableBorderWidth }); setShowTableBorderMenu(false) }}
                      className="flex w-full items-center px-3 py-1.5 text-xs transition-colors"
                      style={{ color: 'var(--color-text)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-alt)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{label}</button>
                  ))}
                  <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('doc.tblBorderLineColor') || '线色'}</span>
                    <input type="color" value={tableBorderColor} onChange={e => setTableBorderColor(e.target.value)}
                      className="w-7 h-6 cursor-pointer rounded border" style={{ borderColor: 'var(--color-border)' }} />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('doc.tblBorderLineWidth') || '线宽'}</span>
                    <select value={String(tableBorderWidth)} onChange={e => setTableBorderWidth(Number(e.target.value))}
                      className="text-xs px-1 py-1 rounded border flex-1"
                      style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
                      <option value="0">1px</option>
                      <option value="0.5">0.5pt</option>
                      <option value="1">1pt</option>
                      <option value="1.5">1.5pt</option>
                      <option value="2">2pt</option>
                      <option value="3">3pt</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="toolbar-divider" />
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'left')} className="toolbar-btn" title={t('doc.alignLeft')} type="button"><IconAlignLeft /></button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'center')} className="toolbar-btn" title={t('doc.alignCenter')} type="button"><IconAlignCenter /></button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'right')} className="toolbar-btn" title={t('doc.alignRight')} type="button"><IconAlignRight /></button>
          <div className="toolbar-divider" />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('doc.vAlign') || '垂直对齐'}:</span>
          <button onClick={() => setCellVAlign(viewRef.current!.state, viewRef.current!.dispatch, 'top')} className={`toolbar-btn ${cellVAlign === 'top' ? 'active' : ''}`} title={t('doc.vAlignTop') || '顶端对齐'} type="button"><IconVAlignTop /></button>
          <button onClick={() => setCellVAlign(viewRef.current!.state, viewRef.current!.dispatch, 'middle')} className={`toolbar-btn ${cellVAlign === 'middle' ? 'active' : ''}`} title={t('doc.vAlignMiddle') || '垂直居中'} type="button"><IconVAlignMiddle /></button>
          <button onClick={() => setCellVAlign(viewRef.current!.state, viewRef.current!.dispatch, 'bottom')} className={`toolbar-btn ${cellVAlign === 'bottom' ? 'active' : ''}`} title={t('doc.vAlignBottom') || '底端对齐'} type="button"><IconVAlignBottom /></button>
          <div className="toolbar-divider" />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('doc.tableAlign') || '表格对齐'}:</span>
          <button onClick={() => exec('tableAlignLeft')} className="toolbar-btn" title={t('doc.tableAlignLeft') || '表格左对齐'} type="button">⟸</button>
          <button onClick={() => exec('tableAlignCenter')} className="toolbar-btn" title={t('doc.tableAlignCenter') || '表格居中'} type="button">⟺</button>
          <button onClick={() => exec('tableAlignRight')} className="toolbar-btn" title={t('doc.tableAlignRight') || '表格右对齐'} type="button">⟹</button>
          <div className="toolbar-divider" />
          {/* 自动调整（对齐 MS Word 表格工具「自动调整」）：根据内容/根据窗口/固定列宽 */}
          <div className="relative">
            <button onClick={() => setShowAutoFitMenu(v => !v)} className={`toolbar-btn ${showAutoFitMenu ? 'active' : ''}`}
              title={t('doc.tblAutoFit') || '自动调整'} type="button">⇔</button>
            {showAutoFitMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 90 }} onMouseDown={() => setShowAutoFitMenu(false)} />
                <div className="absolute top-full left-0 mt-1 py-1.5 rounded-lg shadow-xl" style={{ zIndex: 95, background: 'var(--color-surface)', border: '1px solid var(--color-border)', width: 190 }}>
                  {([
                    ['content', t('doc.tblAutoFitContent') || '根据内容调整表格'],
                    ['window', t('doc.tblAutoFitWindow') || '根据窗口调整表格'],
                    ['fixed', t('doc.tblAutoFitFixed') || '固定列宽'],
                  ] as [string, string][]).map(([mode, label]) => (
                    <button key={mode} type="button"
                      onClick={() => {
                        const v = viewRef.current
                        if (v) {
                          const contentW = pageWidthPx - docMargins.left - docMargins.right
                          autoFitTable(v, mode as 'content' | 'window' | 'fixed', contentW)
                        }
                        setShowAutoFitMenu(false)
                      }}
                      className="flex w-full items-center px-3 py-1.5 text-xs transition-colors"
                      style={{ color: 'var(--color-text)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-alt)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mini 浮动工具栏 — round17 移除：与选区/光标位置冲突，遮挡正文且干扰编辑
        *（用户主诉"太影响编辑了"）。加粗/斜体/字号/颜色等全部功能在 Ribbon 开始
        * 选项卡与右键菜单中均有入口，不受影响。 */}

      {/* 右键菜单 — 边界检测防止越界 */}
      {showContextMenu && (() => {
        const MENU_W = 180, MENU_H = 270
        const vw = window.innerWidth, vh = window.innerHeight
        let cx = contextMenuPos.x, cy = contextMenuPos.y
        if (cx + MENU_W > vw - 8) cx = Math.max(8, vw - MENU_W - 8)
        if (cy + MENU_H > vh - 8) cy = Math.max(8, vh - MENU_H - 8)
        return (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(false)} />
          <div className="fixed z-50 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ left: cx, top: cy, background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 180 }}
          // 右键菜单项同样不夺走编辑器焦点：保持选区高亮与 CellSelection（对齐 MS Office）
          onMouseDown={(e: any) => { if (!(e.target as HTMLElement).closest?.('input, select, textarea')) e.preventDefault() }}>
            <button onClick={() => exec('undo')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>↶ {t('doc.undo')}</button>
            <button onClick={() => exec('redo')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>↷ {t('doc.redo')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => exec('cut')} disabled={!hasSelection()} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>✂ {t('doc.cut')}</button>
            <button onClick={() => exec('copy')} disabled={!hasSelection()} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>⧉ {t('doc.copy')}</button>
            <button onClick={() => exec('paste')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📋 {t('doc.paste')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => exec('bold')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><b>B</b> {t('doc.bold')}</button>
            <button onClick={() => exec('italic')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><i>I</i> {t('doc.italic')}</button>
            <button onClick={() => exec('underline')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><u>U</u> {t('doc.underline')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => { setSearchOpen(true); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🔍 {t('doc.findReplace')}</button>
            <button onClick={() => exec('comment')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>💬 {t('doc.addComment')}</button>
            <button onClick={() => { setRibbonTab('insert'); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📊 {t('doc.insertTable')}</button>
            {contextMenuOnTextBox && (
              <>
                <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
                <button onClick={editTextBoxStyle} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🎨 {t('doc.editStyle')}</button>
              </>
            )}
          </div>
        </>
        )
      })()}

      {watermark && (<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)', fontSize: '72px', color: 'rgba(0,0,0,0.08)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>{watermark}</div>)}

      {/* 导航窗口 (Navigation Pane) */}
      {showNavPane && (
        <div className="flex-shrink-0 overflow-auto animate-fade-in" style={{ width: 200, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', padding: '8px 12px' }}>
          <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('doc.navPane') || '导航'}</div>
          {viewRef.current?.state.doc.content.firstChild ? (() => {
            const headings: { level: number; text: string; pos: number }[] = []
            viewRef.current.state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') {
                headings.push({ level: node.attrs.level, text: node.textContent, pos })
              }
            })
            if (headings.length === 0) return <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('doc.noHeadings') || '无标题'}</div>
            return headings.map((h, i) => (
              <div key={i} className="text-xs cursor-pointer hover:bg-slate-100 rounded px-1 py-0.5" style={{ marginLeft: (h.level - 1) * 12, color: 'var(--color-text-secondary)' }}
                onClick={() => { const v = viewRef.current; if (v) { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(h.pos)))); v.focus() } }}>
                {h.text || `(H${h.level})`}
              </div>
            ))
          })() : null}
        </div>
      )}

      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0, flexDirection: compareTarget ? 'row' : 'column' }}>
      <div
        ref={leftScrollRef}
        onScroll={() => syncScroll('left')}
        className={`flex-1 overflow-auto ${showMarks ? 'show-edit-marks' : ''} ${(splitWindow || compareTarget) ? 'flex' : ''}`}
        style={{ background: 'var(--color-bg-alt)', position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', flex: compareTarget ? '1 1 50%' : '1 1 auto', minWidth: 0, borderRight: compareTarget ? '2px solid var(--color-border)' : 'none', overflowAnchor: 'none' }}
      >
      <div
        ref={pageRef}
        className="mx-auto animate-fade-in"
        onDoubleClick={(e: any) => {
          // 页间空白双击合并/分隔（对齐 MS Word）：
          // - 常规模式：双击两页之间的空白带（页 i 内容区底 → 页 i+1 内容区顶）收起页间空白；
          // - 收起模式：双击页界分隔线（±4px）恢复。
          // 纸页层被上层 pm-host 覆盖，无法用独立命中区，故在容器层按坐标判定。
          // 仅当点击落在空白带/分隔线上才生效 —— 文本块不会渲染在这些区域内，
          // 因此不会误伤正文双击（选词）行为。
          const pr = pageRef.current
          if (!pr) return
          const rect = pr.getBoundingClientRect()
          const z = zoom / 100
          // y = pm-host 顶坐标系（纸页层 rects[].top 同坐标系）：屏幕坐标 - pageRef 顶 - bodyTop
          const y = (e.clientY - rect.top) / z - bodyTop
          let hit = false
          if (whiteSpaceHidden) {
            // 收起模式：页 i>0 纸顶即页界分隔线（rects[i].top = marginTop + i*per）
            for (let i = 1; i < visibleRects.length; i++) {
              if (Math.abs(y - visibleRects[i].top) <= 4) { hit = true; break }
            }
            if (hit) { e.preventDefault(); e.stopPropagation(); setWhiteSpaceHidden(false) }
          } else if (visibleRects.length >= 2) {
            // 常规模式：空白带 = 页 i 内容区底（rects[i].top + marginTop + per）
            //          → 页 i+1 内容区顶（rects[i+1].top + marginTop）
            for (let i = 0; i < visibleRects.length - 1; i++) {
              const bandTop = visibleRects[i].top + docMargins.top + pageContentPerPage
              const bandBottom = visibleRects[i + 1].top + docMargins.top
              if (y >= bandTop && y <= bandBottom) { hit = true; break }
            }
            if (hit) { e.preventDefault(); e.stopPropagation(); setWhiteSpaceHidden(true) }
          }
        }}
        onMouseDown={(e: any) => {
          // 点击页面空白区（页边距 / 纸页正文下方空白 / 尾页下方）：把光标放到最近可输入位置，
          // 对齐 MS Word"点击页面任意空白处即可开始输入"（修复表格后无法输入新文本的一部分场景）。
          // ProseMirror 内容区与交互控件（标尺/文本框/按钮/页脚）不拦截。
          const v = viewRef.current
          if (!v) return
          const target = e.target as HTMLElement
          if (target.closest && target.closest('.ProseMirror, .text-box, button, input, select, textarea, [contenteditable], .sam-ruler, .comment-card')) return
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const zoomRatio = zoom / 100
          const below = e.clientY > rect.top + (docMargins.top * zoomRatio)
          const endPos = v.state.doc.content.size
          try {
            const $pos = v.state.doc.resolve(below ? Math.max(0, endPos) : Math.min(1, endPos))
            const sel = TextSelection.near($pos, below ? -1 : 1)
            v.dispatch(v.state.tr.setSelection(sel).scrollIntoView())
            v.focus()
            e.preventDefault()
          } catch { /* 位置无效时忽略 */ }
        }}
        style={{
          position: 'relative',
          marginTop: '24px',
          marginBottom: '24px',
          borderRadius: '8px',
          background: 'transparent',
          width: pageWidthPx,
          minHeight: pageRefMinH * (zoom / 100),
          overflow: 'visible',
        }}
      >
        {/* 缩放包裹层：仅对纸页与编辑器内容做视觉缩放，不改变布局尺寸，
            避免 CSS zoom 属性导致 ProseMirror 内容区域异常或 measure 循环。 */}
        <div
          style={{
            width: pageWidthPx,
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
          }}
        >
        {/* 纸页背景层：每张纸依据分页引擎算出的实际内容位置绘制，与内容严格对齐 */}
        <div ref={sheetsLayerRef} style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          {visibleRects.map((p, i) => (
            <Fragment key={i}>
              <div className={(showGridlines ? 'page-grid ' : '') + 'pg-paper'} style={{ position: 'absolute', top: bodyTop + p.top, left: 0, width: pageWidthPx, height: p.height, backgroundColor: bgColor, boxShadow: '0 0 32px rgba(15, 23, 42, 0.06)', borderRadius: '8px' }}>
                {/* 每页脚注区：脚注文本显示在引用所在页底部，而非文档末尾（收起页间空白时隐藏：页边距区已折叠） */}
                {!whiteSpaceHidden && (footnotesByPage[i] || []).length > 0 && (
                  <div style={{
                    position: 'absolute',
                    left: docMargins.left,
                    right: docMargins.right,
                    bottom: Math.round(docMargins.bottom * 0.55) + 18,
                    borderTop: '1px solid var(--color-border)',
                    padding: '4px 0',
                    fontSize: '0.82em',
                    lineHeight: 1.5,
                    color: 'var(--color-text-muted)',
                    // 背景透明：护眼色/背景色由纸页层提供，不再被白色遮住（修复护眼模式下页脚区发白）
                    background: 'transparent',
                    pointerEvents: 'auto',
                  }}>
                    {(footnotesByPage[i] || []).map((f) => (
                      <div key={f.sectionPos} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', margin: '2px 0' }}
                           onDoubleClick={() => editFootnote(f)} title={t('doc.prompt.footnote') || '双击编辑脚注'}>
                        <span style={{ flex: 1, wordBreak: 'break-word' }}>
                          <span style={{ color: '#4f46e5', marginRight: '4px', fontSize: '0.92em' }}>{f.num}.</span>{f.text || ' '}
                        </span>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); copyFootnote(f) }}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '12px', lineHeight: 1, padding: '0 4px' }}
                                title="复制脚注">复制</button>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); deleteFootnote(f) }}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                                title="删除脚注">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 文本输入区四角直角标记：仅“显示标记”时显示，标记“可输入内容的起始位置空间”——
                    即页边距之内的正文区域（可编辑文本区）的四个角。角标紧贴文本区边界，
                    让用户一眼看清正文从哪里开始、到哪里结束。
                    该纸页背景 div 的尺寸=整张纸（pageWidthPx × p.height），文本区起点在
                    docMargins.top/left 处，终点在右侧 docMargins.right、底部 docMargins.bottom 处，
                    因此角标需以页边距为偏移定位到文本区四角（而非整张纸四角）。 */}
                {showMarks && (() => {
                  const size = 16
                  const cornerColor = '#5b9bd5' // Word 风格蓝灰，与页面边界一致
                  const mt = docMargins.top
                  const mb = docMargins.bottom
                  const ml = docMargins.left
                  const mr = docMargins.right
                  return (
                    <Fragment>
                      <span style={{ position: 'absolute', top: mt, left: ml, width: size, height: size, borderTop: `2px solid ${cornerColor}`, borderLeft: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', top: mt, right: mr, width: size, height: size, borderTop: `2px solid ${cornerColor}`, borderRight: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', bottom: mb, left: ml, width: size, height: size, borderBottom: `2px solid ${cornerColor}`, borderLeft: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', bottom: mb, right: mr, width: size, height: size, borderBottom: `2px solid ${cornerColor}`, borderRight: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                    </Fragment>
                  )
                })()}
              </div>
              {/* 收起页间空白：页界分隔线（MS Word 样式细蓝线），双击恢复页间空白
                  （命中判定由 pageRef 的 onDoubleClick 统一处理，此层仅负责绘制） */}
              {whiteSpaceHidden && i > 0 && (
                <div style={{
                  position: 'absolute',
                  top: bodyTop + p.top,
                  left: 0,
                  width: pageWidthPx,
                  height: 1,
                  background: '#93b8dc',
                  pointerEvents: 'none',
                }} />
              )}
              {/* 每页底部页脚（富文本，解析自 docx footerN.xml / 可编辑；点击弹页脚编辑对话框）
                  （收起页间空白时隐藏：页脚位于被折叠的下边距区内） */}
              {docFooterHF.text && !whiteSpaceHidden && (
                <div
                  onClick={() => setShowHFDialog({ target: 'footer' })}
                  title={t('doc.footerTitle')}
                  style={{
                    position: 'absolute',
                    top: bodyTop + p.top + p.height - Math.round(docMargins.bottom * 0.8),
                    left: docMargins.left,
                    right: docMargins.right,
                    fontSize: docFooterHF.fontSize ? `${Math.max(9, Math.round(docFooterHF.fontSize * 1.333))}px` : '12px',
                    fontFamily: docFooterHF.fontFamily || undefined,
                    fontWeight: docFooterHF.bold ? 700 : 400,
                    fontStyle: docFooterHF.italic ? 'italic' : undefined,
                    color: docFooterHF.color ? `#${docFooterHF.color}` : 'var(--color-text-muted)',
                    textAlign: (docFooterHF.align as any) || 'center',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                  {docFooterHF.text}
                </div>
              )}
              {/* 每页底部页码（预览）：按真实页码填充模板（收起页间空白时隐藏） */}
              {pageNumber?.enabled && !whiteSpaceHidden && (
                <div style={{
                  position: 'absolute',
                  top: bodyTop + p.top + p.height - Math.round(docMargins.bottom * 0.55) - 8,
                  left: 0,
                  width: pageWidthPx,
                  textAlign: (pageNumber.align as any) || 'center',
                  fontSize: `${((pageNumber.fontSize || 18) / 2)}px`,
                  color: pageNumber.fontColor || 'var(--color-text-muted)',
                  fontFamily: pageNumber.fontFamily || undefined,
                  fontWeight: pageNumber.bold ? 700 : 400,
                  fontStyle: pageNumber.italic ? 'italic' : 'normal',
                  pointerEvents: 'none',
                }}>
                  {fillPageNumber(pageNumber.format, i + 1, visibleRects.length)}
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* 水平标尺（Word 风格：厘米刻度 + 页边距 + 可拖拽缩进滑块）。
              加常量 key 固定身份：本节点同为 ProseMirror 宿主容器的前置兄弟，
              切换标尺时不得让后续兄弟发生跨位置 reconcile。 */}
          {showRuler && (
            <Ruler
              key="doc-ruler"
              width={pageWidthPx}
              marginLeft={docMargins.left}
              marginRight={docMargins.right}
              indents={{
                indentLeft: Number(activeAttrs.indentLeft) || 0,
                indentRight: Number(activeAttrs.indentRight) || 0,
                firstLine: Number(activeAttrs.firstLine) || 0,
                hanging: Number(activeAttrs.hanging) || 0,
              }}
              onChange={(next: Partial<import('../../components/Ruler').RulerIndents>) => {
                if (next.indentLeft !== undefined) setParaAttr('indentLeft', next.indentLeft)
                if (next.indentRight !== undefined) setParaAttr('indentRight', next.indentRight)
                if (next.firstLine !== undefined) setParaAttr('firstLine', next.firstLine)
                if (next.hanging !== undefined) setParaAttr('hanging', next.hanging)
              }}
            />
          )}
          {/* 页眉。
              必须常驻渲染（用 display 控制显隐）而非 `{cond && ...}`：本节点是下方 ProseMirror
              宿主容器的前置兄弟，一旦条件挂载/卸载就会改变宿主容器在 children 中的下标，
              触发 React 跨位置 reconcile，对 ProseMirror 自持的 DOM 调用 removeChild 导致崩溃。
              注意原实现的外层条件里含 docLineNumbers —— 切换「行号」会让本节点整体增删，
              正是 removeChild 崩溃的触发源之一。 */}
          <div
            key="doc-header"
            onClick={() => setShowHFDialog({ target: 'header' })}
            title={t('doc.headerTitle')}
            style={{
              padding: `${Math.round(docMargins.top * 0.3)}px ${docMargins.right}px ${docMargins.top * 0.3}px ${docMargins.left}px`,
              borderBottom: '1px solid var(--color-border)',
              fontSize: docHeaderFmt.fontSize ? `${Math.max(9, Math.round(docHeaderFmt.fontSize * 1.333))}px` : '12px',
              fontFamily: docHeaderFmt.fontFamily || undefined,
              fontWeight: docHeaderFmt.bold ? 700 : 400,
              fontStyle: docHeaderFmt.italic ? 'italic' : undefined,
              color: docHeaderFmt.color ? `#${docHeaderFmt.color}` : 'var(--color-text-muted)',
              textAlign: (docHeaderFmt.align as any) || 'center',
              cursor: 'pointer',
              minHeight: docHeader ? 'auto' : '0',
              display: docHeader ? 'block' : 'none',
            }}>
            {docHeader}
          </div>
          {/* 编辑器主体 — 应用页边距 + 分栏 */}
          <div style={{ position: 'relative', display: 'flex', flex: 1 }}>
            {/* 行号层。
                该层是 ProseMirror 宿主容器的兄弟节点，且它是绝对定位的纯装饰层。
                此处必须用「常驻 + key + display 切换」而不是 `{cond && ...}` 条件渲染：
                条件渲染会让宿主容器在父节点 children 数组中的下标发生变化，触发 React 跨位置
                reconcile / commitDeletion，进而对 ProseMirror 已接管的 DOM 调用 removeChild 而崩溃。 */}
            <div
              key="line-numbers"
              style={{
                display: docLineNumbers ? 'block' : 'none',
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '40px',
                borderRight: '1px solid var(--color-border)',
                padding: `${docMargins.top}px 4px`,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                textAlign: 'right',
                lineHeight: '1.8',
                userSelect: 'none',
                zIndex: 2,
              }}>
              {docLineNumbers && Array.from({ length: Math.max(pmBlockCount, 1) }, (_, i) => (
                <div key={i} style={{ minHeight: '1.8em' }}>{i + 1}</div>
              ))}
            </div>
            {/* ProseMirror 宿主容器。
                关键：该 div 内部的 DOM 完全由 ProseMirror 拥有（EditorView 会在其中注入并持续增删
                .ProseMirror 子树）。React 绝不能参与该子树的 reconcile，否则在兄弟节点条件渲染
                （如行号层 docLineNumbers、页底脚注兜底区）挂载/卸载引发的 commitDeletion 递归中，
                React 会按自己过时的 fiber 记录对已被 ProseMirror 替换的节点调用 removeChild，
                抛出 "Failed to execute 'removeChild' on 'Node'"。
                因此：
                1) key 固定为常量 'pm-host'，保证 React 永远把它识别为同一元素、不跨兄弟位置复用；
                2) 始终渲染 children={undefined} 且不放任何 JSX 子节点，React 视其为空宿主，
                   不会尝试卸载 ProseMirror 注入的子树。 */}
            <div
              key="pm-host"
              ref={editorRef as any}
              suppressHydrationWarning
              style={{
                width: '100%',
                margin: '0 auto',
                padding: `${docMargins.top}px ${docMargins.right}px ${docMargins.bottom}px ${docMargins.left}px`,
                columnCount: docColumns > 1 ? docColumns : undefined,
                columnGap: docColumns > 1 ? '32px' : undefined,
                columnRule: docColumns > 1 ? '1px solid var(--color-border)' : undefined,
                background: 'transparent',
                minHeight: '100%',
                position: 'relative',
              }}
              className={`${showRuler ? 'show-ruler' : ''} ${showGridlines ? 'show-gridlines' : ''} ${eyeCareMode ? 'eye-care-mode' : ''} ${showMarks ? 'show-marks' : ''}`}
            />
          </div>
          {/* 页底脚注区兜底：分页引擎尚未回报页码时（首帧）仍统一显示在页底，避免闪烁丢失 */}
          {blockPages.length === 0 && footnotes.length > 0 && (
            <div style={{
              borderTop: '1px solid var(--color-border)',
              padding: `${Math.round(docMargins.bottom * 0.3)}px ${docMargins.right}px ${Math.round(docMargins.bottom * 0.3)}px ${docMargins.left}px`,
              fontSize: '0.82em',
              color: 'var(--color-text-muted)',
              background: bgColor,
            }}>
              {footnotes.map((f) => (
                <div key={f.sectionPos} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', margin: '2px 0' }}
                     onDoubleClick={() => editFootnote(f)} title={t('doc.prompt.footnote') || '双击编辑脚注'}>
                  <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.5 }}>
                    <span style={{ color: '#4f46e5', marginRight: '4px', fontSize: '0.92em' }}>{f.num}.</span>{f.text || ' '}
                  </span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); copyFootnote(f) }}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '12px', lineHeight: 1, padding: '0 4px' }}
                          title="复制脚注">复制</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteFootnote(f) }}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                          title="删除脚注">×</button>
                </div>
              ))}
            </div>
          )}
          {/* 页脚（每页真实页码由纸页层按页码渲染，见上方 sheetsLayerRef 层） */}
        </div>
        </div>
        </div>

        {/* 右侧批注栏（对齐 MS Word 审阅窗格：批注卡片显示在正文右侧，与批注锚点对应） */}
        {comments.length > 0 && (
          <div
            className="comments-pane"
            style={{
              width: 240,
              flexShrink: 0,
              borderLeft: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              overflowY: 'auto',
              padding: '12px 10px',
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              maxHeight: '100%',
            }}
          >
            <div className="comments-pane-header">{t('doc.comments') || '批注'} ({comments.length})</div>
            {comments.map(c => {
              const anchor = viewRef.current?.domAtPos(Math.min(c.pos + 1, viewRef.current.state.doc.content.size))
              let top = 0
              if (anchor) { const rect = (anchor.node as HTMLElement).getBoundingClientRect?.(); const scroll = (window.document.querySelector('.editor-scroll') as HTMLElement); if (rect) top = rect.top - (scroll ? scroll.getBoundingClientRect().top : 0) }
              const isActive = activeComment === c.id
              const isEditing = editingComment === c.id
              return (
                <div
                  key={c.id}
                  id={`comment-card-${c.id}`}
                  className={`comment-card ${isActive ? 'active' : ''}`}
                  style={{ position: 'relative', marginTop: top > 0 ? top : undefined, marginBottom: '10px', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${isActive ? '#4f46e5' : 'var(--color-border)'}`, background: isActive ? 'var(--color-bg-alt)' : 'var(--color-surface)' }}
                  onClick={() => { setActiveComment(c.id); const v = viewRef.current; if (v) { const node = v.state.doc.nodeAt(c.pos); if (node && node.type.name === 'comment_mark') { const from = c.pos, to = c.pos + node.nodeSize; v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to))); v.focus() } } }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{c.author}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button type="button" className="comment-action" title={t('doc.editComment') || '编辑'} onClick={(e) => { e.stopPropagation(); setEditingComment(c.id) }}>✎</button>
                      <button type="button" className="comment-action" title={t('doc.deleteComment') || '删除'} onClick={(e) => { e.stopPropagation(); deleteComment(c.id) }}>×</button>
                    </div>
                  </div>
                  {isEditing ? (
                    <textarea
                      autoFocus
                      defaultValue={c.text}
                      className="comment-edit-input"
                      style={{ width: '100%', minHeight: '56px', fontSize: '12px', resize: 'vertical', borderRadius: '4px', border: '1px solid var(--color-border)', padding: '4px 6px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                      onBlur={(e) => { editComment(c.id); setEditingComment(null) }}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setEditingComment(null) } }}
                    />
                  ) : (
                    <div style={{ fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text)' }}>{c.text}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 并排对比：右侧只读视图（独立滚动 + 同步滚动 + 差异高亮） */}
      {compareTarget && (
        <div style={{ flex: '1 1 50%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-alt)' }}>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)' }}>
            <span className="flex items-center gap-2">
              <span style={{ fontWeight: 600 }}>{t('doc.compareWith') || '对比:'}</span>
              <span className="truncate max-w-[200px]">{compareTarget.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, background: 'rgba(16,185,129,0.35)', border: '1px solid #10b981', display: 'inline-block', borderRadius: 2 }} /> {t('doc.diffAdd') || '新增'}</span>
              <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, background: 'rgba(239,68,68,0.30)', border: '1px solid #ef4444', display: 'inline-block', borderRadius: 2 }} /> {t('doc.diffDel') || '删除'}</span>
              <button className="px-2 py-0.5 rounded hover:bg-slate-100" onClick={() => setCompareTarget(null)} title={t('doc.close')}>✕</button>
            </span>
          </div>
          <div
            ref={compareRef}
            onScroll={() => syncScroll('right')}
            className={`flex-1 overflow-auto ${showMarks ? 'show-edit-marks' : ''}`}
            style={{ position: 'relative', zIndex: 1, overflowAnchor: 'none' }}
          />
        </div>
      )}
      </div>

      {/* 页码设置对话框 */}
      {showPageNumDialog && (
        <PageNumberDialog
          value={pageNumber}
          onClose={() => setShowPageNumDialog(false)}
          onSave={(pn) => { setPageNumber(pn); setShowPageNumDialog(false); emitDoc(pn) }}
        />
      )}
      {/* 页眉/页脚编辑对话框（对齐 MS Word：文字 + 对齐/字号/加粗/斜体/颜色，保存写回 docx） */}
      {showHFDialog && (
        <HeaderFooterDialog
          target={showHFDialog.target}
          initial={showHFDialog.target === 'header'
            ? { text: docHeader, ...docHeaderFmt }
            : { ...docFooterHF }}
          labels={{
            title: showHFDialog.target === 'header' ? t('doc.header') : (t('doc.footer') || '页脚'),
            text: t('doc.headerPrompt') || '页眉内容',
            align: t('doc.align') || '对齐',
            fontSize: t('doc.fontSize') || '字号',
            ok: t('doc.paraOk') || '确定', cancel: t('doc.paraCancel') || '取消',
            clear: t('sheet.clearFilter') || '清除',
          }}
          onClose={() => setShowHFDialog(null)}
          onSave={(content) => { applyHF(showHFDialog.target, content); setShowHFDialog(null) }}
        />
      )}
      {showParaDialog && (
        <ParagraphDialog
          value={paraDraft}
          onClose={() => setShowParaDialog(false)}
          onSave={(d) => { applyParagraphFormat(d); setShowParaDialog(false) }}
        />
      )}

      {/* 样式库面板 */}
      {showStyles && (
        <div className="modal-overlay" onMouseDown={() => { setShowStyles(false); setEditingStyle(null) }}>
          <div className="modal styles-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{t('doc.styles')}</span>
              <button className="modal-close" onClick={() => { setShowStyles(false); setEditingStyle(null) }}>×</button>
            </div>
            <div className="styles-toolbar">
              <input className="styles-search" placeholder={t('doc.search') || ''} value={styleSearch} onChange={(e) => setStyleSearch(e.target.value)} />
              <button className="btn btn-outline btn-sm" onClick={createStyleFromSelection}>{t('doc.newStyle')}</button>
            </div>
            <div className="styles-list">
              {allStyles.filter(s => s.name.toLowerCase().includes(styleSearch.toLowerCase())).map((s) => (
                <div key={s.name} className="style-row" onClick={() => applyStyle(s.name)} title={t('doc.applyStyle')}>
                  <div className="style-preview" style={{ fontSize: s.format.fontSize, fontWeight: s.format.bold ? 700 : 400, fontStyle: s.format.italic ? 'italic' : 'normal', color: s.format.color || 'inherit', textAlign: (s.format.align as any) || 'left' }}>
                    {s.name}
                  </div>
                  <div className="style-meta">
                    <div className="style-name">{s.name}{!s.builtin ? ' *' : ''}</div>
                    <div className="style-desc">{styleDesc(s.format)}</div>
                  </div>
                  <button className="style-edit" title={t('doc.editStyle')} onClick={(e) => { e.stopPropagation(); setEditingStyle(s.name) }}>✎</button>
                </div>
              ))}
            </div>
            {editingStyle && (
              <StyleEditor
                name={editingStyle}
                initial={resolveStyle(editingStyle)}
                onCancel={() => setEditingStyle(null)}
                onSave={(fmt) => { updateStyleEverywhere(editingStyle, fmt); setEditingStyle(null) }}
              />
            )}
          </div>
        </div>
      )}

      {/* MS Office 风格打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="word"
        printSelector=".ProseMirror"
        renderPreview={(settings) => (
          <div className="text-xs leading-relaxed" style={{ color: '#000' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>{document.meta?.title || t('app.untitled')}</h1>
            {(document.blocks || []).slice(0, 6).map((b: any, i: number) => (
              <p key={i} style={{ marginBottom: '4px', textIndent: b.inline?.[0]?.content ? '2em' : 0 }}>
                {(b.inline || []).map((r: any) => r.content).join('').slice(0, 80)}
              </p>
            ))}
            <div style={{ marginTop: '12px', fontSize: '10px', color: '#999' }}>- 1 -</div>
          </div>
        )}
      />
      {showMathModal && (
        <MathEditorModal
          initialLatex={mathEdit.latex}
          initialInline={mathEdit.inline}
          initialTab={mathEdit.pos != null ? 'formula' : 'formula'}
          onClose={() => setShowMathModal(false)}
          onInsert={handleMathInsert}
        />
      )}
      {activeTextBox && (
        <TextBoxStylePanel
          node={activeTextBox.node}
          onChange={updateTextBox}
          onClose={() => setActiveTextBox(null)}
        />
      )}

      {/* 文档保护：打开受保护文档时，强制要求输入密码才能编辑 */}
      {showUnlock && (
        <div
          className="modal-overlay"
          style={{ background: 'rgba(15,23,42,0.45)', zIndex: 200 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className="modal"
            style={{ maxWidth: 360 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>🔒 {t('doc.protectUnlockTitle') || '文档受保护'}</span>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
                {t('doc.protectUnlockHint') || '该文档已设置密码保护，请输入密码以解除保护进行编辑。'}
              </p>
              <input
                type="password"
                autoFocus
                value={unlockInput}
                onChange={(e) => { setUnlockInput(e.target.value); setUnlockError(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitUnlock() }}
                placeholder={t('doc.protectEnterPwd') || '输入密码'}
                className="comment-edit-input"
                style={{ width: '100%', fontSize: '13px', borderRadius: '4px', border: `1px solid ${unlockError ? '#ef4444' : 'var(--color-border)'}`, padding: '6px 8px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
              {unlockError && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{t('doc.protectWrongPwd') || '密码错误'}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button className="btn btn-primary btn-sm" onClick={submitUnlock}>{t('doc.protectUnlock') || '解除保护'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
