package docx

import (
        "archive/zip"
        "bytes"
        "testing"

        "github.com/zai/samoffice/internal/core"
        docxparser "github.com/zai/samoffice/internal/parser/docx"
)

// TestFootnoteWriterRoundTrip 渲染脚注引用 → 校验 footnotes.xml 部件与注册 →
// 用 docx 解析器回读校验脚注引用与内容存在。
func TestFootnoteWriterRoundTrip(t *testing.T) {
        doc := &core.Document{
                Meta: core.Meta{Title: "FN"},
                Blocks: []core.Block{
                        &core.Paragraph{Inline: []core.Inline{
                                core.Text{Content: "正文"},
                                core.FootnoteRef{Type: "footnote", Num: 1, Content: "第一条脚注"},
                                core.Text{Content: "续"},
                                core.FootnoteRef{Type: "footnote", Num: 2, Content: "第二条脚注"},
                        }},
                        // 文末脚注区（前端数据形态）不应再导出为普通段落
                        &core.FootnoteSection{Type: "footnote_section", Items: []core.FootnoteItem{
                                {Num: 1, Inline: []core.Inline{core.Text{Content: "第一条脚注"}}},
                        }},
                },
        }
        data, err := New().Render(doc)
        if err != nil {
                t.Fatalf("render: %v", err)
        }
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                t.Fatalf("zip: %v", err)
        }
        docXML := zipEntry(t, zr, "word/document.xml")
        fnXML := zipEntry(t, zr, "word/footnotes.xml")

        // 引用标记：FootnoteReference 样式 + 上标 + w:footnoteReference
        if !bytes.Contains([]byte(docXML), []byte(`<w:footnoteReference w:id="1"/>`)) ||
                !bytes.Contains([]byte(docXML), []byte(`<w:footnoteReference w:id="2"/>`)) {
                t.Errorf("footnoteReference missing in document.xml: %s", segment(docXML, "w:footnoteReference"))
        }
        if !bytes.Contains([]byte(docXML), []byte(`<w:rStyle w:val="FootnoteReference"/>`)) {
                t.Errorf("footnoteReference run should carry FootnoteReference rStyle")
        }
        // footnotes.xml：分隔符 + 正文脚注
        if !bytes.Contains([]byte(fnXML), []byte(`w:type="separator" w:id="-1"`)) {
                t.Errorf("footnotes.xml missing separator (-1)")
        }
        if !bytes.Contains([]byte(fnXML), []byte(`w:type="continuationSeparator" w:id="0"`)) {
                t.Errorf("footnotes.xml missing continuationSeparator (0)")
        }
        if !bytes.Contains([]byte(fnXML), []byte(`<w:footnote w:id="1">`)) ||
                !bytes.Contains([]byte(fnXML), []byte("第一条脚注")) {
                t.Errorf("footnotes.xml missing body footnote 1: %s", fnXML)
        }
        // 文末脚注区不再导出为普通段落（无 "1. 内容" 文本段落）
        if bytes.Contains([]byte(docXML), []byte("<w:t xml:space=\"preserve\">1. </w:t>")) {
                t.Errorf("FootnoteSection should not be exported as plain paragraphs")
        }

        // 解析器回读：脚注区重建、内容一致
        doc2, _, err := docxparser.New().Parse(bytes.NewReader(data))
        if err != nil {
                t.Fatalf("parse back: %v", err)
        }
        var sec *core.FootnoteSection
        for _, b := range doc2.Blocks {
                if s, ok := b.(*core.FootnoteSection); ok {
                        sec = s
                        break
                }
        }
        if sec == nil {
                t.Fatalf("parsed doc should contain FootnoteSection (blocks=%d)", len(doc2.Blocks))
        }
        if len(sec.Items) != 2 {
                t.Fatalf("footnote items = %d, want 2", len(sec.Items))
        }
        if got := inlineText(sec.Items[0].Inline); got != "第一条脚注" {
                t.Errorf("footnote 1 content = %q, want 第一条脚注", got)
        }
        // 正文引用存在
        p := doc2.Blocks[0].(*core.Paragraph)
        hasRef := false
        for _, in := range p.Inline {
                var fr *core.FootnoteRef
                switch v := in.(type) {
                case core.FootnoteRef:
                        fr = &v
                case *core.FootnoteRef:
                        fr = v
                }
                if fr != nil && fr.Num == 1 {
                        hasRef = true
                }
        }
        if !hasRef {
                t.Errorf("parsed paragraph should contain FootnoteRef num=1")
        }
}

