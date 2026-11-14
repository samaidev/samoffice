package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/parser/xls"
)

func main() {
	data, err := os.ReadFile("_verify/complex.xls")
	if err != nil {
		fmt.Println("read:", err)
		return
	}
	doc, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		fmt.Println("mscfb:", err)
		return
	}
	for entry, err := doc.Next(); err == nil; entry, err = doc.Next() {
		if entry.Name != "Workbook" && entry.Name != "Book" {
			continue
		}
		wb, _ := io.ReadAll(doc)
		dumpFormulas(wb)
	}
	_ = xls.DecodeFormulaPtg
}

func dumpFormulas(wb []byte) {
	i := 0
	for i+4 <= len(wb) {
		opcode := binary.LittleEndian.Uint16(wb[i : i+2])
		length := int(binary.LittleEndian.Uint16(wb[i+2 : i+4]))
		i += 4
		if opcode == 0x0006 && i+length <= len(wb) {
			d := wb[i : i+length]
			if len(d) >= 22 {
				cce := int(binary.LittleEndian.Uint16(d[20:22]))
				rgce := d[22:min(22+cce, len(d))]
				fmt.Printf("rgce=% X\n  -> %s\n", rgce, xls.DecodeFormulaPtg(rgce))
			}
		}
		i += length
	}
}

func min(a, b int) int { if a < b { return a }; return b }

type byteReader struct{ b []byte; off int }
func bytesReader(b []byte) *byteReader { return &byteReader{b: b} }
func (r *byteReader) Read(p []byte) (int, error) {
	if r.off >= len(r.b) { return 0, io.EOF }
	n := copy(p, r.b[r.off:])
	r.off += n
	return n, nil
}
