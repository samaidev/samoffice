// 查找替换插件：Ctrl+F 弹出查找栏，高亮所有匹配，支持替换
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const searchKey = new PluginKey('search')

interface SearchState {
  query: string
  replace: string
  caseSensitive: boolean
  matches: { from: number; to: number }[]
  activeIndex: number
}

export function searchPlugin() {
  return new Plugin({
    key: searchKey,
    state: {
      init(): SearchState {
        return { query: '', replace: '', caseSensitive: false, matches: [], activeIndex: -1 }
      },
      apply(tr, old: SearchState) {
        const meta = tr.getMeta(searchKey)
        if (meta) return meta
        if (tr.docChanged && old.query) {
          // 文档变化后重新搜索
          return { ...old, matches: findMatches(tr.doc, old.query, old.caseSensitive), activeIndex: -1 }
        }
        return old
      }
    },
    props: {
      decorations(state) {
        const ss: SearchState = searchKey.getState(state)
        if (!ss || !ss.query || ss.matches.length === 0) return null
        const decos: Decoration[] = ss.matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class: i === ss.activeIndex ? 'search-match-active' : 'search-match',
            style: i === ss.activeIndex
              ? 'background: #f59e0b; color: white'
              : 'background: #fef08a'
          })
        )
        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}

function findMatches(doc: any, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!query) return []
  const matches: { from: number; to: number }[] = []
  const q = caseSensitive ? query : query.toLowerCase()
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return
    const text = caseSensitive ? node.text : node.text.toLowerCase()
    let idx = 0
    while ((idx = text.indexOf(q, idx)) >= 0) {
      matches.push({ from: pos + idx, to: pos + idx + q.length })
      idx += q.length
    }
  })
  return matches
}

export function setSearch(tr: any, state: Partial<SearchState>) {
  const old: SearchState = searchKey.getState(tr.startState || tr.doc) || {}
  return tr.setMeta(searchKey, { ...old, ...state })
}

// 便捷方法
export function doSearch(view: any, query: string, caseSensitive: boolean = false) {
  const matches = findMatches(view.state.doc, query, caseSensitive)
  const tr = view.state.tr.setMeta(searchKey, {
    query, replace: '', caseSensitive, matches, activeIndex: matches.length > 0 ? 0 : -1
  })
  view.dispatch(tr)
  if (matches.length > 0) {
    view.dispatch(view.state.tr.scrollIntoView())
  }
}

export function doReplace(view: any, query: string, replace: string, caseSensitive: boolean = false) {
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || ss.matches.length === 0) return
  const m = ss.matches[ss.activeIndex >= 0 ? ss.activeIndex : 0]
  if (!m) return
  const tr = view.state.tr.replaceWith(m.from, m.to, view.state.schema.text(replace))
  // 重新搜索
  const newMatches = findMatches(tr.doc, query, caseSensitive)
  tr.setMeta(searchKey, {
    query, replace, caseSensitive, matches: newMatches,
    activeIndex: newMatches.length > 0 ? 0 : -1
  })
  view.dispatch(tr)
  view.focus()
}

export function doReplaceAll(view: any, query: string, replace: string, caseSensitive: boolean = false): number {
  const matches = findMatches(view.state.doc, query, caseSensitive)
  if (matches.length === 0) return 0
  // 从后往前替换，避免位置偏移
  let tr = view.state.tr
  for (let i = matches.length - 1; i >= 0; i--) {
    tr = tr.replaceWith(matches[i].from, matches[i].to, view.state.schema.text(replace))
  }
  tr.setMeta(searchKey, {
    query: '', replace: '', caseSensitive, matches: [], activeIndex: -1
  })
  view.dispatch(tr)
  view.focus()
  return matches.length
}

export function nextMatch(view: any) {
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || ss.matches.length === 0) return
  const next = (ss.activeIndex + 1) % ss.matches.length
  const m = ss.matches[next]
  view.dispatch(view.state.tr.setMeta(searchKey, { ...ss, activeIndex: next }))
  view.dispatch(view.state.tr.scrollIntoView())
}

export function prevMatch(view: any) {
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || ss.matches.length === 0) return
  const prev = (ss.activeIndex - 1 + ss.matches.length) % ss.matches.length
  view.dispatch(view.state.tr.setMeta(searchKey, { ...ss, activeIndex: prev }))
  view.dispatch(view.state.tr.scrollIntoView())
}

export function getSearchState(view: any): SearchState {
  return searchKey.getState(view.state)
}
