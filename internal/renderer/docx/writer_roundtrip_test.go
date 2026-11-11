package docx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
	docxparser "github.com/zai/samoffice/internal/parser/docx"
)

// 1x1 透明 PNG
const testPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// zipEntry 读取 zip 内指定文件内容；不存在时 Fatal
func zipEntry(t *testing.T, zr *zip.Reader, name string) string {
	t.Helper()
	for _, f := range zr.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open %s: %v", name, err)
			}
			defer rc.Close()
			b, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			return string(b)
		}
	}
	t.Fatalf("zip entry %s not found", name)
	return ""
}

// buildRoundtripDoc 构造覆盖保存路径各丢失点的 UDM 文档
func buildRoundtripDoc() *core.Document {
	return &core.Document{
		Meta: core.Meta{Title: "Writer Roundtrip"},
		PageSetup: &core.PageSetup{
			WidthTwips: 11906, HeightTwips: 16838,
			Orientation: "landscape",
			MarginTop:   1440, MarginRight: 1440, MarginBottom: 1440, MarginLeft: 1440,
			Cols: 1,
		},
		Blocks: []core.Block{
			// 1) 表格：2x2，A1 加粗表头，第二行单元格跨 2 列
			&core.Table{
				Border: 1,
				Rows: [][]core.TableCell{
					{
						{Inline: []core.Inline{core.Text{Content: "A1", Bold: true}}, IsHeader: true},
						{Inline: []core.Inline{core.Text{Content: "B1"}}, IsHeader: true},
					},
					{
						{Inline: []core.Inline{core.Text{Content: "A2B2"}}, ColSpan: 2},
					},
				},
			},
			// 2) 图片：320x240 px
			&core.Image{Src: testPNG, Width: 320, Height: 240},
			// 3) 上标文本
			&core.Paragraph{Inline: []core.Inline{
				core.Text{Content: "E = mc"},
				core.Text{Content: "2", Superscript: true},
			}},
			// 4) 超链接
			&core.Paragraph{Inline: []core.Inline{
				&core.Hyperlink{URL: "https://example.com/docs", Text: []core.Inline{core.Text{Content: "link text"}}},
			}},
			// 5) 项目符号列表（numId 1）
			&core.BulletList{Items: [][]core.Block{
				{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "item one"}}}},
			}},
			// 6) 底纹 + 红头线边框 + 段落级字符间距
			&core.Paragraph{
				Inline: []core.Inline{core.Text{Content: "shaded para"}},
				Props:  map[string]any{"shading": "#FFF3CD", "border": "redBottom", "letterSpacing": "1px"},
			},
			// 7) 非重启分页符
			&core.PageBreak{},
			// 8) 脚注引用
			&core.Paragraph{Inline: []core.Inline{
				core.Text{Content: "见注"},
				core.FootnoteRef{Type: "footnote", Num: 1, Content: "脚注内容"},
			}},
		},
	}
}

