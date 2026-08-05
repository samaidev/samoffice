// Command samoffice-launcher 是 SamOffice 的桌面启动器（Web 模式）。
// 它拉起同目录下的 samoffice-server.exe 子进程，打开浏览器，并提供退出入口。
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"time"
)

func main() {
	exeDir, err := os.Executable()
	if err != nil {
		exeDir = "."
	} else {
		exeDir = filepath.Dir(exeDir)
	}
	_ = err

	addr := os.Getenv("SAMOFFICE_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	dataDir := os.Getenv("SAMOFFICE_DATA")
	if dataDir == "" {
		dataDir = filepath.Join(exeDir, "samoffice-data")
	}

	serverExe := filepath.Join(exeDir, "samoffice-server.exe")
	if _, statErr := os.Stat(serverExe); statErr != nil {
		// 允许从源码目录以 go run 调试
		serverExe = "samoffice-server.exe"
	}

	cmd := exec.Command(serverExe, "--addr", addr, "--data", dataDir)
	cmd.Dir = exeDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Printf("无法启动 SamOffice 服务: %v\n", err)
		fmt.Println("请确认 samoffice-server.exe 与本启动器在同一目录。")
		os.Exit(1)
	}

	url := "http://" + addr + "/"
	ready := false
	for i := 0; i < 40; i++ {
		resp, gerr := http.Get(url + "api/health")
		if gerr == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				ready = true
				break
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	if !ready {
		fmt.Println("服务未能在预期时间内就绪，请检查端口", addr, "是否被占用。")
		_ = cmd.Process.Kill()
		os.Exit(1)
	}

	fmt.Printf("SamOffice 已启动 → %s\n", url)
	openBrowser(url)

	fmt.Println("SamOffice 运行中。关闭此窗口或按 Ctrl+C 即可退出。")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
	fmt.Println("\n正在关闭 SamOffice...")
	_ = cmd.Process.Kill()
}

func openBrowser(u string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		c = exec.Command("open", u)
	default:
		c = exec.Command("xdg-open", u)
	}
	_ = c.Start()
}
