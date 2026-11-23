package pptx

import (
	"archive/zip"
	"os"
	"strings"
	"testing"
)

// round58 调试：背景图解析断链定位
func TestR58BgImage(t *testing.T) {
	path := os.Getenv("R58_PPTX")
	if path == "" {
		t.Skip("R58_PPTX 未设置")
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	theme := parseTheme(files)
	master := parseMasterExtras(files, "ppt/slideMasters/slideMaster1.xml", theme)
	color, img := parseBgInfo(files, "ppt/slideMasters/slideMaster1.xml", theme, master.clrMap)
	t.Logf("color=%s imgLen=%d tile=%d,%d", color, len(img.Img), img.TileW, img.TileH)
	if len(img.Img) > 60 {
		t.Logf("head=%s", strings.ReplaceAll(img.Img[:60], "\n", ""))
	}
	// 直接测 bgImageAt
	direct := bgImageAt(files, 1003, "#8B8E83")
	t.Logf("direct: imgLen=%d tile=%d,%d", len(direct.Img), direct.TileW, direct.TileH)
	// 主题 rels 检查
	tp := findThemePath(files)
	relsPath := strings.Replace(tp, "theme/", "theme/_rels/", 1) + ".rels"
	t.Logf("theme=%s relsPath=%s exists=%v", tp, relsPath, files[relsPath] != nil)
	t.Logf("rId2 → %s", relsTargetByID(files, relsPath, "rId2"))
}
