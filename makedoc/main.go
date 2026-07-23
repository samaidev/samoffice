// 生成用于测试的最小合法 .doc（OLE2/CFB）文件。
// 仅包含必要的 FIB 头与一段 UTF-16LE 正文，供解析器验证打开。
package main

import (
	"encoding/binary"
	"os"
)

const (
	sectorSize = 512
)

// 写一个最小 CFB：DIFAT(头部) + 1 FAT 扇区 + 目录(1 扇区) + WordDocument 流(1 扇区)
// 布局：
//  sector 0: header (含 DIFAT 起始)，FAT 扇区起始=1
//  sector 1: FAT
//  sector 2: directory (含 Root Entry + WordDocument 流)
//  sector 3: WordDocument 流内容
func main() {
	out := "test_doc.doc"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}

	// 构造 WordDocument 流内容（扇区 3）
	text := "这是一个测试用的旧版 Word 文档（.doc 格式）。\rSamOffice 现在可以打开并查看它的正文文本。\r第二段落：表格与图片等复杂排版暂不支持，仅提取可读文本。"
	body := make([]byte, 0, 1024)
	// FIB: 0x00 wIdent(0xA5EC), 0x02 ... 我们只需 wIdent + fcMin(0x18) + ccpText(0x4C)
	fib := make([]byte, 0x60)
	binary.LittleEndian.PutUint16(fib[0:2], 0xA5EC) // wIdent
	// fcMin: 文本起始 = FIB 长度(0x60) 之后
	binary.LittleEndian.PutUint32(fib[0x18:0x1C], 0x60)
	// ccpText: 字符数（UTF-16，每字符2字节）
	ccp := uint32(len([]rune(text)))
	binary.LittleEndian.PutUint32(fib[0x4C:0x50], ccp)
	body = append(body, fib...)
	for _, r := range text {
		body = append(body, byte(r), byte(r>>8))
	}
	// 填充到扇区大小（至少为 9 个扇区，使其超过 mini-stream 阈值 4096，
	// 从而被 mscfb 当作普通流处理；真实 .doc 的 WordDocument 流通常远大于此）
	body = padTo(body, sectorSize*9)
	wdSector := body

	// 目录扇区：两个目录项，Root Entry(存储) + WordDocument(流)
	dir := make([]byte, sectorSize)
	// 项0: Root Entry (storage)
	wstr(dir[0:0x40], "Root Entry")
	dir[0x40] = 0x16 // NameLength (11 字符 * 2, 含终止符)
	dir[0x42] = 0x05 // STGTY_ROOT
	dir[0x43] = 0x00 // 黑色
	binary.LittleEndian.PutUint32(dir[0x44:0x48], 0xFFFFFFFF) // leftSib = NOSTREAM
	binary.LittleEndian.PutUint32(dir[0x48:0x4C], 0xFFFFFFFF) // rightSib = NOSTREAM
	binary.LittleEndian.PutUint32(dir[0x4C:0x50], 1)   // childID = 1 (WordDocument)
	binary.LittleEndian.PutUint32(dir[0x74:0x78], 0xFFFFFFFE) // startingSectorLoc = ENDOFCHAIN (无 mini-stream)
	// 项1: WordDocument (stream)
	wstr(dir[0x80:0xC0], "WordDocument")
	dir[0xC0] = 0x1A // NameLength (13 字符 * 2, 含终止符)
	dir[0xC2] = 0x02 // STGTY_STREAM
	dir[0xC3] = 0x01 // 红色
	binary.LittleEndian.PutUint32(dir[0xC4:0xC8], 0xFFFFFFFF) // leftSib = NOSTREAM
	binary.LittleEndian.PutUint32(dir[0xC8:0xCC], 0xFFFFFFFF) // rightSib = NOSTREAM
	binary.LittleEndian.PutUint32(dir[0xCC:0xD0], 0xFFFFFFFF) // childID = NOSTREAM
	binary.LittleEndian.PutUint32(dir[0xF4:0xF8], 2)                     // 起始扇区 = 2
	binary.LittleEndian.PutUint32(dir[0xF8:0xFC], uint32(len(wdSector))) // 流大小（含填充，>4096 以避免 mini-stream）

	// FAT 扇区：扇区1(目录)->ENDOFCHAIN；WordDocument 流占据扇区 2..10，链式连接
	fat := make([]byte, sectorSize)
	putFat(fat, 1, 0xFFFFFFFE) // 目录扇区 ENDOFCHAIN
	const wdStart = 2
	const wdSectors = 9
	for i := 0; i < wdSectors; i++ {
		if i == wdSectors-1 {
			putFat(fat, wdStart+uint32(i), 0xFFFFFFFE) // 末扇区 ENDOFCHAIN
		} else {
			putFat(fat, wdStart+uint32(i), wdStart+uint32(i)+1) // 链向下一扇区
		}
	}

	// 头部
	header := make([]byte, sectorSize)
	copy(header[0:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1})
	binary.LittleEndian.PutUint16(header[0x18:0x1A], 0x3E) // minor version
	binary.LittleEndian.PutUint16(header[0x1A:0x1C], 3)    // major version
	binary.LittleEndian.PutUint16(header[0x1C:0x1E], 0xFFFE)
	binary.LittleEndian.PutUint16(header[0x1E:0x20], 9)    // sector shift = 512
	binary.LittleEndian.PutUint16(header[0x20:0x22], 6)    // mini sector shift = 64
	binary.LittleEndian.PutUint32(header[0x24:0x28], 0)    // 保留
	binary.LittleEndian.PutUint32(header[0x28:0x2C], 0)    // numDirectorySectors (v3 必须为 0)
	binary.LittleEndian.PutUint32(header[0x2C:0x30], 1)    // numFatSectors = 1
	binary.LittleEndian.PutUint32(header[0x30:0x34], 1)    // directorySectorLoc = 1
	binary.LittleEndian.PutUint32(header[0x34:0x38], 0)    // transaction (保留)
	binary.LittleEndian.PutUint32(header[0x38:0x3C], 4096) // miniStreamCutoff = 4096
	binary.LittleEndian.PutUint32(header[0x3C:0x40], 0)    // miniFatSectorLoc (无)
	binary.LittleEndian.PutUint32(header[0x40:0x44], 0)    // numMiniFatSectors = 0
	// DIFAT: 第一个 FAT 扇区 = 0（紧跟头部）
	binary.LittleEndian.PutUint32(header[0x4C:0x50], 0)
	// 其余 DIFAT 入口 = FREESECT (0xFFFFFFFE)
	for i := 0x50; i < sectorSize-4; i += 4 {
		binary.LittleEndian.PutUint32(header[i:i+4], 0xFFFFFFFE) // FREESECT
	}
	// DIFAT 数组最后一项 = ENDOFCHAIN
	binary.LittleEndian.PutUint32(header[sectorSize-4:sectorSize], 0xFFFFFFFE)

	buf := make([]byte, 0, sectorSize*4)
	buf = append(buf, header...)
	buf = append(buf, fat...)
	buf = append(buf, dir...)
	buf = append(buf, wdSector...)

	if err := os.WriteFile(out, buf, 0644); err != nil {
		panic(err)
	}
}

func padTo(b []byte, n int) []byte {
	if len(b)%n == 0 {
		return b
	}
	return append(b, make([]byte, n-len(b)%n)...)
}

func putFat(fat []byte, sector uint32, val uint32) {
	binary.LittleEndian.PutUint32(fat[sector*4:sector*4+4], val)
}

func wstr(b []byte, s string) {
	for i, r := range s {
		if i*2+1 >= len(b) {
			break
		}
		b[i*2] = byte(r)
		b[i*2+1] = byte(r >> 8)
	}
}
