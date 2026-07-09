//go:build !cgo

package userdict

// openDriver 打开 sqlite 数据库 — Windows/交叉编译用 modernc.org/sqlite (pure Go)
// 与 store_cgo.go (mattn/go-sqlite3) 通过 build tag 互斥

import (
        "database/sql"
        "fmt"

        _ "modernc.org/sqlite"
)

func openDriver(path string) (*sql.DB, error) {
        db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
        if err != nil {
                return nil, fmt.Errorf("open sqlite: %w", err)
        }
        return db, nil
}
