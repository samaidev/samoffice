package main

import (
	"fmt"

	"github.com/zai/gooffice/internal/dict/symspell"
)

func main() {
	s := symspell.New(2)
	words := []string{"hello", "world", "office", "help", "hero"}
	for _, w := range words {
		s.AddWord(w, 1000)
	}
	s.Build()

	query := "helo"
	fmt.Printf("Query: %q\n", query)

	cands := s.Lookup(query, 5)
	fmt.Printf("Candidates: %d\n", len(cands))
	for _, c := range cands {
		fmt.Printf("  - word=%q dist=%d freq=%d\n", c.Word, c.Distance, c.Frequency)
	}

	for _, q := range []string{"wrld", "ofice", "hlp", "hro"} {
		cands := s.Lookup(q, 5)
		fmt.Printf("\nQuery: %q\n", q)
		for _, c := range cands {
			fmt.Printf("  - word=%q dist=%d\n", c.Word, c.Distance)
		}
	}
}
