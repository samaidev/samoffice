package docx

import (
        "archive/zip"
        "bytes"
        "strings"
        "testing"

        "github.com/zai/samoffice/internal/core"
)

// buildZip 构造内存 docx（zip）字节流
func buildZip(t *testing.T, entries map[string]string, binary map[string][]byte) []byte {
        t.Helper()
        var buf bytes.Buffer
        zw := zip.NewWriter(&buf)
        for name, content := range entries {
                w, err := zw.Create(name)
                if err != nil {
                        t.Fatalf("create %s: %v", name, err)
                }
                if _, err := w.Write([]byte(content)); err != nil {
                        t.Fatalf("write %s: %v", name, err)
                }
        }
        for name, data := range binary {
                w, err := zw.Create(name)
                if err != nil {
                        t.Fatalf("create %s: %v", name, err)
                }
                if _, err := w.Write(data); err != nil {
                        t.Fatalf("write %s: %v", name, err)
                }
        }
        if err := zw.Close(); err != nil {
                t.Fatalf("close zip: %v", err)
        }
        return buf.Bytes()
}

// TestParseWordList 验证 word/numbering.xml 列表读入：连续相同 (numId,ilvl)
// 的段落聚合为 core.BulletList；decimal → 编号列表，bullet → 项目符号列表；
// 列表段落的对齐/缩进保留；非列表段落冲刷列表。
func TestParseWordList(t *testing.T) {
        docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:jc w:val="center"/></w:pPr><w:r><w:t>第一项</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>第二项</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>符号项</w:t></w:r></w:p>
    <w:p><w:r><w:t>普通段落</w:t></w:r></w:p>
  </w:body>
</w:document>`
        numberingXML := `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="11">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="2"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="1"><w:abstractNumId w:val="11"/></w:num>
</w:numbering>`
        data := buildZip(t, map[string]string{
                "word/document.xml":  docXML,
                "word/numbering.xml": numberingXML,
        }, nil)

        doc, warns, err := New().Parse(bytes.NewReader(data))
        if err != nil {
                t.Fatalf("Parse: %v (warns=%v)", err, warns)
        }
        if len(doc.Blocks) != 3 {
                t.Fatalf("expected 3 blocks (list2, list1, paragraph), got %d: %T", len(doc.Blocks), blocksTypes(doc.Blocks))
        }
        l1, ok := doc.Blocks[0].(*core.BulletList)
        if !ok {
                t.Fatalf("block 0 expected *core.BulletList, got %T", doc.Blocks[0])
        }
        if !l1.Ordered {
                t.Errorf("numId=2 (decimal) should be ordered list")
        }
        if len(l1.Items) != 2 {
                t.Fatalf("ordered list items = %d, want 2", len(l1.Items))
        }
        if got := inlineTextCore(l1.Items[0]); got != "第一项" {
                t.Errorf("item 0 text = %q, want 第一项", got)
        }
        // 列表段落原有对齐保留
        p0 := l1.Items[0][0].(*core.Paragraph)
        if p0.Align != "center" {
                t.Errorf("list paragraph align = %q, want center", p0.Align)
        }
        l2, ok := doc.Blocks[1].(*core.BulletList)
        if !ok {
                t.Fatalf("block 1 expected *core.BulletList, got %T", doc.Blocks[1])
        }
        if l2.Ordered {
                t.Errorf("numId=1 (bullet) should NOT be ordered list")
        }
        if len(l2.Items) != 1 || inlineTextCore(l2.Items[0]) != "符号项" {
                t.Errorf("bullet list items wrong: %+v", l2.Items)
        }
        if p, ok := doc.Blocks[2].(*core.Paragraph); !ok || inlineTextCore([]core.Block{p}) != "普通段落" {
                t.Errorf("block 2 expected plain paragraph, got %T", doc.Blocks[2])
        }
}

// TestParseParaBorderShading 验证 pBdr/shd 读入：红头线 → "redBottom"，
// 灰色底线 → "bottom"（与写器 paraBorderXML 字符串形态互逆），shd fill → props.shading。
func TestParseParaBorderShading(t *testing.T) {
        xml := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="C00000"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF3CD"/></w:pPr><w:r><w:t>红头段落</w:t></w:r></w:p>
    <w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr><w:r><w:t>上下边框</w:t></w:r></w:p>
  </w:body>
</w:document>`
        blocks, warns, _, _ := parseDocumentXML(strings.NewReader(xml), map[string]string{})
        if len(blocks) != 2 {
                t.Fatalf("expected 2 blocks, got %d (warns=%v)", len(blocks), warns)
        }
        p0 := blocks[0].(*core.Paragraph)
        if p0.Props["border"] != "redBottom" {
                t.Errorf("red header border = %v, want redBottom", p0.Props["border"])
        }
        if p0.Props["shading"] != "#FFF3CD" {
                t.Errorf("shading = %v, want #FFF3CD", p0.Props["shading"])
        }
        p1 := blocks[1].(*core.Paragraph)
        if p1.Props["border"] != "top bottom" {
                t.Errorf("multi-side border = %v, want 'top bottom'", p1.Props["border"])
        }
}

