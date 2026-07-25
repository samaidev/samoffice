// Package docx 实现 OOXML .docx 格式的自研解析器
// 容错策略：ZIP 容错解压 + XML 宽松解析 + 未知元素保留
package docx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

// Parser 实现 core.Parser 接口
type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".docx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
        return strings.HasSuffix(strings.ToLower(path), ".docx") ||
                (len(header) >= 4 && bytes.Equal(header[:2], []byte{0x50, 0x4B})) // PK
}

// Parse 解析 docx 字节流为 UDM
// 返回 (document, warnings, error)，永不 panic
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
        warnings := []core.Warning{}

        // 1. 读取全部字节（zip 需要 ReaderAt）
        data, err := io.ReadAll(r)
        if err != nil {
                return nil, warnings, fmt.Errorf("read docx: %w", err)
        }

        // 2. 容错 ZIP 解压
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                return nil, warnings, fmt.Errorf("open zip: %w", err)
        }

        // 3. 定位关键文件
        files := make(map[string]*zip.File)
        for _, f := range zr.File {
                files[f.Name] = f
        }
        docFile, ok := files["word/document.xml"]
        if !ok {
                // 尝试备用路径
                for name, f := range files {
                        if strings.HasSuffix(name, "document.xml") {
                                docFile = f
                                break
                        }
                }
                if docFile == nil {
                        return nil, warnings, fmt.Errorf("missing word/document.xml")
                }
                warnings = append(warnings, core.Warning{
                        Level: "warn", Stage: "unzip",
                        Message: "document.xml path is non-standard: " + docFile.Name,
                })
        }

        // 4. 解析核心 XML
        doc := &core.Document{
                Meta:   core.Meta{},
                Blocks: []core.Block{},
                Raw:    make(map[string]any),
        }

        // 提取元数据
        if coreFile, ok := files["docProps/core.xml"]; ok {
                if rc, err := coreFile.Open(); err == nil {
                        parseCoreProps(rc, &doc.Meta)
                        rc.Close()
                }
        }

        // 解析 document.xml
        if rc, err := docFile.Open(); err != nil {
                return nil, warnings, fmt.Errorf("open document.xml: %w", err)
        } else {
                defer rc.Close()
                blocks, warns := parseDocumentXML(rc)
                doc.Blocks = blocks
                warnings = append(warnings, warns...)
        }

        // 解析页脚中的 PAGE / NUMPAGES 域，生成页码配置
        if pn := extractPageNumber(files); pn != nil {
                doc.PageNumber = pn
        }

        return doc, warnings, nil
}

// parseDocumentXML 宽松解析 document.xml，提取块级内容
// 容错：用 encoding/xml 的 Token 模式，未知元素跳过而不报错
func parseDocumentXML(r io.Reader) ([]core.Block, []core.Warning) {
        dec := xml.NewDecoder(r)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity

        var blocks []core.Block
        var warnings []core.Warning
        depth := 0

        for {
                tok, err := dec.Token()
                if err == io.EOF {
                        break
                }
                if err != nil {
                        warnings = append(warnings, core.Warning{
                                Level: "warn", Stage: "xml",
                                Message: "xml token error: " + err.Error(),
                        })
                        break
                }

                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        // 进入段落
                        if t.Name.Local == "p" && t.Name.Space == "http://schemas.openxmlformats.org/wordprocessingml/2006/main" {
                                for _, b := range parseParagraph(dec) {
                                        if b != nil {
                                                blocks = append(blocks, b)
                                        }
                                }
                                depth--
                        }
                        if t.Name.Local == "tbl" && t.Name.Space == "http://schemas.openxmlformats.org/wordprocessingml/2006/main" {
                                tbl := parseTable(dec)
                                if tbl != nil {
                                        blocks = append(blocks, tbl)
                                }
                                depth--
                        }
                case xml.EndElement:
                        depth--
                }
        }
        return blocks, warnings
}

