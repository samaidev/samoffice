package main

import (
        "fmt"
        "os"

        "github.com/zai/gooffice/internal/core"
        "github.com/zai/gooffice/internal/dict"
        "github.com/zai/gooffice/internal/dict/userdict"
        "github.com/zai/gooffice/internal/parser"
)

func main() {
        fmt.Println("=== GoOffice Module Test ===")

        // 1. 词库测试
        testDict()

        // 2. Markdown 解析测试
        testMarkdown()

        // 3. docx 解析测试（如果有样本文件）
        if len(os.Args) > 1 {
                testDocx(os.Args[1])
        }
}

func testDict() {
        fmt.Println("\n--- Dictionary Test ---")
        store, err := userdict.Open("/tmp/test-userdict.sqlite")
        if err != nil {
                fmt.Println("ERR:", err)
                return
        }
        defer store.Close()

        mgr := dict.NewManager(store)
        enWords := map[string]int{
                "hello": 1000, "world": 1000, "office": 500, "document": 500,
                "open": 500, "save": 500, "spell": 200, "check": 500,
        }
        mgr.RegisterLang("en", enWords)

        text := "helo world, this is a officce document with erors"
        errs := mgr.SpellCheck(text, "en")
        fmt.Printf("Text: %q\n", text)
        fmt.Printf("Errors found: %d\n", len(errs))
        for _, e := range errs {
                fmt.Printf("  - Word=%q Start=%d End=%d SuggestLen=%d\n", e.Word, e.Start, e.End, len(e.Suggest))
                for i, s := range e.Suggest {
                        fmt.Printf("      [%d] %q (len=%d)\n", i, s, len(s))
                }
        }

        mgr.LearnUserWord("officce", "en", "manual")
        fmt.Println("\nAfter learning 'officce':")
        errs2 := mgr.SpellCheck(text, "en")
        fmt.Printf("Errors found: %d\n", len(errs2))
        for _, e := range errs2 {
                fmt.Printf("  - %q\n", e.Word)
        }
}

func testMarkdown() {
        fmt.Println("\n--- Markdown Parser Test ---")
        registry := parser.NewRegistry()
        md := "# Hello World\n\nThis is a **bold** and *italic* text with a [link](https://example.com).\n\n## Subtitle\n\n- item 1\n- item 2\n\n```go\nfmt.Println(\"Hello\")\n```\n"
        doc, warns, err := registry.ParseBytes("test.md", []byte(md))
        if err != nil {
                fmt.Println("ERR:", err)
                return
        }
        fmt.Printf("Warnings: %d\n", len(warns))
        fmt.Printf("Blocks: %d\n", len(doc.Blocks))
        for i, b := range doc.Blocks {
                fmt.Printf("  [%d] %s\n", i, b.BlockType())
                if p, ok := b.(*core.Paragraph); ok {
                        for _, in := range p.Inline {
                                if t, ok := in.(core.Text); ok {
                                        fmt.Printf("      text: %q (bold=%v italic=%v)\n", t.Content, t.Bold, t.Italic)
                                }
                                if h, ok := in.(core.Hyperlink); ok {
                                        fmt.Printf("      link: %q -> %s\n", h.Text, h.URL)
                                }
                        }
                }
                if h, ok := b.(*core.Heading); ok {
                        fmt.Printf("      level=%d\n", h.Level)
                }
        }
}

func testDocx(path string) {
        fmt.Println("\n--- DOCX Parser Test ---")
        fmt.Printf("File: %s\n", path)
        data, err := os.ReadFile(path)
        if err != nil {
                fmt.Println("read file ERR:", err)
                return
        }
        registry := parser.NewRegistry()
        doc, warns, err := registry.ParseBytes(path, data)
        if err != nil {
                fmt.Println("ERR:", err)
                return
        }
        fmt.Printf("Warnings: %d\n", len(warns))
        fmt.Printf("Meta: %+v\n", doc.Meta)
        fmt.Printf("Blocks: %d\n", len(doc.Blocks))
        for i, b := range doc.Blocks {
                if i > 10 {
                        fmt.Printf("  ... (%d more)\n", len(doc.Blocks)-10)
                        break
                }
                fmt.Printf("  [%d] %s\n", i, b.BlockType())
                if p, ok := b.(*core.Paragraph); ok {
                        for _, in := range p.Inline {
                                if t, ok := in.(core.Text); ok {
                                        fmt.Printf("      text: %q (bold=%v italic=%v)\n", t.Content, t.Bold, t.Italic)
                                }
                        }
                }
                if h, ok := b.(*core.Heading); ok {
                        fmt.Printf("      level=%d\n", h.Level)
                }
        }
}
