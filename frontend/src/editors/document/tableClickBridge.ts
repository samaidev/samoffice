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
import { CellSelection, cellAround, inSameTable, tableEditingKey } from 'prosemirror-tables'

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
  // round37：跨格拖选不再手写 domCellPos 坐标运算，改为移植开源引擎
  // prosemirror-tables 的 handleMouseDown$1（dist 2203 行）同款算法：
  // anchor 存 cell 的 $resolved pos（cellAround 解析），mousemove 里
  // cellUnderMouse→posAtCoords 重新解析目标格，inSameTable 校验，
  // CellSelection 直接构造 —— 与 TipTap/Atlassian 编辑器逐字节同源。
  // （r36 手写算法实测可用，但 corner-case 全靠人肉枚举；引擎算法
  // 经过了上游全部测试集。）
  // 格内文字拖选仍走 round36 的 PM pos 方案（引擎的文本选区依赖
  // 浏览器原生 drag-select —— 死区下没有，必须桥内自建）。
  let gesture: {
    anchorPos: number | null // mousedown 处 caret 的 PM 位置（格内文本拖选锚点）
    anchorCellPosNum: number | null // mousedown 所在格 cell pos（数字；move 时重新 resolve —— 引擎同源：ResolvedPos 跨事务后 doc 失配会抛 "must point at the current document"，r37 实测）
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

  /** 坐标 → 精确 caret DOM 位置（禁用全部桥层后 caretRangeFromPoint，同步恢复）。
   * 仅 mousedown 同步阶段一次性使用（随即换算成 PM pos）；绝不缓存返回的
   * DOM 节点跨事件使用（round36 根因：dispatch 重渲染后成孤儿节点，
   * setBaseAndExtent 对其静默失败）。 */
  const caretDomAt = (x: number, y: number): { node: Node; offset: number } | null => {
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

  /** 坐标 → 精确 caret 的 PM 位置（caretDomAt + posAtDOM 一次性换算 ——
   * round36：拖选全程以 PM pos 为准，DOM 节点仅作同步换算的桥梁）。 */
  const caretPosAt = (x: number, y: number): number | null => {
    const v = getView()
    if (!v) return null
    const d = caretDomAt(x, y)
    if (!d) return null
    try {
      const pos = v.posAtDOM(d.node, d.offset)
      if (pos >= 0 && pos <= v.state.doc.content.size) return pos
    } catch { /* */ }
    return null
  }

  // （round37：domCellPos 手写坐标运算已退役 —— 跨格拖选改用引擎算法
  //  cellAround/inSameTable/CellSelection，见 onMousemove。）

  // round54（用户报告：Word 脚注双击编辑无效）：桥层按 tableWrapper 的【整个矩形】
  // 铺放（跨页大表的包围盒会盖住同页的脚注行/批注按钮等非表格内容）。层默认
  // pointer-events:none —— 非表格内容（脚注行双击编辑、复制/删除按钮、空白区双击
  // 恢复页间空白等）全部走原生事件，不再被层吞掉；仅当鼠标悬停在真实表格格上
  // （cellAt 几何命中）时才把层临时激活为 auto，表格死区手势照常接管。
  // mousedown 仍先走 cellAt 判定（触屏无 hover 也能接管表格），cellAt 未命中且
  // target 恰在层上时兜底转发给层下元素。
  const setLayersPE = (v: string) => layers.forEach(l => { l.style.pointerEvents = v })
  // 表格手势进行中冻结 PE（拖选移出表格时层不被关闭，mouseup 后由管理器接管）
  let peFrozen = false
  let peRaf = 0
  const onMousemovePE = (e: MouseEvent) => {
    if (peFrozen || peRaf) return
    const x = e.clientX, y = e.clientY
    peRaf = requestAnimationFrame(() => {
      peRaf = 0
      setLayersPE(cellAt(x, y) ? 'auto' : 'none')
    })
  }

  const forwardToBeneath = (type: string, e: MouseEvent) => {
    const saved: { el: HTMLElement; v: string }[] = []
    try {
      layers.forEach(l => { saved.push({ el: l, v: l.style.pointerEvents }); l.style.pointerEvents = 'none' })
      const target = window.document.elementFromPoint(e.clientX, e.clientY)
      if (!target || layers.has(target as HTMLElement)) return
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: e.clientX, clientY: e.clientY,
        button: e.button, buttons: e.buttons, detail: e.detail,
      }))
    } catch { /* 转发失败不影响原手势 */ } finally {
      saved.forEach(s => { s.el.style.pointerEvents = s.v })
    }
  }

  const isOnLayer = (e: MouseEvent) => {
    let el = e.target as HTMLElement | null
    while (el) { if (layers.has(el)) return true; el = el.parentElement }
    return false
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
    if (!td) {
      // round54：点不在任何格内 —— 若 target 在桥层上（表格包围盒死区），
      // 层下可能是脚注行/正文/按钮等非表格内容，转发事件而不是静默吞掉
      //（此前 [bridge] cellAt miss 直接 return，层下元素的 click/dblclick
      // 手势全部失效）。stopPropagation 掐掉真事件的继续传播，只留转发
      // 事件走完整生命周期（否则 document 级监听会双触发）。
      // 层外点击（菜单/按钮等普通 UI）不介入，走原生路径。
      if (isOnLayer(e)) { e.stopPropagation(); forwardToBeneath('mousedown', e) }
      return
    }

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
    peFrozen = true
    setLayersPE('auto')

    // ---- 手势判定 ----
    const now = Date.now()
    if (gesture && now - gesture.lastUp < 500 && Math.abs(e.clientX - gesture.startX) < 5 && Math.abs(e.clientY - gesture.startY) < 5) {
      gesture.clickCount++
    } else {
      gesture = { anchorPos: null, anchorCellPosNum: null, startX: e.clientX, startY: e.clientY, moved: false, clickCount: 1, lastUp: 0 }
    }
    const g = gesture!

    // 锚点 caret（同步测量 —— round33 关键修复；
    // round36：只存 pos 不存 DOM 节点，dispatch 重渲染不影响）
    const anchorDom = caretDomAt(e.clientX, e.clientY)
    if (anchorDom) {
      try {
        const pos = v.posAtDOM(anchorDom.node, anchorDom.offset)
        if (pos >= 0 && pos <= v.state.doc.content.size) g.anchorPos = pos
      } catch { /* */ }
    }
    // 所在格的 cell pos（数字）：跨格拖选锚点（round37 引擎算法）。
    // 引擎同源逻辑（handleMouseDown$1）：domInCell(view, target) + 
    // cellUnderMouse 事件坐标 → cellAround。桥下 target 是层不是 td，
    // 用 cellAt 几何扫描得到的 td 内 caret pos 反解。
    // ★ 只存数字 pos —— ResolvedPos 跨事务（doc 替换）后失配，引擎在
    //   move() 里也是存 pos（tableEditingKey state）每次重新 resolve。
    const resolveAnchorCell = (): number | null => {
      try {
        if (anchorDom) {
          const caretPos = v.posAtDOM(anchorDom.node, anchorDom.offset)
          if (caretPos >= 0) {
            const $cell = cellAround(v.state.doc.resolve(caretPos))
            if ($cell) return $cell.pos
          }
        }
        // caret 测量失败（空白 padding 处）：td 内首文本 pos 反解
        const firstText = (function findText(el: Node): Text | null {
          for (const n of Array.from(el.childNodes)) {
            if (n.nodeType === 3) return n as Text
            const r = findText(n); if (r) return r
          }
          return null
        })(td)
        if (firstText) {
          const pos = v.posAtDOM(firstText, 0)
          if (pos >= 0) {
            const $cell = cellAround(v.state.doc.resolve(pos))
            if ($cell) return $cell.pos
          }
        }
      } catch { /* */ }
      return null
    }
    g.anchorCellPosNum = resolveAnchorCell()

    // ---- Shift+click：扩展 CellSelection（round37，引擎 handleMouseDown$1
    // 的 shift 分支移植，dist 2210-2216）：
    //   分支A（已有 CellSelection）：以 state.selection.$anchorCell 为锚、
    //         点击格为 head 扩展 —— setCellSelection($anchorCell, event)。
    //   分支B（文本选区）：锚 = cellAround(state.selection.$anchor)（当前
    //         caret 所在格），头 = 点击格；两者异格才扩展。
    //         （r37 初版把分支B写成"本次点击格 vs 本次点击格"恒等永假，
    //          E2E 实测 ③ 全空后修正。）
    if (e.shiftKey) {
      const curSel = v.state.selection as any
      const shiftHeadPos = resolveAnchorCell() // 点击格（head）
      if (shiftHeadPos != null) {
        if (curSel && curSel.$anchorCell && curSel.$headCell) {
          // 分支A：从 CellSelection 的 anchorCell 扩展
          try {
            const $anchor = v.state.doc.resolve(curSel.$anchorCell.pos)
            const $head = v.state.doc.resolve(shiftHeadPos)
            v.dispatch(v.state.tr.setSelection(new CellSelection($anchor, $head)).setMeta('scrollIntoView', false))
            ;(v.dom as HTMLElement).focus({ preventScroll: true })
            return
          } catch { /* 扩展失败走正常点击 */ }
        } else {
          // 分支B：文本选区 → 锚 = 当前 caret 所在格（引擎 cellAround($anchor)）
          try {
            const $anchorCell = cellAround(curSel?.$anchor ?? v.state.selection.$anchor)
            if ($anchorCell && $anchorCell.pos !== shiftHeadPos) {
              const $head = v.state.doc.resolve(shiftHeadPos)
              v.dispatch(v.state.tr.setSelection(new CellSelection($anchorCell, $head)).setMeta('scrollIntoView', false))
              ;(v.dom as HTMLElement).focus({ preventScroll: true })
              return
            }
          } catch { /* 扩展失败走正常点击 */ }
        }
      }
    }

    ;(window as any).__bridgeLog = ((window as any).__bridgeLog || []).concat(['md count=' + g.clickCount + ' td=' + (td.textContent || '').slice(0, 10) + ' anchorPos=' + g.anchorPos + ' anchorCellPos=' + g.anchorCellPosNum])
    if (g.clickCount === 3) {
      // 三击：选中整个单元格 —— round37 对齐开源引擎 handleTripleClick
      //（dist 2171：CellSelection($cell) 单格选区）。引擎语义是
      // CellSelection（含 pm-tables 的 .selectedCell 高亮 + Delete 清格），
      // 与「点击格选中整格再拖跨格」的连续体验一致。
      // anchorCellPosNum 是 cell 节点位置（before），resolve 即 $anchorCell ——
      // 不能再包 cellAround（resolve 后 depth=2，cellAround 从 depth-1 起步
      // 找不到 row，返回 null 走 catch 回退，r37 diag12 实测）。
      if (g.anchorCellPosNum != null) {
        try {
          const $cell = v.state.doc.resolve(g.anchorCellPosNum)
          ;(v.dom as HTMLElement).focus({ preventScroll: true })
          v.dispatch(v.state.tr.setSelection(new CellSelection($cell)).setMeta('scrollIntoView', false))
          return
        } catch { /* 引擎路径失败退回 DOM 全选 */ }
      }
      selectCellAll(td)
      g.anchorPos = null
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

    // 双击：选中所点单词（round37 重写）。
    // 旧实现（v0.7.18）Selection.modify backward+forward 连击在同一 selection
    // 上执行 —— 第二次 modify 在非空选区上把 focus 推回 anchor 导致清空
    //（r37 diag9 实测 mid-forward 后 sel=""）。改为【两次独立测量】：
    // 各自从 collapsed caret 出发测词首/词尾 focusOffset，再组合区间。
    // clamp：测得的 start > 点击 offset（backward 越过 cell 边界反跳，
    // r37 diag11 off0 实测 focusOffset=6 跳到别处）时回退点击 offset 本身。
    if (g.clickCount === 2 && anchorDom && anchorDom.node.nodeType === 3) {
      const sel = window.getSelection()
      try {
        const tn = anchorDom.node as Text
        const off = anchorDom.offset
        const measure = (dir: 'backward' | 'forward'): number => {
          const range = window.document.createRange()
          range.setStart(tn, off)
          range.collapse(true)
          sel?.removeAllRanges()
          sel?.addRange(range)
          ;(sel as any)?.modify?.('extend', dir, 'word')
          return sel?.focusOffset ?? off
        }
        const start = Math.min(measure('backward'), off)
        const end = Math.max(measure('forward'), off)
        if (start < end) {
          const range = window.document.createRange()
          range.setStart(tn, start)
          range.setEnd(tn, end)
          sel?.removeAllRanges()
          sel?.addRange(range)
          // PM 的 selectionToDOM 会在 focus 后用 state.selection 覆盖
          // DOM 选区 —— 必须把词选区同步进 PM state（round34：双击
          // 选词被 focus 清空的根因）。
          try {
            const fromP = v.posAtDOM(tn, start)
            const toP = v.posAtDOM(tn, end)
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
    if (g.anchorPos != null) {
      (v.dom as HTMLElement).focus({ preventScroll: true })
      try {
        // 禁止 PM 自动 scrollIntoView（round34：点击后 wrapper 被滚到
        // 视口顶 y=0，后续点击全部错位 —— 用户「点击像刷新」的观感来源）。
        // 点击的 caret 本来就在视口内，无需滚动。
        v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(Math.min(g.anchorPos, v.state.doc.content.size)), 1)).setMeta('scrollIntoView', false))
      } catch { /* PM 同步失败不阻塞 DOM caret */ }
      const range = window.document.createRange()
      range.setStart(anchorDom!.node, anchorDom!.offset)
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
          if (pmPos >= 0) {
            g.anchorPos = pmPos
            v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pmPos), 1)).setMeta('scrollIntoView', false))
          }
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

  // 拖选：mousedown 后 move —— 从 anchor 到当前点扩选（round37 引擎移植）。
  // 格内文本拖选：round36 的 PM pos 方案（引擎依赖浏览器原生 drag-select，
  // 死区下没有，必须桥内自建）。
  // 跨格拖选：移植 prosemirror-tables handleMouseDown$1 的 setCellSelection
  //（dist 2203 行）—— cellUnderMouse 解析目标格 → inSameTable 校验 →
  // CellSelection(anchor, head) dispatch。唯一桥内适配：引擎的
  // cellUnderMouse 调 view.posAtCoords（死区下 null），改用 caretPosAt
  //（禁层 + caretRangeFromPoint + posAtDOM 链路）。
  const onMousemove = (e: MouseEvent) => {
    if (!gesture || !gesture.moved) return
    // buttons 守卫：无按键按下（mouseup 后的悬停移动）不处理，
    // 防止选区跟着悬停乱跑（旧实现的悬停污染）。
    if (!(e.buttons & 1)) return
    const v = getView()
    if (!v) return
    const doc = v.state.doc

    // ---- 引擎算法：跨格 CellSelection ----
    // 引擎语义（handleMouseDown$1.move）：目标格 ≠ 起始格 → CellSelection。
    // 桥适配：锚存数字 pos（mousedown 时），每次 move 从当前 doc 重新
    // resolve（引擎 move 同款 —— ResolvedPos 缓存跨事务会 doc 失配抛
    // "must point at the current document"，r37 实测踩坑）；目标格用
    // caret pos 反解。
    if (gesture.anchorCellPosNum != null) {
      // 引擎 move 同源：anchor 存 $anchorCell.pos（cell 节点位置），
      // 每次 resolve 即得 $anchorCell —— 不能再包 cellAround（resolve(cell
      // 节点位置) 的 depth 停在 row，cellAround 找不到 row 祖先返回 null，
      // r37 mv 日志 $a=null 实锤）。
      let $anchorCell: any = null
      try { $anchorCell = doc.resolve(gesture.anchorCellPosNum) } catch { /* */ }
      const curTd = cellAt(e.clientX, e.clientY)
      if ($anchorCell && curTd) {
        const curCaret = caretPosAt(e.clientX, e.clientY)
        // $head：引擎 cellUnderMouse 的桥内版 —— caret pos 在 cell 内容内，
        // cellAround(resolve(caretPos)) 返回 $headCell（cell 节点位置）。
        // 同格判定（引擎语义 head.pos != anchor.pos 才跨格）。
        const $head = curCaret != null ? cellAround(doc.resolve(curCaret)) : null
        if ($head && $head.pos !== $anchorCell.pos) {
          try {
            // inSameTable 用 $resolved 深度+范围校验（引擎 dist 434）
            if (inSameTable($head, $anchorCell)) {
              v.dispatch(v.state.tr.setSelection(new CellSelection($anchorCell, $head)).setMeta('scrollIntoView', false))
              return
            }
          } catch { /* CellSelection 失败退回文本选区 */ }
        }
        // 同格或解析失败 → 落到格内文本拖选
      } else if (!$anchorCell || (curTd === null && caretPosAt(e.clientX, e.clientY) === null)) {
        // 移出表格（间隙/表格外）→ 引擎 move 里 domInCell 变更时 stop；
        // 桥语义：保留当前选区不动（不做任何 dispatch）
        return
      }
    }

    // ---- 格内文本拖选：anchor PM pos → 当前 caret PM pos ----
    if (gesture.anchorPos == null) return
    const caretPos = caretPosAt(e.clientX, e.clientY)
    if (caretPos == null) return
    try {
      const from = Math.min(gesture.anchorPos, caretPos)
      const to = Math.max(gesture.anchorPos, caretPos)
      if (to > from) {
        v.dispatch(v.state.tr.setSelection(TextSelection.create(doc, from, to)).setMeta('scrollIntoView', false))
      }
    } catch { /* */ }
  }

  const onMouseup = (e: MouseEvent) => {
    if (!gesture) return
    gesture.lastUp = Date.now()
    peFrozen = false
    // 关键（round34 时间线实锤 t0+90ms selection 被打到文档末尾）：
    // mousedown preventDefault 不能阻止 Chromium 在 mouseup 阶段
    // 重新执行默认 caret 放置（放置到 contenteditable 末尾 —— 
    // 因为死区坐标在浏览器看来"没有有效 target"）。mouseup 也必须
    // preventDefault，mousedown 里放好的 caret 才能存活。
    // 旧代理层的 60ms 补刀就是在对抗这个 —— 从根上阻止即可。
    e.preventDefault()
    // round37：会话结束清 anchor（clickCount 保留供双击/三击累计）。
    gesture.anchorPos = null
    gesture.anchorCellPosNum = null
    gesture.moved = false
  }

  // move 超过阈值才进入拖选（避免手抖把单击变拖选）
  const onMousemoveArm = (e: MouseEvent) => {
    if (!gesture || (gesture.anchorPos == null && gesture.anchorCellPosNum == null)) return
    if (!(e.buttons & 1)) return
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
  // round54：无手势时（点击落在层上但不是表格格）转发 click 给层下元素，
  // 脚注行的复制/删除按钮等才能收到点击。
  const onClick = (e: MouseEvent) => {
    if (gesture) { e.preventDefault(); return }
    if (isOnLayer(e)) { e.stopPropagation(); forwardToBeneath('click', e) }
  }
  // round54：双击同理 —— 无手势且 target 在层上时转发 dblclick，
  // 页底脚注行的「双击编辑」才能触发（用户报告：Word 脚注无法编辑）。
  const onDblclick = (e: MouseEvent) => {
    if (gesture) { e.preventDefault(); return }
    if (isOnLayer(e)) { e.stopPropagation(); forwardToBeneath('dblclick', e) }
  }
  window.document.addEventListener('mousedown', onMousedown, true)
  window.document.addEventListener('mousemove', onMousemoveArm, true)
  window.document.addEventListener('mousemove', onMousemovePE, true)
  window.document.addEventListener('mouseup', onMouseup, true)
  window.document.addEventListener('click', onClick, true)
  window.document.addEventListener('dblclick', onDblclick, true)

  // ---- 层生命周期 ----
  const ensureLayer = (wrapper: HTMLElement) => {
    if (disposed || layers.has(wrapper)) return
    const h = host()
    if (!h || !wrapper.isConnected) return
    const layer = window.document.createElement('div')
    layer.className = 'pm-table-clickbridge'
    // round54：默认 pointer-events:none（悬停真实格才激活，见 onMousemovePE）——
    // 层矩形是非表格内容的禁区，不能常驻拦截。
    layer.style.cssText = 'position:absolute;z-index:7;pointer-events:none'
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
    if (peRaf) cancelAnimationFrame(peRaf)
    ;(window as any).__samTableBridge = false
    mo.disconnect()
    scroller?.removeEventListener('scroll', scheduleSync)
    window.removeEventListener('resize', scheduleSync)
    window.document.removeEventListener('mousedown', onMousedown, true)
  window.document.removeEventListener('click', onClick, true)
    window.document.removeEventListener('dblclick', onDblclick, true)
    window.document.removeEventListener('mousemove', onMousemoveArm, true)
    window.document.removeEventListener('mousemove', onMousemovePE, true)
    window.document.removeEventListener('mouseup', onMouseup, true)
    if (syncTimer) window.clearTimeout(syncTimer)
    layers.forEach(l => l.remove())
    layers.clear()
  }
}
