// Package docx 实现 OOXML .docx 格式的自研解析器
// 容错策略：ZIP 容错解压 + XML 宽松解析 + 未知元素保留
package docx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"github.com/zai/gooffice/internal/core"
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
				para := parseParagraph(dec)
				if para != nil {
					blocks = append(blocks, para)
				}
				depth--
			}
		case xml.EndElement:
			depth--
		}
	}
	return blocks, warnings
}

// parseParagraph 解析 <w:p> 段落
func parseParagraph(dec *xml.Decoder) *core.Paragraph {
	para := &core.Paragraph{Inline: []core.Inline{}}
	var inRun bool
	var curText core.Text

	for {
		tok, err := dec.Token()
		if err != nil {
			return para
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
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
			}
		case xml.EndElement:
			if t.Name.Local == "r" && inRun {
				if curText.Content != "" {
					para.Inline = append(para.Inline, curText)
				}
				inRun = false
			}
			if t.Name.Local == "p" {
				return para
			}
		}
	}
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
	for {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		text := readCharData(dec)
		switch start.Name.Local {
		case "title":
			meta.Title = text
		case "creator":
			meta.Author = text
		case "subject":
			meta.Subject = text
		case "description":
			meta.Description = text
		case "language":
			meta.Language = text
		case "created":
			meta.CreatedAt = text
		case "modified":
			meta.ModifiedAt = text
		}
	}
}
