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

// 解码一段 grpprl，提取段落对齐(0=左,1=中,2=右,3=两端,4=分散)与字号(half-pt)。
// grp 结构：[istd:2][grpprl...]
func decodePAPX(grp []byte) (jc, hps, istd int, ok bool) {
	if len(grp) < 2 {
		return 0, 0, 0, false
	}
	istd = int(binary.LittleEndian.Uint16(grp[0:2]))
	p := 2
	got := false
	for p+1 < len(grp) {
		op := uint16(grp[p]) | uint16(grp[p+1])<<8
		size, special := sprmOpSize(op)
		if special || size < 0 {
			break
		}
		if p+2+size > len(grp) {
			break
		}
		switch op {
		case 0x2461, 0x2403: // PJc
			jc = int(grp[p+2])
			got = true
		case 0x4A43, 0x4A41: // PHps
			hps = int(binary.LittleEndian.Uint16(grp[p+2 : p+4]))
			got = true
		}
		p += 2 + size
	}
	return jc, hps, istd, got
}

func sprmOpSize(op uint16) (size int, special bool) {
	switch op {
	case 0x2461, 0x2403, 0x2462, 0x2404, 0x2464, 0x2406, 0x2465, 0x2407,
		0x246A, 0x240C, 0x246B, 0x240D, 0x2470, 0x2410, 0x2472, 0x2477,
		0x2479, 0x247D, 0x247E, 0x260A, 0x2610, 0x2400,
		0x2A3E, 0x2800, 0x2A41, 0x2803, 0x2A4F, 0x2811, 0x2A50, 0x2812:
		return 1, false
	case 0x4A43, 0x4A41, 0x2467, 0x2409, 0x2469, 0x240B, 0x246D, 0x2475,
		0x2476, 0x2A42, 0x2804, 0x2A45, 0x2807, 0x2A48, 0x280A,
		0x2A4A, 0x280C, 0x2A4B, 0x200D, 0x2A4C, 0x280E, 0x2A4D, 0x280F,
		0x2471, 0x2411:
		return 2, false
	case 0x2A40, 0x2802, 0x2A44, 0x2806, 0x2A4E, 0x2810:
		return 4, false
	case 0x2474, 0x247B, 0x247C, 0x2480:
		return -1, true
	}
	t := (op >> 10) & 0x7
	switch t {
	case 0, 4:
		return 1, false
	case 1, 2:
		return 2, false
	case 3, 5:
		return -1, true
	case 6:
		return 4, false
	case 7:
		return 0, false
	}
	return -1, false
}

