package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser"
)

func main() {
	registry := parser.NewRegistry()
	cases := []struct {
		name string
		data []byte
	}{
		{name: "1. 完全无效的字节流", data: []byte("this is not a docx at all")},
		{name: "2. 空字节流", data: []byte{}},
		{
			name: "3. 截断的 ZIP",
			data: func() []byte {
				d, _ := os.ReadFile("/tmp/test.docx")
				return d[:len(d)/2]
			}(),
		},
		{
			name: "4. 损坏的 ZIP 头",
			data: []byte{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00},
		},
		{
			name: "5. 包含 null 字节",
			data: func() []byte {
				d, _ := os.ReadFile("/tmp/test.docx")
				if len(d) < 5100 {
					return d
				}
				modified := make([]byte, len(d)+100)
				copy(modified[:5000], d[:5000])
				for i := 5000; i < 5100; i++ {
					modified[i] = 0
				}
				copy(modified[5100:], d[5000:])
				return modified
			}(),
		},
		{name: "6. 乱七八糟的字节", data: bytes.Repeat([]byte{0xFF, 0xFE, 0x00, 0x01}, 100)},
	}

	pass := 0
	for _, c := range cases {
		fmt.Printf("\n=== %s ===\n", c.name)
		fmt.Printf("  Input size: %d bytes\n", len(c.data))

		func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("  ✗ PANIC: %v\n", r)
				}
			}()

			doc, warns, err := registry.ParseBytes("test.docx", c.data)
			if err != nil {
				fmt.Printf("  ✓ Error returned (graceful): %v\n", err)
			} else {
				fmt.Printf("  ✓ Parsed: %d blocks, %d warnings\n", len(doc.Blocks), len(warns))
			}
			pass++
		}()
	}

	fmt.Printf("\n=== Result: %d/%d cases passed without panic ===\n", pass, len(cases))
}
