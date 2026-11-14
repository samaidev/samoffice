package docx

import (
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/renderer/docx"
)

// TestPageSetupRoundTrip：写器输出 sectPr → 读取器解析回 PageSetup
func TestPageSetupRoundTrip(t *testing.T) {
	d := &core.Document{
		Meta:   core.Meta{Title: "PS"},
		Blocks: []core.Block{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "hello"}}}},
		PageSetup: &core.PageSetup{
			WidthTwips: 16838, HeightTwips: 11906, Orientation: "landscape",
			MarginTop: 720, MarginRight: 720, MarginBottom: 720, MarginLeft: 720, Cols: 2,
		},
	}
	r := docx.New()
	data, err := r.Render(d)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	doc, _, err := New().Parse(strings.NewReader(string(data)))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	ps := doc.PageSetup
	if ps == nil {
		t.Fatal("PageSetup not parsed back")
	}
	if ps.WidthTwips != 16838 || ps.HeightTwips != 11906 {
		t.Errorf("size = %d x %d, want 16838 x 11906", ps.WidthTwips, ps.HeightTwips)
	}
	if ps.Orientation != "landscape" {
		t.Errorf("orientation = %q, want landscape", ps.Orientation)
	}
	if ps.MarginTop != 720 || ps.MarginLeft != 720 || ps.Cols != 2 {
		t.Errorf("margins/cols = %v", ps)
	}
}
