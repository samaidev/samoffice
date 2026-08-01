package antiword

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

func TestAntiwordIntegration(t *testing.T) {
	// 测试真实 .doc 文件：走 antiword 命令行解析，验证文本提取
	path := `D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("测试文件不存在: %v", err)
	}

	Reset()
	p := &Parser{}
	if !p.CanParse(path, data[:8]) {
		t.Skip("antiword.exe 不可用，跳过集成测试")
	}

	doc, warns, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if doc == nil {
		if len(warns) > 0 {
			t.Fatalf("doc is nil; first warn: %s", warns[0].Message)
		}
		t.Fatal("doc is nil (no warnings)")
	}

	t.Logf("警告: %d 条", len(warns))
	for _, w := range warns {
		t.Logf("  %s: %s", w.Level, w.Message)
	}

	// 统计输出
	paraCount := 0
	totalChars := 0
	titleSample := ""
	for _, b := range doc.Blocks {
		if p, ok := b.(*core.Paragraph); ok {
			paraCount++
			for _, in := range p.Inline {
				if tx, ok := in.(core.Text); ok {
					totalChars += len([]rune(tx.Content))
					if titleSample == "" && strings.Contains(tx.Content, "碳") {
						titleSample = tx.Content
						if len([]rune(titleSample)) > 30 {
							titleSample = string([]rune(titleSample)[:30])
						}
					}
				}
			}
		}
	}

	t.Logf("antiword 解析结果:")
	t.Logf("  段落数: %d", paraCount)
	t.Logf("  总字符: %d", totalChars)
	t.Logf("  标题样本: %q", titleSample)

	// 基本断言：有正文
	if paraCount == 0 {
		t.Error("预期至少 1 个段落")
	}
	if totalChars < 100 {
		t.Error("预期至少 100 字符正文")
	}

	// 验证中文内容存在（用"碳排放"作标记）
	found := false
	for _, b := range doc.Blocks {
		if p, ok := b.(*core.Paragraph); ok {
			for _, in := range p.Inline {
				if tx, ok := in.(core.Text); ok && strings.Contains(tx.Content, "碳排放") {
					found = true
				}
			}
		}
	}
	if !found {
		t.Error("未找到 '碳排放'，可能文本提取失败或编码错误")
	}

	// 列出前 10 个段落预览
	t.Logf("前 10 段预览:")
	count := 0
	for _, b := range doc.Blocks {
		if p, ok := b.(*core.Paragraph); ok {
			text := ""
			for _, in := range p.Inline {
				if tx, ok := in.(core.Text); ok {
					text += tx.Content
				}
			}
			if len([]rune(text)) > 40 {
				text = string([]rune(text)[:40])
			}
			t.Logf("  [%d] %q", count+1, text)
			count++
			if count >= 10 {
				break
			}
		}
	}
}

func TestParseTextOutput(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		want     int
		contains string
	}{
		{name: "空输入", input: "", want: 0},
		{name: "纯空格", input: "  \n  \n  ", want: 0},
		{name: "单段落", input: "中国区域碳排放影响因素研究", want: 1, contains: "碳排放"},
		{name: "多段落", input: "第一段\n\n第二段\n\n第三段", want: 3, contains: "第二段"},
		{name: "过滤分隔线", input: "正文\n----\n脚注内容", want: 2, contains: "正文"},
		{name: "过滤分页符", input: "第一页\n\f\n第二页", want: 2, contains: "第二页"},
		{name: "多行合并", input: "第一行\n第二行\n\n新段", want: 2, contains: "第一行 第二行"},
		{name: "过滤横线", input: "正文\n-\n更多正文", want: 2, contains: "更多正文"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			blocks := parseTextOutput(tt.input)
			if len(blocks) != tt.want {
				t.Errorf("got %d blocks, want %d", len(blocks), tt.want)
			}
			if tt.contains != "" {
				found := false
				for _, b := range blocks {
					if p, ok := b.(*core.Paragraph); ok {
						for _, in := range p.Inline {
							if tx, ok := in.(core.Text); ok && strings.Contains(tx.Content, tt.contains) {
								found = true
							}
						}
					}
				}
				if !found {
					t.Errorf("预期文本包含 %q，未找到", tt.contains)
				}
			}
		})
	}
}

func TestParseTextOutputCRLF(t *testing.T) {
	input := "第一段\r\n\r\n第二段\r\n\r\n第三段"
	blocks := parseTextOutput(input)
	if len(blocks) != 3 {
		t.Errorf("CRLF: got %d blocks, want 3", len(blocks))
	}
}
