package doc

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/core"
)

func TestDecodeANSIGBK(t *testing.T) {
	// "中文" 的 GBK 编码：D6 D0 CE C4
	raw := []byte{0xD6, 0xD0, 0xCE, 0xC4}
	got := decodeANSI(raw, 936)
	if got != "中文" {
		t.Fatalf("GBK decode = %q, want %q", got, "中文")
	}
	// 默认（未知代码页）也应回退到 GBK
	if got2 := decodeANSI(raw, 0); got2 != "中文" {
		t.Fatalf("default-codepage GBK decode = %q, want %q", got2, "中文")
	}
}

// TestPieceTableGBK 构造一个仅含单个压缩(GBK)片的合成 Piece Table，
// 验证 extractTextPieceTable 能正确按代码页解码双字节中文（不依赖真实 .doc）。
func TestPieceTableGBK(t *testing.T) {
	// WordDocument 流：FIB 头部 + 文本字节
	wordDoc := make([]byte, 0x400)
	ccpText := uint32(2) // "中文" = 2 个字符
	binary.LittleEndian.PutUint32(wordDoc[0x4C:0x50], ccpText)
	binary.LittleEndian.PutUint32(wordDoc[0x18:0x1C], 0) // fcMin（本测试未用）
	// 文本字节放在偏移 0 处：GBK "中文"
	copy(wordDoc[0:4], []byte{0xD6, 0xD0, 0xCE, 0xC4})

	// 构造 CLX（在 Table 流偏移 0）：clxtPcd(0x01) + lcb(4) + PlcPcd
	// PlcPcd：n=1，aCp=[0,2]（8 字节），1 个 Pcd（8 字节，fCompressed=1, fc=0）
	aCp := make([]byte, 8)
	binary.LittleEndian.PutUint32(aCp[0:4], 0)
	binary.LittleEndian.PutUint32(aCp[4:8], 2)
	pcd := make([]byte, 8)
	// fcc = 0x40000000（bit30=fCompressed, fc=0）→ 位于 Pcd 偏移 2 起的 4 字节
	binary.LittleEndian.PutUint32(pcd[2:6], 0x40000000)
	plcPcd := append(aCp, pcd...)
	lcb := uint32(len(plcPcd))
	table := []byte{0x01}
	tmp := make([]byte, 4)
	binary.LittleEndian.PutUint32(tmp, lcb)
	table = append(table, tmp...)
	table = append(table, plcPcd...)

	// 在 FIB 中写入 fcClx/lcbClx（0x2AA / 0x2AE）
	binary.LittleEndian.PutUint32(wordDoc[0x2AA:0x2AE], 0)
	binary.LittleEndian.PutUint32(wordDoc[0x2AE:0x2B2], uint32(len(table)))

	got := extractTextPieceTable(wordDoc, table, ccpText)
	if got != "中文" {
		t.Fatalf("piece-table GBK decode = %q, want %q", got, "中文")
	}
}

func TestParseTestDocNoGarble(t *testing.T) {
	data, err := os.ReadFile("../../../test_doc.doc")
	if err != nil {
		t.Skipf("test file missing: %v", err)
	}
	p := New()
	doc, warns, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("parse error: %v (warns=%v)", err, warns)
	}
	var txt strings.Builder
	for _, b := range doc.Blocks {
		if para, ok := b.(*core.Paragraph); ok {
			for _, in := range para.Inline {
				if tx, ok := in.(core.Text); ok {
					txt.WriteString(tx.Content)
					txt.WriteString("\n")
				}
			}
		}
	}
	if strings.Contains(txt.String(), "\uFFFD") {
		t.Fatalf("output contains replacement char (garbled): %q", txt.String()[:min(200, txt.Len())])
	}
	if !strings.Contains(txt.String(), "SamOffice") {
		t.Fatalf("expected 'SamOffice' in parsed text, got: %q", txt.String()[:min(300, txt.Len())])
	}
}

func readStream(t *testing.T, data []byte, name string) []byte {
	t.Helper()
	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("open cfb: %v", err)
	}
	var out []byte
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		if strings.EqualFold(entry.Name, name) {
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				out = buf
			}
		}
	}
	return out
}

// TestPieceTableOffsetValid 验证真实 .doc 是否含 Table 流；若样本本身不含
// Table 流（极简测试文档常见），则跳过——Piece Table 逻辑已由 TestPieceTableGBK 覆盖。
func TestPieceTableOffsetValid(t *testing.T) {
	data, err := os.ReadFile("../../../test_doc.doc")
	if err != nil {
		t.Skipf("test file missing: %v", err)
	}
	wordDoc := readStream(t, data, "worddocument")
	if len(wordDoc) == 0 {
		t.Fatal("no WordDocument stream")
	}
	table := readStream(t, data, "1table")
	if len(table) == 0 {
		table = readStream(t, data, "0table")
	}
	if len(table) == 0 {
		t.Skipf("sample has no Table stream (uses fallback path); skipping CLX offset check")
	}
	ccpText := binary.LittleEndian.Uint32(wordDoc[0x4C:0x50])
	txt := extractTextPieceTable(wordDoc, table, ccpText)
	if txt == "" {
		t.Fatalf("extractTextPieceTable returned empty — fcClx offset likely wrong (ccpText=%d, tableLen=%d)", ccpText, len(table))
	}
	t.Logf("piece-table text length = %d, sample = %q", len(txt), txt[:min(120, len(txt))])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
