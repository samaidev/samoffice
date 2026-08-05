//go:build cgo && !windows

package userdict

// openDriver 打开 sqlite 数据库 — Linux/Mac 本地编译用 mattn/go-sqlite3 (CGO, 更快)
// Windows 桌面版 (Wails, 必须 cgo) 改用纯 Go 的 modernc.org/sqlite 以避开
// MinGW gcc 编译的 mattn/go-sqlite3 在运行时的 ACCESS VIOLATION 崩溃。

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

func openDriver(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path+"?_journal=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	return db, nil
}
