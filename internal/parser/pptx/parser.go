// Package pptx 实现 OOXML .pptx 演示文稿格式的自研解析器
// 结构：
//   ppt/presentation.xml   ← 主文件，定义幻灯片顺序
//   ppt/slides/slide1.xml  ← 每张幻灯片
//   ppt/slides/_rels/slideN.xml.rels ← 幻灯片内资源（图片 rId→media）
//   ppt/media/             ← 嵌入的图片字节
//   ppt/slideLayouts/      ← 布局
//   ppt/slideMasters/      ← 母版
//
// 容错策略：与 docx 解析器一致
package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".pptx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
	return strings.HasSuffix(strings.ToLower(path), ".pptx")
}

// Parse 解析 pptx 为 UDM
// 每张幻灯片转换为一个 RawBlock（kind="slide"），
// 包含 title、bullets、notes 以及完整的 shapes（文本/矩形/图片几何体），
// 以便前端真正渲染幻灯片版面。
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	warnings := []core.Warning{}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, warnings, fmt.Errorf("read pptx: %w", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, warnings, fmt.Errorf("open zip: %w", err)
	}

	files := make(map[string]*zip.File)
	for _, f := range zr.File {
		files[f.Name] = f
	}

	// 收集所有 slide 文件，按编号排序
	var slideNames []string
	for name := range files {
		if strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml") {
			slideNames = append(slideNames, name)
		}
	}
	sort.Slice(slideNames, func(i, j int) bool {
		return extractSlideNum(slideNames[i]) < extractSlideNum(slideNames[j])
	})

	// 幻灯片页面尺寸（EMU），默认 16:9
	pageWEMU, pageHEMU := int64(12192000), int64(6858000)
	if pf, ok := files["ppt/presentation.xml"]; ok {
		if prc, e := pf.Open(); e == nil {
			pageWEMU, pageHEMU = parsePresentationSize(prc)
			prc.Close()
		}
	}

	if len(slideNames) == 0 {
		return nil, warnings, fmt.Errorf("no slides found in pptx")
	}

	doc := &core.Document{
		Meta:   core.Meta{Title: "Presentation"},
		Blocks: []core.Block{},
	}

	// 提取元数据
	if coreFile, ok := files["docProps/core.xml"]; ok {
		if rc, err := coreFile.Open(); err == nil {
			parseCoreProps(rc, &doc.Meta)
			rc.Close()
		}
	}

	// 解析每张幻灯片
	for _, slideName := range slideNames {
		f := files[slideName]
		rc, err := f.Open()
		if err != nil {
			warnings = append(warnings, core.Warning{
				Level: "warn", Stage: "unzip",
				Message: fmt.Sprintf("open %s: %v", slideName, err),
			})
			continue
		}
		relsName := slideRelsName(slideName)
		var rels map[string]string
		if rf, ok := files[relsName]; ok {
			if rrc, e := rf.Open(); e == nil {
				rels = parseRels(rrc)
				rrc.Close()
			}
		}
		slide := parseSlide(rc, slideName, files, rels)
		rc.Close()

		// 幻灯片标题作为 Heading，正文作为段落列表（供大纲视图使用）
		if slide.Title != "" {
			doc.Blocks = append(doc.Blocks, &core.Heading{
				Level:  2,
				Inline: []core.Inline{core.Text{Content: slide.Title, Bold: true}},
			})
		}
		for _, b := range slide.Bullets {
			doc.Blocks = append(doc.Blocks, &core.BulletList{
				Items: [][]core.Block{{
					&core.Paragraph{Inline: []core.Inline{core.Text{Content: b}}},
				}},
				Ordered: false,
			})
		}
		// 保存原始信息到 RawBlock（含完整 shapes）
		doc.Blocks = append(doc.Blocks, &core.RawBlock{
			Kind: "slide",
			Data: map[string]any{
				"slideNum":  extractSlideNum(slideName),
				"slideName": slideName,
				"title":     slide.Title,
				"bullets":   slide.Bullets,
				"notes":     slide.Notes,
				"bg":        slide.Bg,
				"shapes":    slide.Shapes,
				"pageW":     pageWEMU,
				"pageH":     pageHEMU,
			},
		})
	}

	return doc, warnings, nil
}

// slideRelsName 由 ppt/slides/slideN.xml 得到 ppt/slides/_rels/slideN.xml.rels
func slideRelsName(slideName string) string {
	base := slideName
	if i := strings.LastIndex(base, "/"); i >= 0 {
		dir := base[:i]
		file := base[i+1:]
		return dir + "/_rels/" + file + ".rels"
	}
	return "_rels/" + base + ".rels"
}

