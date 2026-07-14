package docx

import (
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

func TestRenderBasic(t *testing.T) {
	r := New()
	doc := &core.Document{
		Meta: core.Meta{Title: "Test", Author: "Tester"},
		Blocks: []core.Block{
			&core.Heading{Level: 1, Inline: []core.Inline{core.Text{Content: "标题"}}},
			&core.Paragraph{Inline: []core.Inline{core.Text{Content: "段落内容"}}},
			&core.Paragraph{Inline: []core.Inline{
				core.Text{Content: "加粗", Bold: true},
				core.Text{Content: "和"},
				core.Text{Content: "斜体", Italic: true},
			}},
		},
	}
	data, err := r.Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if len(data) < 500 {
		t.Errorf("rendered size too small: %d bytes", len(data))
	}
	// 应包含 ZIP 头
	if data[0] != 0x50 || data[1] != 0x4B {
		t.Errorf("output is not ZIP (PK header missing)")
	}
}

func TestRenderTable(t *testing.T) {
	r := New()
	doc := &core.Document{
		Meta: core.Meta{Title: "Table Test"},
		Blocks: []core.Block{
			&core.Table{
				Rows: [][]core.TableCell{
					{
						{Inline: []core.Inline{core.Text{Content: "A1"}}, IsHeader: true},
						{Inline: []core.Inline{core.Text{Content: "B1"}}, IsHeader: true},
					},
					{
						{Inline: []core.Inline{core.Text{Content: "A2"}}},
						{Inline: []core.Inline{core.Text{Content: "B2"}}},
					},
				},
			},
		},
	}
	data, err := r.Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if len(data) < 500 {
		t.Errorf("table render size too small: %d", len(data))
	}
}

func TestRenderImage(t *testing.T) {
	r := New()
	// 1x1 PNG
	png := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	doc := &core.Document{
		Meta: core.Meta{Title: "Image Test"},
		Blocks: []core.Block{
			&core.Image{Src: png, Width: 100, Height: 50, Alt: "test"},
		},
	}
	data, err := r.Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	// 验证包含 image1.png
	if !strings.Contains(string(data), "image1.png") {
		t.Error("rendered docx should contain image1.png reference")
	}
}

func TestEscapeXML(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"hello", "hello"},
		{"a&b", "a&amp;b"},
		{"a<b", "a&lt;b"},
		{"a>b", "a&gt;b"},
		{`a"b`, "a&quot;b"},
	}
	for _, c := range cases {
		if got := escapeXML(c.in); got != c.want {
			t.Errorf("escapeXML(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