// headingLevel 根据 Word 内置标题样式 ID（Heading1..Heading9）推断标题级别，
// 非标题样式返回 0。大小写均可识别（Heading1 / heading1）。
func headingLevel(style string) int {
	if style == "" {
		return 0
	}
	const prefix = "heading"
	lower := strings.ToLower(style)
	if !strings.HasPrefix(lower, prefix) {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimPrefix(lower, prefix))
	if err != nil || n < 1 || n > 9 {
		return 0
	}
	return n
}

// parseParagraph 解析 <w:p> 段落。若段落内含 OMML 公式，则返回 *core.Math 块。
// 返回 []core.Block：可能包含其前/后的分页符块（pageBreakBefore / w:br type=page）。
func parseParagraph(dec *xml.Decoder) []core.Block {
	para := &core.Paragraph{Inline: []core.Inline{}}
	var inRun bool
	var curText core.Text
	hasMath := false
	var mathXML strings.Builder
	leadingPageBreak := false  // pageBreakBefore：段前分页
	trailingPageBreak := false // w:br type="page"：段后分页
	inPPr := false // 当前是否处于 <w:pPr> 内（用于区分段落属性与 run 属性的同名元素，如 w:spacing）
	setProp := func(k string, v any) {
		if para.Props == nil {
			para.Props = map[string]any{}
		}
		para.Props[k] = v
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			return []core.Block{para}
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "pPr":
				inPPr = true
			case "r": // <w:r> run
				inRun = true
				curText = core.Text{}
			case "t": // <w:t> text
				if inRun {
					text := readCharData(dec)
					curText.Content += text
				}
			case "b": // bold
				if inRun {
					curText.Bold = readOnOffAttr(t)
				}
			case "i":
				if inRun {
					curText.Italic = readOnOffAttr(t)
				}
		case "u":
			if inRun {
				curText.Under = true
			}
		case "br": // 换行；type="page" 表示分页符
			if inRun {
				for _, a := range t.Attr {
					if a.Name.Local == "type" && strings.EqualFold(a.Value, "page") {
						trailingPageBreak = true
					}
				}
			}
		case "rFonts": // 字体名：优先 eastAsia（中文字体），其次 ascii/hAnsi
			if inRun {
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "eastAsia":
						if a.Value != "" {
							curText.Font = a.Value
						}
					case "ascii", "hAnsi":
						if curText.Font == "" && a.Value != "" {
							curText.Font = a.Value
						}
					}
				}
			}
		case "pStyle": // paragraph style
				for _, a := range t.Attr {
					if a.Name.Local == "val" {
						para.Style = a.Value
					}
				}
			case "jc": // justify/align
				for _, a := range t.Attr {
					if a.Name.Local == "val" {
						para.Align = a.Value
					}
				}
			case "ind": // 缩进（仅在 pPr 上下文）
				if !inPPr {
					break
				}
				var leftTw, rightTw, firstTw, hangTw, leftCh, firstCh, hangCh float64
				for _, a := range t.Attr {
					f, _ := strconv.ParseFloat(a.Value, 64)
					switch a.Name.Local {
					case "left":
						leftTw = f
					case "right":
						rightTw = f
					case "firstLine":
						firstTw = f
					case "hanging":
						hangTw = f
					case "leftChars":
						leftCh = f
					case "firstLineChars":
						firstCh = f
					case "hangingChars":
						hangCh = f
					}
				}
				// 优先使用字符单位，否则用 twips（1 字符 ≈ 240twips @12pt）
				if leftCh != 0 {
					setProp("indentLeft", leftCh/100)
				} else if leftTw != 0 {
					setProp("indentLeft", leftTw/240)
				}
				if rightTw != 0 {
					setProp("indentRight", rightTw/240)
				}
				if firstCh != 0 {
					setProp("firstLine", firstCh/100)
				} else if firstTw != 0 {
					setProp("firstLine", firstTw/240)
				}
				if hangCh != 0 {
					setProp("hanging", hangCh/100)
				} else if hangTw != 0 {
					setProp("hanging", hangTw/240)
				}
			case "spacing": // 段前/段后/行距（仅在 pPr 上下文）
				if !inPPr {
					break
				}
				var before, after, line float64
				rule := ""
				for _, a := range t.Attr {
					f, _ := strconv.ParseFloat(a.Value, 64)
					switch a.Name.Local {
					case "before":
						before = f
					case "after":
						after = f
					case "line":
						line = f
					case "lineRule":
						rule = a.Value
					}
				}
				if before != 0 {
					setProp("spaceBefore", before/20) // twips → pt
				}
				if after != 0 {
					setProp("spaceAfter", after/20)
				}
				if line != 0 {
					if rule == "exact" || rule == "atLeast" {
						setProp("lineHeight", fmt.Sprintf("%.0fpt", line/20))
					} else {
						mult := line / 240.0
						setProp("lineHeight", strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", mult), "0"), "."))
					}
				}
			case "keepLines":
				if inPPr {
					setProp("keepLines", readOnOffAttr(t))
				}
			case "keepNext":
				if inPPr {
					setProp("keepWithNext", readOnOffAttr(t))
				}
			case "pageBreakBefore":
				if inPPr {
					setProp("pageBreakBefore", readOnOffAttr(t))
					if readOnOffAttr(t) {
						leadingPageBreak = true
					}
				}
			case "outlineLvl":
				if inPPr {
					for _, a := range t.Attr {
						if a.Name.Local == "val" {
							if v, err := strconv.Atoi(a.Value); err == nil {
								setProp("outlineLevel", v+1)
							}
						}
					}
				}
			case "oMath", "oMathPara": // OMML 公式
				hasMath = true
				mathXML.WriteString(serializeStart(t))
				collectElement(dec, &mathXML, t.Name.Local)
			}
		case xml.EndElement:
			if t.Name.Local == "pPr" {
				inPPr = false
			}
			if t.Name.Local == "r" && inRun {
				if curText.Content != "" {
					para.Inline = append(para.Inline, curText)
				}
				inRun = false
			}
		if t.Name.Local == "p" {
			var out []core.Block
			if leadingPageBreak {
				out = append(out, &core.PageBreak{})
			}
			if hasMath {
				if latex := ommlToLatex(mathXML.String()); latex != "" {
					out = append(out, &core.Math{Formula: latex})
					if trailingPageBreak {
						out = append(out, &core.PageBreak{})
					}
					return out
				}
			}
			if lvl := headingLevel(para.Style); lvl > 0 {
				out = append(out, &core.Heading{
					Level:  lvl,
					Inline: para.Inline,
					Style:  para.Style,
					Props:  para.Props,
				})
			} else {
				out = append(out, para)
			}
			if trailingPageBreak {
				out = append(out, &core.PageBreak{})
			}
			return out
		}
		}
	}
}