// parsePresentationSize 读取 ppt/presentation.xml 的 <p:sldSz cx cy/>（EMU）。
// 默认返回 16:9 (12192000 x 6858000)。
func parsePresentationSize(r io.Reader) (int64, int64) {
	w, h := int64(12192000), int64(6858000)
	dec := xml.NewDecoder(r)
	dec.Strict = false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		t, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if t.Name.Local == "sldSz" {
			for _, a := range t.Attr {
				switch a.Name.Local {
				case "cx":
					w = atoi64(a.Value)
				case "cy":
					h = atoi64(a.Value)
				}
			}
			break
		}
	}
	return w, h
}

// parseRels 解析 .rels 文件，返回 rId -> Target
func parseRels(r io.Reader) map[string]string {
	out := map[string]string{}
	dec := xml.NewDecoder(r)
	dec.Strict = false
	for {
		tok, err := dec.Token()
		if err != nil {
			return out
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "Relationship" {
			var id, target string
			for _, a := range se.Attr {
				switch a.Name.Local {
				case "Id":
					id = a.Value
				case "Target":
					target = a.Value
				}
			}
			if id != "" && target != "" {
				out[id] = target
			}
		}
	}
}

// shapeDef 描述单个形状（文本/矩形/图片），几何单位均为 EMU
type shapeDef struct {
	Kind   string `json:"kind"` // text | rect | pic
	X      int64  `json:"x"`
	Y      int64  `json:"y"`
	Cx     int64  `json:"cx"`
	Cy     int64  `json:"cy"`
	Fill   string `json:"fill,omitempty"` // 填充色 #RRGGBB
	Text   string `json:"text,omitempty"`
	Color  string `json:"color,omitempty"` // 文字颜色
	SizePt int    `json:"sizePt,omitempty"`
	Bold   bool   `json:"bold,omitempty"`
	Align  string `json:"align,omitempty"`  // l|c|r
	Vanchor string `json:"vanchor,omitempty"` // t|ctr|b
	Img    string `json:"img,omitempty"`   // 图片 data URL
}

type slideContent struct {
	Title   string
	Bullets []string
	Notes   string
	Bg      string
	Shapes  []shapeDef
}

// parseSlide 解析单张幻灯片 XML，提取形状（文本/矩形/图片）
func parseSlide(r io.Reader, name string, files map[string]*zip.File, rels map[string]string) *slideContent {
	slide := &slideContent{}
	dec := xml.NewDecoder(r)
	dec.Strict = false

	// 当前形状构建状态
	var shapes []shapeDef
	var cur *shapeDef
	var curBlipRID string
	// 当前文本形状内的段落/文本累积
	var paraText strings.Builder
	var paraAlign string
	var runColor string
	var runSize int
	var runBold bool
	var inTxBody, inPara, inRun, inPic, inBlipFill, inBg bool
	var bodyVanchor string

	flushParagraph := func() {
		if cur == nil {
			paraText.Reset()
			paraAlign = ""
			return
		}
		t := strings.TrimSpace(paraText.String())
		if cur.Text == "" {
			cur.Text = t
		} else if t != "" {
			cur.Text += "\n" + t
		}
		if cur.Align == "" {
			cur.Align = mapAlign(paraAlign)
		}
		if cur.Color == "" {
			cur.Color = runColor
		}
		if cur.SizePt == 0 {
			cur.SizePt = runSize
		}
		if !cur.Bold {
			cur.Bold = runBold
		}
		paraText.Reset()
		paraAlign = ""
		runColor = ""
		runSize = 0
		runBold = false
	}

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}

		switch t := tok.(type) {
		case xml.StartElement:
			local := t.Name.Local
			switch local {
			case "sp":
				cur = &shapeDef{Kind: "text"}
				inTxBody = false
			case "pic":
				cur = &shapeDef{Kind: "pic"}
				inPic = true
			case "xfrm":
				// 形状/图片的几何容器
			case "off":
				if cur != nil {
					for _, a := range t.Attr {
						switch a.Name.Local {
						case "x":
							cur.X = atoi64(a.Value)
						case "y":
							cur.Y = atoi64(a.Value)
						}
					}
				}
			case "ext":
				if cur != nil {
					for _, a := range t.Attr {
						switch a.Name.Local {
						case "cx":
							cur.Cx = atoi64(a.Value)
						case "cy":
							cur.Cy = atoi64(a.Value)
						}
					}
				}
			case "txBody":
				inTxBody = true
			case "p":
				if inTxBody {
					inPara = true
					paraText.Reset()
					paraAlign = ""
				}
			case "pPr":
				if inPara {
					for _, a := range t.Attr {
						if a.Name.Local == "algn" {
							paraAlign = a.Value
						}
					}
				}
			case "bodyPr":
				for _, a := range t.Attr {
					if a.Name.Local == "anchor" {
						bodyVanchor = mapVanchor(a.Value)
					}
				}
			case "r":
				if inPara {
					inRun = true
					runColor = ""
					runSize = 0
					runBold = false
				}
			case "rPr":
				if inRun {
					for _, a := range t.Attr {
						switch a.Name.Local {
						case "sz":
							runSize = atoi(a.Value) / 100
						case "b":
							runBold = a.Value == "1" || a.Value == "true"
						}
					}
				}
			case "solidFill":
				// 可能是形状填充或文字颜色，根据上下文判断
			case "srgbClr":
				var val string
				for _, a := range t.Attr {
					if a.Name.Local == "val" {
						val = "#" + strings.ToUpper(a.Value)
					}
				}
				if val != "" {
					if inBg {
						slide.Bg = val
					} else if inRun && inPara {
						runColor = val
					} else if cur != nil && !inTxBody {
						cur.Fill = val
					} else if cur != nil {
						cur.Color = val
					}
				}
			case "t":
				if inRun {
					text := readCharData(dec)
					paraText.WriteString(text)
				}
			case "blipFill":
				if inPic {
					inBlipFill = true
				}
			case "blip":
				if inBlipFill {
					for _, a := range t.Attr {
						if a.Name.Local == "embed" {
							curBlipRID = a.Value
						}
					}
				}
			case "bg":
				inBg = true
			case "bgPr":
				inBg = true
			}
		case xml.EndElement:
			local := t.Name.Local
			switch local {
			case "sp":
				if cur != nil {
					// 段落结束已 flushParagraph，此处不再重复 flush（否则 runSize 已被清空会覆盖 SizePt）
					if cur.Vanchor == "" {
						cur.Vanchor = bodyVanchor
					}
					shapes = append(shapes, *cur)
					cur = nil
					inTxBody = false
					bodyVanchor = ""
				}
			case "pic":
				if cur != nil {
					// 解析图片字节
					if curBlipRID != "" && rels != nil {
						if target, ok := rels[curBlipRID]; ok {
							if img, ok := loadMedia(files, name, target); ok {
								cur.Img = img
							}
						}
					}
					shapes = append(shapes, *cur)
					cur = nil
					inPic = false
					inBlipFill = false
					curBlipRID = ""
				}
			case "p":
				if inPara {
					flushParagraph()
					inPara = false
				}
			case "r":
				inRun = false
			case "txBody":
				inTxBody = false
			case "blipFill":
				inBlipFill = false
			case "srgbClr":
				// 背景颜色：在 bgPr 内
			case "bgPr":
				// 背景已在 srgbClr 处赋值
			}
		}
	}

	// 推断标题与 bullets：取最大的文本形状作为标题，其余作为要点
	var texts []string
	for _, s := range shapes {
		if s.Kind == "text" && strings.TrimSpace(s.Text) != "" {
			texts = append(texts, s.Text)
		}
	}
	if len(texts) > 0 {
		slide.Title = texts[0]
		slide.Bullets = texts[1:]
	}

	slide.Shapes = shapes
	return slide
}

