// reader.go — docgo 增强解析器
// 解析 docx 时保留文档结构：标题/段落/列表/表格/代码块/run 样式

package docgo

import (
	"encoding/xml"
	"io"
	"strings"
)

// === 结构化 Getters ===

// Headings 返回所有标题
func (d *Document) Headings() []*Heading {
	var hs []*Heading
	for _, e := range d.elements {
		if h, ok := e.(*Heading); ok {
			hs = append(hs, h)
		}
	}
	return hs
}

// Tables 返回所有表格
func (d *Document) Tables() []*Table {
	var ts []*Table
	for _, e := range d.elements {
		if t, ok := e.(*Table); ok {
			ts = append(ts, t)
		}
	}
	return ts
}

// Lists 返回所有列表
func (d *Document) Lists() []*List {
	var ls []*List
	for _, e := range d.elements {
		if l, ok := e.(*List); ok {
			ls = append(ls, l)
		}
	}
	return ls
}

// Images 返回所有图片
func (d *Document) Images() []*Image {
	var ims []*Image
	for _, e := range d.elements {
		if im, ok := e.(*Image); ok {
			ims = append(ims, im)
		}
	}
	return ims
}

// CodeBlocks 返回所有代码块
func (d *Document) CodeBlocks() []*CodeBlock {
	var cbs []*CodeBlock
	for _, e := range d.elements {
		if cb, ok := e.(*CodeBlock); ok {
			cbs = append(cbs, cb)
		}
	}
	return cbs
}

// ElementCount 返回元素总数
func (d *Document) ElementCount() int { return len(d.elements) }

// === 增强解析器 ===
// 替换原 parseDocumentXML，保留结构信息

type docxBody struct {
	Paragraphs []docxPara `xml:"p"`
	Tables     []docxTbl  `xml:"tbl"`
}

type docxPara struct {
	PPR  *docxPPR  `xml:"pPr"`
	Runs []docxRun `xml:"r"`
}

type docxPPR struct {
	PStyle struct {
		Val string `xml:"val,attr"`
	} `xml:"pStyle"`
	NumPr *struct {
		Ilvl  struct{ Val string `xml:"val,attr"` } `xml:"ilvl"`
		NumId struct{ Val string `xml:"val,attr"` } `xml:"numId"`
	} `xml:"numPr"`
	Jc struct{ Val string `xml:"val,attr"` } `xml:"jc"`
}

type docxRun struct {
	RPR *docxRPR `xml:"rPr"`
	T   string   `xml:"t"`
}

type docxRPR struct {
	B         *struct{} `xml:"b"`
	I         *struct{} `xml:"i"`
	U         *struct{} `xml:"u"`
	Strike    *struct{} `xml:"strike"`
	Color     struct{ Val string `xml:"val,attr"` } `xml:"color"`
	Sz        struct{ Val string `xml:"val,attr"` } `xml:"sz"`
	RFonts    struct {
		Ascii string `xml:"ascii,attr"`
	} `xml:"rFonts"`
	Highlight struct{ Val string `xml:"val,attr"` } `xml:"highlight"`
	VertAlign struct{ Val string `xml:"val,attr"` } `xml:"vertAlign"`
}

type docxTbl struct {
	Rows []docxRow `xml:"tr"`
}

type docxRow struct {
	Cells []docxCell `xml:"tc"`
}

type docxCell struct {
	Paragraphs []docxPara `xml:"p"`
}

// parseDocumentStructural 结构化解析 document.xml
func parseDocumentStructural(r io.Reader, doc *Document) {
	data, _ := io.ReadAll(r)
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose

	// 手动遍历顶层元素，保持顺序
	parseBodyElements(dec, doc)
}

// parseBodyElements 按顺序解析 body 下的块级元素
func parseBodyElements(dec *xml.Decoder, doc *Document) {
	for {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch se := tok.(type) {
		case xml.StartElement:
			switch se.Name.Local {
			case "p":
				p := parsePara(dec)
				applyParaToDoc(p, doc)
			case "tbl":
				tbl := parseTable(dec)
				doc.elements = append(doc.elements, tbl)
			}
		}
	}
}

// parsePara 解析 <w:p>
func parsePara(dec *xml.Decoder) *docxPara {
	p := &docxPara{}
	for {
		tok, err := dec.Token()
		if err != nil {
			return p
		}
		switch se := tok.(type) {
		case xml.StartElement:
			switch se.Name.Local {
			case "pPr":
				ppr := &docxPPR{}
				if err := dec.DecodeElement(ppr, &se); err == nil {
					p.PPR = ppr
				}
			case "r":
				r := parseRun(dec)
				p.Runs = append(p.Runs, r)
			}
		case xml.EndElement:
			if se.Name.Local == "p" {
				return p
			}
		}
	}
}

// parseRun 解析 <w:r>
func parseRun(dec *xml.Decoder) docxRun {
	r := docxRun{}
	for {
		tok, err := dec.Token()
		if err != nil {
			return r
		}
		switch se := tok.(type) {
		case xml.StartElement:
			switch se.Name.Local {
			case "rPr":
				rpr := &docxRPR{}
				if err := dec.DecodeElement(rpr, &se); err == nil {
					r.RPR = rpr
				}
			case "t":
				// 读取文本内容
				inner, err := dec.Token()
				if err == nil {
					if cd, ok := inner.(xml.CharData); ok {
						r.T += string(cd)
					}
				}
			}
		case xml.EndElement:
			if se.Name.Local == "r" {
				return r
			}
		}
	}
}

