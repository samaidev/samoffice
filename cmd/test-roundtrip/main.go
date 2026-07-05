package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/zai/gooffice/internal/parser"
	"github.com/zai/gooffice/internal/renderer/docx"
)

func main() {
	src := "/tmp/test.docx"
	if len(os.Args) > 1 {
		src = os.Args[1]
	}

	data, err := os.ReadFile(src)
	if err != nil {
		fmt.Println("read:", err)
		os.Exit(1)
	}
	registry := parser.NewRegistry()
	doc, warns1, err := registry.ParseBytes(src, data)
	if err != nil {
		fmt.Println("parse:", err)
		os.Exit(1)
	}
	fmt.Printf("Step 1: Parsed %s\n", src)
	fmt.Printf("  Blocks: %d, Warnings: %d\n", len(doc.Blocks), len(warns1))
	fmt.Printf("  Meta: title=%q author=%q\n", doc.Meta.Title, doc.Meta.Author)

	r := docx.New()
	out, err := r.Render(doc)
	if err != nil {
		fmt.Println("render:", err)
		os.Exit(1)
	}
	fmt.Printf("\nStep 2: Rendered %d bytes\n", len(out))

	outPath := "/tmp/test-roundtrip.docx"
	if err := os.WriteFile(outPath, out, 0644); err != nil {
		fmt.Println("write:", err)
		os.Exit(1)
	}
	fmt.Printf("Step 3: Written to %s\n", outPath)

	doc2, warns2, err := registry.ParseBytes(outPath, out)
	if err != nil {
		fmt.Println("re-parse:", err)
		os.Exit(1)
	}
	fmt.Printf("\nStep 4: Re-parsed round-trip docx\n")
	fmt.Printf("  Blocks: %d, Warnings: %d\n", len(doc2.Blocks), len(warns2))
	fmt.Printf("  Meta: title=%q author=%q\n", doc2.Meta.Title, doc2.Meta.Author)

	if len(doc.Blocks) != len(doc2.Blocks) {
		fmt.Printf("\nWARNING: Block count differs: %d vs %d\n", len(doc.Blocks), len(doc2.Blocks))
	} else {
		fmt.Printf("\nOK: Block count matches: %d\n", len(doc.Blocks))
	}

	fmt.Printf("\nFile sizes:\n  Original: %d bytes\n  Round-trip: %d bytes\n", len(data), len(out))

	if !bytes.HasPrefix(out, []byte{0x50, 0x4B}) {
		fmt.Println("WARNING: Output is not a valid ZIP!")
	} else {
		fmt.Println("OK: Output is valid ZIP (PK header)")
	}
}