// loadMedia 根据 rels 的 Target 解析图片字节，返回 data URL
func loadMedia(files map[string]*zip.File, slideName, target string) (string, bool) {
	// target 形如 "../media/image1.png"，相对 ppt/slides/ 解析
	dir := "ppt/slides"
	if i := strings.LastIndex(slideName, "/"); i >= 0 {
		dir = slideName[:i]
	}
	// 逐层解析 ".."
	parts := strings.Split(strings.TrimPrefix(target, "/"), "/")
	var stack []string
	for _, p := range parts {
		switch p {
		case "", ".":
			// skip
		case "..":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		default:
			stack = append(stack, p)
		}
	}
	_ = dir
	mediaPath := strings.Join(stack, "/")
	f, ok := files[mediaPath]
	if !ok {
		return "", false
	}
	rc, err := f.Open()
	if err != nil {
		return "", false
	}
	defer rc.Close()
	raw, err := io.ReadAll(rc)
	if err != nil {
		return "", false
	}
	mime := mimeOf(mediaPath)
	enc := base64.StdEncoding.EncodeToString(raw)
	return "data:" + mime + ";base64," + enc, true
}

func mimeOf(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".bmp"):
		return "image/bmp"
	case strings.HasSuffix(lower, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func mapAlign(a string) string {
	switch a {
	case "ctr":
		return "c"
	case "r":
		return "r"
	default:
		return "l"
	}
}

func mapVanchor(a string) string {
	switch a {
	case "t":
		return "t"
	case "b":
		return "b"
	default:
		return "ctr"
	}
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func atoi64(s string) int64 {
	n := int64(0)
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int64(r-'0')
	}
	return n
}

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

// extractSlideNum 从 "ppt/slides/slide1.xml" 提取 1
func extractSlideNum(name string) int {
	s := name
	s = strings.TrimPrefix(s, "ppt/slides/slide")
	s = strings.TrimSuffix(s, ".xml")
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// parseCoreProps 解析 docProps/core.xml 提取元数据（与 docx 共用逻辑）
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
			if depth == 2 {
				text := readCharData(dec)
				depth--
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
				}
			}
		case xml.EndElement:
			depth--
		}
	}
}
