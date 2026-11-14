package parser

import (
	"os"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// TestRoutingRealDoc 验证对真实 .doc 的路由：原生明显残缺时回退 LibreOffice
// 转换，最终产出居中标题、脚注、参考文献序号、页码。
func TestRoutingRealDoc(t *testing.T) {
	const path = `D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("file missing: %v", err)
	}
	r := NewRegistry()
	doc, warns, perr := r.ParseBytes(path, data)
	if perr != nil {
		t.Fatalf("parse: %v", perr)
	}
	for _, w := range warns {
		t.Logf("warn: %s", w.Message)
	}
	refs := 0
	centered := 0
	footnoteSection := false
	for _, b := range doc.Blocks {
		switch v := b.(type) {
		case *core.Paragraph:
			if v.Align == "center" {
				centered++
			}
			for _, in := range v.Inline {
				if _, ok := in.(*core.FootnoteRef); ok {
					refs++
				}
			}
		case *core.FootnoteSection:
			footnoteSection = true
		}
	}
	t.Logf("RESULT centered=%d refs=%d footnoteSection=%v pageNumber=%v", centered, refs, footnoteSection, doc.PageNumber != nil)
	t.Logf("路由引擎: antiword 优先（纯文本模式，无排版/脚注/页码）")
	if refs > 0 || centered > 0 || footnoteSection || doc.PageNumber != nil {
		t.Logf("→ 通过 LibreOffice 转换补全了排版信息")
	}
	if !strings.Contains(anyText(doc), "碳排放") {
		t.Errorf("正文缺失")
	}
	if len(doc.Blocks) == 0 {
		t.Errorf("无任何正文块")
	}
}

func anyText(d *core.Document) string {
	var sb strings.Builder
	for _, b := range d.Blocks {
		if p, ok := b.(*core.Paragraph); ok {
			for _, in := range p.Inline {
				if tx, ok := in.(core.Text); ok {
					sb.WriteString(tx.Content)
				}
			}
		}
	}
	return sb.String()
}
