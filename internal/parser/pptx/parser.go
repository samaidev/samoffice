// Package pptx 实现 OOXML .pptx 演示文稿格式的自研解析器
// 结构：
//   ppt/presentation.xml   ← 主文件，定义幻灯片顺序
//   ppt/slides/slide1.xml  ← 每张幻灯片
//   ppt/slideLayouts/      ← 布局
//   ppt/slideMasters/      ← 母版
//
// 容错策略：与 docx 解析器一致
package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/zai/gooffice/internal/core"
)

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".pptx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
	return strings.HasSuffix(strings.ToLower(path), ".pptx")
}

// Parse 解析 pptx 为 UDM
// 每张幻灯片转换为一个 RawBlock（kind="slide"），
// 包含 title 和 bullets 字段
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
		slide := parseSlide(rc, slideName)
		rc.Close()

		// 幻灯片标题作为 Heading，正文作为段落列表
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
		// 保存原始信息到 RawBlock
		doc.Blocks = append(doc.Blocks, &core.RawBlock{
			Kind: "slide",
			Data: map[string]any{
				"slideNum":  extractSlideNum(slideName),
				"slideName": slideName,
				"title":     slide.Title,
				"bullets":   slide.Bullets,
				"notes":     slide.Notes,
			},
		})
	}

	return doc, warnings, nil
}

type slideContent struct {
	Title   string
	Bullets []string
	Notes   string
}

// parseSlide 解析单张幻灯片 XML
// OOXML PresentationML 结构：
//   <p:sld>
//     <p:cSld>
//       <p:spTree>
//         <p:sp>...</p:sp>  ← 形状（文本框等）
//       </p:spTree>
//     </p:cSld>
//   </p:sld>
func parseSlide(r io.Reader, name string) *slideContent {
	slide := &slideContent{}
	dec := xml.NewDecoder(r)
	dec.Strict = false

	var inTextBody bool
	var inParagraph bool
	var curText strings.Builder
	var texts []string

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
			if t.Name.Local == "txBody" {
				inTextBody = true
			}
			if t.Name.Local == "p" && inTextBody {
				inParagraph = true
				curText.Reset()
			}
			if t.Name.Local == "t" && inParagraph {
				text := readCharData(dec)
				curText.WriteString(text)
			}
		case xml.EndElement:
			if t.Name.Local == "txBody" {
				inTextBody = false
			}
			if t.Name.Local == "p" && inParagraph {
				inParagraph = false
				text := strings.TrimSpace(curText.String())
				if text != "" {
					texts = append(texts, text)
				}
			}
		}
	}

	// 第一个文本作为标题，其余作为 bullets
	if len(texts) > 0 {
		slide.Title = texts[0]
		slide.Bullets = texts[1:]
	}

	return slide
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
	// 去掉前缀和后缀
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
