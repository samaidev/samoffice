// Package antiword 提供基于开源 antiword 工具的 .doc 文本提取。
//
// antiword (https://antiword.sourceforge.io) 是一个轻量级开源 C 工具，
// 专门解析旧版 Word (.doc) 二进制文档。本包将其打包为 SamOffice 的原生
// .doc 解析器，实现 "不依赖 LibreOffice、使用开源代码解析"。
//
// 部署要求：将 antiword.exe 及其数据文件置于 SamOffice 可执行文件同目录下：
//
//	samoffice.exe
//	antiword.exe
//	antiword_data/
//	  .antiword/
//	    UTF-8.txt
//	    8859-1.txt
//
// 若运行时检测不到 antiword 二进制，CanParse 返回 false，调用方降级。
//
// 已知限制：
//   - 仅输出纯文本，无段落对齐/缩进/页码/脚注结构信息
//   - 中文路径需使用 ASCII 临时文件名（antiword 0.37 不支持 Unicode 文件名）
//   - 作为文本提取器，不执行文档布局
package antiword

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zai/samoffice/internal/core"
)

// 缓存 antiword 可执行文件及数据目录路径。
var (
	findOnce    sync.Once
	awExePath   string
	awDataDir   string
	awAvailable bool
)

// findAntiword 查找 antiword 可执行文件及数据目录。搜索顺序：
//  1. 可执行文件同目录（含 antiword_data/）
//  2. 当前工作目录及父目录链（向上搜索直至根目录）
//  3. PATH
func findAntiword() (exe string, dataDir string, ok bool) {
	findOnce.Do(func() {
		seen := map[string]bool{}
		addDir := func(dir string) {
			if dir == "" || seen[dir] {
				return
			}
			seen[dir] = true
			cand := filepath.Join(dir, "antiword.exe")
			if _, err := os.Stat(cand); err != nil {
				return
			}
			awExePath = cand
			// 检查同级的 antiword_data/.antiword/（映射文件）
			dataCand := filepath.Join(dir, "antiword_data", ".antiword")
			if fi, err := os.Stat(dataCand); err == nil && fi.IsDir() {
				awDataDir = dataCand
			}
			awAvailable = true
		}

		// 候选 1：可执行文件所在目录
		if p, err := os.Executable(); err == nil {
			addDir(filepath.Dir(p))
			if awAvailable {
				return
			}
		}

		// 候选 2：当前工作目录及父目录链（向上搜索到根目录）
		if wd, err := os.Getwd(); err == nil {
			dir := filepath.Clean(wd)
			for {
				addDir(dir)
				if awAvailable {
					return
				}
				parent := filepath.Dir(dir)
				if parent == dir {
					break
				}
				dir = parent
			}
		}

		// 候选 3：PATH（此时无法确定 data 目录，仅用 exe 路径）
		if p, err := exec.LookPath("antiword"); err == nil {
			awExePath = p
			awAvailable = true
			return
		}
	})
	return awExePath, awDataDir, awAvailable
}

// Parser 实现 core.Parser 接口，使用 antiword 命令行工具解析 .doc 文件。
type Parser struct{}

// Supported 返回支持的扩展名列表。
func (p *Parser) Supported() []string {
	return []string{".doc"}
}

// CanParse 检查是否可以处理给定文件。
// 条件：扩展名为 .doc 且 antiword 可执行文件可用。
func (p *Parser) CanParse(path string, header []byte) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".doc" {
		return false
	}
	_, _, ok := findAntiword()
	return ok
}

