//go:build darwin || linux

package main

import (
	"os"
	"path/filepath"
	"syscall"
)

// instanceLockFile 持有单实例锁文件的打开句柄。
// 必须保留到进程退出：flock 随文件描述符关闭而释放，
// 若被 GC 回收（os.File 有 finalizer）会提前解锁，导致多开。
var instanceLockFile *os.File

// acquireSingleInstanceLock 用 flock 独占锁文件实现单实例，
// 与 Windows 的全局命名互斥体等价：返回 true 表示本进程持有锁（首个实例）。
// 进程退出（含崩溃）时内核自动释放锁，残留的锁文件不影响下次启动。
func acquireSingleInstanceLock() bool {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "samoffice")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		// 无法创建锁目录：退化为允许多开，不阻止启动
		return true
	}
	f, err := os.OpenFile(filepath.Join(dir, "instance.lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return true
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		// 已被其它实例持有
		_ = f.Close()
		return false
	}
	instanceLockFile = f
	return true
}