// parseTable 解析 <w:tbl>
func parseTable(dec *xml.Decoder) *Table {
	tbl := &Table{header: true, borderStyle: "single"}
	for {
		tok, err := dec.Token()
		if err != nil {
			return tbl
		}
		switch se := tok.(type) {
		case xml.StartElement:
			if se.Name.Local == "tr" {
				row := parseRow(dec)
				var cells []string
				for _, c := range row {
					var cellText strings.Builder
					for _, p := range c.Paragraphs {
						for _, r := range p.Runs {
							cellText.WriteString(r.T)
						}
					}
					cells = append(cells, cellText.String())
				}
				tbl.rows = append(tbl.rows, cells)
			}
		case xml.EndElement:
			if se.Name.Local == "tbl" {
				return tbl
			}
		}
	}
}

func parseRow(dec *xml.Decoder) []docxCell {
	var cells []docxCell
	for {
		tok, err := dec.Token()
		if err != nil {
			return cells
		}
		switch se := tok.(type) {
		case xml.StartElement:
			if se.Name.Local == "tc" {
				cell := docxCell{}
				if err := dec.DecodeElement(&cell, &se); err == nil {
					cells = append(cells, cell)
				}
			}
		case xml.EndElement:
			if se.Name.Local == "tr" {
				return cells
			}
		}
	}
}

// applyParaToDoc 根据段落样式将解析结果添加到文档
func applyParaToDoc(p *docxPara, doc *Document) {
	// 提取文本
	var fullText strings.Builder
	for _, r := range p.Runs {
		fullText.WriteString(r.T)
	}
	text := fullText.String()

	// 判断是否为标题
	styleVal := ""
	if p.PPR != nil {
		styleVal = p.PPR.PStyle.Val
	}
	upperStyle := strings.ToUpper(styleVal)
	if strings.HasPrefix(upperStyle, "HEADING") || strings.HasPrefix(upperStyle, "H") {
		level := extractLevel(upperStyle)
		if level > 0 && level <= 6 {
			doc.AddHeading(text, level)
			return
		}
	}

	// 判断是否为列表
	if p.PPR != nil && p.PPR.NumPr != nil {
		numID := p.PPR.NumPr.NumId.Val
		if numID != "" && numID != "0" {
			// 追加到最后一个列表或创建新列表
			if len(doc.elements) > 0 {
				if lastList, ok := doc.elements[len(doc.elements)-1].(*List); ok {
					lastList.items = append(lastList.items, text)
					return
				}
			}
			l := &List{items: []string{text}, ordered: numID == "2"}
			doc.elements = append(doc.elements, l)
			return
		}
	}

	// 判断是否为代码块（Consolas 字体或 Code 样式）
	if upperStyle == "CODE" || isAllCodeFont(p.Runs) {
		var codeText strings.Builder
		for _, r := range p.Runs {
			codeText.WriteString(r.T)
		}
		if codeText.Len() > 0 {
			doc.AddCodeBlock("", codeText.String())
			return
		}
	}

	// 普通段落：保留 run 样式
	para := &Paragraph{}
	for _, r := range p.Runs {
		run := Run{text: r.T}
		if r.RPR != nil {
			run.bold = r.RPR.B != nil
			run.italic = r.RPR.I != nil
			run.underline = r.RPR.U != nil
			run.strike = r.RPR.Strike != nil
			if r.RPR.Color.Val != "" {
				run.color = r.RPR.Color.Val
			}
			if r.RPR.Sz.Val != "" {
				if sz, e := atoiSafe(r.RPR.Sz.Val); e == nil {
					run.size = sz / 2 // OOXML sz 是 pt*2
				}
			}
			if r.RPR.RFonts.Ascii != "" {
				run.font = r.RPR.RFonts.Ascii
			}
			if r.RPR.Highlight.Val != "" {
				run.highlight = r.RPR.Highlight.Val
			}
			if r.RPR.VertAlign.Val == "superscript" {
				run.superscript = true
			}
			if r.RPR.VertAlign.Val == "subscript" {
				run.subscript = true
			}
		}
		para.runs = append(para.runs, run)
	}
	if p.PPR != nil && p.PPR.Jc.Val != "" {
		para.align = p.PPR.Jc.Val
	}
	if len(para.runs) == 0 && text == "" {
		return // 跳过空段落
	}
	doc.elements = append(doc.elements, para)
}

func isAllCodeFont(runs []docxRun) bool {
	hasFont := false
	for _, r := range runs {
		if r.RPR != nil && r.RPR.RFonts.Ascii != "" {
			hasFont = true
			f := strings.ToLower(r.RPR.RFonts.Ascii)
			if !strings.Contains(f, "consola") && !strings.Contains(f, "mono") && !strings.Contains(f, "courier") {
				return false
			}
		}
	}
	return hasFont && len(runs) > 0
}

func extractLevel(upperStyle string) int {
	// "HEADING1" -> 1, "H2" -> 2
	s := upperStyle
	if strings.HasPrefix(s, "HEADING") {
		s = strings.TrimPrefix(s, "HEADING")
	} else if strings.HasPrefix(s, "H") && len(s) > 1 {
		s = s[1:]
	} else {
		return 0
	}
	n, err := atoiSafe(s)
	if err != nil || n < 1 || n > 6 {
		return 0
	}
	return n
}

func atoiSafe(s string) (int, error) {
	n := 0
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return 0, errInvalid
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

var errInvalid = &parseError{"invalid number"}

type parseError struct{ msg string }

func (e *parseError) Error() string { return e.msg }