// extractPageNumber 扫描 word/footer*.xml，提取页码域（PAGE / NUMPAGES），
// 还原为 UDM 的 PageNumberConfig。找不到页码域时返回 nil。
func extractPageNumber(files map[string]*zip.File) *core.PageNumberConfig {
	for name, f := range files {
		if !strings.HasPrefix(name, "word/footer") || !strings.HasSuffix(name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		cfg := parseFooterPageNumber(rc)
		rc.Close()
		if cfg != nil {
			return cfg
		}
	}
	return nil
}

// parseFooterPageNumber 解析单个页脚 XML，构造页码格式模板。
// 形如「第 」+ PAGE 域 +「 页」拼成 "第 {n} 页"；含 NUMPAGES 则补 {total}。
func parseFooterPageNumber(rc io.Reader) *core.PageNumberConfig {
	dec := xml.NewDecoder(rc)
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity

	type tok struct {
		text  string
		page  bool
		total bool
	}
	var toks []tok
	var align string
	inPPr := false
	fieldDepth := 0 // 进入域（fldSimple / fldChar begin）后跳过其内部的显示文本

	for {
		t, err := dec.Token()
		if err != nil {
			break
		}
		switch el := t.(type) {
		case xml.StartElement:
			switch el.Name.Local {
			case "pPr":
				inPPr = true
			case "jc":
				if inPPr {
					for _, a := range el.Attr {
						if a.Name.Local == "val" {
							align = a.Value
						}
					}
				}
			case "fldSimple":
				for _, a := range el.Attr {
					if a.Name.Local == "instr" {
						up := strings.ToUpper(strings.TrimSpace(a.Value))
						if strings.Contains(up, "NUMPAGES") {
							toks = append(toks, tok{total: true})
						} else if strings.Contains(up, "PAGE") {
							toks = append(toks, tok{page: true})
						}
					}
				}
				fieldDepth++
			case "fldChar":
				ftype := ""
				for _, a := range el.Attr {
					if a.Name.Local == "fldCharType" {
						ftype = a.Value
					}
				}
				if ftype == "begin" {
					fieldDepth++
				} else if ftype == "end" {
					if fieldDepth > 0 {
						fieldDepth--
					}
				}
			case "instrText":
				if fieldDepth > 0 {
					up := strings.ToUpper(strings.TrimSpace(readCharData(dec)))
					if strings.Contains(up, "NUMPAGES") {
						toks = append(toks, tok{total: true})
					} else if strings.Contains(up, "PAGE") {
						toks = append(toks, tok{page: true})
					}
				}
			case "t":
				if fieldDepth == 0 {
					toks = append(toks, tok{text: readCharData(dec)})
				}
			}
		case xml.EndElement:
			if el.Name.Local == "pPr" {
				inPPr = false
			} else if el.Name.Local == "fldSimple" {
				if fieldDepth > 0 {
					fieldDepth--
				}
			}
		}
	}

	var sb strings.Builder
	hasPage := false
	for _, tk := range toks {
		if tk.page {
			sb.WriteString("{n}")
			hasPage = true
		}
		if tk.total {
			sb.WriteString("{total}")
		}
		if tk.text != "" {
			sb.WriteString(tk.text)
		}
	}
	if !hasPage {
		return nil
	}
	if align == "" {
		align = "center"
	}
	return &core.PageNumberConfig{
		Enabled: true,
		Format:  sb.String(),
		Align:   align,
	}
}

// parseTable 解析 <w:tbl>，返回 *core.Table。容错：未知或残缺元素跳过。
func parseTable(dec *xml.Decoder) core.Block {
	tbl := &core.Table{Rows: [][]core.TableCell{}}
	var curRow []core.TableCell
	var curCell core.TableCell
	var curCellInline []core.Inline
	inTcPr := false

	flushCell := func() {
		if curCellInline != nil {
			curCell.Inline = curCellInline
		}
		curRow = append(curRow, curCell)
		curCell = core.TableCell{}
		curCellInline = nil
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tr":
				curRow = []core.TableCell{}
			case "tc":
				curCell = core.TableCell{}
				curCellInline = []core.Inline{}
			case "tcPr":
				inTcPr = true
			case "gridSpan":
				if inTcPr {
					for _, a := range t.Attr {
						if a.Name.Local == "val" {
							if n, e := strconv.Atoi(a.Value); e == nil {
								curCell.ColSpan = n
							}
						}
					}
				}
			case "vMerge":
				if inTcPr {
					val := ""
					for _, a := range t.Attr {
						if a.Name.Local == "val" {
							val = a.Value
						}
					}
					// restart：纵向合并起点；continue：被合并区域（仍保留占位单元格以维持列对齐）
					if val == "" || val == "restart" {
						curCell.RowSpan = 1
					}
				}
			case "p":
				for _, b := range parseParagraph(dec) {
					if b == nil {
						continue
					}
					if p, ok := b.(*core.Paragraph); ok {
						curCellInline = append(curCellInline, p.Inline...)
					} else if h, ok := b.(*core.Heading); ok {
						curCellInline = append(curCellInline, h.Inline...)
					}
					// 表格单元格内的分页符忽略（单元格内不分页）
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "tcPr":
				inTcPr = false
			case "tc":
				flushCell()
			case "tr":
				tbl.Rows = append(tbl.Rows, curRow)
			case "tbl":
				return tbl
			}
		}
	}
	return tbl
}

