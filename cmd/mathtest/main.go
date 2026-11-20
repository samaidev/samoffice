package main

import (
	"fmt"

	docxrenderer "github.com/zai/samoffice/internal/renderer/docx"
)

// mathtest 验证编辑路径的 LaTeX→OMML 转换：\le/\ge/\ne 与 UTF-8 字符。
func main() {
	cases := []string{
		`s_{c*} \le 0`,
		`s_{c*} \ge 1`,
		`a \ne b`,
		`n \in (0,+\infty) 的正整数`,
		`\sum_{n=1}^{N} \frac{1}{(1+r)^n} …省略号…，测试`,
		`ln(PMa_r)`,
	}
	for _, c := range cases {
		omml, ok := docxrenderer.LatexToOMMLForTest(c)
		if !ok {
			fmt.Printf("FAIL  %q -> (转换失败)\n", c)
			continue
		}
		fmt.Printf("OK    %q -> %s\n", c, omml)
	}
}
