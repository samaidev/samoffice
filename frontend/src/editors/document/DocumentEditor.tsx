import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import type { Document } from '../../types/udm'

interface Props {
  document: Document
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
}

export function DocumentEditor({ document, onChange, onSpellCheck }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  useEffect(() => {
    if (!editorRef.current) return
    const doc = udmToProseMirror(document, schema)

    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
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
        })
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
      }
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={editorRef} className="prose-mirror-editor" />
}
