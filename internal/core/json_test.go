package core

import (
        "encoding/json"
        "testing"
)

func TestDocumentUnmarshalJSON(t *testing.T) {
        jsonStr := `{
                "meta": {"title": "测试", "author": "T"},
                "blocks": [
                        {"inline": [{"content": "段落文本"}], "style": "", "align": ""},
                        {"level": 2, "inline": [{"content": "标题"}]},
                        {"items": [[{"inline": [{"content": "项1"}], "style": "", "align": ""}]], "ordered": false},
                        {"code": "fmt.Println(\"hi\")"},
                        {"src": "data:image/png;base64,xxx", "alt": "img"},
                        {"rows": [[{"inline": [{"content": "A1"}], "isHeader": true}]]}
                ]
        }`

        var doc Document
        if err := json.Unmarshal([]byte(jsonStr), &doc); err != nil {
                t.Fatalf("unmarshal: %v", err)
        }

        if doc.Meta.Title != "测试" {
                t.Errorf("title = %q", doc.Meta.Title)
        }
        if len(doc.Blocks) != 6 {
                t.Fatalf("expected 6 blocks, got %d", len(doc.Blocks))
        }

        // 验证各类型
        if _, ok := doc.Blocks[0].(*Paragraph); !ok {
                t.Errorf("block 0 should be Paragraph, got %T", doc.Blocks[0])
        }
        if _, ok := doc.Blocks[1].(*Heading); !ok {
                t.Errorf("block 1 should be Heading, got %T", doc.Blocks[1])
        }
        if _, ok := doc.Blocks[2].(*BulletList); !ok {
                t.Errorf("block 2 should be BulletList, got %T", doc.Blocks[2])
        }
        if _, ok := doc.Blocks[3].(*CodeBlock); !ok {
                t.Errorf("block 3 should be CodeBlock, got %T", doc.Blocks[3])
        }
        if _, ok := doc.Blocks[4].(*Image); !ok {
                t.Errorf("block 4 should be Image, got %T", doc.Blocks[4])
        }
        if _, ok := doc.Blocks[5].(*Table); !ok {
                t.Errorf("block 5 should be Table, got %T", doc.Blocks[5])
        }
}

func TestTableUnmarshal(t *testing.T) {
        jsonStr := `{
                "rows": [
                        [{"inline": [{"content": "A1"}], "isHeader": true},
                         {"inline": [{"content": "B1"}], "isHeader": true}],
                        [{"inline": [{"content": "A2"}]},
                         {"inline": [{"content": "B2"}]}]
                ]
        }`

        var tbl Table
        if err := json.Unmarshal([]byte(jsonStr), &tbl); err != nil {
                t.Fatalf("unmarshal table: %v", err)
        }
        if len(tbl.Rows) != 2 {
                t.Fatalf("expected 2 rows, got %d", len(tbl.Rows))
        }
        if len(tbl.Rows[0]) != 2 {
                t.Fatalf("expected 2 cells in row 0, got %d", len(tbl.Rows[0]))
        }
        if !tbl.Rows[0][0].IsHeader {
                t.Error("first cell should be header")
        }
        // Inline[0] 反序列化为 *Text
        var cellText string
        if t, ok := tbl.Rows[0][0].Inline[0].(Text); ok {
                cellText = t.Content
        } else if t, ok := tbl.Rows[0][0].Inline[0].(*Text); ok {
                cellText = t.Content
        }
        if cellText != "A1" {
                t.Errorf("cell content = %q, want A1", cellText)
        }
}

func TestHyperlinkUnmarshal(t *testing.T) {
        jsonStr := `{
                "url": "https://example.com",
                "text": [{"content": "link text"}]
        }`
        var h Hyperlink
        if err := json.Unmarshal([]byte(jsonStr), &h); err != nil {
                t.Fatalf("unmarshal hyperlink: %v", err)
        }
        if h.URL != "https://example.com" {
                t.Errorf("url = %q", h.URL)
        }
        if len(h.Text) != 1 {
                t.Fatalf("expected 1 inline, got %d", len(h.Text))
        }
        var textContent string
        if t, ok := h.Text[0].(Text); ok {
                textContent = t.Content
        } else if t, ok := h.Text[0].(*Text); ok {
                textContent = t.Content
        }
        if textContent != "link text" {
                t.Errorf("text = %q", textContent)
        }
}

func TestRoundTripJSON(t *testing.T) {
        doc := &Document{
                Meta: Meta{Title: "Round Trip"},
                Blocks: []Block{
                        &Paragraph{Inline: []Inline{Text{Content: "测试"}}},
                },
        }
        data, err := json.Marshal(doc)
        if err != nil {
                t.Fatalf("marshal: %v", err)
        }
        var doc2 Document
        if err := json.Unmarshal(data, &doc2); err != nil {
                t.Fatalf("unmarshal: %v", err)
        }
        if doc2.Meta.Title != doc.Meta.Title {
                t.Errorf("title mismatch: %q vs %q", doc2.Meta.Title, doc.Meta.Title)
        }
        if len(doc2.Blocks) != 1 {
                t.Fatalf("blocks: %d vs 1", len(doc2.Blocks))
        }
}
