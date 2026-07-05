import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { SpellError } from '../../types/udm'

const spellKey = new PluginKey<DecorationSet>('spellCheck')

// spellCheckPlugin: 接收外部传入的拼写错误列表，在编辑器中渲染装饰
// 错误词用红色波浪线标记，点击可触发建议
export function spellCheckPlugin(getErrors: () => SpellError[]) {
  return new Plugin<DecorationSet>({
    key: spellKey,
    state: {
      init() {
        return DecorationSet.empty
      },
      apply(tr, oldState) {
        // 如果是文档变更，清除旧装饰（外部会重新触发检查）
        if (tr.docChanged) {
          return DecorationSet.empty
        }
        return oldState
      }
    },
    props: {
      decorations(state) {
        const errors = getErrors()
        if (!errors || errors.length === 0) {
          return DecorationSet.empty
        }

        const decorations: Decoration[] = []
        // 遍历文档，找到所有文本节点，匹配错误词
        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return
          const text = node.text
          for (const err of errors) {
            if (!err.word) continue
            // 在文本中查找错误词的所有出现位置
            let idx = 0
            while (true) {
              const found = text.indexOf(err.word, idx)
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

        return DecorationSet.create(state.doc, decorations)
      }
    }
  })
}

// 更新装饰的外部入口（通过 transaction meta 触发）
export function setSpellErrors(tr: any, _errors: SpellError[]) {
  // 装饰通过 props.decorations 动态计算，不需要 meta
  return tr
}
