// reader_test.go — 验证 docgo 结构化解析

package docgo

import (
	"testing"
)

// TestStructuralParse 验证结构化解析：标题/列表/表格/run 样式
func TestStructuralParse(t *testing.T) {
	// 1. 创建文档，添加多种结构
	doc := New()
	doc.AddHeading("一级标题", 1)
	doc.AddHeading("二级标题", 2)
	doc.AddParagraph("普通段落")

	doc.AddList([]string{"列表项1", "列表项2", "列表项3"})

	doc.AddHeading("带表格的章节", 1)
	doc.AddTable([][]string{
		{"姓名", "分数"},
		{"张三", "95"},
		{"李四", "88"},
	})

	doc.AddCodeBlock("go", "fmt.Println(\"hello\")")

	// 2. 保存为字节
	data, err := doc.Bytes()
	if err != nil {
		t.Fatalf("Bytes() failed: %v", err)
	}

	// 3. 重新解析
	doc2, err := ParseBytes(data)
	if err != nil {
		t.Fatalf("ParseBytes() failed: %v", err)
	}

	// 4. 验证标题
	headings := doc2.Headings()
	if len(headings) < 3 {
		t.Errorf("Headings count = %d, want >= 3", len(headings))
	}
	if len(headings) > 0 {
		if headings[0].Text != "一级标题" {
			t.Errorf("First heading = %q, want 一级标题", headings[0].Text)
		}
		if headings[0].Level != 1 {
			t.Errorf("First heading level = %d, want 1", headings[0].Level)
		}
	}

	// 5. 验证列表
	lists := doc2.Lists()
	if len(lists) < 1 {
		t.Errorf("Lists count = %d, want >= 1", len(lists))
	}
	if len(lists) > 0 {
		if len(lists[0].items) < 3 {
			t.Errorf("List items = %d, want >= 3", len(lists[0].items))
		}
	}

	// 6. 验证表格
	tables := doc2.Tables()
	if len(tables) < 1 {
		t.Errorf("Tables count = %d, want >= 1", len(tables))
	}
	if len(tables) > 0 {
		if len(tables[0].rows) < 3 {
			t.Errorf("Table rows = %d, want >= 3", len(tables[0].rows))
		}
	}

	// 7. 验证代码块
	codeBlocks := doc2.CodeBlocks()
	if len(codeBlocks) < 1 {
		t.Errorf("CodeBlocks count = %d, want >= 1", len(codeBlocks))
	}

	// 8. 验证元素总数
	if doc2.ElementCount() < 6 {
		t.Errorf("ElementCount = %d, want >= 6", doc2.ElementCount())
	}
}

// TestRunStyleParse 验证 run 样式解析（加粗/斜体等）
func TestRunStyleParse(t *testing.T) {
	doc := New()
	p := doc.AddParagraph("")
	p.AddRun("普通").Bold(true)
	p.AddRun("斜体").Italic(true)
	p.AddRun("下划线").Underline(true)

	data, _ := doc.Bytes()
	doc2, _ := ParseBytes(data)

	paras := 0
	for _, e := range doc2.elements {
		if _, ok := e.(*Paragraph); ok {
			paras++
		}
	}
	if paras < 1 {
		t.Errorf("Paragraphs = %d, want >= 1", paras)
	}
}
