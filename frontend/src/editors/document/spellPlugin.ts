import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { SpellError } from '../../types/udm'

const spellKey = new PluginKey<DecorationSet>('spellCheck')

// spellCheckPlugin: 用 plugin state 存错误列表，state 变化时重新计算装饰
export function spellCheckPlugin() {
  return new Plugin<DecorationSet>({
    key: spellKey,
    state: {
      init() {
        return DecorationSet.empty
      },
      apply(tr, oldState) {
        const meta = tr.getMeta(spellKey)
        if (meta !== undefined) {
          const decos = buildDecorations(tr.doc, meta)
          return decos
        }
        if (tr.docChanged) {
          return DecorationSet.empty
        }
        return oldState
      }
    },
    props: {
      decorations(state) {
        return spellKey.getState(state)
      }
    }
  })
}

// buildDecorations 根据错误列表在文档中查找并构建装饰
function buildDecorations(doc: any, errors: SpellError[]): DecorationSet {
  if (!errors || errors.length === 0) {
    return DecorationSet.empty
  }

  const decorations: Decoration[] = []
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return
    const text = node.text
    for (const err of errors) {
      if (!err.word) continue
      let idx = 0
      while (true) {
        const found = text.toLowerCase().indexOf(err.word.toLowerCase(), idx)
        if (found < 0) break
        const from = pos + found
        const to = from + err.word.length
        decorations.push(
          Decoration.inline(from, to, {
            class: 'spell-error',
            'data-suggest': err.suggest?.slice(0, 5).join(',') || '',
            title: `建议: ${err.suggest?.slice(0, 3).join(', ') || '无'}`
          })
        )
        idx = found + err.word.length
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

// setSpellErrors 通过 transaction meta 触发装饰更新
export function setSpellErrors(tr: any, errors: SpellError[]) {
  return tr.setMeta(spellKey, errors)
}
