package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/zai/samoffice/internal/parser"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "dump" {
		entries, _ := os.ReadDir("C:\\Users\\Administrator\\Desktop")
		for _, e := range entries {
			if len(e.Name()) > 5 && e.Name()[len(e.Name())-5:] == ".docx" {
				dumpDocumentXML("C:\\Users\\Administrator\\Desktop\\" + e.Name())
				return
			}
		}
		fmt.Println("NO DOCX ON DESKTOP")
		return
	}
	path := ""
	if len(os.Args) > 1 {
		if os.Args[1] == "export" {
			entries, _ := os.ReadDir("C:\\Users\\Administrator\\Desktop")
			for _, e := range entries {
				if strings.HasSuffix(strings.ToLower(e.Name()), ".docx") {
					path = "C:\\Users\\Administrator\\Desktop\\" + e.Name()
					break
				}
			}
		} else {
			path = os.Args[1]
		}
	}
	if path == "" || path == "auto" {
		entries, _ := os.ReadDir("C:\\Users\\Administrator\\Desktop")
		for _, e := range entries {
			if strings.HasSuffix(strings.ToLower(e.Name()), ".docx") {
				path = "C:\\Users\\Administrator\\Desktop\\" + e.Name()
				break
			}
		}
	}
	if path == "" {
		fmt.Println("NO DOCX FOUND ON DESKTOP")
		os.Exit(1)
	}
	reg := parser.NewRegistry()
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("READ ERROR:", err)
		os.Exit(1)
	}
	doc, warns, err := reg.ParseBytes(path, data)
	if err != nil {
		fmt.Println("PARSE ERROR:", err)
		os.Exit(1)
	}
	if len(os.Args) > 1 && os.Args[1] == "export" {
		out := "c:\\samoffice\\real_doc.json"
		if len(os.Args) > 2 {
			out = os.Args[2]
		}
		b, _ := json.MarshalIndent(doc, "", "  ")
		os.WriteFile(out, b, 0644)
		fmt.Printf("EXPORTED UDM to %s (%d bytes, %d warnings)\n", out, len(b), len(warns))
		return
	}
	b, _ := json.Marshal(doc)
	var m map[string]interface{}
	json.Unmarshal(b, &m)
	blocks, _ := m["blocks"].([]interface{})
	fontSet := map[string]int{}
	for _, blk := range blocks {
		blkMap, ok := blk.(map[string]interface{})
		if !ok {
			continue
		}
		inlines, _ := blkMap["inline"].([]interface{})
		for _, in := range inlines {
			inMap, ok := in.(map[string]interface{})
			if !ok {
				continue
			}
			if inMap["content"] != nil || inMap["font"] != nil {
				font, _ := inMap["font"].(string)
				fontSet[font]++
			}
		}
	}
	fmt.Println("=== FONT USAGE (font name -> count of inline runs) ===")
	for f, c := range fontSet {
		fmt.Printf("  %q: %d\n", f, c)
	}
	fmt.Println("=== blocks count:", len(blocks), "===")
	fmt.Println("=== warnings:", len(warns), "===")
	for _, w := range warns {
		fmt.Printf("  WARN: %s\n", w.Message)
	}
	shown := 0
	for _, blk := range blocks {
		blkMap, ok := blk.(map[string]interface{})
		if !ok {
			continue
		}
		inlines, _ := blkMap["inline"].([]interface{})
		for _, in := range inlines {
			inMap, ok := in.(map[string]interface{})
			if !ok {
				continue
			}
			if txt, ok := inMap["content"].(string); ok && len([]rune(txt)) > 0 {
				font, _ := inMap["font"].(string)
				fmt.Printf("[font=%q] %q\n", font, txt)
				shown++
				if shown >= 15 {
					return
				}
			}
		}
	}
}
