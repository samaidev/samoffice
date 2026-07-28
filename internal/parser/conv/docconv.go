// Package conv 提供旧版 .doc 二进制文档到 .docx 的转换封装。
//
// 由于 .doc 是二进制排版格式，其页码（PAGE 域）、列宽、单元格合并、嵌套表等
// 只有在「渲染布局」时才能被可靠还原；纯流式解析无法做到。本包借助本机安装的
// LibreOffice（headless）将 .doc 渲染为 .docx，从而复用已验证可用的 .docx 解析器
// （表格/列宽/合并/页码全支持）。
//
// 若本机未安装 LibreOffice，ConvertDocToDocx 返回 ok=false，调用方应回退到内置的
// 简易 .doc 解析逻辑。
package conv

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

var (
	sofficeOnce  sync.Once
	sofficePath  string
	sofficeFound bool
	// convMu 防止多个 soffice 实例同时运行导致用户配置锁冲突。
	convMu sync.Mutex
)

// findSoffice 探测 LibreOffice 可执行文件，结果缓存。
func findSoffice() (string, bool) {
	sofficeOnce.Do(func() {
		candidates := []string{
			`C:\Program Files\LibreOffice\program\soffice.exe`,
			`C:\Progra~1\LibreOffice\program\soffice.exe`,
			`C:\Program Files (x86)\LibreOffice\program\soffice.exe`,
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				sofficePath = c
				sofficeFound = true
				return
			}
		}
		if p, err := exec.LookPath("soffice"); err == nil {
			sofficePath = p
			sofficeFound = true
		}
	})
	return sofficePath, sofficeFound
}

// ConvertDocToDocx 将旧版 .doc 字节转换为 .docx 字节。
// 返回 (docxBytes, ok, error)。ok=false 表示本机无 LibreOffice 或转换失败，
// 调用方应回退到内置 .doc 解析。
func ConvertDocToDocx(srcName string, data []byte) ([]byte, bool, error) {
	bin, ok := findSoffice()
	if !ok {
		return nil, false, fmt.Errorf("libreoffice (soffice) not found")
	}

	convMu.Lock()
	defer convMu.Unlock()

	tmpDir, err := os.MkdirTemp("", "samoffice-docconv-")
	if err != nil {
		return nil, false, err
	}
	defer os.RemoveAll(tmpDir)

	inPath := filepath.Join(tmpDir, "input.doc")
	if err := os.WriteFile(inPath, data, 0644); err != nil {
		return nil, false, err
	}

	// 使用独立的用户配置目录，避免与已运行的 LibreOffice 实例争用配置锁。
	userProfile := "file:///" + filepath.ToSlash(filepath.Join(tmpDir, "lo_profile"))
	outDir := tmpDir
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"-env:UserInstallation="+userProfile,
		"--headless",
		"--convert-to", "docx",
		"--outdir", outDir,
		inPath,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, false, fmt.Errorf("soffice convert failed: %v: %s", err, stderr.String())
	}

	outPath := filepath.Join(outDir, "input.docx")
	outData, err := os.ReadFile(outPath)
	if err != nil {
		return nil, false, fmt.Errorf("read converted docx: %v", err)
	}
	if len(outData) == 0 {
		return nil, false, fmt.Errorf("converted docx is empty")
	}
	return outData, true, nil
}
