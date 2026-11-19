package docx_test

import (
	"bytes"
	"encoding/json"
	"testing"
	"archive/zip"

	"github.com/zai/samoffice/internal/core"
	parsepkg "github.com/zai/samoffice/internal/parser/docx"
	"github.com/zai/samoffice/internal/renderer/docx"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
func zipReader(r *bytes.Reader, size int64) (*zip.Reader, error) {
	return zip.NewReader(r, size)
}

// r43：用户报告 —— 启用页码→保存→重新打开，页码消失。
// UDM → Render docx → ParseBytes → 检查 PageNumber 是否还原。
func TestPageNumberRoundTrip(t *testing.T) {
	doc := &core.Document{
		Meta: core.Meta{Title: "r43-pn"},
		Blocks: []core.Block{
			&core.Paragraph{Inline: []core.Inline{core.Text{Content: "hello"}}},
		},
		PageNumber: &core.PageNumberConfig{
			Enabled: true,
			Format:  "第 {n} 页",
			Align:   "center",
		},
	}
	data, err := docx.New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, _, err := (&parsepkg.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.PageNumber == nil {
		t.Fatalf("★ 复现：往返后 PageNumber = nil（页码丢失）")
	}
	if !got.PageNumber.Enabled {
		t.Fatalf("★ 复现：Enabled=false")
	}
	if got.PageNumber.Format != "第 {n} 页" {
		t.Fatalf("Format 变化: %q", got.PageNumber.Format)
	}
}

// r43 附加：JSON 序列化层（Wails WriteDocument 收到的 document）往返 ——
// 前端发 JSON → Go json.Unmarshal → Render → Parse。
// 若 Go 结构体 json tag 与前端字段名不一致，PageNumber 在绑定层就会丢。
func TestPageNumberJSONBinding(t *testing.T) {
	// 与前端 emitDoc 发出的 JSON 完全一致的结构
	jsonDoc := `{
		"meta": {"title": "r43-json"},
		"blocks": [{"inline": [{"content": "hi"}]}],
		"pageNumber": {"enabled": true, "format": "第 {n} 页", "align": "center"}
	}`
	var doc core.Document
	if err := jsonUnmarshal([]byte(jsonDoc), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if doc.PageNumber == nil {
		t.Fatalf("★ JSON 绑定丢 pageNumber")
	}
	data, err := docx.New().Render(&doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, _, err := (&parsepkg.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.PageNumber == nil || !got.PageNumber.Enabled {
		t.Fatalf("★ JSON 链路往返页码丢失: %+v", got.PageNumber)
	}
}

// r43 附加：完整 HTTP 保存路径等价 —— saveDocument 也是 core.Document JSON 绑定，
// 用 multipart 无关；直接验证 ParseBytes 对 Render 输出的 zip 结构接受度
// （footer1.xml / footer2.xml / rels / contentTypes 齐全性）。
func TestPageNumberZipStructure(t *testing.T) {
	doc := &core.Document{
		Meta:   core.Meta{Title: "r43-zip"},
		Blocks: []core.Block{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "x"}}}},
		PageNumber: &core.PageNumberConfig{
			Enabled: true, Format: "Page {n} of {total}", Align: "right",
		},
	}
	data, err := docx.New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	zr, err := zipReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, need := range []string{"word/footer1.xml", "word/footer2.xml", "word/document.xml"} {
		if !names[need] {
			t.Errorf("zip 缺少 %s（现有: %v）", need, names)
		}
	}
}

// r44：页码段落不得被误收为页脚文字 —— 重开后 footer.text 必须为空，
// 否则编辑器渲染两行（"第 页" + "第 x 页"）。
func TestPageNumberFooterNotMisread(t *testing.T) {
	doc := &core.Document{
		Meta:   core.Meta{Title: "r44-footer"},
		Blocks: []core.Block{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "x"}}}},
		PageNumber: &core.PageNumberConfig{
			Enabled: true, Format: "第 {n} 页", Align: "center",
		},
	}
	data, err := docx.New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, _, err := (&parsepkg.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.PageNumber == nil || !got.PageNumber.Enabled {
		t.Fatalf("页码配置丢失: %+v", got.PageNumber)
	}
	if got.Footer != nil && got.Footer.Text != "" {
		t.Fatalf("★ 复现 r44：页码段落被误收为 footer.text=%q（导致双行显示）", got.Footer.Text)
	}
}

// r44：真实页脚文字 + 页码并存时，两者各自保留（页脚文字一行 + 页码一行是用户主动设置的）。
func TestRealFooterTextPlusPageNumber(t *testing.T) {
	doc := &core.Document{
		Meta:   core.Meta{Title: "r44-mix"},
		Blocks: []core.Block{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "x"}}}},
		Footer: &core.HeaderFooter{Text: "版权所有", Align: "center"},
		PageNumber: &core.PageNumberConfig{
			Enabled: true, Format: "第 {n} 页", Align: "center",
		},
	}
	data, err := docx.New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, _, err := (&parsepkg.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Footer == nil || got.Footer.Text != "版权所有" {
		t.Fatalf("真实页脚文字丢失: %+v", got.Footer)
	}
	if got.PageNumber == nil || !got.PageNumber.Enabled || got.PageNumber.Format != "第 {n} 页" {
		t.Fatalf("页码配置丢失: %+v", got.PageNumber)
	}
}

// r44：含总页数的页码模板往返 —— {total} 必须落地为 NUMPAGES 域并还原。
func TestPageNumberTotalTemplate(t *testing.T) {
	doc := &core.Document{
		Meta:   core.Meta{Title: "r44-total"},
		Blocks: []core.Block{&core.Paragraph{Inline: []core.Inline{core.Text{Content: "x"}}}},
		PageNumber: &core.PageNumberConfig{
			Enabled: true, Format: "第 {n} / 共 {total} 页", Align: "right",
		},
	}
	data, err := docx.New().Render(doc)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, _, err := (&parsepkg.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.PageNumber == nil || got.PageNumber.Format != "第 {n} / 共 {total} 页" {
		t.Fatalf("★ 总页数模板丢失: %+v", got.PageNumber)
	}
}
