import { useEffect, useMemo, useRef, useState } from 'react'

// 公式分类与常用模板（点击插入对应 LaTeX）
interface FormulaTemplate {
  label: string
  latex: string
}
interface FormulaCategory {
  name: string
  templates: FormulaTemplate[]
}
const FORMULA_CATEGORIES: FormulaCategory[] = [
  {
    name: '基础代数',
    templates: [
      { label: 'a²+b²=c²', latex: 'a^2 + b^2 = c^2' },
      { label: 'x = (−b±√(b²−4ac))/2a', latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' },
      { label: '分数 a/b', latex: '\\frac{a}{b}' },
      { label: '根号 √x', latex: '\\sqrt{x}' },
      { label: 'n次根', latex: '\\sqrt[n]{x}' },
      { label: '幂 xⁿ', latex: 'x^{n}' },
      { label: '下标 xₙ', latex: 'x_{n}' },
      { label: '绝对值 |x|', latex: '\\left| x \\right|' },
    ],
  },
  {
    name: '求和/求积',
    templates: [
      { label: '∑ 求和', latex: '\\sum_{i=1}^{n} a_i' },
      { label: '∏ 求积', latex: '\\prod_{i=1}^{n} a_i' },
      { label: '∑ 带条件', latex: '\\sum_{\\substack{1 \\le i \\le n \\\\ i \\neq j}} a_i' },
    ],
  },
  {
    name: '积分',
    templates: [
      { label: '∫ 定积分', latex: '\\int_{a}^{b} f(x)\\, dx' },
      { label: '∬ 二重', latex: '\\iint_{D} f(x,y)\\, dx\\, dy' },
      { label: '∮ 围道', latex: '\\oint_{C} f(z)\\, dz' },
      { label: '极限 lim', latex: '\\lim_{x \\to \\infty} f(x)' },
    ],
  },
  {
    name: '微积分',
    templates: [
      { label: "f'", latex: "f'(x)" },
      { label: '偏导数 ∂', latex: '\\frac{\\partial f}{\\partial x}' },
      { label: '二阶导', latex: '\\frac{d^2 y}{dx^2}' },
      { label: '梯度 ∇', latex: '\\nabla f' },
    ],
  },
  {
    name: '矩阵',
    templates: [
      { label: '2×2 矩阵', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
      { label: '括号矩阵', latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}' },
      { label: '行列式', latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}' },
      { label: '3×3 矩阵', latex: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}' },
    ],
  },
  {
    name: '集合/逻辑',
    templates: [
      { label: '∈ 属于', latex: 'x \\in A' },
      { label: '⊂ 子集', latex: 'A \\subset B' },
      { label: '∩ 交', latex: 'A \\cap B' },
      { label: '∪ 并', latex: 'A \\cup B' },
      { label: '∀ 任意', latex: '\\forall x \\in A' },
      { label: '∃ 存在', latex: '\\exists x \\in A' },
      { label: '⇒ 蕴含', latex: 'P \\Rightarrow Q' },
      { label: '⇔ 等价', latex: 'P \\Leftrightarrow Q' },
    ],
  },
  {
    name: '希腊字母',
    templates: [
      { label: 'α', latex: '\\alpha' }, { label: 'β', latex: '\\beta' }, { label: 'γ', latex: '\\gamma' },
      { label: 'δ', latex: '\\delta' }, { label: 'θ', latex: '\\theta' }, { label: 'λ', latex: '\\lambda' },
      { label: 'μ', latex: '\\mu' }, { label: 'π', latex: '\\pi' }, { label: 'σ', latex: '\\sigma' },
      { label: 'φ', latex: '\\phi' }, { label: 'ω', latex: '\\omega' }, { label: 'Δ', latex: '\\Delta' },
      { label: 'Σ', latex: '\\Sigma' }, { label: 'Ω', latex: '\\Omega' }, { label: 'Φ', latex: '\\Phi' },
      { label: 'Ψ', latex: '\\Psi' },
    ],
  },
  {
    name: '关系/运算',
    templates: [
      { label: '≠', latex: '\\neq' }, { label: '≤', latex: '\\leq' }, { label: '≥', latex: '\\geq' },
      { label: '≈', latex: '\\approx' }, { label: '≡', latex: '\\equiv' }, { label: '∝', latex: '\\propto' },
      { label: '±', latex: '\\pm' }, { label: '×', latex: '\\times' }, { label: '÷', latex: '\\div' },
      { label: '·', latex: '\\cdot' }, { label: '∞', latex: '\\infty' }, { label: '∠', latex: '\\angle' },
      { label: '⊥', latex: '\\perp' }, { label: '∥', latex: '\\parallel' }, { label: '∅', latex: '\\emptyset' },
    ],
  },
  {
    name: '箭头',
    templates: [
      { label: '→', latex: '\\to' }, { label: '⇒', latex: '\\Rightarrow' },
      { label: '⟶', latex: '\\longrightarrow' }, { label: '↔', latex: '\\leftrightarrow' },
      { label: '⇔', latex: '\\Leftrightarrow' }, { label: '↑', latex: '\\uparrow' }, { label: '↓', latex: '\\downarrow' },
    ],
  },
]

// 符号面板分类（插入纯字符或命令）
interface SymbolItem {
  char?: string
  latex?: string
  label: string
}
const SYMBOL_CATEGORIES: { name: string; items: SymbolItem[] }[] = [
  {
    name: '希腊',
    items: 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.split('').map((c) => ({
      char: c,
      label: c,
    })),
  },
  {
    name: '运算',
    items: '±×÷·∗∘∝∞∠∇∂√∫∮∑∏∩∪∅¬'.split('').map((c) => ({ char: c, label: c })),
  },
  {
    name: '关系',
    items: '≠≤≥≈≡≅⊂⊃⊆⊇∈∉∀∃∧∨⇒⇔'.split('').map((c) => ({ char: c, label: c })),
  },
  {
    name: '箭头',
    items: '←↑→↓↔↕↖↗↘↙⇒⇐⇔⟶⟵⟷'.split('').map((c) => ({ char: c, label: c })),
  },
  {
    name: '圈号',
    items: '①②③④⑤⑥⑦⑧⑨⑩ⒶⒷⒸⓐⓑⓒ'.split('').map((c) => ({ char: c, label: c })),
  },
  {
    name: '罗马',
    items: 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ'.split('').map((c) => ({ char: c, label: c })),
  },
]

interface Props {
  initialLatex?: string
  initialInline?: boolean
  initialTab?: 'formula' | 'symbol'
  onClose: () => void
  onInsert: (latex: string, inline: boolean) => void
}

export function MathEditorModal({ initialLatex = '', initialInline = false, initialTab = 'formula', onClose, onInsert }: Props) {
  const [latex, setLatex] = useState(initialLatex)
  const [inline, setInline] = useState(initialInline)
  const [cat, setCat] = useState(0)
  const [symCat, setSymCat] = useState(0)
  const [leftTab, setLeftTab] = useState<'formula' | 'symbol'>(initialTab)
  const previewRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 实时 KaTeX 预览
  const previewHtml = useMemo(() => {
    const katex = (window as any).katex
    if (!katex || !latex.trim()) return ''
    try {
      return katex.renderToString(latex, { displayMode: !inline, throwOnError: false })
    } catch (e: any) {
      return `<span style="color:#ef4444">${e.message || '公式错误'}</span>`
    }
  }, [latex, inline])

  useEffect(() => {
    if (previewRef.current) previewRef.current.innerHTML = previewHtml
  }, [previewHtml])

  // 在光标处插入文本
  const insertAtCursor = (text: string) => {
    const el = inputRef.current
    if (!el) {
      setLatex((s) => s + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = latex.slice(0, start) + text + latex.slice(end)
    setLatex(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  const esc = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleInsert()
  }

  const handleInsert = () => {
    if (!latex.trim()) {
      onClose()
      return
    }
    onInsert(latex, inline)
  }

  const totalSym = SYMBOL_CATEGORIES.reduce((a, c) => a + c.items.length, 0)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.55)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={esc}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: 'min(960px, 94vw)',
          height: 'min(680px, 92vh)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ background: 'var(--color-bg-alt)', borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="font-semibold text-sm flex items-center gap-2">
            <span className="text-lg">Σ</span> 公式编辑器
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} />
              行内公式
            </label>
            <button className="text-xl leading-none px-1 hover:text-red-500" onClick={onClose} title="关闭 (Esc)">
              ×
            </button>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧：符号面板 / 公式分类 */}
          <div className="w-72 border-r flex flex-col" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex text-xs">
              <button
                className="flex-1 py-2 font-medium"
                style={{
                  background: leftTab === 'formula' ? 'var(--color-primary)' : 'transparent',
                  color: leftTab === 'formula' ? 'white' : 'var(--color-text)',
                }}
                onClick={() => setLeftTab('formula')}
              >
                常用公式
              </button>
              <button
                className="flex-1 py-2 font-medium"
                style={{
                  background: leftTab === 'symbol' ? 'var(--color-primary)' : 'transparent',
                  color: leftTab === 'symbol' ? 'white' : 'var(--color-text)',
                }}
                onClick={() => setLeftTab('symbol')}
              >
                符号
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {leftTab === 'formula' ? (
                <>
                  <div className="flex flex-col gap-3">
                    {FORMULA_CATEGORIES.map((c, ci) => (
                      <div key={c.name}>
                        <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          {c.name}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {c.templates.map((tpl, ti) => (
                            <button
                              key={ti}
                              className="text-left text-xs rounded px-2 py-1.5 transition-colors hover:opacity-80"
                              style={{
                                background: 'var(--color-bg-alt)',
                                border: '1px solid var(--color-border)',
                                fontFamily: 'var(--font-ui)',
                              }}
                              title={tpl.latex}
                              onClick={() => insertAtCursor(tpl.latex)}
                            >
                              {tpl.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {SYMBOL_CATEGORIES.map((c, i) => (
                      <button
                        key={c.name}
                        className="text-xs px-2 py-1 rounded"
                        style={{
                          background: symCat === i ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                          color: symCat === i ? 'white' : 'var(--color-text)',
                        }}
                        onClick={() => setSymCat(i)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-6 gap-1">
                    {SYMBOL_CATEGORIES[symCat].items.map((s, i) => (
                      <button
                        key={i}
                        className="text-lg rounded hover:opacity-80"
                        style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', minWidth: 32, minHeight: 32 }}
                        onClick={() => s.latex ? insertAtCursor(s.latex) : insertAtCursor(s.char || '')}
                        title={s.latex || s.char}
                      >
                        {s.char}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 右侧：LaTeX 编辑 + 预览 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 pt-3 pb-1 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              LaTeX 代码（Ctrl/⌘+Enter 插入，Esc 关闭）
            </div>
            <div className="px-4">
              <textarea
                ref={inputRef}
                value={latex}
                onChange={(e) => setLatex(e.target.value)}
                spellCheck={false}
                className="w-full rounded-lg p-3 text-sm font-mono resize-none focus:outline-none"
                style={{
                  height: 130,
                  background: 'var(--color-bg-alt)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
                placeholder="例如：E = mc^2  或  \\int_{a}^{b} f(x)\\,dx"
              />
            </div>
            <div className="px-4 py-1 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              预览
            </div>
            {/* 预览区。
                关键约束：KaTeX 通过 innerHTML 直接接管 previewRef 所指节点的全部内容，
                因此该节点绝不能同时挂载任何 React 子节点。
                此前把占位提示 `{!previewHtml && <span/>}` 直接放在 previewRef 的 div 内，
                导致：React 记录了该 span 为自己的子节点 → innerHTML 写入把它抹掉 →
                React 再执行 removeChild(span) 时节点已不存在 → NotFoundError 崩溃。
                现改为外层容器由 React 管理（含占位提示），内层空 div 专供 KaTeX 使用，
                两者所有权彻底隔离。 */}
            <div
              className="flex-1 mx-4 mb-3 rounded-lg overflow-auto p-4 flex items-center justify-center text-center"
              style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', minHeight: 120 }}
            >
              {!previewHtml && <span style={{ color: 'var(--color-text-muted)' }}>在左侧选择公式或输入 LaTeX 查看预览</span>}
              <div ref={previewRef} style={{ display: previewHtml ? 'block' : 'none' }} />
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ background: 'var(--color-bg-alt)', borderTop: '1px solid var(--color-border)' }}
        >
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            共 {FORMULA_CATEGORIES.reduce((a, c) => a + c.templates.length, 0)} 个公式模板 · {totalSym} 个符号
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleInsert} disabled={!latex.trim()}>
              插入公式
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
