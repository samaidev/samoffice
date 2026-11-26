package pptx

// round72：标题/正文占位符写盘往返测试。
// 用户主诉：PPT ribbon 加粗等大量按钮对标题/正文弹「请先选择元素」且无法选中；
// 且标题/正文在旧版保存时不写进 pptx（保存即丢）。
// 本测验证：title/content + titleStyle/contentStyle（颜色/字号/字体/加粗/对齐/
// 行距/缩进/项目符号/编号）写盘 → 解析回读不丢。

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

func TestPlaceholderRoundTrip(t *testing.T) {
	wJSON := `{
	  "pageW": 12192000, "pageH": 6858000,
	  "slides": [
	    {
	      "bg": "#ffffff",
	      "title": "年度总结",
	      "content": "第一行\n第二行\n第三行",
	      "titleStyle": {
	        "color": "#EF4444", "fontSize": 40, "fontFamily": "黑体",
	        "bold": true, "align": "center"
	      },
	      "contentStyle": {
	        "color": "#2563EB", "fontSize": 18, "fontFamily": "宋体",
	        "bold": false, "align": "left", "lineHeight": 1.5,
	        "indent": 1, "bullet": true
	      },
	      "shapes": []
	    }
	  ]
	}`

	dir := t.TempDir()
	p := filepath.Join(dir, "placeholder.pptx")
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

	// 标题/正文文本往返
	if got, _ := slide["title"].(string); got != "年度总结" {
		t.Errorf("title = %q, want 年度总结", got)
	}
	// bullets 语义：每个文本形状一项（body 占位符多行文本 join 为一项，换行分隔）
	bulletsRaw, _ := slide["bullets"].([]string)
	if len(bulletsRaw) != 1 {
		t.Fatalf("bullets = %v (len %d), want 1（body 占位符整块）", bulletsRaw, len(bulletsRaw))
	}
	if bulletsRaw[0] != "第一行\n第二行\n第三行" {
		t.Errorf("bullets[0] = %q, want 三行换行拼接", bulletsRaw[0])
	}

	// 占位符形状（解析端把 title 提取为 slide.Title，shapes 内不再重复；
	// 但样式随占位符 sp 落盘 —— 验证形状列表含带 ph 的占位符）
	// shapes 是 []shapeDef（RawBlock.Data 直存 Go 结构体），按 ph 找占位符
	shapes, _ := slide["shapes"].([]shapeDef)
	var titleShape, bodyShape *shapeDef
	for i := range shapes {
		if shapes[i].Ph == "ctrTitle" {
			titleShape = &shapes[i]
		}
		if shapes[i].Ph == "body" {
			bodyShape = &shapes[i]
		}
	}
	if titleShape == nil {
		t.Fatalf("ctrTitle placeholder shape missing in %v", shapes)
	}
	if bodyShape == nil {
		t.Fatalf("body placeholder shape missing")
	}

	// 标题样式往返
	if titleShape.Color != "#EF4444" {
		t.Errorf("title color = %q, want #EF4444", titleShape.Color)
	}
	if titleShape.SizePt != 40 {
		t.Errorf("title sizePt = %d, want 40", titleShape.SizePt)
	}
	if titleShape.Font != "黑体" {
		t.Errorf("title font = %q, want 黑体", titleShape.Font)
	}
	if !titleShape.Bold {
		t.Errorf("title bold = false, want true")
	}

	// 正文样式往返（对齐/行距/缩进/项目符号）
	if bodyShape.Color != "#2563EB" {
		t.Errorf("body color = %q, want #2563EB", bodyShape.Color)
	}
	if bodyShape.SizePt != 18 {
		t.Errorf("body sizePt = %d, want 18", bodyShape.SizePt)
	}
	if bodyShape.Align != "l" {
		t.Errorf("body align = %q, want l", bodyShape.Align)
	}
	if bodyShape.LineHeight < 1.49 || bodyShape.LineHeight > 1.51 {
		t.Errorf("body lineHeight = %v, want 1.5", bodyShape.LineHeight)
	}
	if bodyShape.Indent != 1 {
		t.Errorf("body indent = %d, want 1", bodyShape.Indent)
	}
	if !bodyShape.Bullet {
		t.Errorf("body bullet = false, want true")
	}
}
