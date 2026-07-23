package docx

import "strings"

// latexToOMML 将 LaTeX 数学公式转换为 OOXML Math (OMML) 内部 XML 片段。
// 支持常见结构：上下标、分数、根式、求和/积分（带上下限）、
// 括号、希腊字母、常用运算符与关系符。无法解析时返回 ok=false。
func latexToOMML(latex string) (string, bool) {
	latex = strings.TrimSpace(latex)
	if latex == "" {
		return "", false
	}
	p := &omathParser{src: latex}
	body := p.parseSequence('}')
	if body == "" {
		return "", false
	}
	return body, true
}

// extractFormulaOMML 识别形如 ⟨formula:...⟩ 的文本并将其转为 OMML。
func extractFormulaOMML(content string) (string, bool) {
	const pre = "⟨formula:"
	if !strings.HasPrefix(content, pre) {
		return "", false
	}
	if !strings.HasSuffix(content, "⟩") {
		return "", false
	}
	latex := content[len(pre) : len(content)-len("⟩")]
	return latexToOMML(latex)
}

type omathParser struct {
	src string
	pos int
}

func (p *omathParser) peek() rune {
	if p.pos >= len(p.src) {
		return 0
	}
	return rune(p.src[p.pos])
}

func (p *omathParser) next() rune {
	c := p.peek()
	if c != 0 {
		p.pos++
	}
	return c
}

func (p *omathParser) skipSpace() {
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

// parseSequence 解析一段用 stop 终止的表达式（stop 通常为 '}'）。
// 嵌套的 {...} 会由 parsePrimary 在递归中自行消费匹配的 '}'，
// 因此外层只会遇到本层级的 '}'。
func (p *omathParser) parseSequence(stop rune) string {
	var sb strings.Builder
	for p.pos < len(p.src) {
		c := p.peek()
		if c == 0 || c == stop {
			break
		}
		if c == '^' || c == '_' { // 缺少基底的孤立上下标，跳过
			p.next()
			continue
		}
		sb.WriteString(p.parseWithScripts())
	}
	return sb.String()
}

// parseWithScripts 解析一个原子及其后的连续上下标。
func (p *omathParser) parseWithScripts() string {
	base := p.parsePrimary()
	for {
		c := p.peek()
		if c == '^' {
			p.next()
			sup := p.parseArgument()
			base = `<m:sSup><m:e>` + base + `</m:e><m:sup>` + sup + `</m:sup></m:sSup>`
		} else if c == '_' {
			p.next()
			sub := p.parseArgument()
			base = `<m:sSub><m:e>` + base + `</m:e><m:sub>` + sub + `</m:sub></m:sSub>`
		} else {
			break
		}
	}
	return base
}

func (p *omathParser) parseArgument() string {
	prim := p.parsePrimary()
	if prim == "" {
		return `<m:e></m:e>`
	}
	return `<m:e>` + prim + `</m:e>`
}

func (p *omathParser) parsePrimary() string {
	p.skipSpace()
	c := p.peek()
	if c == 0 {
		return ""
	}
	if c == '{' {
		p.next()
		inner := p.parseSequence('}')
		if p.peek() == '}' {
			p.next()
		}
		return `<m:e>` + inner + `</m:e>`
	}
	if c == '\\' {
		return p.parseCommand()
	}
	if c == '(' || c == '[' || c == ')' || c == ']' {
		p.next()
		return runOMML(string(c))
	}
	p.next()
	return runOMML(string(c))
}

func (p *omathParser) parseCommand() string {
	p.next() // 消费反斜杠
	var name strings.Builder
	for p.pos < len(p.src) {
		ch := p.src[p.pos]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') {
			name.WriteByte(ch)
			p.pos++
		} else {
			break
		}
	}
	cmd := name.String()
	switch cmd {
	case "frac":
		num := p.parseArgument()
		den := p.parseArgument()
		return `<m:f><m:num>` + num + `</m:num><m:den>` + den + `</m:den></m:f>`
	case "sqrt":
		arg := p.parseArgument()
		return `<m:rad><m:e>` + arg + `</m:e></m:rad>`
	case "sum", "prod", "int", "oint", "coprod":
		chr := naryChr(cmd)
		var sub, sup string
		if p.peek() == '_' {
			p.next()
			sub = p.parseArgument()
		}
		if p.peek() == '^' {
			p.next()
			sup = p.parseArgument()
		}
		e := p.parseWithScripts()
		return `<m:nary><m:naryPr><m:chr m:val="` + chr + `"/></m:naryPr><m:sub>` + sub + `</m:sub><m:sup>` + sup + `</m:sup><m:e>` + e + `</m:e></m:nary>`
	case "left", "right", "big", "Big", "bigg", "Bigg", "mathring":
		return "" // 仅用于尺寸/定界符提示，忽略
	case "text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "operatorname":
		if p.peek() == '{' {
			p.next()
			inner := p.parseSequence('}')
			if p.peek() == '}' {
				p.next()
			}
			return inner
		}
		return ""
	default:
		if g, ok := greekMap[cmd]; ok {
			return runOMML(g)
		}
		if o, ok := opMap[cmd]; ok {
			return runOMML(o)
		}
		// 未知命令：原样输出名称（去掉反斜杠），保证可见
		return runOMML(cmd)
	}
}

func naryChr(cmd string) string {
	switch cmd {
	case "sum":
		return "∑"
	case "prod":
		return "∏"
	case "int":
		return "∫"
	case "oint":
		return "∮"
	case "coprod":
		return "∐"
	}
	return "∑"
}

func runOMML(s string) string {
	return `<m:r><m:t>` + escapeXML(s) + `</m:t></m:r>`
}

var greekMap = map[string]string{
	"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "zeta": "ζ",
	"eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ",
	"nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ",
	"upsilon": "υ", "phi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
	"Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Pi": "Π",
	"Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
}

var opMap = map[string]string{
	"times": "×", "div": "÷", "pm": "±", "mp": "∓", "cdot": "·", "ast": "∗",
	"star": "⋆", "circ": "∘", "bullet": "∙", "oplus": "⊕", "otimes": "⊗",
	"leq": "≤", "geq": "≥", "neq": "≠", "approx": "≈", "equiv": "≡",
	"propto": "∝", "sim": "∼", "cong": "≅", "in": "∈", "notin": "∉",
	"subset": "⊂", "supset": "⊃", "subseteq": "⊆", "supseteq": "⊇",
	"emptyset": "∅", "infty": "∞", "partial": "∂", "nabla": "∇",
	"to": "→", "rightarrow": "→", "leftarrow": "←", "leftrightarrow": "↔",
	"Rightarrow": "⇒", "Leftarrow": "⇐", "Leftrightarrow": "⇔",
	"angle": "∠", "perp": "⊥", "parallel": "∥", "forall": "∀",
	"exists": "∃", "neg": "¬", "wedge": "∧", "vee": "∨",
	"cap": "∩", "cup": "∪", "ni": "∋",
}