// TestParseDocxImage 验证 docx 图片读入：rels + media + drawing → InlineImage(data URI, px)
func TestParseDocxImage(t *testing.T) {
        // 1x1 PNG（与 renderer 测试相同的字节）
        pngBytes := []byte{
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
                0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
                0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
                0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
                0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        }
        docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r><w:t>前文</w:t></w:r>
      <w:r><w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="3048000" cy="1524000"/>
          <wp:docPr id="1" name="Picture 1"/>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill>
            </pic:pic>
          </a:graphicData></a:graphic>
        </wp:inline>
      </w:drawing></w:r>
      <w:r><w:t>后文</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
        relsXML := `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`
        data := buildZip(t, map[string]string{
                "word/document.xml":           docXML,
                "word/_rels/document.xml.rels": relsXML,
        }, map[string][]byte{"word/media/image1.png": pngBytes})

        doc, warns, err := New().Parse(bytes.NewReader(data))
        if err != nil {
                t.Fatalf("Parse: %v (warns=%v)", err, warns)
        }
        if len(doc.Blocks) != 1 {
                t.Fatalf("expected 1 paragraph, got %d", len(doc.Blocks))
        }
        p := doc.Blocks[0].(*core.Paragraph)
        var im *core.InlineImage
        var order []string
        for _, in := range p.Inline {
                switch v := in.(type) {
                case core.Text:
                        order = append(order, v.Content)
                case core.InlineImage:
                        im = &v
                        order = append(order, "[img]")
                }
        }
        if im == nil {
                t.Fatalf("InlineImage not parsed: %+v", p.Inline)
        }
        if !strings.HasPrefix(im.Src, "data:image/png;base64,") {
                t.Errorf("image src should be png data URI, got %.40q", im.Src)
        }
        // EMU/9525 → px：3048000/9525=320，1524000/9525=160
        if im.Width != 320 || im.Height != 160 {
                t.Errorf("image size = %vx%v, want 320x160", im.Width, im.Height)
        }
        if len(order) != 3 || order[0] != "前文" || order[1] != "[img]" || order[2] != "后文" {
                t.Errorf("inline order wrong: %v", order)
        }
}

// TestParseComments 验证 word/comments.xml 读入与正文 commentReference 锚点
func TestParseComments(t *testing.T) {
        docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>被批注文本</w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="a3"/></w:rPr><w:commentReference w:id="7"/></w:r>
    </w:p>
  </w:body>
</w:document>`
        commentsXML := `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="7" w:author="李四" w:date="2024-01-01T00:00:00Z">
    <w:p><w:r><w:t>请核对此处数据</w:t></w:r></w:p>
  </w:comment>
</w:comments>`
        data := buildZip(t, map[string]string{
                "word/document.xml": docXML,
                "word/comments.xml": commentsXML,
        }, nil)

        doc, warns, err := New().Parse(bytes.NewReader(data))
        if err != nil {
                t.Fatalf("Parse: %v (warns=%v)", err, warns)
        }
        if len(doc.Comments) != 1 {
                t.Fatalf("comments = %d, want 1", len(doc.Comments))
        }
        c := doc.Comments[0]
        if c.ID != "7" || c.Author != "李四" || c.Content != "请核对此处数据" {
                t.Errorf("comment parsed wrong: %+v", c)
        }
        p := doc.Blocks[0].(*core.Paragraph)
        found := false
        for _, in := range p.Inline {
                if txt, ok := in.(core.Text); ok && txt.CommentID == "7" {
                        found = true
                }
        }
        if !found {
                t.Errorf("paragraph should contain Text with CommentID=7: %+v", p.Inline)
        }
}

func blocksTypes(blocks []core.Block) []string {
        out := []string{}
        for _, b := range blocks {
                out = append(out, b.BlockType())
        }
        return out
}

func inlineTextCore(item []core.Block) string {
        var sb strings.Builder
        for _, b := range item {
                if p, ok := b.(*core.Paragraph); ok {
                        for _, in := range p.Inline {
                                if txt, ok := in.(core.Text); ok {
                                        sb.WriteString(txt.Content)
                                }
                        }
                }
        }
        return sb.String()
}
