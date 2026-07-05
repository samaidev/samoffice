package main

import (
	"fmt"

	"github.com/zai/gooffice/internal/dict/hunspell"
	"github.com/zai/gooffice/internal/dict/symspell"
)

func main() {
	enWords, err := hunspell.LoadBuiltin("en_US")
	if err != nil {
		fmt.Println("ERR:", err)
		return
	}
	fmt.Printf("Loaded: %d words\n", len(enWords))

	// 验证关键词是否在词库
	for _, w := range []string{"receive", "recieve", "definite", "accommodation", "separate"} {
		_, ok := enWords[w]
		fmt.Printf("  %q in dict: %v\n", w, ok)
	}

	s := symspell.New(2)
	for w, f := range enWords {
		s.AddWord(w, f)
	}
	s.Build()

	fmt.Printf("\nBuilt index. Testing:\n")
	for _, q := range []string{"recieve", "accomodation", "seperate", "definately", "teh"} {
		cands := s.Lookup(q, 5)
		fmt.Printf("  %q → ", q)
		for _, c := range cands {
			fmt.Printf("%s(d=%d,f=%d) ", c.Word, c.Distance, c.Frequency)
		}
		fmt.Println()
	}
}
