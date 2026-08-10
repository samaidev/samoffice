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

func TestRenderPreservesFormat(t *testing.T) {
	doc := sampleDoc()
	r := New()
	out, err := r.Render(&doc)
	if err != nil {
		t.Fatalf("Render error: %v", err)
	}
	if len(out) < 5000 {
		t.Fatalf("PDF too small: %d bytes", len(out))
	}
	s := string(out)
	// 图片应被嵌入：gopdf 图片流含 /Image XObject
	if !strings.Contains(s, "/Image") || !strings.Contains(s, "/XObject") {
		t.Errorf("image not embedded in PDF (no image XObject found)")
	}
	// 写出供 pypdf 文本提取做端到端验证
	if err := os.MkdirAll("_verify_tmp", 0o755); err == nil {
		_ = os.WriteFile("_verify_tmp/pdf_format_sample.pdf", out, 0o644)
	}
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
