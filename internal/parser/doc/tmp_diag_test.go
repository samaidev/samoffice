package doc

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/richardlehane/mscfb"
)

func openDoc4(t *testing.T, path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("mscfb: %v", err)
	}
	var wordDoc []byte
	for entry, e2 := cfb.Next(); e2 == nil; entry, e2 = cfb.Next() {
		if strings.EqualFold(entry.Name, "worddocument") {
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				wordDoc = buf
			}
		}
	}
	return wordDoc
}

func TestDiagFtnBrute(t *testing.T) {
	wordDoc := openDoc4(t, `D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`)
	ccpFtn := 58
	best := ""
	bestScore := 0
	bestOff := 0
	for off := 0x3000; off+ccpFtn*2 <= len(wordDoc); off += 2 {
		u := make([]uint16, ccpFtn)
		okAll := true
		for i := 0; i < ccpFtn; i++ {
			v := binary.LittleEndian.Uint16(wordDoc[off+i*2:])
			// 允许中文与常见标点，跳过明显控制符
			if v == 0 {
				okAll = false
				break
			}
			u[i] = v
		}
		if !okAll {
			continue
		}
		s := string(utf16.Decode(u))
		score := 0
		for _, r := range s {
			if r >= '一' && r <= '鿿' {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			best = s
			bestOff = off
		}
	}
	t.Logf("bestOff=0x%X score=%d ftn=%q", bestOff, bestScore, best)

	// 同时尝试：脚注可能在某 OLE 子存储（如 Footnote 存储）。列出所有流名与大小。
	data, _ := os.ReadFile(`D:\个人\文章投稿\中国区域碳排放影响因素研究20160818.doc`)
	cfb, _ := mscfb.New(bytes.NewReader(data))
	var names []string
	for entry, e2 := cfb.Next(); e2 == nil; entry, e2 = cfb.Next() {
		names = append(names, entry.Name)
	}
	t.Logf("STREAMS=%v", names)
}
