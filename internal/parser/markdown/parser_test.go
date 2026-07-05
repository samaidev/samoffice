package markdown

import (
        "strings"
        "testing"

        "github.com/zai/gooffice/internal/core"
)

func TestParseBasic(t *testing.T) {
        p := New()
        md := "# Title\n\nThis is a paragraph with **bold** and *italic*.\n\n## Subtitle\n\n- item 1\n- item 2\n"
        doc, warns, err := p.Parse(strings.NewReader(md))
        if err != nil {
                t.Fatalf("parse: %v", err)
        }
        if len(warns) != 0 {
                t.Errorf("warnings: %v", warns)
        }
        if len(doc.Blocks) < 4 {
                t.Errorf("expected at least 4 blocks, got %d", len(doc.Blocks))
        }
}

func TestParseHeading(t *testing.T) {
        p := New()
        doc, _, err := p.Parse(strings.NewReader("# Hello\n## World\n### Deep"))
        if err != nil {
                t.Fatalf("parse: %v", err)
        }
        if len(doc.Blocks) != 3 {
                t.Fatalf("expected 3 headings, got %d", len(doc.Blocks))
        }
}

func TestParseInline(t *testing.T) {
        inlines := parseInline("hello **world** end")
        if len(inlines) < 3 {
                t.Errorf("expected at least 3 inlines, got %d", len(inlines))
        }
        foundBold := false
        for _, in := range inlines {
                if t, ok := in.(core.Text); ok && t.Content == "world" && t.Bold {
                        foundBold = true
                }
        }
        if !foundBold {
                t.Error("expected bold 'world' inline")
        }
}

func TestParseCodeBlock(t *testing.T) {
        p := New()
        md := "```python\nprint(1)\n```\n"
        doc, _, err := p.Parse(strings.NewReader(md))
        if err != nil {
                t.Fatalf("parse: %v", err)
        }
        if len(doc.Blocks) != 1 {
                t.Fatalf("expected 1 block, got %d", len(doc.Blocks))
        }
        cb, ok := doc.Blocks[0].(*core.CodeBlock)
        if !ok {
                t.Fatalf("expected CodeBlock, got %T", doc.Blocks[0])
        }
        if cb.Code != "print(1)\n" {
                t.Errorf("code = %q, want %q", cb.Code, "print(1)\n")
        }
}
