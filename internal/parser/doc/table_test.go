package doc

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// TestBlocksFromRaw 验证按标记拼表格的逻辑（不依赖真实文件）。
// 模拟一段含两张表的文本：表1 两行两列，中间穿插普通段落，表2 单行。
func TestBlocksFromRaw(t *testing.T) {
	raw := "" +
		"标题段落\r" +
		"a\x07b\x07\r" + // 表1 行1：单元格 a | b
		"\r" + // 表尾空段落
		"c\x07d\x07\r" + // 表1 行2：单元格 c | d
		"\r" + // 表尾空段落
		"中间正文段落\r" +
		"x\x07y\x07z\x07\r" + // 表2 行1：x | y | z
		"\r" // 表尾空段落

	blocks := blocksFromRaw(raw)

	var tables []*core.Table
	var paras []string
	for _, b := range blocks {
		switch v := b.(type) {
		case core.Table:
			tables = append(tables, &v)
		case *core.Paragraph:
			paras = append(paras, cellTextPara(v))
		case core.Paragraph:
			paras = append(paras, cellTextPara2(v))
		}
	}

	if len(tables) != 2 {
		t.Fatalf("期望 2 张表，实际 %d", len(tables))
	}
	if got := len(tables[0].Rows); got != 2 {
		t.Fatalf("表1 期望 2 行，实际 %d", got)
	}
	if got := len(tables[0].Rows[0]); got != 2 {
		t.Fatalf("表1 行1 期望 2 列，实际 %d", got)
	}
	if !tables[0].Rows[0][0].IsHeader {
		t.Errorf("表1 首行应标记为表头")
	}
	if tables[0].Rows[0][0].Inline[0].(core.Text).Content != "a" ||
		tables[0].Rows[0][1].Inline[0].(core.Text).Content != "b" {
		t.Errorf("表1 行1 内容错误: %v", tables[0].Rows[0])
	}
	if tables[1].Rows[0][2].Inline[0].(core.Text).Content != "z" {
		t.Errorf("表2 列3 内容错误")
	}
	// 普通段落应保留
	if !contains(paras, "标题段落") || !contains(paras, "中间正文段落") {
		t.Errorf("正文段落丢失: %v", paras)
	}
}

// TestRealDocTableSmoke 用真实投稿文档做冒烟测试；文件不存在则跳过。
func TestRealDocTableSmoke(t *testing.T) {
	path := `D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`
	if _, err := os.Stat(path); err != nil {
		t.Skip("真实文档不存在，跳过")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	doc, _, perr := New().Parse(bytes.NewReader(data))
	if perr != nil {
		t.Fatalf("parse: %v", perr)
	}
	var nTable int
	var foundProvince bool
	for _, b := range doc.Blocks {
		if tbl, ok := b.(core.Table); ok {
			nTable++
			for _, row := range tbl.Rows {
				for _, cell := range row {
					if strings.Contains(cellText(cell), "省份") {
						foundProvince = true
					}
				}
			}
		}
	}
	t.Logf("tables=%d found省份=%v", nTable, foundProvince)
	if nTable == 0 {
		t.Errorf("真实文档应至少解析出 1 张表格")
	}
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}

func cellText(c core.TableCell) string {
	var sb strings.Builder
	for _, in := range c.Inline {
		if txt, ok := in.(core.Text); ok {
			sb.WriteString(txt.Content)
		}
	}
	return sb.String()
}

func cellTextPara(p *core.Paragraph) string {
	var sb strings.Builder
	for _, in := range p.Inline {
		if txt, ok := in.(core.Text); ok {
			sb.WriteString(txt.Content)
		}
	}
	return sb.String()
}

func cellTextPara2(p core.Paragraph) string {
	var sb strings.Builder
	for _, in := range p.Inline {
		if txt, ok := in.(core.Text); ok {
			sb.WriteString(txt.Content)
		}
	}
	return sb.String()
}
