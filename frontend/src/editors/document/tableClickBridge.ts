// round34：表格点击透传桥（重写 round26~33 的代理层）
//
// 背景（r34 全链实验 + round26~33 历史事实）：
// Chromium 合成器 hit-test 会把 .ProseMirror（contenteditable 根）内的
// <table> 子树排除出 input targets（样式剥离/重绘/层扰动/嵌套 editable
// 全部无效，r34_probe7/10/18/25/28 实锤）；同一 DOM 挪到文档流外即恢复
// （r34_probe18/20）。段落等普通块不受影响。headless 与真实 WebView
// 均复现（round26 用户的原始报告）。
// → 必须保留一层挂在 body/host 直属的接收层（合成器对这条路径的
//   hit-test 正常，r34_probe16/17 z=1..10 全活）。
//
// 与旧代理层的架构区别（用户反馈"每次点击刷新整个表格/修修补补没意义"）：
// 1. 零劫持：mousemove/mouseup/mouseleave/click/dblclick 一律不监听、
//    不 preventDefault —— 层上只处理 mousedown（放 caret / 拖选起点 /
//    双击三击判定），其余手势由本层 mousedown 内自建的状态机完成，
//    绝不派发合成事件（合成事件不触发浏览器默认行为，r26 已踩坑）。
// 2. caret 在 mousedown 同步阶段测量（round33 修复：延迟测量会被
//    domObserver→分页重排打偏，r33_diag7 实锤），无 60ms 补刀、
//    无滚动恢复 —— 那些是错位时代的防御 hack，同步测量后不再需要。
// 3. 原生手势对齐（Word 行为）：
//    - 单击：caret 放在所点字符边界（caretRangeFromPoint）
//    - 按住拖动：从 anchor caret 到当前点实时扩选（Selection API）
//    - 双击：选中所点单词（Word 字符级 word boundary）
//    - 三击：选中整个单元格内容
//    - 点击 CellSelection 已选行内：透传给行拖拽（tablePlugins mousedown
//      已处理，本层 mousedown 里 preventDefault 保留选区并启动会话）
// 4. 层本身完全透明（无背景色 —— 旧层 alpha 0.003 是为了 hit-test
//    注册；实测 r34_probe16 无背景层同样可命中，去掉视觉污染源）。

import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/** 桥层管理器：为每个 .tableWrapper 在 pm-host 内维护一个接收层。
 * 返回 cleanup。幂等（同 window 只跑一个实例，StrictMode 双挂载安全）。 */