// TestWriterRoundTrip 渲染 UDM → docx，再用仓库的 docx 解析器回读验证
func TestWriterRoundTrip(t *testing.T) {
	doc := buildRoundtripDoc()
	data, err := New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	// ZIP 可正常解压（隐式验证输出包完整性）
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open rendered docx as zip: %v", err)
	}

	docXML := zipEntry(t, zr, "word/document.xml")
	relsXML := zipEntry(t, zr, "word/_rels/document.xml.rels")
	ctXML := zipEntry(t, zr, "[Content_Types].xml")

	// === 表格 ===
	if !strings.Contains(docXML, "<w:tbl>") || !strings.Contains(docXML, "<w:tblGrid>") {
		t.Fatalf("document.xml should contain w:tbl/w:tblGrid")
	}
	if strings.Count(docXML, "<w:tr>") != 2 {
		t.Errorf("expected 2 table rows, got %d", strings.Count(docXML, "<w:tr>"))
	}
	if !strings.Contains(docXML, `<w:gridSpan w:val="2"/>`) {
		t.Errorf("colspan-2 cell should emit gridSpan")
	}
	if !strings.Contains(docXML, `w:fill="D9E2F3"`) {
		t.Errorf("header cells should have shading D9E2F3")
	}
	if !strings.Contains(docXML, "<w:tblBorders>") {
		t.Errorf("table borders missing")
	}

	// === 图片尺寸：320x240 px → EMU（1px = 9525 EMU）===
	if !strings.Contains(docXML, `<wp:extent cx="3048000" cy="2286000"/>`) {
		t.Errorf("image extent should be 3048000x2286000 EMU (320x240px), got: %s", segment(docXML, "wp:extent"))
	}

	// === 上标 ===
	if !strings.Contains(docXML, `<w:vertAlign w:val="superscript"/>`) {
		t.Errorf("superscript run missing vertAlign")
	}

	// === 超链接关系注册（修复文档损坏问题）===
	wantRel := "rId" + strconv.Itoa(hashString("https://example.com/docs"))
	if !strings.Contains(docXML, `<w:hyperlink r:id="`+wantRel+`"`) {
		t.Errorf("hyperlink should reference %s", wantRel)
	}
	if !strings.Contains(relsXML, `Id="`+wantRel+`"`) ||
		!strings.Contains(relsXML, `Target="https://example.com/docs"`) ||
		!strings.Contains(relsXML, `TargetMode="External"`) {
		t.Errorf("link relationship not registered in document.xml.rels: %s", relsXML)
	}
	if n := strings.Count(relsXML, `Id="`+wantRel+`"`); n != 1 {
		t.Errorf("relationship %s registered %d times, want 1", wantRel, n)
	}

	// === numbering.xml ===
	numXML := zipEntry(t, zr, "word/numbering.xml")
	if !strings.Contains(numXML, `<w:num w:numId="1">`) || !strings.Contains(numXML, `<w:num w:numId="2">`) {
		t.Errorf("numbering.xml should define numId 1 and 2: %s", numXML)
	}
	if !strings.Contains(numXML, `<w:numFmt w:val="bullet"/>`) || !strings.Contains(numXML, `<w:numFmt w:val="decimal"/>`) {
		t.Errorf("numbering.xml should contain bullet + decimal formats")
	}
	if !strings.Contains(ctXML, "/word/numbering.xml") {
		t.Errorf("[Content_Types].xml missing numbering override")
	}
	if !strings.Contains(relsXML, `Target="numbering.xml"`) {
		t.Errorf("document.xml.rels missing numbering relationship")
	}
	if !strings.Contains(docXML, `<w:numId w:val="1"/>`) {
		t.Errorf("bullet paragraph should reference numId 1")
	}

	// === 段落底纹 + 红头线 + 字符间距 ===
	if !strings.Contains(docXML, `w:fill="fff3cd"`) {
		t.Errorf("paragraph shading missing (want fill fff3cd)")
	}
	if !strings.Contains(docXML, `<w:bottom w:val="single" w:sz="12" w:space="1" w:color="C00000"/>`) {
		t.Errorf("redBottom border missing")
	}
	if !strings.Contains(docXML, `<w:spacing w:val="15"/>`) {
		t.Errorf("paragraph letterSpacing 1px should emit run w:spacing 15 twips")
	}

	// === 分页符（非重启）===
	if !strings.Contains(docXML, `<w:br w:type="page"/>`) {
		t.Errorf("non-restart page break should emit w:br type=page")
	}

	// === 页面设置：横向 ===
	if !strings.Contains(docXML, `<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>`) {
		t.Errorf("landscape page setup not rendered: %s", segment(docXML, "w:pgSz"))
	}

	// === 脚注引用 ===
	if !strings.Contains(docXML, `<w:t>[1]</w:t>`) {
		t.Errorf("footnote reference [1] missing")
	}

	// === 用仓库 docx 解析器回读 ===
	p := docxparser.New()
	doc2, warns, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse rendered docx: %v (warns=%v)", err, warns)
	}
	var tbl *core.Table
	for _, b := range doc2.Blocks {
		if tb, ok := b.(*core.Table); ok {
			tbl = tb
			break
		}
	}
	if tbl == nil {
		t.Fatalf("parsed document should contain a table (blocks=%d)", len(doc2.Blocks))
	}
	if len(tbl.Rows) != 2 {
		t.Fatalf("parsed table rows = %d, want 2", len(tbl.Rows))
	}
	if len(tbl.Rows[0]) != 2 {
		t.Fatalf("parsed row 0 cells = %d, want 2", len(tbl.Rows[0]))
	}
	if len(tbl.Rows[1]) != 1 || tbl.Rows[1][0].ColSpan != 2 {
		t.Fatalf("parsed row 1 should be one cell with ColSpan 2, got %+v", tbl.Rows[1])
	}
	// 文本内容回读（加粗表头单元格）
	if got := inlineText(tbl.Rows[0][0].Inline); got != "A1" {
		t.Errorf("cell A1 text = %q, want A1", got)
	}
}

