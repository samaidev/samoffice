package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/richardlehane/mscfb"
)

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	path := "test_doc.doc"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("read err:", err)
		return
	}
	fmt.Printf("file size=%d head=% X\n", len(data), data[:min(16, len(data))])
	isOLE := len(data) >= 8 && bytes.Equal(data[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1})
	fmt.Printf("isOLE=%v\n", isOLE)

	// 原始扇区 dump：扇区0=头，扇区1~3 可能含 WordDocument 流起始（FIB）
	secSize := 512
	for s := 0; s <= 3 && s*secSize+32 <= len(data); s++ {
		start := s * secSize
		fmt.Printf("sector%d (off=%d): % X\n", s, start, data[start:start+32])
	}
	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		fmt.Println("ole err:", err)
		return
	}
	var wd, tbl []byte
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		fmt.Printf("  stream: %q size=%d\n", entry.Name, entry.Size)
		switch strings.ToLower(entry.Name) {
		case "worddocument":
			b := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(b, 0); rerr == nil || rerr == io.EOF {
				wd = b
			}
		case "1table", "0table":
			b := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(b, 0); rerr == nil || rerr == io.EOF {
				if len(tbl) == 0 || strings.EqualFold(entry.Name, "1table") {
					tbl = b
				}
			}
		}
	}
	nFib := binary.LittleEndian.Uint16(wd[2:4])
	fmt.Printf("nFib=0x%04X wdLen=%d tblLen=%d\n", nFib, len(wd), len(tbl))

	// 不依赖 FKP 索引：直接扫描 WordDocument 流中 PJc sprm(0x2461/0x2403) 的出现顺序，
	// 与 CHps sprm(0x4A43/0x4A41) 的出现顺序，作为段落/字符属性的"有序列表"。
	var jcSeq []int
	for i := 0; i+3 < len(wd); i++ {
		op := uint16(wd[i]) | uint16(wd[i+1])<<8
		if op == 0x2461 || op == 0x2403 {
			jcSeq = append(jcSeq, int(wd[i+2]))
			i += 2
		}
	}
	var hpsSeq []int
	for i := 0; i+4 < len(wd); i++ {
		op := uint16(wd[i]) | uint16(wd[i+1])<<8
		if op == 0x4A43 || op == 0x4A41 {
			hpsSeq = append(hpsSeq, int(binary.LittleEndian.Uint16(wd[i+2:i+4])))
			i += 3
		}
	}
	fmt.Printf("\nscan: PJc(0x2461/0x2403) occurrences=%d, CHps(0x4A43/0x4A41) occurrences=%d\n", len(jcSeq), len(hpsSeq))
	jcCount := map[int]int{}
	for _, v := range jcSeq {
		jcCount[v]++
	}
	fmt.Printf("  jc value distribution (0=L,1=C,2=R): %v\n", jcCount)
	fmt.Printf("  first 20 jc: %v\n", firstN(jcSeq, 20))
	hpsCount := map[int]int{}
	for _, v := range hpsSeq {
		hpsCount[v]++
	}
	fmt.Printf("  hps (half-pt) distribution: %v\n", hpsCount)

	// 在 1Table 流里按精确 PLCF-BTE 长度签名定位 PlcfbtePapx/Chpx
	matches := findAllPlcfBte(tbl)
	fmt.Printf("PlcfBte candidates (exact signature): %d\n", len(matches))
	for mi, m := range matches {
		fmt.Printf("\n[PlcfBte #%d] at off=0x%X segments=%d firstBTE=%d\n", mi, m.off, len(m.btes), m.btes[0])
		jcList := []int{}
		hpsList := []int{}
		for seg := 0; seg < len(m.btes); seg++ {
			pageOff := int(m.btes[seg]) * 512
			if pageOff+512 > len(wd) {
				continue
			}
			grps, ok := tryPapxFKP(wd, pageOff)
			if !ok {
				continue
			}
			for _, g := range grps {
				jcList = append(jcList, findJc(g))
				hpsList = append(hpsList, findHps(g))
			}
		}
		jcDist := map[int]int{}
		for _, v := range jcList {
			jcDist[v]++
		}
		hpsDist := map[int]int{}
		for _, v := range hpsList {
			hpsDist[v]++
		}
		fmt.Printf("  decoded runs=%d jc dist(0=L,1=C,2=R,-1=none): %v\n", len(jcList), jcDist)
		fmt.Printf("  hps dist(half-pt,-1=none): %v\n", hpsDist)
		fmt.Printf("  first jc: %v\n", firstN(jcList, 14))
		// dump 第一个 FKP 页原始字节（若未解出 sprm，便于手动核对布局）
		if len(jcList) == 0 && len(hpsList) == 0 && mi < 3 {
			po := int(m.btes[0]) * 512
			if po+512 <= len(wd) {
				fmt.Printf("  raw FKP page@0x%X: % X\n", po, wd[po:po+512])
			}
		}
	}

	// 同时扫描 CHPX（看字号 sprm 0x4A43 / 0x4A41 是否在）
	hpsDist := map[int]int{}
	chpxPages := 0
	for off := 0; off+512 <= len(wd); off += 512 {
		hps, ok := tryChpxFKP(wd, off)
		if !ok {
			continue
		}
		chpxPages++
		for _, v := range hps {
			hpsDist[v]++
		}
	}
	fmt.Printf("CHPX FKP pages found: %d\n", chpxPages)
	fmt.Printf("hps (half-points) distribution: %v\n", hpsDist)
}

