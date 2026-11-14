package hunspell

import (
	"testing"
)

func TestParseAffBasic(t *testing.T) {
	affData := []byte(`SET UTF-8
SFX A Y 2
SFX A 0 re .
SFX A e er .
PFX B N 1
PFX B 0 un .
`)
	r := ParseAffRules(affData)
	if r.Encoding != "UTF-8" {
		t.Errorf("encoding = %q, want UTF-8", r.Encoding)
	}
	if _, ok := r.SFX['A']; !ok {
		t.Error("SFX A not parsed")
	}
	if _, ok := r.PFX['B']; !ok {
		t.Error("PFX B not parsed")
	}
	if len(r.SFX['A'].Entries) != 2 {
		t.Errorf("SFX A entries = %d, want 2", len(r.SFX['A'].Entries))
	}
}

func TestDerive(t *testing.T) {
	affData := []byte(`SET UTF-8
SFX M Y 1
SFX M 0 ly .
SFX S Y 1
SFX S 0 s .
`)
	r := ParseAffRules(affData)

	// definite/SM → definite, definites, definitely
	derived := r.Derive("definite", "SM")
	want := map[string]bool{
		"definite":    true,
		"definites":   true,
		"definitely":  true,
	}
	for _, w := range derived {
		if !want[w] {
			t.Logf("unexpected derived word: %s", w)
		}
	}
	for w := range want {
		found := false
		for _, d := range derived {
			if d == w {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected derived word %q not found in %v", w, derived)
		}
	}
}

func TestParseDicWithAff(t *testing.T) {
	dicData := []byte(`3
definite/SM
happy/A
office
`)
	affData := []byte(`SET UTF-8
SFX M Y 1
SFX M 0 ly .
SFX S Y 1
SFX S 0 s .
SFX A Y 1
SFX A y ier .
`)
	rules := ParseAffRules(affData)
	words, err := ParseDicWithAff(dicData, rules)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	// 验证派生词在
	expected := []string{"definite", "definites", "definitely", "happy", "happier", "office"}
	for _, w := range expected {
		if _, ok := words[w]; !ok {
			t.Errorf("expected word %q in dict, got %d words", w, len(words))
		}
	}
}