// TestImageFloatAnchor 验证 float=left/right 的图片输出 wp:anchor 且使用指定尺寸
func TestImageFloatAnchor(t *testing.T) {
	doc := &core.Document{
		Meta: core.Meta{Title: "Float"},
		Blocks: []core.Block{
			&core.Image{Src: testPNG, Width: 640, Height: 480, Float: "right"},
		},
	}
	data, err := New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	docXML := zipEntry(t, zr, "word/document.xml")
	if !strings.Contains(docXML, `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0"`) {
		t.Errorf("floating image should emit wp:anchor with behindDoc=0")
	}
	if !strings.Contains(docXML, `<wp:wrapSquare wrapText="both"/>`) {
		t.Errorf("anchor should use square wrap")
	}
	if !strings.Contains(docXML, `<wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>`) {
		t.Errorf("anchor positionH should align right")
	}
	// 640x480 px → 6096000 x 4572000 EMU
	if !strings.Contains(docXML, `<wp:extent cx="6096000" cy="4572000"/>`) {
		t.Errorf("floating image extent should honor width/height: %s", segment(docXML, "wp:extent"))
	}
}

// TestParaBorderObjectForm 验证对象形态的段落边框（防御性支持）
func TestParaBorderObjectForm(t *testing.T) {
	got := paraBorderXML(map[string]any{
		"top": map[string]any{"color": "#FF0000", "size": 1},
	})
	if !strings.Contains(got, `<w:top w:val="single" w:sz="8" w:space="1" w:color="ff0000"/>`) {
		t.Errorf("object border form: got %s", got)
	}
	got = paraBorderXML(map[string]any{"sides": "all", "color": "3366CC", "size": 0.5})
	for _, side := range []string{"top", "left", "bottom", "right"} {
		if !strings.Contains(got, `<w:`+side+` w:val="single" w:sz="4" w:space="1" w:color="3366cc"/>`) {
			t.Errorf("sides=all border missing %s: got %s", side, got)
		}
	}
}