// === OMML → LaTeX 转换（覆盖常见结构）===

func serializeStart(t xml.StartElement) string {
	var sb strings.Builder
	sb.WriteString("<" + t.Name.Local)
	for _, a := range t.Attr {
		sb.WriteString(" " + a.Name.Local + `="` + a.Value + `"`)
	}
	sb.WriteString(">")
	return sb.String()
}

// collectElement 从 dec 中消费掉名为 name 的元素（含其全部子节点），
// 将其完整 XML（含起始标签已由外部写入 mathXML）追加到 out。
func collectElement(dec *xml.Decoder, out *strings.Builder, name string) {
	depth := 1
	for {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			out.WriteString(serializeStart(t))
		case xml.CharData:
			out.Write(t)
		case xml.EndElement:
			out.WriteString("</" + t.Name.Local + ">")
			depth--
			if depth == 0 && t.Name.Local == name {
				return
			}
		}
	}
}

// ommlToLatex 将 OMML 片段转为 LaTeX。失败返回空字符串。
func ommlToLatex(omml string) string {
	dec := xml.NewDecoder(strings.NewReader(omml))
	dec.Strict = false
	var sb strings.Builder
	ok := false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		if start, ok2 := tok.(xml.StartElement); ok2 {
			if start.Name.Local == "oMath" || start.Name.Local == "oMathPara" {
				ok = true
				writeOMMLChildren(dec, &sb)
			}
		}
	}
	if !ok {
		return ""
	}
	return strings.TrimSpace(sb.String())
}

