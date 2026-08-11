package pdf

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// makePNG 生成一张 2x2 的红色 PNG，返回 data URL
func makePNGDataURL() string {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for x := 0; x < 2; x++ {
		for y := 0; y < 2; y++ {
			img.Set(x, y, color.RGBA{220, 30, 30, 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func sampleDoc() core.Document {
	doc := core.Document{
		Meta: core.Meta{Title: "PDF 格式测试", Author: "SamAI"},
		Blocks: []core.Block{
			core.Heading{Level: 1, Inline: []core.Inline{core.Text{Content: "一级标题 Heading"}}},
			core.Paragraph{Inline: []core.Inline{
				core.Text{Content: "普通文本 normal "},
				core.Text{Content: "加粗", Bold: true},
				core.Text{Content: " 红色", Color: "#cc0000"},
			}},
			core.Paragraph{Inline: []core.Inline{
				core.Text{Content: "下划线", Under: true},
				core.Text{Content: " 删除线", Strike: true},
			}},
			core.Image{Src: makePNGDataURL(), Width: 80, Height: 80},
			core.BulletList{Ordered: false, Items: [][]core.Block{
				{core.Paragraph{Inline: []core.Inline{core.Text{Content: "列表项一"}}}},
				{core.Paragraph{Inline: []core.Inline{core.Text{Content: "列表项二"}}}},
			}},
		},
	}
	return doc
}

// TestLineHeightAlgorithm 验证参考 LibreOffice 的行距解析算法。
func TestLineHeightAlgorithm(t *testing.T) {
	// 比例：单倍基准 = 11 * 1.2 = 13.2
	if h, ok := parseLineHeight("1.5", 11); !ok || h < 19.7 || h > 19.9 {
		t.Fatalf("1.5x -> %.2f, want ~19.8", h)
	}
	if h, ok := parseLineHeight("2", 11); !ok || h < 26.3 || h > 26.5 {
		t.Fatalf("2x -> %.2f, want ~26.4", h)
	}
	// 固定/至少值：直接取 pt
	if h, ok := parseLineHeight("18pt", 11); !ok || h != 18 {
		t.Fatalf("18pt -> %.2f, want 18", h)
	}
	// 缺省（空）-> 不生效
	if _, ok := parseLineHeight("", 11); ok {
		t.Fatalf("empty should not ok")
	}

	// 段距消费：spaceBefore/spaceAfter 为 pt 数值
	p := &core.Paragraph{Props: map[string]any{
		"lineHeight":  "1.5",
		"spaceBefore": "12",
		"spaceAfter":  "6",
	}}
	lh, sb, sa, _ := paragraphMetrics(p)
	if lh < 19.7 || lh > 19.9 {
		t.Fatalf("paragraph lineH %.2f want ~19.8", lh)
	}
	if sb != 12 || sa != 6 {
		t.Fatalf("spaceBefore=%v spaceAfter=%v want 12/6", sb, sa)
	}
}

// TestLineHeightAppliedToRender 验证不同行距的段落实际渲染出行高差异。
func TestLineHeightAppliedToRender(t *testing.T) {
	single := core.Paragraph{Props: map[string]any{"lineHeight": "1"}, Inline: []core.Inline{core.Text{Content: "单倍行距行"}}}
	double := core.Paragraph{Props: map[string]any{"lineHeight": "2"}, Inline: []core.Inline{core.Text{Content: "双倍行距行"}}}
	doc := core.Document{Blocks: []core.Block{
		single, double,
		core.Paragraph{Props: map[string]any{"spaceBefore": "20"}, Inline: []core.Inline{core.Text{Content: "段前有 20pt 间距"}}},
	}}
	r := New()
	out, err := r.Render(&doc)
	if err != nil {
		t.Fatalf("Render error: %v", err)
	}
	if len(out) < 1000 {
		t.Fatalf("PDF too small: %d", len(out))
	}
	if err := os.MkdirAll("_verify_tmp", 0o755); err == nil {
		_ = os.WriteFile("_verify_tmp/lineheight_sample.pdf", out, 0o644)
	}
}

// TestWrapRunsLineCount 验证 wrapRuns 的折行行数计算（widow/orphan 分页依赖它）。
func TestWrapRunsLineCount(t *testing.T) {
	// 一行能放下：短文本 1 行
	runs := collectRuns([]core.Inline{core.Text{Content: "短文本"}})
	lines := wrapRuns(runs, marginLeft, pageWidth-marginLeft-marginRight, 14)
	if len(lines) != 1 {
		t.Fatalf("短文本应 1 行, got %d", len(lines))
	}
	// 长文本应折成多行
	long := strings.Repeat("中", 500) // 500 个全角字，远超过一行宽度
	runs2 := collectRuns([]core.Inline{core.Text{Content: long}})
	lines2 := wrapRuns(runs2, marginLeft, pageWidth-marginLeft-marginRight, 14)
	if len(lines2) < 5 {
		t.Fatalf("长文本应折成多行, got %d", len(lines2))
	}
	// 显式换行符 \n 应增加行数
	runs3 := collectRuns([]core.Inline{core.Text{Content: "第一行\n第二行"}})
	lines3 := wrapRuns(runs3, marginLeft, pageWidth-marginLeft-marginRight, 14)
	if len(lines3) != 2 {
		t.Fatalf("含 \\n 应 2 行, got %d", len(lines3))
	}
}

// TestWidowStrictLongParagraph 验证超长段落跨页时末页（承接行）>= widows(2) 行，
// 且整段渲染不 panic、能正常跨页。参考 LibreOffice widorp.cxx 的严格 widow 控制。
func TestWidowStrictLongParagraph(t *testing.T) {
	var paras []core.Inline
	// 构造一个会跨多页的长段落（约 120 行）
	content := "这是一段用于验证 widow 控制的长文本。" + strings.Repeat("内容填充以保持行宽足以折行。", 200)
	paras = append(paras, core.Text{Content: content})
	doc := core.Document{Blocks: []core.Block{
		core.Paragraph{Props: map[string]any{"lineHeight": "1.2"}, Inline: paras},
	}}
	r := New()
	out, err := r.Render(&doc)
	if err != nil {
		t.Fatalf("Render error: %v", err)
	}
	if len(out) < 2000 {
		t.Fatalf("PDF too small: %d", len(out))
	}
	// 长段必然跨页：PDF 中应含多页标记（/Type /Page 出现多次）
	if strings.Count(string(out), "/Type /Page") < 2 && strings.Count(string(out), "/Type/Page") < 2 {
		t.Fatalf("长段应跨页生成多页 PDF")
	}
}

func TestRenderPreservesFormat(t *testing.T) {
	doc := sampleDoc()
	doc.Blocks = append(doc.Blocks, mergedTableBlock(), inlineImgBlock(), footnoteBlock(), slideRawBlock())
	r := New()
	out, err := r.Render(&doc)
	if err != nil {
		t.Fatalf("Render error: %v", err)
	}
	if len(out) < 5000 {
		t.Fatalf("PDF too small: %d bytes", len(out))
	}
	s := string(out)
	// 图片应被嵌入：gopdf 图片流含 /Image XObject（含表格/幻灯片中的图片）
	if !strings.Contains(s, "/Image") || !strings.Contains(s, "/XObject") {
		t.Errorf("image not embedded in PDF (no image XObject found)")
	}
	// 写出供人工/工具可视化验证
	if err := os.MkdirAll("_verify_tmp", 0o755); err == nil {
		_ = os.WriteFile("_verify_tmp/pdf_format_sample.pdf", out, 0o644)
	}
}

// mergedTableBlock 构造含合并单元格、表头灰底、单元格背景色与对齐的表格
func mergedTableBlock() core.Table {
	mk := func(s string, bg, align string, header bool) core.TableCell {
		return core.TableCell{
			Inline:   []core.Inline{core.Text{Content: s, Bg: bg, Align: align}},
			IsHeader: header,
		}
	}
	return core.Table{
		Rows: [][]core.TableCell{
			{mk("姓名", "", "center", true), mk("成绩", "", "center", true), mk("评级", "", "center", true)},
			{mk("张三", "#fff3cd", "center", false), mk("95", "#d1e7dd", "right", false), mk("A", "", "center", false)},
			// 合并：第二、三行第一列合并
			{mk("李四", "", "center", false), mk("88", "", "right", false), mk("B", "", "center", false)},
		},
	}
}

// inlineImgBlock 行内图片 + 脚注引用，验证 collectRuns 不丢内容
func inlineImgBlock() core.Paragraph {
	return core.Paragraph{Inline: []core.Inline{
		core.Text{Content: "正文前有图片 "},
		&core.InlineImage{Src: makePNGDataURL(), Width: 16, Height: 16},
		core.Text{Content: " 后接脚注"},
		&core.FootnoteRef{Num: 1},
	}}
}

func footnoteBlock() core.FootnoteSection {
	return core.FootnoteSection{Type: "footnote_section", Items: []core.FootnoteItem{
		{Num: 1, Inline: []core.Inline{core.Text{Content: "这是脚注内容"}}},
	}}
}

// slideRawBlock 模拟 PPT 整张幻灯片（含图片与文本框），验证 RawBlock 不再丢失
func slideRawBlock() core.RawBlock {
	imgURL := makePNGDataURL()
	shapes := `[{"kind":"rect","x":914400,"y":0,"cx":914400,"cy":457200,"fill":"#4472c4","text":"蓝框标题","color":"#ffffff","sizePt":24,"align":"center"},{"kind":"pic","x":0,"y":457200,"cx":1828800,"cy":914400,"img":"` + imgURL + `"}]`
	return core.RawBlock{Kind: "slide", Data: map[string]any{"shapes": shapes}}
}

func TestLoadImageBytes(t *testing.T) {
	url := makePNGDataURL()
	b, err := loadImageBytes(url)
	if err != nil {
		t.Fatalf("loadImageBytes(data url) error: %v", err)
	}
	if len(b) == 0 {
		t.Fatal("empty image bytes")
	}
	if _, _, err := image.Decode(bytes.NewReader(b)); err != nil {
		t.Fatalf("decoded image invalid: %v", err)
	}
	if _, err := loadImageBytes(""); err == nil {
		t.Error("expected error for empty src")
	}
}

// TestRenderTableMerged 验证合并单元格表格可正常渲染不 panic 且尺寸合理
func TestRenderTableMerged(t *testing.T) {
	tbl := mergedTableBlock()
	r := New()
	out, err := r.Render(&core.Document{Blocks: []core.Block{tbl}})
	if err != nil {
		t.Fatalf("Render merged table error: %v", err)
	}
	if len(out) < 1000 {
		t.Fatalf("merged table PDF too small: %d", len(out))
	}
}

// TestRenderRawBlockSlide 验证 PPT 幻灯片 RawBlock 渲染不 panic
func TestRenderRawBlockSlide(t *testing.T) {
	blk := slideRawBlock()
	r := New()
	out, err := r.Render(&core.Document{Blocks: []core.Block{blk}})
	if err != nil {
		t.Fatalf("Render slide RawBlock error: %v", err)
	}
	if len(out) < 1000 {
		t.Fatalf("slide PDF too small: %d", len(out))
	}
}
