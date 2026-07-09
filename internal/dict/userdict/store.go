package userdict

import (
        "database/sql"
        "fmt"
        "strings"
        "sync"
        "time"
)

// Store 是用户词库的 SQLite 存储
// 支持增删查改 + 频率自学习 + 多语言
type Store struct {
        db *sql.DB
        mu sync.Mutex
}

type Entry struct {
        Word      string
        Lang      string
        Frequency int
        Source    string // manual | auto-learned | imported
        CreatedAt time.Time
        LastUsed  time.Time
}

func Open(path string) (*Store, error) {
        db, err := openDriver(path)
        if err != nil {
                return nil, fmt.Errorf("open sqlite: %w", err)
        }
        db.SetMaxOpenConns(1) // SQLite 单写
        s := &Store{db: db}
        if err := s.init(); err != nil {
                return nil, err
        }
        return s, nil
}

func (s *Store) init() error {
        _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS user_dict (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    lang TEXT NOT NULL,
    frequency INTEGER DEFAULT 1,
    source TEXT DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(word, lang)
);
CREATE INDEX IF NOT EXISTS idx_user_dict_word ON user_dict(word);
CREATE INDEX IF NOT EXISTS idx_user_dict_lang ON user_dict(lang);
`)
        return err
}

// Add 添加用户词；若已存在则 frequency += inc
func (s *Store) Add(word, lang, source string, inc int) error {
        s.mu.Lock()
        defer s.mu.Unlock()
        word = strings.ToLower(strings.TrimSpace(word))
        if word == "" {
                return nil
        }
        if inc <= 0 {
                inc = 1
        }
        _, err := s.db.Exec(`
INSERT INTO user_dict (word, lang, frequency, source, last_used)
VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(word, lang) DO UPDATE SET
    frequency = frequency + ?,
    last_used = CURRENT_TIMESTAMP
`, word, lang, inc, source, inc)
        return err
}

// Remove 删除用户词
func (s *Store) Remove(word, lang string) error {
        s.mu.Lock()
        defer s.mu.Unlock()
        _, err := s.db.Exec(`DELETE FROM user_dict WHERE word=? AND lang=?`,
                strings.ToLower(word), lang)
        return err
}

// Has 检查是否在用户词库
func (s *Store) Has(word, lang string) (bool, error) {
        s.mu.Lock()
        defer s.mu.Unlock()
        var id int
        err := s.db.QueryRow(`SELECT id FROM user_dict WHERE word=? AND lang=?`,
                strings.ToLower(word), lang).Scan(&id)
        if err == sql.ErrNoRows {
                return false, nil
        }
        return err == nil, err
}

// All 加载某语言全部用户词，用于补全 SymSpell 索引
func (s *Store) All(lang string) ([]Entry, error) {
        s.mu.Lock()
        defer s.mu.Unlock()
        rows, err := s.db.Query(`SELECT word, lang, frequency, source, created_at, last_used
                FROM user_dict WHERE lang=? ORDER BY frequency DESC`, lang)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        var out []Entry
        for rows.Next() {
                var e Entry
                if err := rows.Scan(&e.Word, &e.Lang, &e.Frequency, &e.Source, &e.CreatedAt, &e.LastUsed); err != nil {
                        return nil, err
                }
                out = append(out, e)
        }
        return out, rows.Err()
}

// Stats 返回词库统计
func (s *Store) Stats() (map[string]int, error) {
        s.mu.Lock()
        defer s.mu.Unlock()
        rows, err := s.db.Query(`SELECT lang, COUNT(*) FROM user_dict GROUP BY lang`)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        out := make(map[string]int)
        for rows.Next() {
                var lang string
                var n int
                if err := rows.Scan(&lang, &n); err != nil {
                        return nil, err
                }
                out[lang] = n
        }
        return out, rows.Err()
}

func (s *Store) Close() error { return s.db.Close() }
