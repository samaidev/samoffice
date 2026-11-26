package pptx

// round73：选定文字富文本往返测试。
// 用户主诉：字体/字号/颜色/加粗（补斜体/下划线/删除线）要支持选定文字调整而非
// 元素整体 —— titleParas/contentParas 逐段逐 run 写盘 → 解析回读不丢。

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

func TestRichParasRoundTrip(t *testing.T) {
	wJSON := `{
	  "pageW": 12192000, "pageH": 6858000,
	  "slides": [
	    {
	      "bg": "#ffffff",
	      "title": "整段标题",
	      "content": "整段正文",
	      "titleParas": [
	        {"runs": [
	          {"text": "前半", "bold": true, "color": "#EF4444", "sizePt": 40, "font": "黑体"},
	          {"text": "后半", "italic": true, "underline": true, "strike": true, "color": "#2563EB", "sizePt": 28, "spc": 200}
	        ]}
	      ],
	      "contentParas": [
	        {"align": "c", "runs": [
	          {"text": "第一段粗", "bold": true},
	          {"text": "斜红", "italic": true, "color": "#EF4444"}
	        ]},
	        {"align": "r", "runs": [
	          {"text": "第二段下划删除", "underline": true, "strike": true, "spc": 300}
	        ]}
	      ],
	      "shapes": []
	    }
	  ]
	}`

	dir := t.TempDir()
	p := filepath.Join(dir, "rich.pptx")
	if err := WritePPTX(p, wJSON); err != nil {
		t.Fatalf("WritePPTX: %v", err)
	}

	// 1) 写盘端：slide1.xml 的 run 级属性全部落盘
	zr, err := zip.OpenReader(p)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer zr.Close()
	slideXML := ""
	for _, f := range zr.File {
		if f.Name == "ppt/slides/slide1.xml" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			slideXML = string(b)
			rc.Close()
		}
	}
	if slideXML == "" {
		t.Fatalf("slide1.xml missing")
	}
	for _, frag := range []string{
		` i="1"`,            // 斜体
		` u="sng"`,           // 下划线
		` strike="sngStrike"`, // 删除线
		` spc="200"`,         // 字符间距 2pt
		` spc="300"`,         // 字符间距 3pt
		`<a:latin typeface="黑体"/>`, // run 级字体
		` b="1"`,            // run 级加粗
	} {
		if !strings.Contains(slideXML, frag) {
			t.Errorf("slide1.xml missing fragment: %s", frag)
		}
	}

	// 2) 解析端：phParas 提取 → RawBlock Data（titleParas/contentParas）
	f2, _ := os.Open(p)
	defer f2.Close()
	doc, _, err := New().Parse(f2)
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
		t.Fatalf("no slide RawBlock")
	}
	tpRaw, _ := slide["titleParas"].([]paraDef)
	if len(tpRaw) != 1 {
		t.Fatalf("titleParas = %v, want 1 段", tpRaw)
	}
	runs := tpRaw[0].Runs
	if len(runs) != 2 {
		t.Fatalf("titleParas runs = %d, want 2（前半/后半）", len(runs))
	}
	r1, r2 := runs[0], runs[1]
	if r1.Text != "前半" || !r1.Bold || r1.Color != "#EF4444" || r1.SizePt != 40 || r1.Font != "黑体" {
		t.Errorf("run1 = %+v, want 前半 bold red 40 黑体", r1)
	}
	if r2.Text != "后半" || !r2.Italic || !r2.Underline || !r2.Strike || r2.Spc != 200 || r2.Color != "#2563EB" || r2.SizePt != 28 {
		t.Errorf("run2 = %+v, want 后半 italic/underline/strike spc=200 blue 28", r2)
	}

	cpRaw, _ := slide["contentParas"].([]paraDef)
	if len(cpRaw) != 2 {
		t.Fatalf("contentParas = %d 段, want 2", len(cpRaw))
	}
	if cpRaw[0].Align != "c" || cpRaw[1].Align != "r" {
		t.Errorf("contentParas align = %q/%q, want c/r", cpRaw[0].Align, cpRaw[1].Align)
	}
	cr1 := cpRaw[0].Runs
	if len(cr1) != 2 || !cr1[0].Bold || !cr1[1].Italic || cr1[1].Color != "#EF4444" {
		t.Errorf("contentParas p1 runs = %+v, want 粗+斜红", cr1)
	}
	cr2 := cpRaw[1].Runs
	if len(cr2) != 1 || !cr2[0].Underline || !cr2[0].Strike || cr2[0].Spc != 300 {
		t.Errorf("contentParas p2 runs = %+v, want underline+strike spc=300", cr2)
	}
}
