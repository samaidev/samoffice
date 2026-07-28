// reader_test.go — 验证三个库的读写往返（与 UI 操作对齐）

package pptgo

import (
	"os"
	"testing"
)

// TestRoundTripWriteRead 验证写入后重新读取，结构与 UI 操作一致
func TestRoundTripWriteRead(t *testing.T) {
	// 1. 创建并写入
	prs := New()
	prs.SetTitle("测试演示文稿")
	prs.SetAuthor("GoOffice")
	prs.SetSubject("往返测试")

	s1 := prs.AddSlide()
	s1.SetLayout(LayoutTitle)
	s1.AddTitle("第一张标题")
	s1.AddSubtitle("副标题内容")

	s2 := prs.AddSlide()
	s2.SetLayout(LayoutContent)
	s2.AddTitle("第二张")
	s2.AddBullet("要点一")
	s2.AddBullet("要点二")
	s2.AddBullet("要点三")

	s3 := prs.AddSlide()
	s3.SetLayout(LayoutContent)
	s3.AddTitle("带背景")
	s3.AddBullet("彩色背景页")
	s3.SetBgColor("FF6600")

	// 2. 保存为字节
	data, err := prs.Bytes()
	if err != nil {
		t.Fatalf("Bytes() failed: %v", err)
	}

	// 3. 重新解析
	prs2, err := ParseBytes(data)
	if err != nil {
		t.Fatalf("ParseBytes() failed: %v", err)
	}

	// 4. 验证元数据
	if prs2.Author() != "GoOffice" {
		t.Errorf("Author = %q, want GoOffice", prs2.Author())
	}
	if prs2.Subject() != "往返测试" {
		t.Errorf("Subject = %q, want 往返测试", prs2.Subject())
	}

	// 5. 验证幻灯片数
	if prs2.SlideCount() != 3 {
		t.Errorf("SlideCount = %d, want 3", prs2.SlideCount())
	}

	// 6. 验证第一张标题
	s1r := prs2.GetSlide(0)
	if s1r == nil {
		t.Fatal("GetSlide(0) returned nil")
	}
	if s1r.Title() != "第一张标题" {
		t.Errorf("Slide 0 title = %q, want 第一张标题", s1r.Title())
	}
	if s1r.GetSubtitle() != "副标题内容" {
		t.Errorf("Slide 0 subtitle = %q, want 副标题内容", s1r.GetSubtitle())
	}

	// 7. 验证第二张要点
	s2r := prs2.GetSlide(1)
	if s2r == nil {
		t.Fatal("GetSlide(1) returned nil")
	}
	if s2r.Title() != "第二张" {
		t.Errorf("Slide 1 title = %q, want 第二张", s2r.Title())
	}
	bullets := s2r.GetBullets()
	if len(bullets) < 2 {
		t.Errorf("Slide 1 bullets = %d, want >= 2", len(bullets))
	}

	// 8. 验证第三张背景色
	s3r := prs2.GetSlide(2)
	if s3r == nil {
		t.Fatal("GetSlide(2) returned nil")
	}
	if s3r.GetBgColor() != "#FF6600" {
		t.Errorf("Slide 2 bgColor = %q, want #FF6600", s3r.GetBgColor())
	}
}

// TestOpenFile 验证从文件打开
func TestOpenFile(t *testing.T) {
	prs := New()
	s := prs.AddSlide()
	s.AddTitle("文件打开测试")
	s.AddBullet("要点A")

	tmpFile := filepath.Join(t.TempDir(), "test_pptgo_open.pptx")
	defer os.Remove(tmpFile)

	if err := prs.Save(tmpFile); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	prs2, err := Open(tmpFile)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if prs2.SlideCount() != 1 {
		t.Errorf("SlideCount = %d, want 1", prs2.SlideCount())
	}
}
