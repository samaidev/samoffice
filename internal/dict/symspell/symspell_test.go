package symspell

import (
        "os"
        "path/filepath"
        "testing"
)

func TestSymSpellBasic(t *testing.T) {
        s := New(2)
        words := []string{"hello", "world", "help", "hero", "office", "document"}
        for _, w := range words {
                s.AddWord(w, 1000)
        }
        s.Build()

        // 完全匹配
        cands := s.Lookup("hello", 5)
        if len(cands) != 1 || cands[0].Word != "hello" || cands[0].Distance != 0 {
                t.Errorf("exact match failed: %+v", cands)
        }

        // 单删除：helo → hello（应在候选中）
        cands = s.Lookup("helo", 5)
        foundHello := false
        for _, c := range cands {
                if c.Word == "hello" && c.Distance == 1 {
                        foundHello = true
                }
        }
        if !foundHello {
                t.Errorf("helo should match hello at distance 1, got %+v", cands)
        }

        // 双删除：wrld → world
        cands = s.Lookup("wrld", 5)
        found := false
        for _, c := range cands {
                if c.Word == "world" {
                        found = true
                        break
                }
        }
        if !found {
                t.Errorf("wrld should match world, got %+v", cands)
        }
}

func TestDamerauDistance(t *testing.T) {
        // 相邻交换：recieve → receive (距离 1)
        s := New(2)
        s.AddWord("receive", 1000)
        s.AddWord("relieve", 1000)
        s.Build()

        cands := s.Lookup("recieve", 5)
        if len(cands) == 0 {
                t.Fatal("recieve should have candidates")
        }
        // receive 距离应为 1，relieve 距离应为 1
        foundReceive := false
        for _, c := range cands {
                if c.Word == "receive" && c.Distance == 1 {
                        foundReceive = true
                }
        }
        if !foundReceive {
                t.Errorf("recieve should match receive at distance 1, got %+v", cands)
        }
}

func TestEmptyAndLookup(t *testing.T) {
        s := New(2)
        s.Build()

        if cands := s.Lookup("", 5); len(cands) != 0 {
                t.Errorf("empty query should return empty, got %+v", cands)
        }
        if cands := s.Lookup("xyz", 5); len(cands) != 0 {
                t.Errorf("unknown word with empty dict should return empty, got %+v", cands)
        }
}

func TestIndexSerialization(t *testing.T) {
        s := New(2)
        words := []string{"hello", "world", "test", "office", "document"}
        for _, w := range words {
                s.AddWord(w, 500)
        }
        s.Build()

        tmpDir, _ := os.MkdirTemp("", "symspell-test")
        defer os.RemoveAll(tmpDir)
        cachePath := filepath.Join(tmpDir, "test.gob")

        if err := s.SaveIndex(cachePath); err != nil {
                t.Fatalf("save index: %v", err)
        }

        // 新实例加载
        s2 := New(2)
        if err := s2.LoadIndex(cachePath); err != nil {
                t.Fatalf("load index: %v", err)
        }

        // 验证查询结果一致
        cands1 := s.Lookup("helo", 5)
        cands2 := s2.Lookup("helo", 5)
        if len(cands1) != len(cands2) {
                t.Errorf("after load, candidate count mismatch: %d vs %d", len(cands1), len(cands2))
        } else {
                for i := range cands1 {
                        if cands1[i].Word != cands2[i].Word || cands1[i].Distance != cands2[i].Distance {
                                t.Errorf("candidate %d mismatch: %+v vs %+v", i, cands1[i], cands2[i])
                        }
                }
        }
}

func TestEditDistance(t *testing.T) {
        cases := []struct {
                a, b string
                want int
        }{
                {"hello", "hello", 0},
                {"hello", "hell", 1},
                {"hello", "hallo", 1},
                {"", "abc", 3},
                {"abc", "", 3},
        }
        for _, c := range cases {
                got := editDistance(c.a, c.b)
                if got != c.want {
                        t.Errorf("editDistance(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
                }
        }
}
