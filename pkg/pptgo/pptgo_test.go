package pptgo

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateAndSave(t *testing.T) {
	prs := New()
	prs.SetTitle("测试演示")
	prs.SetAuthor("Tester")

	s1 := prs.AddSlide()
	s1.SetLayout(LayoutTitle)
	s1.AddTitle("标题页")
	s1.AddSubtitle("副标题")

	s2 := prs.AddSlide()
	s2.SetLayout(LayoutContent)
	s2.AddTitle("内容页")
	s2.AddBullets([]string{"要点1", "要点2"})

	tmpFile := filepath.Join(t.TempDir(), "pptgo-test.pptx")
	if err := prs.Save(tmpFile); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile)

	if _, err := os.Stat(tmpFile); err != nil {
		t.Fatal("file not created")
	}
}

func TestSlideCount(t *testing.T) {
	prs := New()
	prs.AddSlide().AddTitle("S1")
	prs.AddSlide().AddTitle("S2")
	prs.AddSlide().AddTitle("S3")

	if len(prs.Slides()) != 3 {
		t.Errorf("slides = %d, want 3", len(prs.Slides()))
	}
}

func TestBullets(t *testing.T) {
	prs := New()
	s := prs.AddSlide()
	s.AddBullet("one")
	s.AddBullet("two")
	s.AddBullets([]string{"three", "four"})

	if len(s.Bullets()) != 4 {
		t.Errorf("bullets = %d, want 4", len(s.Bullets()))
	}
}

func TestBytes(t *testing.T) {
	prs := New()
	prs.AddSlide().AddTitle("Test")
	data, err := prs.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 500 {
		t.Errorf("bytes too small: %d", len(data))
	}
	if !strings.HasPrefix(string(data), "PK") {
		t.Error("not ZIP format")
	}
}

func TestBgColor(t *testing.T) {
	prs := New()
	s := prs.AddSlide()
	s.SetBgColor("#FF0000")
	if s.bgColor != "#FF0000" {
		t.Error("bg color not set")
	}
}
