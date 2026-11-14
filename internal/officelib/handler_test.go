package officelib

import (
	"encoding/json"
	"testing"
)

// TestSpecJSONTags 验证智能体直创 API 的 JSON 字段名与文档一致：
// 历史版本使用联合 tag（如 `json:"x,y"`），encoding/json 会把两个字段都命名为
// "x" 而丢弃 "y" 键，导致智能体传坐标/页边距错位。此测试保证每个字段独立 tag。
func TestSpecJSONTags(t *testing.T) {
	// PptSpec：形状坐标、卡片、KPI、代码块、自由文本、pill、Aurora 背景
	pptJSON := `{
	  "slides": [{
	    "shapes": [{"type": "rect", "x": 11, "y": 22, "w": 33, "h": 44}],
	    "cards": [{"x": 1, "y": 2, "w": 3, "h": 4, "title": "卡片"}],
	    "kpiCards": [{"x": 5, "y": 6, "w": 7, "h": 8, "value": "99%", "label": "可用性"}],
	    "codeBlocks": [{"x": 9, "y": 10, "w": 11, "h": 12, "lines": ["hi"]}],
	    "texts": [{"x": 13, "y": 14, "w": 15, "h": 16, "text": "文本"}],
	    "pills": [{"x": 17, "y": 18, "w": 19, "h": 20, "text": "v1", "color": "818CF8"}],
	    "bgAurora": {"baseColor": "0B1120", "glows": [{"x": 21, "y": 22, "r": 23, "color": "818CF8", "alpha": 40}]}
	  }]
	}`
	var ps PptSpec
	if err := json.Unmarshal([]byte(pptJSON), &ps); err != nil {
		t.Fatalf("unmarshal PptSpec: %v", err)
	}
	s := ps.Slides[0]
	checks := []struct {
		name string
		got  int
		want int
	}{
		{"shape.x", s.Shapes[0].X, 11}, {"shape.y", s.Shapes[0].Y, 22},
		{"shape.w", s.Shapes[0].W, 33}, {"shape.h", s.Shapes[0].H, 44},
		{"card.x", s.Cards[0].X, 1}, {"card.h", s.Cards[0].H, 4},
		{"kpi.x", s.KPICards[0].X, 5}, {"kpi.h", s.KPICards[0].H, 8},
		{"code.x", s.CodeBlocks[0].X, 9}, {"code.h", s.CodeBlocks[0].H, 12},
		{"text.x", s.Texts[0].X, 13}, {"text.h", s.Texts[0].H, 16},
		{"pill.x", s.Pills[0].X, 17}, {"pill.h", s.Pills[0].H, 20},
		{"aurora.x", s.BgAurora.Glows[0].X, 21}, {"aurora.y", s.BgAurora.Glows[0].Y, 22},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d（联合 json tag 回归：字段被错误映射）", c.name, c.got, c.want)
		}
	}

	// DocSpec：页边距（cm）
	docJSON := `{"title": "t", "pageMargins": {"top": 2.5, "bottom": 2.6, "left": 2.7, "right": 2.8}}`
	var ds DocSpec
	if err := json.Unmarshal([]byte(docJSON), &ds); err != nil {
		t.Fatalf("unmarshal DocSpec: %v", err)
	}
	if ds.PageMargins.Top != 2.5 || ds.PageMargins.Bottom != 2.6 ||
		ds.PageMargins.Left != 2.7 || ds.PageMargins.Right != 2.8 {
		t.Errorf("pageMargins = %+v，四个方向未独立解析", ds.PageMargins)
	}

	// PdfSpec：页边距（pt）
	pdfJSON := `{"title": "t", "margins": {"top": 72, "bottom": 73, "left": 74, "right": 75}}`
	var pdfs PdfSpec
	if err := json.Unmarshal([]byte(pdfJSON), &pdfs); err != nil {
		t.Fatalf("unmarshal PdfSpec: %v", err)
	}
	if pdfs.Margins.Top != 72 || pdfs.Margins.Bottom != 73 ||
		pdfs.Margins.Left != 74 || pdfs.Margins.Right != 75 {
		t.Errorf("pdf margins = %+v，四个方向未独立解析", pdfs.Margins)
	}
}