// TestCommentsWriterRoundTrip 渲染批注 → 校验 comments.xml/注册 → 解析器回读
func TestCommentsWriterRoundTrip(t *testing.T) {
        doc := &core.Document{
                Meta: core.Meta{Title: "CM"},
                Blocks: []core.Block{
                        &core.Paragraph{Inline: []core.Inline{
                                core.Text{Content: "被批注文本"},
                                core.Text{Content: "", CommentID: "42"},
                        }},
                },
                Comments: []core.Comment{
                        {ID: "42", Author: "张三", Content: "这里需要修改"},
                },
        }
        data, err := New().Render(doc)
        if err != nil {
                t.Fatalf("render: %v", err)
        }
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                t.Fatalf("zip: %v", err)
        }
        docXML := zipEntry(t, zr, "word/document.xml")
        cmXML := zipEntry(t, zr, "word/comments.xml")
        ctXML := zipEntry(t, zr, "[Content_Types].xml")
        relsXML := zipEntry(t, zr, "word/_rels/document.xml.rels")

        wantID := hashString("42")
        if !bytes.Contains([]byte(docXML), []byte(`<w:commentRangeStart w:id="`+itoa(wantID)+`"/>`)) {
                t.Errorf("commentRangeStart missing: %s", segment(docXML, "w:commentRangeStart"))
        }
        if !bytes.Contains([]byte(docXML), []byte(`<w:commentReference w:id="`+itoa(wantID)+`"/>`)) {
                t.Errorf("commentReference missing")
        }
        if !bytes.Contains([]byte(cmXML), []byte(`w:id="`+itoa(wantID)+`"`)) ||
                !bytes.Contains([]byte(cmXML), []byte("这里需要修改")) ||
                !bytes.Contains([]byte(cmXML), []byte("张三")) {
                t.Errorf("comments.xml missing comment: %s", cmXML)
        }
        if !bytes.Contains([]byte(ctXML), []byte("/word/comments.xml")) {
                t.Errorf("[Content_Types].xml missing comments override")
        }
        if !bytes.Contains([]byte(relsXML), []byte(`Target="comments.xml"`)) {
                t.Errorf("document.xml.rels missing comments relationship")
        }

        // 解析器回读：批注与锚点均恢复
        doc2, _, err := docxparser.New().Parse(bytes.NewReader(data))
        if err != nil {
                t.Fatalf("parse back: %v", err)
        }
        if len(doc2.Comments) != 1 || doc2.Comments[0].Content != "这里需要修改" || doc2.Comments[0].Author != "张三" {
                t.Fatalf("comments not parsed back: %+v", doc2.Comments)
        }
        p := doc2.Blocks[0].(*core.Paragraph)
        found := false
        for _, in := range p.Inline {
                if txt, ok := in.(core.Text); ok && txt.CommentID == itoa(wantID) {
                        found = true
                }
        }
        if !found {
                t.Errorf("parsed paragraph should contain Text with CommentID=%s, inline=%+v", itoa(wantID), p.Inline)
        }
}

func itoa(n int) string {
        if n == 0 {
                return "0"
        }
        var b [20]byte
        i := len(b)
        neg := n < 0
        if neg {
                n = -n
        }
        for n > 0 {
                i--
                b[i] = byte('0' + n%10)
                n /= 10
        }
        if neg {
                i--
                b[i] = '-'
        }
        return string(b[i:])
}
