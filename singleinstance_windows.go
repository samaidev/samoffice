//go:build windows

package main

import "golang.org/x/sys/windows"

// acquireSingleInstanceLock 创建全局命名互斥体并持有：
// 成功即为首个实例（返回 true）；已存在实例则返回 false。
// 互斥体句柄随进程存活，不需要（也不应该）提前关闭 —— 关闭即释放单实例锁。
func acquireSingleInstanceLock() bool {
	const mutexName = "Global\\SamOffice-SingleInstance"
	_, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(mutexName))
	if err == nil {
		return true
	}
	if errno, ok := err.(windows.Errno); ok && errno == windows.ERROR_ALREADY_EXISTS {
		return false
	}
	// 其它创建错误：退化为允许多开
	return true
}
