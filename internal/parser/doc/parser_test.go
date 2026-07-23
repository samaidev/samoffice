package doc

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestParseTestDoc(t *testing.T) {
	data, err := os.ReadFile("../../../test_doc.doc")
	if err != nil {
		t.Skipf("test file missing: %v", err)
	}
	p := New()
	doc, warns, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if len(doc.Blocks) == 0 {
		t.Fatalf("no blocks extracted; warnings=%v", warns)
	}
	b, _ := json.Marshal(doc)
	s := string(b)
	if !strings.Contains(s, "SamOffice") {
		t.Fatalf("expected extracted text to contain 'SamOffice'; got: %s", s)
	}
	t.Logf("extracted %d blocks", len(doc.Blocks))
}