export function createTableClickBridge(getView: () => EditorView | null): () => void {
  if ((window as any).__samTableBridge) return () => { /* */ }
  ;(window as any).__samTableBridge = true

  const layers = new Map<Element, HTMLElement>()
  let disposed = false
  let syncTimer = 0

  const host = () => (getView()?.dom?.parentElement as HTMLElement) || null

  // ---- 手势状态机（每个 mousedown 会话） ----
  let gesture: {
    anchor: { node: Node; offset: number } | null // mousedown 处 caret（拖选锚点）
    startX: number; startY: number
    moved: boolean
    clickCount: number // 同位置累计点击次数（dblclick 判定）
    lastUp: number
  } | null = null

  const cellAt = (x: number, y: number): HTMLElement | null => {
    // 死区坐标下 elementFromPoint 返回 null/错误元素 —— 几何扫描
    // 全部 wrapper 的 td（与拖拽插件同法，r27 实证可靠）。
    const v = getView()
    if (!v) return null
    let hit: HTMLElement | null = null
    v.dom.querySelectorAll('.tableWrapper table tr').forEach(tr => {
      if (hit) return
      ;(tr as HTMLElement).querySelectorAll('td,th').forEach(td => {
        if (hit) return
        const r = (td as HTMLElement).getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = td as HTMLElement
      })
    })
    return hit
  }

  /** 坐标 → 精确 caret（禁用全部桥层后 caretRangeFromPoint，同步恢复）。 */
  const caretAt = (x: number, y: number): { node: Node; offset: number } | null => {
    const saved: { el: HTMLElement; v: string }[] = []
    try {
      layers.forEach(l => { saved.push({ el: l, v: l.style.pointerEvents }); l.style.pointerEvents = 'none' })
      const cr = (window.document as any).caretRangeFromPoint?.(x, y) as Range | null
      if (cr && cr.startContainer && (cr.startContainer as any).nodeType !== undefined) {
        // 落在 cell 内才有效（防命中表格外元素）
        const el = (cr.startContainer.nodeType === 3 ? cr.startContainer.parentElement : cr.startContainer as HTMLElement)
        if (el?.closest?.('td,th')) return { node: cr.startContainer, offset: cr.startOffset }
      }
      return null
    } catch { return null } finally {
      saved.forEach(s => { s.el.style.pointerEvents = s.v })
    }
  }

  const selectCellAll = (td: HTMLElement) => {
    const range = window.document.createRange()
    range.selectNodeContents(td)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  const onMousedown = (e: MouseEvent) => {
    if (e.button !== 0) { console.error('[bridge] non-left button', e.button); return }
    const v = getView()
    if (!v) { console.error('[bridge] no view'); return }
    const td = cellAt(e.clientX, e.clientY)
    if (!td) { console.error('[bridge] cellAt miss at', e.clientX, e.clientY, 'wrappers=', v.dom.querySelectorAll('.tableWrapper').length); return }

    // 行拖拽协同：CellSelection（整行选中）内按下 → 启动行拖拽会话
    //（与 tablePlugins.ts 的原生 mousedown 同逻辑 —— 但表格死区下
    //  PM 收不到 mousedown，必须在此处理）。
    const curSel = v.state.selection as any
    if (curSel && curSel.$anchorCell && curSel.$headCell) {
      const rowOf = ($cell: any) => {
        try {
          for (let d = $cell.depth; d >= 2; d--) {
            if ($cell.node(d).type.name === 'table_row') {
              const theRow = $cell.node(d)
              let idx = -1
              $cell.node(d - 1).forEach((rw: any, _o: number, i: number) => { if (rw === theRow) idx = i })
              return idx
            }
          }
        } catch { /* */ }
        return -1
      }
      const fromRow = Math.min(rowOf(curSel.$anchorCell), rowOf(curSel.$headCell))
      const toRow = Math.max(rowOf(curSel.$anchorCell), rowOf(curSel.$headCell))
      const table = td.closest('table')
      const trs: HTMLTableRowElement[] = table ? Array.from(table.querySelectorAll('tr')) : []
      const hitRow = trs.indexOf(td.closest('tr') as HTMLTableRowElement)
      if (hitRow >= 0 && fromRow >= 0 && hitRow >= fromRow && hitRow <= toRow) {
        e.preventDefault()
        // 动态 import 会引入异步 —— 直接用全局注册（DocumentEditor 侧注册）
        ;(window as any).__samStartRowDrag?.(v, e.clientX, e.clientY)
        return
      }
    }

    e.preventDefault() // 死区内的点击没有任何默认行为可保留

    // ---- 手势判定 ----
    const now = Date.now()
    if (gesture && now - gesture.lastUp < 500 && Math.abs(e.clientX - gesture.startX) < 5 && Math.abs(e.clientY - gesture.startY) < 5) {
      gesture.clickCount++
    } else {
      gesture = { anchor: null, startX: e.clientX, startY: e.clientY, moved: false, clickCount: 1, lastUp: 0 }
    }
    const g = gesture!

    ;(window as any).__bridgeLog = ((window as any).__bridgeLog || []).concat(['md count=' + g.clickCount + ' td=' + (td.textContent || '').slice(0, 10) + ' xy=' + Math.round(e.clientX) + ',' + Math.round(e.clientY)])
    if (g.clickCount === 3) {
      // 三击：选中整个单元格。PM state 也要同步（focus 的
      // selectionToDOM 会用 state.selection 覆盖 DOM 选区 —— 双击
      // 同款坑，round34）。
      selectCellAll(td)
      g.anchor = null
      try {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const r0 = sel.getRangeAt(0)
          const fromP = v.posAtDOM(r0.startContainer, r0.startOffset)
          const toP = v.posAtDOM(r0.endContainer, r0.endOffset)
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, fromP, toP)).setMeta('scrollIntoView', false))
        }
      } catch { /* 同步失败保留 DOM 选区 */ }
      (v.dom as HTMLElement).focus({ preventScroll: true })
      return
    }

    // 单击/双击的锚点 caret（同步测量 —— round33 关键修复）
    g.anchor = caretAt(e.clientX, e.clientY)
    ;(window as any).__bridgeLog = ((window as any).__bridgeLog || []).concat(['anchor=' + (g.anchor ? (g.anchor.node.textContent || '').slice(0, 10) + '@' + g.anchor.offset : 'null')])

    // 双击：选中所点单词。Range.expand('word') 对中文/数字混排不可靠
    // （r34 实测 "[10 000" 上 expand 保持 collapsed）—— 改用
    // Selection.modify 的 word granularity 双向扩展（Chromium 稳定）。
    if (g.clickCount === 2 && g.anchor) {
      const sel = window.getSelection()
      try {
        const range = window.document.createRange()
        range.setStart(g.anchor.node, g.anchor.offset)
        range.collapse(true)
        sel?.removeAllRanges()
        sel?.addRange(range)
        ;(sel as any).modify?.('extend', 'backward', 'word')
        ;(sel as any).modify?.('extend', 'forward', 'word')
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
          // PM 的 selectionToDOM 会在 focus 后用 state.selection 覆盖
          // DOM 选区 —— 必须把词选区同步进 PM state（round34：双击
          // 选词被 focus 清空的根因）。
          try {
            const r0 = sel.getRangeAt(0)
            const fromP = v.posAtDOM(r0.startContainer, r0.startOffset)
            const toP = v.posAtDOM(r0.endContainer, r0.endOffset)
            v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, fromP, toP)).setMeta('scrollIntoView', false))
          } catch { /* 同步失败保留 DOM 选区 */ }
          (v.dom as HTMLElement).focus({ preventScroll: true })
          return
        }
      } catch { /* modify 失败走单击路径 */ }
    }

    // 单击：放置 caret（PM selection + DOM selection 同步 —— PM 输入
    // 管线依赖两套 selection 一致，round26_last/Q5A1 实证）。
    // 顺序关键（round34 时间线实锤）：focus() 若在 selection 设置之后，
    // Chromium 会在 focus 归位时把 caret 重放到编辑器末尾（9615）；
    // 必须先 focus（清掉旧焦点状态），再放 DOM selection，再同步 PM。
    if (g.anchor) {
      (v.dom as HTMLElement).focus({ preventScroll: true })
      try {
        const pmPos = v.posAtDOM(g.anchor.node, g.anchor.offset)
        if (pmPos >= 0) {
          // 禁止 PM 自动 scrollIntoView（round34：点击后 wrapper 被滚到
          // 视口顶 y=0，后续点击全部错位 —— 用户「点击像刷新」的观感来源）。
          // 点击的 caret 本来就在视口内，无需滚动。
          v.dispatch(v.state.tr.setSelection((v.state.selection as any).constructor.near(v.state.doc.resolve(Math.min(pmPos, v.state.doc.content.size)), 1)).setMeta('scrollIntoView', false))
        }
      } catch { /* PM 同步失败不阻塞 DOM caret */ }
      const range = window.document.createRange()
      range.setStart(g.anchor.node, g.anchor.offset)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    } else {
      // caret 测量失败（点击空白 padding）：caret 放 cell 首文本
      const firstText = (function findText(el: Node): Text | null {
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === 3) return n as Text
          const r = findText(n); if (r) return r
        }
        return null
      })(td)
      if (firstText) {
        (v.dom as HTMLElement).focus({ preventScroll: true })
        try {
          const pmPos = v.posAtDOM(firstText, 0)
          if (pmPos >= 0) v.dispatch(v.state.tr.setSelection((v.state.selection as any).constructor.near(v.state.doc.resolve(pmPos), 1)).setMeta('scrollIntoView', false))
        } catch { /* */ }
        const range = window.document.createRange()
        range.setStart(firstText, 0)
        range.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  // 拖选：mousedown 后 move —— 从 anchor 到当前点扩选
  const onMousemove = (e: MouseEvent) => {
    if (!gesture || !gesture.anchor || !gesture.moved) return
    const v = getView()
    if (!v) return
    const caret = caretAt(e.clientX, e.clientY)
    if (!caret) return
    try {
      const sel = window.getSelection()
      if (sel) sel.setBaseAndExtent(gesture.anchor.node, gesture.anchor.offset, caret.node, caret.offset)
    } catch { /* */ }
  }

  const onMouseup = (e: MouseEvent) => {
    if (!gesture) return
    gesture.lastUp = Date.now()
    // 关键（round34 时间线实锤 t0+90ms selection 被打到文档末尾）：
    // mousedown preventDefault 不能阻止 Chromium 在 mouseup 阶段
    // 重新执行默认 caret 放置（放置到 contenteditable 末尾 —— 
    // 因为死区坐标在浏览器看来"没有有效 target"）。mouseup 也必须
    // preventDefault，mousedown 里放好的 caret 才能存活。
    // 旧代理层的 60ms 补刀就是在对抗这个 —— 从根上阻止即可。
    e.preventDefault()
  }

  // move 超过阈值才进入拖选（避免手抖把单击变拖选）
  const onMousemoveArm = (e: MouseEvent) => {
    if (!gesture || !gesture.anchor) return
    if (!gesture.moved) {
      if (Math.abs(e.clientX - gesture.startX) < 4 && Math.abs(e.clientY - gesture.startY) < 4) return
      gesture.moved = true
    }
    onMousemove(e)
  }

  ;(window as any).__samBridgeAlive = () => ({ disposed, listeners: 3, layers: layers.size })
  // click 的默认行为独立于 mouseup（round34 时间线：mouseup preventDefault
  // 后 t+120ms selection 仍被归位到文档末尾 —— click 默认 caret 放置）。
  // 桥手势期间 click 一律 preventDefault（不阻止冒泡，UI 外部监听不受影响）。
  const onClick = (e: MouseEvent) => { if (gesture) e.preventDefault() }
  window.document.addEventListener('mousedown', onMousedown, true)
  window.document.addEventListener('mousemove', onMousemoveArm, true)
  window.document.addEventListener('mouseup', onMouseup, true)
  window.document.addEventListener('click', onClick, true)

  // ---- 层生命周期 ----
  const ensureLayer = (wrapper: HTMLElement) => {
    if (disposed || layers.has(wrapper)) return
    const h = host()
    if (!h || !wrapper.isConnected) return
    const layer = window.document.createElement('div')
    layer.className = 'pm-table-clickbridge'
    layer.style.cssText = 'position:absolute;z-index:7;pointer-events:auto'
    layers.set(wrapper, layer)
    h.appendChild(layer)
    syncOne(wrapper, layer)
  }

  const syncOne = (wrapper: Element, layer: HTMLElement) => {
    const h = layer.parentElement
    if (!h || !wrapper.isConnected) { layer.remove(); return }
    const wr = (wrapper as HTMLElement).getBoundingClientRect()
    const hr = h.getBoundingClientRect()
    if (wr.width < 2 || wr.height < 2) { layer.style.display = 'none'; return }
    layer.style.display = 'block'
    layer.style.left = (wr.left - hr.left) + 'px'
    layer.style.top = (wr.top - hr.top) + 'px'
    layer.style.width = wr.width + 'px'
    layer.style.height = wr.height + 'px'
  }

  const scheduleSync = () => {
    if (syncTimer || disposed) return
    syncTimer = window.setTimeout(() => {
      syncTimer = 0
      const run = () => {
        const v = getView()
        const pm = v?.dom
        if (!pm) return
        pm.querySelectorAll('.tableWrapper').forEach(w => {
          if (!layers.has(w)) ensureLayer(w as HTMLElement)
          const layer = layers.get(w)
          if (layer) syncOne(w, layer)
        })
        for (const [w, layer] of [...layers]) {
          if (!w.isConnected) { layer.remove(); layers.delete(w) }
        }
      }
      // 建层/写几何走 MessageChannel 任务（r27_t16：effect 闭包内
      // setTimeout 建层进死名单；Channel 任务建的层全活）
      try {
        const ch = new MessageChannel()
        ch.port1.onmessage = () => { try { ch.port1.close() } catch { /* */ } run() }
        ch.port2.postMessage('go')
      } catch { run() }
    }, 120)
  }

  // 初始多波次（覆盖文档打开后的异步渲染/分页重排）
  const viaChannel = (fn: () => void, delay: number) => {
    window.setTimeout(() => {
      if (disposed) return
      try {
        const ch = new MessageChannel()
        ch.port1.onmessage = () => { try { ch.port1.close() } catch { /* */ } fn() }
        ch.port2.postMessage('go')
      } catch { fn() }
    }, delay)
  }
  for (const d of [400, 1500, 3500, 7000]) viaChannel(scheduleSync, d)

  // 持续维护：DOM 变化（分页 margin/行高列宽/文档切换）+ 滚动 + resize
  const v0 = getView()
  const mo = new MutationObserver(scheduleSync)
  if (v0?.dom) mo.observe(v0.dom as Node, { childList: true, subtree: true })
  const scroller = (v0?.dom as HTMLElement)?.closest('.overflow-auto')
  scroller?.addEventListener('scroll', scheduleSync, { passive: true })
  window.addEventListener('resize', scheduleSync, { passive: true })

  return () => {
    disposed = true
    ;(window as any).__samTableBridge = false
    mo.disconnect()
    scroller?.removeEventListener('scroll', scheduleSync)
    window.removeEventListener('resize', scheduleSync)
    window.document.removeEventListener('mousedown', onMousedown, true)
  window.document.removeEventListener('click', onClick, true)
    window.document.removeEventListener('mousemove', onMousemoveArm, true)
    window.document.removeEventListener('mouseup', onMouseup, true)
    if (syncTimer) window.clearTimeout(syncTimer)
    layers.forEach(l => l.remove())
    layers.clear()
  }
}
