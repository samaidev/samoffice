package docx

import (
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// paraText 拼接段落全部文本 run
func paraText(p *core.Paragraph) string {
	var sb strings.Builder
	for _, inl := range p.Inline {
		if txt, ok := inl.(core.Text); ok {
			sb.WriteString(txt.Content)
		}
	}
	return sb.String()
}

// TestParseChineseSpacePreserve 验证中文文本中的半角/全角空格在解析时被完整保留
// （Word 的 xml:space="preserve" 语义）：连续空格、run 边界空格、行尾空格、
// 全角空格 U+3000 均必须原样进入 UDM，不得折叠或裁剪。
func TestParseChineseSpacePreserve(t *testing.T) {
	xml := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">中文  连续空格测试</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">中文 abc 中文</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">开始  中间   结尾</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">全角空　格</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">粗体结尾空 </w:t></w:r><w:r><w:t xml:space="preserve"> 普通开头空</w:t></w:r></w:p>
    <w:p><w:r><w:t>行尾空格 </w:t></w:r></w:p>
  </w:body>
</w:document>`

	blocks, warns, _, _ := parseDocumentXML(strings.NewReader(xml), map[string]string{})
	if len(blocks) != 6 {
		t.Fatalf("expected 6 blocks, got %d (warns=%v)", len(blocks), warns)
	}

	want := []string{
		"中文  连续空格测试",
		"中文 abc 中文",
		"开始  中间   结尾",
		"全角空\u3000格",
		"粗体结尾空  普通开头空",
		"行尾空格 ",
	}
	for i, w := range want {
		p, ok := blocks[i].(*core.Paragraph)
		if !ok {
			t.Fatalf("block %d expected *core.Paragraph, got %T", i, blocks[i])
		}
		if got := paraText(p); got != w {
			t.Errorf("para %d space mismatch:\n got  %q\n want %q", i, got, w)
		}
	}
}
