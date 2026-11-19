// parsehang 诊断工具：解析指定文件并在超时后转储全部 goroutine 栈，用于定位解析挂死。
// 用法: go run ./cmd/parsehang <file> [超时秒]
package main

import (
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/zai/samoffice/internal/parser"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: parsehang <file> [timeout-seconds]")
		os.Exit(2)
	}
	path := os.Args[1]
	timeout := 30 * time.Second
	if len(os.Args) > 2 {
		var n int
		if _, err := fmt.Sscan(os.Args[2], &n); err == nil && n > 0 {
			timeout = time.Duration(n) * time.Second
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(2)
	}
	fmt.Printf("file %s (%d bytes)\n", path, len(data))

	done := make(chan struct{})
	go func() {
		defer close(done)
		reg := parser.NewRegistry()
		start := time.Now()
		doc, warns, perr := reg.ParseBytes(path, data)
		fmt.Printf("PARSE DONE in %v\n", time.Since(start))
		fmt.Printf("warnings=%d err=%v\n", len(warns), perr)
		if doc != nil {
			fmt.Printf("doc non-nil, blocks=%d\n", len(doc.Blocks))
		}
	}()

	select {
	case <-done:
		fmt.Println("OK: parse returned")
	case <-time.After(timeout):
		fmt.Printf("TIMEOUT after %v — goroutine dump:\n", timeout)
		buf := make([]byte, 4<<20)
		n := runtime.Stack(buf, true)
		fmt.Println(string(buf[:n]))
		os.Exit(3)
	}
}
