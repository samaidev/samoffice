package main

import (
        "fmt"

        "github.com/zai/gooffice/internal/dict/symspell"
)

func main() {
        s := symspell.New(2)
        for _, w := range []string{"the", "this", "receive", "relieve", "reeve", "revive", "recipe"} {
                s.AddWord(w, 1000)
        }
        s.Build()

        for _, q := range []string{"teh", "recieve"} {
                cands := s.Lookup(q, 10)
                fmt.Printf("Lookup %q (top 10):\n", q)
                for _, c := range cands {
                        fmt.Printf("  %s (d=%d, f=%d)\n", c.Word, c.Distance, c.Frequency)
                }
                fmt.Println()
        }
}

