package chinese

import (
        "testing"
)

func TestSegmentBasic(t *testing.T) {
        s := New()
        s.AddWord("我们", 100)
        s.AddWord("北京", 100)
        s.AddWord("编辑", 100)
        s.AddWord("文档", 100)

        tokens := s.Segment("我们在北京编辑文档")
        want := []string{"我们", "在", "北京", "编辑", "文档"}
        if len(tokens) != len(want) {
                t.Errorf("token count = %d, want %d, tokens=%v", len(tokens), len(want), tokens)
                return
        }
        for i, w := range want {
                if tokens[i] != w {
                        t.Errorf("token[%d] = %q, want %q", i, tokens[i], w)
                }
        }
}

func TestSegmentMixed(t *testing.T) {
        s := New()
        s.AddWord("Hello", 100)
        s.AddWord("世界", 100)
        tokens := s.Segment("Hello 世界 123")
        if len(tokens) < 3 {
                t.Errorf("expected at least 3 tokens, got %d: %v", len(tokens), tokens)
        }
}

func TestSegmentEmpty(t *testing.T) {
        s := New()
        if tokens := s.Segment(""); len(tokens) != 0 {
                t.Errorf("empty input should return 0 tokens, got %v", tokens)
        }
}

func TestHasWord(t *testing.T) {
        s := New()
        s.AddWord("测试", 10)
        if !s.HasWord("测试") {
                t.Error("HasWord(测试) should be true")
        }
        if s.HasWord("不存在") {
                t.Error("HasWord(不存在) should be false")
        }
}
