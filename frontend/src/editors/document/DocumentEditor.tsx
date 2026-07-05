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

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const errorsRef = useRef<SpellError[]>(spellErrors)
  errorsRef.current = spellErrors

  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set())
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
        updateActiveMarks(newState)
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

  const updateActiveMarks = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    if (empty) {
      state.storedMarks?.forEach(m => marks.add(m.type.name))
      $from.marks().forEach(m => marks.add(m.type.name))
    } else {
      state.doc.nodesBetween(from, to, (node) => {
        node.marks.forEach(m => marks.add(m.type.name))
      })
    }
    if ($from.parent.type.name === 'heading') {
      marks.add(`heading-${$from.parent.attrs.level}`)
    }
    setActiveMarks(marks)
    setTick(t => t + 1)
  }

  const execCommand = (cmd: 'bold' | 'italic' | 'underline' | 'code' | 'h1' | 'h2' | 'h3' | 'paragraph' | 'bulletList' | 'orderedList' | 'quote' | 'codeBlock' | 'undo' | 'redo') => {
    const view = viewRef.current
    if (!view) return
    switch (cmd) {
      case 'bold': toggleMark(schema.marks.bold)(view.state, view.dispatch); break
      case 'italic': toggleMark(schema.marks.italic)(view.state, view.dispatch); break
      case 'underline': toggleMark(schema.marks.underline)(view.state, view.dispatch); break
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

  const Btn = ({ cmd, icon, title, active, group }: {
    cmd: Parameters<typeof execCommand>[0],
    icon: React.ReactNode,
    title: string,
    active?: boolean,
    group?: boolean
  }) => (
    <>
      <button
        onClick={() => execCommand(cmd)}
        className={`toolbar-btn ${active ? 'active' : ''}`}
        title={title}
        type="button"
      >{icon}</button>
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
      {/* 工具栏 */}
      <div
        className="px-2 sm:px-4 py-1.5 flex items-center gap-0.5 flex-wrap flex-shrink-0 sticky top-0 z-10 transition-shadow"
        style={{
          background: focused ? 'var(--color-surface)' : 'var(--color-surface-alt)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: focused ? 'var(--shadow-sm)' : 'none'
        }}
      >
        {/* 撤销重做 */}
        <Btn cmd="undo" icon={<span style={{fontSize: '15px'}}>↶</span>} title="撤销 (Ctrl+Z)" group />
        <Btn cmd="redo" icon={<span style={{fontSize: '15px'}}>↷</span>} title="重做 (Ctrl+Y)" group />

        {/* 段落类型 */}
        <Btn cmd="paragraph" icon={<span style={{fontSize: '11px', fontWeight: 700}}>¶</span>} title="正文段落" active={activeMarks.size === 0 || (activeMarks.size === 1 && !Array.from(activeMarks).some(m => m.startsWith('heading')))} />
        <Btn cmd="h1" icon={<span style={{fontSize: '12px', fontWeight: 700}}>H1</span>} title="一级标题" active={activeMarks.has('heading-1')} />
        <Btn cmd="h2" icon={<span style={{fontSize: '11px', fontWeight: 700}}>H2</span>} title="二级标题" active={activeMarks.has('heading-2')} />
        <Btn cmd="h3" icon={<span style={{fontSize: '10px', fontWeight: 700}}>H3</span>} title="三级标题" active={activeMarks.has('heading-3')} group />

        {/* 文本样式 */}
        <Btn cmd="bold" icon={<strong style={{fontSize: '13px'}}>B</strong>} title="加粗 (Ctrl+B)" active={activeMarks.has('bold')} />
        <Btn cmd="italic" icon={<em style={{fontSize: '13px'}}>I</em>} title="斜体 (Ctrl+I)" active={activeMarks.has('italic')} />
        <Btn cmd="underline" icon={<u style={{fontSize: '13px'}}>U</u>} title="下划线 (Ctrl+U)" active={activeMarks.has('underline')} />
        <Btn cmd="code" icon={<span style={{fontSize: '10px', fontFamily: 'monospace'}}>{'</>'}</span>} title="行内代码" active={activeMarks.has('code')} group />

        {/* 列表 */}
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