// plcMatch 保存一个 PLCF-BTE 的位置与 BTE 数组
type plcMatch struct {
	off  int
	btes []byte
}

// findAllPlcfBte 在 tbl 中按精确 PLCF-BTE 长度签名定位候选。
// PLCF-BTE 结构：4 字节 n，随后 (n+1) 个递增 4 字节 CP，随后 n 个 1 字节 BTE。
// 精确长度：4 + 4*(n+1) + n 必须等于从 s 开始的连续区域长度（用后续 BTE 区域边界判定）。
func findAllPlcfBte(tbl []byte) []plcMatch {
	var out []plcMatch
	for s := 0; s+8 <= len(tbl); s++ {
		n := binary.LittleEndian.Uint32(tbl[s : s+4])
		if n == 0 || n > 4000 {
			continue
		}
		cpEnd := s + 4 + 4*(int(n)+1)
		if cpEnd+int(n) > len(tbl) {
			continue
		}
		// CP 严格递增且合理
		prev := uint32(0)
		ok := true
		for i := 0; i <= int(n); i++ {
			cp := binary.LittleEndian.Uint32(tbl[s+4+4*i : s+4+4*i+4])
			if cp <= prev || cp > 500000 {
				ok = false
				break
			}
			prev = cp
		}
		if !ok {
			continue
		}
		btes := make([]byte, n)
		for i := 0; i < int(n); i++ {
			btes[i] = tbl[cpEnd+i]
		}
		out = append(out, plcMatch{off: s, btes: btes})
	}
	return out
}

func firstN(a []int, n int) []int {
	if len(a) > n {
		return a[:n]
	}
	return a
}

// tryPapxFKP 尝试把 off 处的 512 字节解码为 PAPX FKP 页，返回各段落的 grpprl。
// 仅做结构校验（不要求含 jc sprm），以便观察真实 sprm 编码。
func tryPapxFKP(wd []byte, off int) ([][]byte, bool) {
	cpara := int(wd[off])
	if cpara == 0 || cpara > 0x100 {
		return nil, false
	}
	rgfcEnd := 1 + 4*(cpara+1)
	rgbEnd := rgfcEnd + cpara
	if rgbEnd > 512 {
		return nil, false
	}
	// rgfc 必须递增
	prev := uint32(0)
	for i := 0; i <= cpara; i++ {
		fc := binary.LittleEndian.Uint32(wd[off+1+4*i : off+1+4*i+4])
		if fc < prev {
			return nil, false
		}
		prev = fc
	}
	var grps [][]byte
	for i := 0; i < cpara; i++ {
		po := int(wd[off+rgfcEnd+i])
		if po+2 > 512 {
			return nil, false
		}
		cb := int(binary.LittleEndian.Uint16(wd[off+po : off+po+2]))
		if cb <= 0 || po+2+cb > 512 {
			return nil, false
		}
		grp := wd[off+po+2 : off+po+2+cb]
		grps = append(grps, grp)
	}
	if len(grps) == 0 {
		return nil, false
	}
	return grps, true
}

// findJc 在 grpprl 中查找 jc sprm。返回对齐值，找不到返回 -1。
// 支持 WW8(0x2461) 与 Word6(0x2403)，sprm 以小端存储，操作数 1 字节。
func findJc(grp []byte) int {
	for k := 0; k+2 < len(grp); k++ {
		// 小端: 低字节在前
		op := uint16(grp[k]) | uint16(grp[k+1])<<8
		var isJc bool
		switch op {
		case 0x2461, 0x2403:
			isJc = true
		}
		if isJc {
			return int(grp[k+2])
		}
	}
	return -1
}

// tryChpxFKP 尝试把 off 处解码为 CHPX FKP 页，提取每个 run 的 hps（半磅）。
func tryChpxFKP(wd []byte, off int) ([]int, bool) {
	crun := int(wd[off])
	if crun == 0 || crun > 0x200 {
		return nil, false
	}
	rgfcEnd := 1 + 4*(crun+1)
	rgbEnd := rgfcEnd + crun
	if rgbEnd > 512 {
		return nil, false
	}
	prev := uint32(0)
	for i := 0; i <= crun; i++ {
		fc := binary.LittleEndian.Uint32(wd[off+1+4*i : off+1+4*i+4])
		if fc < prev {
			return nil, false
		}
		prev = fc
	}
	var hpss []int
	for i := 0; i < crun; i++ {
		po := int(wd[off+rgfcEnd+i])
		if po+1 > 512 {
			return nil, false
		}
		cb := int(wd[off+po])
		if cb <= 0 || po+1+cb > 512 {
			return nil, false
		}
		grp := wd[off+po+1 : off+po+1+cb]
		hps := findHps(grp)
		if hps < 0 {
			return nil, false
		}
		hpss = append(hpss, hps)
	}
	if len(hpss) == 0 {
		return nil, false
	}
	return hpss, true
}

// findHps 在 grpprl 查找字号 sprm（CHps）。WW8=0x4A43，Word6=0x4A41，操作数 2 字节（半磅）。
func findHps(grp []byte) int {
	for k := 0; k+3 < len(grp); k++ {
		op := uint16(grp[k]) | uint16(grp[k+1])<<8
		if op == 0x4A43 || op == 0x4A41 {
			return int(binary.LittleEndian.Uint16(grp[k+2 : k+4]))
		}
	}
	return -1
}
