package main

import (
	"encoding/json"
	"fmt"

	"github.com/zai/samoffice/internal/core"
)

func main() {
	raw := `{"items":[[{"inline":[{"content":"a"}]}]],"ordered":true,"style":"circle-num","start":1}`
	var doc core.Document
	err := json.Unmarshal([]byte(`{"blocks":[`+raw+`]}`), &doc)
	if err != nil {
		fmt.Println("ERR:", err)
		return
	}
	for _, b := range doc.Blocks {
		if l, ok := b.(*core.BulletList); ok {
			fmt.Printf("OK BulletList ordered=%v style=%q items=%d\n", l.Ordered, l.Style, len(l.Items))
		} else {
			fmt.Printf("WRONG TYPE: %T\n", b)
		}
	}
}