// TestLetterSpacingTwips 单位换算
func TestLetterSpacingTwips(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"1px", 15},
		{"0.5px", 7}, // 7.5 截断为 7
		{"2pt", 40},
		{"1em", 240}, // 16px 基准
		{"", 0},
		{"abc", 0},
	}
	for _, c := range cases {
		if got := letterSpacingTwips(c.in); got != c.want {
			t.Errorf("letterSpacingTwips(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

// TestHighlightExactColor 非调色板高亮色 → shd 底纹而非强制黄色
func TestHighlightExactColor(t *testing.T) {
	if got := highlightXML("#FFE08A"); got != `<w:shd w:val="clear" w:color="auto" w:fill="ffe08a"/>` {
		t.Errorf("exact highlight color should use shd, got %s", got)
	}
	if got := highlightXML("#FFFF00"); got != `<w:highlight w:val="yellow"/>` {
		t.Errorf("palette highlight color should use w:highlight, got %s", got)
	}
}

// TestUDMJSONParse 验证前端 convert.ts 下发的 JSON 字段能被 UDM 正确反序列化
func TestUDMJSONParse(t *testing.T) {
	jsonStr := `{
                "meta": {"title": "T"},
                "pageSetup": {"widthTwips": 11906, "heightTwips": 16838, "orientation": "landscape",
                        "marginTop": 1440, "marginRight": 1300, "marginBottom": 1440, "marginLeft": 1300, "cols": 2},
                "blocks": [
                        {"rows": [[{"inline": [{"content": "A"}], "colspan": 2, "rowspan": 1}]]},
                        {"inline": [{"content": "x2", "superscript": true}, {"content": "gap", "letterSpacing": "1px"}]},
                        {"src": "data:image/png;base64,xxx", "width": 320, "height": 240, "float": "left", "align": "left"},
                        {"inline": [{"content": "p"}], "props": {"border": "redBottom", "shading": "#FFF3CD", "letterSpacing": "0.5em"}}
                ]
        }`
	var doc core.Document
	if err := json.Unmarshal([]byte(jsonStr), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if doc.PageSetup == nil || doc.PageSetup.Orientation != "landscape" || doc.PageSetup.Cols != 2 || doc.PageSetup.MarginRight != 1300 {
		t.Fatalf("pageSetup not parsed: %+v", doc.PageSetup)
	}
	tbl, ok := doc.Blocks[0].(*core.Table)
	if !ok {
		t.Fatalf("block 0 should be Table, got %T", doc.Blocks[0])
	}
	if tbl.Rows[0][0].ColSpan != 2 {
		t.Errorf("lowercase colspan should map to ColSpan, got %d", tbl.Rows[0][0].ColSpan)
	}
	p1, ok := doc.Blocks[1].(*core.Paragraph)
	if !ok {
		t.Fatalf("block 1 should be Paragraph, got %T", doc.Blocks[1])
	}
	txt, _ := p1.Inline[0].(*core.Text)
	if txt == nil || !txt.Superscript {
		t.Errorf("superscript flag not parsed: %+v", p1.Inline[0])
	}
	txt2, _ := p1.Inline[1].(*core.Text)
	if txt2 == nil || txt2.LetterSpacing != "1px" {
		t.Errorf("letterSpacing not parsed: %+v", p1.Inline[1])
	}
	im, ok := doc.Blocks[2].(*core.Image)
	if !ok || im.Width != 320 || im.Height != 240 || im.Float != "left" || im.Align != "left" {
		t.Errorf("image width/height/float/align not parsed: %+v", doc.Blocks[2])
	}
	p3, _ := doc.Blocks[3].(*core.Paragraph)
	if p3.Props["border"] != "redBottom" || p3.Props["shading"] != "#FFF3CD" {
		t.Errorf("para props not parsed: %+v", p3.Props)
	}
}

func inlineText(inlines []core.Inline) string {
	var sb strings.Builder
	for _, in := range inlines {
		switch t := in.(type) {
		case core.Text:
			sb.WriteString(t.Content)
		case *core.Text:
			sb.WriteString(t.Content)
		}
	}
	return sb.String()
}

// segment 截取包含 name 标签的片段用于失败信息
func segment(s, name string) string {
	i := strings.Index(s, "<"+name)
	if i < 0 {
		return "(not found: " + name + ")"
	}
	j := strings.Index(s[i:], ">")
	if j < 0 || i+j+1 > len(s) {
		return s[i:]
	}
	end := i + j + 1
	if end-i > 200 {
		end = i + 200
	}
	return s[i:end]
}
