// 查找替换插件：Ctrl+F 弹出查找栏，高亮所有匹配，支持替换
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
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
// round49：全部函数防御性校验 view —— 调用方误把事件对象/null 当 view 传入时
// （v0.7.29 查找栏 ↑/↓ 按钮 onClick={nextMatch} 把 MouseEvent 当 view），
// searchKey.getState(undefined) 会抛 "Cannot read properties of undefined
// (reading 'search$')" 整页崩掉。这里静默返回，坏调用只无效不致命。
function validView(view: any): boolean {
  return !!(view && view.state && view.state.doc && view.dispatch)
}

export function doSearch(view: any, query: string, caseSensitive: boolean = false) {
  if (!validView(view)) return
  const matches = findMatches(view.state.doc, query, caseSensitive)
  const tr = view.state.tr.setMeta(searchKey, {
    query, replace: '', caseSensitive, matches, activeIndex: matches.length > 0 ? 0 : -1
  })
  view.dispatch(tr)
  if (matches.length > 0) {
    // round50：初始搜索也定位到第一个匹配（同 ↑/↓ 导航语义）
    gotoMatch(view, 0)
  }
}

export function doReplace(view: any, query: string, replace: string, caseSensitive: boolean = false) {
  if (!validView(view)) return
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
  if (!validView(view)) return 0
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

// round50（问题1）：↑/↓ 导航后正文滚动到匹配处。
// 之前 scrollIntoView() 挂在空 tr 上 —— 没有 selection 变化，
// ProseMirror 只会滚到当前光标/视口，选中的匹配高亮可能还在屏幕外。
// 正确做法：把 selection 设到匹配区间（同一 tr 带 scrollIntoView），视图
// 随之滚动到匹配位置；同时 Replace 直接作用于选中的匹配（语义对齐 Word
// 查找栏导航）。
function gotoMatch(view: any, index: number) {
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || !ss.matches.length) return
  const m = ss.matches[index]
  if (!m) return
  view.dispatch(view.state.tr
    .setMeta(searchKey, { ...ss, activeIndex: index })
    .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
    .scrollIntoView())
  // round50 根因修复：PM 的 scrollToSelection 在编辑器失焦时（焦点在查找
  // 输入框 —— domSelectionRange().focusNode 不在 PM dom 内）是空操作
  // （prosemirror-view updateStateInner → scrollToSelection 开头的
  // if (!startDOM || !contains) ; 空语句直接返回）。因此查找导航的
  // scrollIntoView 从未生效 —— ↑/↓ 只改高亮不滚动，用户看不到定位。
  // 这里 dispatch 后手动滚动：coordsAtPos 拿匹配坐标，找最近滚动祖先滚入
  // 视口（60px 边距，与 scrollMargin 语义一致）。不 view.focus() ——
  // 那会抢走查找框焦点（Word 的查找框保持焦点，Enter 继续下一处）。
  try {
    const coords = view.coordsAtPos(m.from, 1)
    let el: HTMLElement | null = view.dom as HTMLElement
    while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement
    if (el && coords) {
      const scTop = el.getBoundingClientRect().top
      const target = coords.top - scTop - Math.max(60, el.clientHeight / 4)
      if (coords.top < scTop + 60 || coords.top > el.getBoundingClientRect().bottom - 60) {
        el.scrollTop = Math.max(0, el.scrollTop + target)
      }
    }
  } catch { /* coordsAtPos 对空文档/异常位置可能抛错，导航不因此中断 */ }
}

export function nextMatch(view: any) {
  if (!validView(view)) return
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || ss.matches.length === 0) return
  gotoMatch(view, (ss.activeIndex + 1) % ss.matches.length)
}

export function prevMatch(view: any) {
  if (!validView(view)) return
  const ss: SearchState = searchKey.getState(view.state)
  if (!ss || ss.matches.length === 0) return
  gotoMatch(view, (ss.activeIndex - 1 + ss.matches.length) % ss.matches.length)
}

export function getSearchState(view: any): SearchState {
  if (!validView(view)) return { query: '', replace: '', caseSensitive: false, matches: [], activeIndex: -1 }
  return searchKey.getState(view.state)
}
