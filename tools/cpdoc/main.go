package main

import (
	"fmt"
	"os"
)

func main() {
	src := `D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`
	dst := `c:\Users\Administrator\samoffice\real.doc`
	b, err := os.ReadFile(src)
	if err != nil {
		fmt.Println("read err:", err)
		return
	}
	if err := os.WriteFile(dst, b, 0644); err != nil {
		fmt.Println("write err:", err)
		return
	}
	fmt.Printf("copied %d bytes -> %s\n", len(b), dst)
}