// writeOMMLChildren 解析 OMML 子元素直到匹配当前元素的结束标签。
func writeOMMLChildren(dec *xml.Decoder, sb *strings.Builder) {
	depth := 1
	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			writeOMMLElement(dec, sb, t)
		case xml.EndElement:
			depth--
		}
	}
}

// writeOMMLElement 转换单个 OMML 元素。子元素文本通过 dec 消费。
func writeOMMLElement(dec *xml.Decoder, sb *strings.Builder, t xml.StartElement) {
	switch t.Name.Local {
	case "oMath", "oMathPara":
		writeOMMLChildren(dec, sb)
	case "f": // 分数
		sb.WriteString("\\frac{")
		skipTo(dec, sb, "num")
		skipTo(dec, sb, "den")
		sb.WriteString("}")
	case "num":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}{")
	case "den":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}")
	case "rad": // 根式
		sb.WriteString("\\sqrt{")
		skipTo(dec, sb, "deg")
		skipTo(dec, sb, "e")
		sb.WriteString("}")
	case "sqrt": // 简单根号
		sb.WriteString("\\sqrt{")
		writeOMMLChildren(dec, sb)
		sb.WriteString("}")
	case "deg":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}{")
	case "e":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}")
	case "sup": // 上标
		sb.WriteString("^{")
		skipTo(dec, sb, "e")
		sb.WriteString("}")
	case "sub": // 下标
		sb.WriteString("_{")
		skipTo(dec, sb, "e")
		sb.WriteString("}")
	case "sSubSup":
		sb.WriteString("_{")
		skipTo(dec, sb, "sub")
		sb.WriteString("}^{")
		skipTo(dec, sb, "sup")
		sb.WriteString("}")
	case "sSup":
		sb.WriteString("^{")
		skipTo(dec, sb, "sup")
		sb.WriteString("}")
	case "subArg":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}{")
	case "supArg":
		writeOMMLChildren(dec, sb)
		sb.WriteString("}")
	case "d": // 定界符（括号）
		sb.WriteString("\\left(")
		skipTo(dec, sb, "e")
		sb.WriteString("\\right)")
	case "nary": // 求和/积分等
		sb.WriteString(naryCmd(t))
		sb.WriteString("_{")
		skipTo(dec, sb, "sub")
		sb.WriteString("}^{")
		skipTo(dec, sb, "sup")
		sb.WriteString("}")
		skipTo(dec, sb, "e")
	case "acc": // 帽子符号
		sb.WriteString("\\hat{")
		skipTo(dec, sb, "e")
		sb.WriteString("}")
	case "r": // 公式文本 run
		writeOMMLChildren(dec, sb)
	case "t", "i", "lit": // 文本/标识符/字面量
		sb.WriteString(ommlText(readCharData(dec)))
	default:
		writeOMMLChildren(dec, sb)
	}
}