func main() {
	path := "real.doc"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("read err:", err)
		return
	}
	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		fmt.Println("cfb err:", err)
		return
	}
	var wd, tbl []byte
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
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
	fmt.Printf("wd=%d tbl=%d\n", len(wd), len(tbl))
	if len(wd) < 0x22 {
		return
	}
	nFib := binary.LittleEndian.Uint16(wd[2:4])
	fmt.Printf("nFib=0x%X\n", nFib)

	// FIB fc/lcb 数组
	cswOff := 0x20
	csw := int(binary.LittleEndian.Uint16(wd[cswOff : cswOff+2]))
	cslwOff := cswOff + 2 + 2*csw
	cslw := int(binary.LittleEndian.Uint16(wd[cslwOff : cslwOff+2]))
	cbOff := cslwOff + 2 + 4*cslw
	cb := int(binary.LittleEndian.Uint16(wd[cbOff : cbOff+2]))
	arrStart := cbOff + 2
	fmt.Printf("csw=%d cslw=%d cb=%d arrStart=0x%X\n", csw, cslw, cb, arrStart)

	type pair struct{ fc, lcb int }
	pairs := []pair{}
	for i := 0; i < cb; i++ {
		base := arrStart + i*8
		if base+8 > len(wd) {
			break
		}
		fc := int(int32(binary.LittleEndian.Uint32(wd[base : base+4])))
		lcb := int(binary.LittleEndian.Uint32(wd[base+4 : base+8]))
		pairs = append(pairs, pair{fc, lcb})
	}

	// 扫描所有 fc/lcb 条目，把每个当成 PLCF-BTE 测试，挑出能解出真实段落对齐的
	type cand struct {
		idx                                        int
		jcList, hpsList, istdList                  []int
		nilCount, pagesUsed, totalParas            int
	}
	var cands []cand
	for idx, pr := range pairs {
		if pr.lcb < 12 || pr.fc < 0 || pr.fc+pr.lcb > len(tbl) {
			continue
		}
		plc := tbl[pr.fc : pr.fc+pr.lcb]
		n := binary.LittleEndian.Uint32(plc[0:4])
		if n == 0 || n > 20000 {
			continue
		}
		if int(4+4*(n+1)+n) != pr.lcb {
			continue
		}
		cpEnd := 4 + 4*(int(n)+1)
		if cpEnd+int(n) > len(plc) {
			continue
		}
		// CP 递增
		prev := uint32(0)
		ok := true
		for j := 0; j <= int(n); j++ {
			cp := binary.LittleEndian.Uint32(plc[4+4*j : 4+4*j+4])
			if cp <= prev {
				ok = false
				break
			}
			prev = cp
		}
		if !ok {
			continue
		}
		btes := plc[cpEnd : cpEnd+int(n)]
		jcList := []int{}
		hpsList := []int{}
		istdList := []int{}
		nilCount := 0
		pagesUsed := 0
		for k := 0; k < len(btes); k++ {
			bte := int(btes[k])
			pageOff := bte * 512
			if pageOff+512 > len(wd) {
				continue
			}
			page := wd[pageOff : pageOff+512]
			cpara := int(page[0])
			if cpara <= 0 || cpara > 0x200 {
				continue
			}
			rgfcEnd := 1 + 4*(cpara+1)
			if rgfcEnd > 512 {
				continue
			}
			rgbEnd := rgfcEnd + cpara
			if rgbEnd > 512 {
				continue
			}
			pagesUsed++
			for i := 0; i < cpara; i++ {
				po := int(page[rgfcEnd+i])
				if po+2 > 512 {
					continue
				}
				cb := int(binary.LittleEndian.Uint16(page[po : po+2]))
				if cb == 0 {
					jcList = append(jcList, -1)
					hpsList = append(hpsList, -1)
					istdList = append(istdList, -1)
					nilCount++
					continue
				}
				end := po + 2 + cb
				if end > 512 {
					continue
				}
				jc, hps, istd, ok := decodePAPX(page[po+2 : end])
				if !ok {
					jcList = append(jcList, -1)
					hpsList = append(hpsList, -1)
					istdList = append(istdList, istd)
					continue
				}
				jcList = append(jcList, jc)
				hpsList = append(hpsList, hps)
				istdList = append(istdList, istd)
			}
		}
		if len(jcList) == 0 {
			continue
		}
		cands = append(cands, cand{idx, jcList, hpsList, istdList, nilCount, pagesUsed, len(jcList)})
	}
	fmt.Printf("PLCF-BTE candidates: %d\n", len(cands))
	for _, c := range cands {
		jcDist := map[int]int{}
		for _, v := range c.jcList {
			jcDist[v]++
		}
		hpsDist := map[int]int{}
		for _, v := range c.hpsList {
			if v > 0 {
				hpsDist[v]++
			}
		}
		fmt.Printf("  pair#%d paras=%d pages=%d nil=%d jc=%v hps=%v\n",
			c.idx, c.totalParas, c.pagesUsed, c.nilCount, jcDist, hpsDist)
	}
	// 选 jc 分布里含居中(1)或右(2)的候选（真实段落属性）
	var best *cand
	for i := range cands {
		d := map[int]int{}
		for _, v := range cands[i].jcList {
			d[v]++
		}
		if (d[1] > 0 || d[2] > 0) && (best == nil || cands[i].totalParas > best.totalParas) {
			best = &cands[i]
		}
	}
	if best == nil && len(cands) > 0 {
		best = &cands[0]
	}
	if best == nil {
		fmt.Println("no usable PLCF-BTE found")
	}
	// 手工核对：PJc(0x2461) 出现位置附近的 512 对齐页
	for _, off := range []int{0x5400, 0x2800} {
		if off+512 <= len(wd) {
			fmt.Printf("\n=== wd page@0x%X (contains a PJc) ===\n", off)
			pg := wd[off : off+512]
			fmt.Printf("  byte0(cpara?)=%d (0x%X)\n", pg[0], pg[0])
			fmt.Printf("  first 64 bytes: % X\n", pg[:64])
		}
	}
}

func firstN(a []int, n int) []int {
	if len(a) > n {
		return a[:n]
	}
	return a
}
