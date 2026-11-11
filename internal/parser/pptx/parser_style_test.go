package pptx

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// TestStyleRoundTrip 验证 段落/run 样式 + 背景 + 填充 的写入→解析往返不丢失
func TestStyleRoundTrip(t *testing.T) {
	wJSON := `{
	  "pageW": 12192000, "pageH": 6858000,
	  "slides": [{
	    "bg": "#1B2A4A", "notes": "",
	    "shapes": [
	      {"kind":"text","type":"rect","x":914400,"y":914400,"cx":5486400,"cy":914400,
	       "fill":"","text":"红色蓝色加粗","color":"#E74C3C","sizePt":28,"bold":false,
	       "align":"c","vanchor":"ctr",
	       "paras":[
	         {"align":"c","runs":[
	           {"text":"红色","color":"#E74C3C","sizePt":28,"bold":false,"italic":false,"underline":false},
	           {"text":"蓝色加粗","color":"#3498DB","sizePt":32,"bold":true,"italic":false,"underline":true}
	         ]},
	         {"align":"l","runs":[
	           {"text":"绿色斜体","color":"#27AE60","sizePt":26,"bold":false,"italic":true,"underline":false}
	         ]}
	       ]},
	      {"kind":"text","type":"roundRect","x":6400800,"y":4572000,"cx":2743200,"cy":914400,
	       "fill":"#2E74B5","text":"填充形状","color":"#FFFFFF","sizePt":18,"bold":true,
	       "align":"c","vanchor":"ctr"}
	    ]
	  }]
	}`

	dir := t.TempDir()
	p := filepath.Join(dir, "roundtrip.pptx")
	if err := WritePPTX(p, wJSON); err != nil {
		t.Fatalf("WritePPTX: %v", err)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatalf("open saved: %v", err)
	}
	defer f.Close()
	doc, _, err := New().Parse(f)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	var slide map[string]any
	for _, b := range doc.Blocks {
		if rb, ok := b.(*core.RawBlock); ok && rb.Kind == "slide" {
			slide = rb.Data
		}
	}
	if slide == nil {
		t.Fatalf("no slide RawBlock found")
	}

	if bg, _ := slide["bg"].(string); bg != "#1B2A4A" {
		t.Errorf("bg = %q, want #1B2A4A", bg)
	}
	shapes, _ := slide["shapes"].([]shapeDef)
	if len(shapes) != 2 {
		t.Fatalf("shapes = %d, want 2", len(shapes))
	}
	s0 := shapes[0]
	if len(s0.Paras) != 2 {
		t.Fatalf("paras = %d, want 2", len(s0.Paras))
	}
	r00 := s0.Paras[0].Runs[0]
	if r00.Text != "红色" || r00.Color != "#E74C3C" || r00.SizePt != 28 {
		t.Errorf("run[0][0] = %+v", r00)
	}
	r01 := s0.Paras[0].Runs[1]
	if !r01.Bold || !r01.Underline || r01.Color != "#3498DB" || r01.SizePt != 32 {
		t.Errorf("run[0][1] = %+v", r01)
	}
	r10 := s0.Paras[1].Runs[0]
	if !r10.Italic || r10.Color != "#27AE60" {
		t.Errorf("run[1][0] = %+v", r10)
	}
	if s0.Paras[0].Align != "c" || s0.Paras[1].Align != "l" {
		t.Errorf("aligns = %q,%q want c,l", s0.Paras[0].Align, s0.Paras[1].Align)
	}
	if s0.Text != "红色蓝色加粗\n绿色斜体" {
		t.Errorf("flat Text = %q", s0.Text)
	}
	s1 := shapes[1]
	if s1.Fill != "#2E74B5" || s1.Geom != "roundRect" {
		t.Errorf("shape1 fill/geom = %q/%q", s1.Fill, s1.Geom)
	}
	if s1.Color != "#FFFFFF" || !s1.Bold {
		t.Errorf("shape1 color/bold = %q/%v", s1.Color, s1.Bold)
	}
}