// Parse 使用 antiword 解析 .doc 二进制文档。
// 返回 core.Document，仅包含纯文本段落（无排版/脚注/页码信息）。
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	bin, dataDir, ok := findAntiword()
	if !ok {
		return nil, nil, fmt.Errorf("antiword: executable not found")
	}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, nil, fmt.Errorf("antiword: read input: %v", err)
	}
	if len(data) == 0 {
		return nil, nil, fmt.Errorf("antiword: empty input")
	}

	// 写入临时文件（antiword 只支持文件输入，且不支持中文路径名）
	tmpFile, err := os.CreateTemp("", "samoffice-antiword-*.doc")
	if err != nil {
		return nil, nil, fmt.Errorf("antiword: create temp: %v", err)
	}
	tmpPath := tmpFile.Name()
	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return nil, nil, fmt.Errorf("antiword: write temp: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpPath)

		// 确保 mapping 文件在 antiword 能访问的路径下
	if dataDir != "" {
		if err := installMappings(dataDir); err != nil {
			return nil, []core.Warning{{
				Level: "warn", Stage: "parse",
				Message: fmt.Sprintf("antiword: install mappings: %v", err),
			}}, nil
		}
	}

	// 调用 antiword 输出 UTF-8 文本
	args := []string{tmpPath}
	if dataDir != "" {
		args = append([]string{"-m", "UTF-8.txt"}, args...)
	}
	cmd := exec.Command(bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// antiword 对部分格式或编码会返回非零
		return nil, []core.Warning{{
			Level:   "warn",
			Stage:   "parse",
			Message: fmt.Sprintf("antiword exit error: %v; stderr: %s", err, strings.TrimSpace(stderr.String())),
		}}, nil
	}

	// 解析 antiword 输出为 core.Document
	doc := &core.Document{
		Blocks: parseTextOutput(stdout.String()),
	}

	if stderr.Len() > 0 {
		doc.Warnings = append(doc.Warnings, core.Warning{
			Level:   "info",
			Stage:   "parse",
			Message: fmt.Sprintf("antiword stderr: %s", strings.TrimSpace(stderr.String())),
		})
	}

	return doc, nil, nil
}

// parseTextOutput 将 antiword 的文本输出解析为段落 Block 列表。
//
// antiword 输出格式：
//   - 段落之间以空行（连续两个换行）分隔
//   - 页眉/页脚/脚注在输出中以标记行形式出现（如 "[footnote 1]"）
//   - 表格单元格以制表符分隔行呈现
func parseTextOutput(text string) []core.Block {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	lines := strings.Split(text, "\n")
	var blocks []core.Block
	var buf strings.Builder

	flushPara := func() {
		content := strings.TrimSpace(buf.String())
		if content == "" {
			buf.Reset()
			return
		}
		blocks = append(blocks, &core.Paragraph{
			Inline: []core.Inline{core.Text{Content: content}},
		})
		buf.Reset()
	}

	for i, line := range lines {
		line = strings.TrimRight(line, "\r")
		trimmed := strings.TrimSpace(line)

		// 空行 = 段落分隔符
		if trimmed == "" {
			flushPara()
			continue
		}

		// 忽略分页符 / 分隔线（非正文内容）—— 先 flush 当前段落再跳过
		if strings.HasPrefix(line, "\f") || strings.HasPrefix(trimmed, "----") {
			flushPara()
			continue
		}
		if trimmed == "-" || trimmed == "=" {
			flushPara()
			continue
		}

		// 累积到当前段落缓冲
		if buf.Len() > 0 {
			buf.WriteByte(' ')
		}
		buf.WriteString(trimmed)

		// 最后一行 flush
		if i == len(lines)-1 {
			flushPara()
		}
	}

	flushPara()
	return blocks
}

// Reset 清除 antiword 路径缓存（主要用于测试）。
func Reset() {
	findOnce = sync.Once{}
	awExePath = ""
	awDataDir = ""
	awAvailable = false
}

// installMappings 将 mapping 文件复制到 antiword 能访问的路径下。
// antiword (MinGW/MSYS 编译) 硬编码在 /usr/share/antiword/ 查找 mapping 文件，
// Windows 上对应 C:\usr\share\antiword\。
func installMappings(srcDir string) error {
	awDir := `C:\usr\share\antiword`
	if err := os.MkdirAll(awDir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %v", awDir, err)
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return fmt.Errorf("read mappings %s: %v", srcDir, err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
			continue
		}
		src := filepath.Join(srcDir, e.Name())
		dst := filepath.Join(awDir, e.Name())
		// 目标已存在则跳过（避免重复写）
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			return fmt.Errorf("read %s: %v", src, err)
		}
		if err := os.WriteFile(dst, data, 0644); err != nil {
			return fmt.Errorf("write %s: %v", dst, err)
		}
	}
	return nil
}
