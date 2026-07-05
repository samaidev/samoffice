import { useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import { spellCheckPlugin, setSpellErrors } from './spellPlugin'
import type { Document, SpellError } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
}

// 字体列表
const FONTS = [
  { name: '默认', value: '' },
  { name: '宋体', value: '"Noto Serif SC", "SimSun", serif' },
  { name: '黑体', value: '"Noto Sans SC", "SimHei", sans-serif' },
  { name: '楷体', value: '"LXGW WenKai", "KaiTi", cursive' },
  { name: '等宽', value: '"Liberation Mono", "Consolas", monospace' },
]

// 字号列表
const FONT_SIZES = [
  { name: '小', value: '12px' },
  { name: '正文', value: '15px' },
  { name: '中', value: '18px' },
  { name: '大', value: '24px' },
  { name: '标题', value: '32px' },
]

// 行距列表
const LINE_HEIGHTS = [
  { name: '1.0', value: '1.0' },
  { name: '1.5', value: '1.5' },
  { name: '1.75', value: '1.75' },
  { name: '2.0', value: '2.0' },
]

// 颜色列表
const COLORS = [
  '#000000', '#374151', '#6B7280', '#9CA3AF',
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#6366F1', '#8B5CF6', '#EC4899', '#6B7280',
]

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set())
  const [activeAttrs, setActiveAttrs] = useState<{align?: string, lineHeight?: string, indent?: number}>({})
  const [activeFont, setActiveFont] = useState('')
  const [activeFontSize, setActiveFontSize] = useState('')
  const [activeColor, setActiveColor] = useState('')
  const [, setTick] = useState(0)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!editorRef.current) return
    const doc = udmToProseMirror(document, schema)

    const state = EditorState.create({
      doc,
      plugins: [
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
          'Mod-b': toggleMark(schema.marks.bold),
          'Mod-i': toggleMark(schema.marks.italic),
          'Mod-u': toggleMark(schema.marks.underline),
        }),
        keymap(baseKeymap),
        history(),
        inputRules({
          rules: [
            textblockTypeInputRule(/^#\s$/, schema.nodes.heading, () => ({ level: 1 })),
            textblockTypeInputRule(/^##\s$/, schema.nodes.heading, () => ({ level: 2 })),
            textblockTypeInputRule(/^###\s$/, schema.nodes.heading, () => ({ level: 3 })),
            new InputRule(/\*\*([^*]+)\*\*$/, (state, match, start, end) => {
              const tr = state.tr.deleteRange(start, end)
              const text = schema.text(match[1], [schema.marks.bold.create()])
              return tr.insert(start, text)
            }),
            new InputRule(/\*([^*]+)\*$/, (state, match, start, end) => {
              const tr = state.tr.deleteRange(start, end)
              const text = schema.text(match[1], [schema.marks.italic.create()])
              return tr.insert(start, text)
            }),
            new InputRule(/`([^`]+)`$/, (state, match, start, end) => {
              const tr = state.tr.deleteRange(start, end)
              const text = schema.text(match[1], [schema.marks.code.create()])
              return tr.insert(start, text)
            }),
            wrappingInputRule(/^\s*-\s$/, schema.nodes.bullet_list),
            wrappingInputRule(/^\s*\d+\.\s$/, schema.nodes.ordered_list),
            wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
            textblockTypeInputRule(/^```\s$/, schema.nodes.code_block),
          ]
        }),
        spellCheckPlugin()
      ]
    })

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (onChangeRef.current) {
          onChangeRef.current(proseMirrorToUDM(newState.doc))
        }
        if (onSpellCheckRef.current) {
          onSpellCheckRef.current(newState.doc.textContent)
        }
        updateActiveState(newState)
      },
      handleDOMEvents: {
        focus: () => { setFocused(true); return false },
        blur: () => { setFocused(false); return false },
      }
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: {align?: string, lineHeight?: string, indent?: number} = {}

    // 段落属性
    if ($from.parent.type.name === 'paragraph') {
      if ($from.parent.attrs.align) attrs.align = $from.parent.attrs.align
      if ($from.parent.attrs.lineHeight) attrs.lineHeight = $from.parent.attrs.lineHeight
      if ($from.parent.attrs.indent > 0) attrs.indent = $from.parent.attrs.indent
    }

    // Marks
    let curFont = '', curSize = '', curColor = ''
    if (empty) {
      state.storedMarks?.forEach(m => {
        marks.add(m.type.name)
        if (m.type.name === 'fontFamily') curFont = (m.attrs as any).font
        if (m.type.name === 'fontSize') curSize = (m.attrs as any).size
        if (m.type.name === 'textColor') curColor = (m.attrs as any).color
      })
      $from.marks().forEach(m => {
        marks.add(m.type.name)
        if (m.type.name === 'fontFamily') curFont = (m.attrs as any).font
        if (m.type.name === 'fontSize') curSize = (m.attrs as any).size
        if (m.type.name === 'textColor') curColor = (m.attrs as any).color
      })
    } else {
      state.doc.nodesBetween(from, to, (node) => {
        node.marks.forEach(m => {
          marks.add(m.type.name)
          if (m.type.name === 'fontFamily') curFont = (m.attrs as any).font
          if (m.type.name === 'fontSize') curSize = (m.attrs as any).size
          if (m.type.name === 'textColor') curColor = (m.attrs as any).color
        })
      })
    }

    if ($from.parent.type.name === 'heading') {
      marks.add(`heading-${$from.parent.attrs.level}`)
    }

    setActiveMarks(marks)
    setActiveAttrs(attrs)
    setActiveFont(curFont)
    setActiveFontSize(curSize)
    setActiveColor(curColor)
    setTick(t => t + 1)
  }

  // 文本命令
  const execCommand = (cmd: string) => {
    const view = viewRef.current
    if (!view) return
    switch (cmd) {
      case 'bold': toggleMark(schema.marks.bold)(view.state, view.dispatch); break
      case 'italic': toggleMark(schema.marks.italic)(view.state, view.dispatch); break
      case 'underline': toggleMark(schema.marks.underline)(view.state, view.dispatch); break
      case 'strikethrough': toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); break
      case 'code': toggleMark(schema.marks.code)(view.state, view.dispatch); break
      case 'h1': setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch); break
      case 'h2': setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch); break
      case 'h3': setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch); break
      case 'paragraph': setBlockType(schema.nodes.paragraph)(view.state, view.dispatch); break
      case 'bulletList': wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch); break
      case 'orderedList': wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch); break
      case 'quote': wrapIn(schema.nodes.blockquote)(view.state, view.dispatch); break
      case 'codeBlock': setBlockType(schema.nodes.code_block)(view.state, view.dispatch); break
      case 'undo': undo(view.state, view.dispatch); break
      case 'redo': redo(view.state, view.dispatch); break
    }
    view.focus()
  }

  // 段落属性命令
  const setParagraphAttr = (attr: string, value: any) => {
    const view = viewRef.current
    if (!view) return
    const { $from } = view.state.selection
    if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') return
    const tr = view.state.tr.setNodeMarkup($from.before(), undefined, {
      ...$from.parent.attrs,
      [attr]: value,
    })
    view.dispatch(tr)
    view.focus()
  }

  // 字体命令
  const setFont = (font: string) => {
    const view = viewRef.current
    if (!view) return
    if (font) {
      toggleMark(schema.marks.fontFamily, { font })(view.state, view.dispatch)
    } else {
      // 清除字体
      const tr = view.state.tr.removeMark(view.state.selection.from, view.state.selection.to, schema.marks.fontFamily)
      view.dispatch(tr)
    }
    view.focus()
  }

  const setFontSize = (size: string) => {
    const view = viewRef.current
    if (!view) return
    toggleMark(schema.marks.fontSize, { size })(view.state, view.dispatch)
    view.focus()
  }

  const setTextColor = (color: string) => {
    const view = viewRef.current
    if (!view) return
    toggleMark(schema.marks.textColor, { color })(view.state, view.dispatch)
    view.focus()
  }

  const setHighlight = (color: string) => {
    const view = viewRef.current
    if (!view) return
    toggleMark(schema.marks.highlight, { color })(view.state, view.dispatch)
    view.focus()
  }

  const Btn = ({ cmd, icon, title, active, group }: {
    cmd: string, icon: React.ReactNode, title: string, active?: boolean, group?: boolean
  }) => (
    <>
      <button onClick={() => execCommand(cmd)} className={`toolbar-btn ${active ? 'active' : ''}`} title={title} type="button">{icon}</button>
      {group && <div className="toolbar-divider" />}
    </>
  )

  useEffect(() => {
    if (viewRef.current) {
      const view = viewRef.current
      const tr = setSpellErrors(view.state.tr, spellErrors)
      view.dispatch(tr)
      view.updateState(view.state)
      setTick((t) => t + 1)
    }
  }, [spellErrors])

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏第一行：字体/字号/颜色/排版 */}
      <div
        className="px-2 py-1 flex items-center gap-1 flex-wrap flex-shrink-0"
        style={{
          background: focused ? 'var(--color-surface)' : 'var(--color-surface-alt)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* 字体选择 */}
        <select
          value={activeFont}
          onChange={(e) => setFont(e.target.value)}
          className="text-xs rounded px-1 py-0.5"
          style={{ width: '90px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          title="字体"
        >
          {FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}
        </select>

        {/* 字号选择 */}
        <select
          value={activeFontSize}
          onChange={(e) => setFontSize(e.target.value)}
          className="text-xs rounded px-1 py-0.5"
          style={{ width: '60px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          title="字号"
        >
          <option value="">默认</option>
          {FONT_SIZES.map(s => <option key={s.value} value={s.value}>{s.name}</option>)}
        </select>

        {/* 文字颜色 */}
        <div className="relative group">
          <button
            className="toolbar-btn"
            title="文字颜色"
            type="button"
            style={{ borderBottom: `3px solid ${activeColor || '#333'}` }}
          >A</button>
          <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-6 gap-1">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  className="w-5 h-5 rounded border"
                  style={{ background: c, border: '1px solid var(--color-border)' }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>

        {/* 高亮颜色 */}
        <div className="relative group">
          <button
            className="toolbar-btn"
            title="高亮"
            type="button"
            style={{ background: 'linear-gradient(180deg, transparent 60%, #fef08a 60%)' }}
          >H</button>
          <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-6 gap-1">
              {['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff'].map(c => (
                <button
                  key={c}
                  onClick={() => setHighlight(c)}
                  className="w-5 h-5 rounded border"
                  style={{ background: c, border: '1px solid var(--color-border)' }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* 对齐 */}
        <button onClick={() => setParagraphAttr('align', 'left')} className={`toolbar-btn ${activeAttrs.align === 'left' ? 'active' : ''}`} title="左对齐" type="button">⬅</button>
        <button onClick={() => setParagraphAttr('align', 'center')} className={`toolbar-btn ${activeAttrs.align === 'center' ? 'active' : ''}`} title="居中" type="button">⬌</button>
        <button onClick={() => setParagraphAttr('align', 'right')} className={`toolbar-btn ${activeAttrs.align === 'right' ? 'active' : ''}`} title="右对齐" type="button">➡</button>
        <button onClick={() => setParagraphAttr('align', 'justify')} className={`toolbar-btn ${activeAttrs.align === 'justify' ? 'active' : ''}`} title="两端对齐" type="button">☰</button>

        <div className="toolbar-divider" />

        {/* 行距 */}
        <select
          value={activeAttrs.lineHeight || ''}
          onChange={(e) => setParagraphAttr('lineHeight', e.target.value)}
          className="text-xs rounded px-1 py-0.5"
          style={{ width: '55px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          title="行距"
        >
          <option value="">行距</option>
          {LINE_HEIGHTS.map(l => <option key={l.value} value={l.value}>{l.name}</option>)}
        </select>

        {/* 缩进 */}
        <button onClick={() => setParagraphAttr('indent', Math.min(8, (activeAttrs.indent || 0) + 1))} className="toolbar-btn" title="增加缩进" type="button">→|</button>
        <button onClick={() => setParagraphAttr('indent', Math.max(0, (activeAttrs.indent || 0) - 1))} className="toolbar-btn" title="减少缩进" type="button">|←</button>
      </div>

      {/* 工具栏第二行：段落类型/样式/列表 */}
      <div
        className="px-2 py-1 flex items-center gap-0.5 flex-wrap flex-shrink-0 sticky top-0 z-10"
        style={{
          background: focused ? 'var(--color-surface)' : 'var(--color-surface-alt)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: focused ? 'var(--shadow-sm)' : 'none'
        }}
      >
        <Btn cmd="undo" icon={<span style={{fontSize: '15px'}}>↶</span>} title="撤销 (Ctrl+Z)" group />
        <Btn cmd="redo" icon={<span style={{fontSize: '15px'}}>↷</span>} title="重做 (Ctrl+Y)" group />

        <Btn cmd="paragraph" icon={<span style={{fontSize: '11px', fontWeight: 700}}>¶</span>} title="正文段落" active={activeMarks.size === 0 || (activeMarks.size === 1 && !Array.from(activeMarks).some(m => m.startsWith('heading')))} />
        <Btn cmd="h1" icon={<span style={{fontSize: '12px', fontWeight: 700}}>H1</span>} title="一级标题" active={activeMarks.has('heading-1')} />
        <Btn cmd="h2" icon={<span style={{fontSize: '11px', fontWeight: 700}}>H2</span>} title="二级标题" active={activeMarks.has('heading-2')} />
        <Btn cmd="h3" icon={<span style={{fontSize: '10px', fontWeight: 700}}>H3</span>} title="三级标题" active={activeMarks.has('heading-3')} group />

        <Btn cmd="bold" icon={<strong style={{fontSize: '13px'}}>B</strong>} title="加粗 (Ctrl+B)" active={activeMarks.has('bold')} />
        <Btn cmd="italic" icon={<em style={{fontSize: '13px'}}>I</em>} title="斜体 (Ctrl+I)" active={activeMarks.has('italic')} />
        <Btn cmd="underline" icon={<u style={{fontSize: '13px'}}>U</u>} title="下划线 (Ctrl+U)" active={activeMarks.has('underline')} />
        <Btn cmd="strikethrough" icon={<s style={{fontSize: '13px'}}>S</s>} title="删除线" active={activeMarks.has('strikethrough')} />
        <Btn cmd="code" icon={<span style={{fontSize: '10px', fontFamily: 'monospace'}}>{'</>'}</span>} title="行内代码" active={activeMarks.has('code')} group />

        <Btn cmd="bulletList" icon={<span style={{fontSize: '14px'}}>•</span>} title="无序列表" />
        <Btn cmd="orderedList" icon={<span style={{fontSize: '11px', fontWeight: 700}}>1.</span>} title="有序列表" />
        <Btn cmd="quote" icon={<span style={{fontSize: '14px'}}>❝</span>} title="引用" />
        <Btn cmd="codeBlock" icon={<span style={{fontSize: '10px', fontFamily: 'monospace'}}>{'{}'}</span>} title="代码块" />
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-auto" ref={editorRef as any} />
    </div>
  )
}