// skipTo 跳过直到遇到名为 name 的子元素，然后转换它。
func skipTo(dec *xml.Decoder, sb *strings.Builder, name string) {
	depth := 1
	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if t.Name.Local == name {
				writeOMMLElement(dec, sb, t)
			}
		case xml.EndElement:
			depth--
		}
	}
}

func naryCmd(_ xml.StartElement) string { return "\\sum" }

// ommlText 将 OMML 文本中的特殊字符映射为 LaTeX。
func ommlText(s string) string {
	repl := map[string]string{
		"∑": "\\sum", "∫": "\\int", "∏": "\\prod", "√": "\\sqrt",
		"α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta",
		"θ": "\\theta", "λ": "\\lambda", "μ": "\\mu", "π": "\\pi",
		"σ": "\\sigma", "φ": "\\phi", "ω": "\\omega", "∞": "\\infty",
		"≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx",
		"×": "\\times", "÷": "\\div", "±": "\\pm", "→": "\\to",
		"∈": "\\in", "∀": "\\forall", "∃": "\\exists", "∇": "\\nabla",
	}
	for k, v := range repl {
		s = strings.ReplaceAll(s, k, v)
	}
	return s
}

// readCharData 读取元素内的文本
func readCharData(dec *xml.Decoder) string {
        var sb strings.Builder
        for {
                tok, err := dec.Token()
                if err != nil {
                        return sb.String()
                }
                switch t := tok.(type) {
                case xml.CharData:
                        sb.Write(t)
                case xml.EndElement:
                        return sb.String()
                }
        }
}

func readOnOffAttr(t xml.StartElement) bool {
        for _, a := range t.Attr {
                if a.Name.Local == "val" {
                        v := strings.ToLower(a.Value)
                        return v == "" || v == "1" || v == "true" || v == "on"
                }
        }
        return true // 无 val 属性默认开启
}

// parseCoreProps 解析 docProps/core.xml 提取元数据
func parseCoreProps(r io.Reader, meta *core.Meta) {
        dec := xml.NewDecoder(r)
        dec.Strict = false
        depth := 0
        for {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        // 只处理 coreProperties 的直接子元素（depth==2）
                        if depth == 2 {
                                text := readCharData(dec)
                                depth-- // readCharData 消耗了 EndElement
                                switch t.Name.Local {
                                case "title":
                                        meta.Title = strings.TrimSpace(text)
                                case "creator":
                                        meta.Author = strings.TrimSpace(text)
                                case "subject":
                                        meta.Subject = strings.TrimSpace(text)
                                case "description":
                                        meta.Description = strings.TrimSpace(text)
                                case "language":
                                        meta.Language = strings.TrimSpace(text)
                                case "created":
                                        meta.CreatedAt = strings.TrimSpace(text)
                                case "modified":
                                        meta.ModifiedAt = strings.TrimSpace(text)
                                }
                        }
                case xml.EndElement:
                        depth--
                }
        }
}
