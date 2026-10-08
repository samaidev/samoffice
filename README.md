# SamOffice — Cross-Platform Office Suite

A cross-platform Office suite (Documents / Spreadsheets / Presentations) built with Go + Web technologies.
Core features: **Dual-mode architecture** (Wails desktop + standalone HTTP service), **fault-tolerant document parsing**, **spell-check dictionary**.

> **[中文版 / Chinese version](README.zh-CN.md)**

> **Naming Notes (to avoid confusion)**
> - Repository Go module path: `github.com/zai/samoffice`
> - Product name (Wails `name`): `SamOffice` (install directory / executable name are both `samoffice`)
> - ⚠️ The `github.com/zai/SamOffice` seen in older docs (e.g. `pkg/README.md`) is an **outdated form**; the correct path is `github.com/zai/samoffice`.

---

## 0. Quick Reference (At a Glance)

| Item | Value |
|------|-------|
| Module path | `github.com/zai/samoffice` |
| Language / Framework | Go 1.25 + React 18 + Wails v2.12.0 |
| Desktop shell | Wails (frameless, front-end draws its own title bar) |
| Backend service | Gin (embedded HTTP + standalone `samoffice-server`) |
| Storage | SQLite (user dictionary `userdict.sqlite`) |
| Build entry | `main.go` (desktop) / `cmd/samoffice-server` (service) |
| Package manager | Go modules + npm (front-end) |
| Tests | 116 e2e all passing (100%); Go unit tests `go test ./...` |
| Install location | `C:\Program Files\SamOffice\` (Windows) |

**Windows build artifacts (as of 2026-07-19 install):**

| File | Size | Description |
|------|------|-------------|
| `samoffice.exe` | ~49.9 MB | Desktop main program (front-end embedded into exe) |
| `samoffice-server.exe` | ~43.5 MB | Standalone HTTP service mode |
| `uninstall.exe` | ~76 KB | Uninstaller |
| `frontend\` | — | ⚠️ Not produced by NSIS installer (front-end compiled into exe); an extra/debug directory, **does not affect operation** |

---

## 1. Build Environment

| Dependency | Version | Purpose |
|------------|---------|---------|
| Go | **1.25.0** | Backend / desktop compilation (see `go.mod`) |
| Node.js | **18+** | Front-end build (Vite 5 / React 18 / TypeScript) |
| Wails CLI | v2.12.0 (optional) | `go install github.com/wailsapp/wails/v2/cmd/wails@latest`, only for dev |
| NSIS | 3.x (Windows packaging only) | Generates installer `samoffice-setup-0.1.0.exe` |
| OS | Windows 10/11 64-bit (NSIS script requires x64) | Desktop run / packaging |

---

## 2. Build & Run

### 2.1 One-click Build (by platform)

```bash
# Linux / macOS: build desktop + server + front-end
./scripts/build.sh all
./scripts/build.sh server     # server only
./scripts/build.sh wails      # desktop only

# Windows: package NSIS installer (includes front-end build + Go compile + NSIS)
packaging/windows/build_windows_package.bat
```

### 2.2 Manual Compilation (equivalent commands, for troubleshooting)

```bash
# Front-end
cd frontend && npm install && npm run build && cd ..

# Desktop main program (Windows)
go build -tags desktop,production -ldflags="-s -w -H windowsgui" -o samoffice.exe .

# Standalone HTTP server
go build -ldflags="-s -w" -o samoffice-server.exe ./cmd/samoffice-server
```

### 2.3 Run

```bash
# Remote mode: access via browser at http://localhost:8080
./samoffice-server --addr 0.0.0.0:8080 --data ./data

# Local mode: native window + embedded HTTP service
./samoffice        # auto-launches window and prints the embedded HTTP port
```

---

## 3. Source Structure (**actually implemented**, not planned)

```
samoffice/
├── main.go                     # Wails desktop entry + embedded Gin HTTP service (127.0.0.1:random port)
├── wails.json                  # Wails config (name=SamOffice, embeds frontend/dist)
├── cmd/                        # multiple executable entries
│   ├── samoffice-server/        # standalone HTTP service entry
│   ├── test/                   # integration tests
│   ├── test-symspell/          # SymSpell algorithm tests
│   ├── gen-docx/               # generate test docx
│   ├── debug-sym/              # spell-check debugging tool
│   ├── test-fuzz/              # fuzz testing
│   ├── test-roundtrip/         # parse/write-back round-trip tests
│   └── gen-test-files/         # generate test files
├── internal/
│   ├── core/                   # UDM unified document model (document.go, json.go) — dual Go/TS definitions
│   ├── parser/                 # parsers
│   │   ├── docx/               # in-house docx parser (fault-tolerant: relaxed ZIP/XML parsing)
│   │   ├── markdown/           # Markdown parser
│   │   ├── pptx/               # PPTX parser
│   │   ├── xlsx/               # XLSX parser (excelize)
│   │   └── registry.go         # parser registry (dispatch by extension)
│   ├── dict/                   # dictionary system
│   │   ├── symspell/           # pure-Go SymSpell spell correction
│   │   ├── hunspell/           # Hunspell dictionary loading (.aff/.dic)
│   │   ├── userdict/           # user dictionary SQLite persistence + self-learning
│   │   ├── chinese/            # Chinese dictionary
│   │   └── manager.go          # dictionary scheduler (multi-language registry / cache)
│   ├── server/api/             # HTTP API (Gin Handler + CORS middleware)
│   ├── renderer/               # rendering / write-back
│   │   ├── docx/               # docx write-back
│   │   └── pdf/                # PDF export (gopdf + embedded fonts fonts/)
│   └── officelib/              # unified Office operation handler (internal library wrapper)
├── pkg/                        # standalone reusable libraries (agent/developer-friendly, chainable API)
│   ├── docgo/                  # read/write .docx (mirrors python-docx)
│   ├── xlsgo/                  # read/write .xlsx (mirrors openpyxl, depends on excelize)
│   ├── pptgo/                  # read/write .pptx (mirrors python-pptx)
│   ├── pdfgo/                  # PDF generation
│   └── README.md               # quick API reference for each library (note: import paths to be fixed)
├── frontend/                   # React 18 + TypeScript front-end
│   ├── src/
│   │   ├── editors/            # document(ProseMirror) / spreadsheet / slide editors
│   │   ├── services/backend.ts # Backend abstraction: LocalBackend(Wails) / RemoteBackend(HTTP) auto-switch
│   │   ├── types/udm.ts        # UDM TypeScript types (corresponds to internal/core)
│   │   ├── components/ hooks/   # UI components and hooks
│   │   ├── App.tsx i18n.tsx main.tsx index.css
│   ├── dist/                   # build output (embedded into exe via main.go's //go:embed)
│   └── package.json            # React18/Vite5/Tailwind3/ProseMirror/Zustand
├── scripts/
│   ├── build.sh                # Linux/macOS build script
│   └── e2e/                    # end-to-end tests (Playwright .mjs)
├── packaging/windows/          # Windows installer
│   ├── build_windows_package.bat
│   ├── samoffice_installer.nsi # NSIS script (installs to $PROGRAMFILES64\SamOffice)
│   └── stage/                  # packaging staging area (exe + README/LICENSE)
├── test-report.html            # test report (HTML)
└── test-results.json           # test results (structured JSON)
```

### Implemented Features

- [x] **Dual-mode architecture**: Wails local window + standalone HTTP service, front-end `backend.ts` auto-switches
- [x] **UDM unified document model**: dual Go (`internal/core`) + TS (`types/udm.ts`) definitions
- [x] **Document parsing**: docx (in-house fault-tolerant), markdown, xlsx (excelize), pptx
- [x] **Rendering / write-back**: docx write-back, PDF export (`internal/renderer`)
- [x] **Standalone Office libraries**: `pkg/{docgo,xlsgo,pptgo,pdfgo}` (mirrors python-docx/openpyxl/python-pptx)
- [x] **Spell correction**: SymSpell + Hunspell + user dictionary (SQLite self-learning) + Chinese/English bilingual
- [x] **Front-end editors**: ProseMirror document / lightweight spreadsheet / presentation editor + spell-check UI
- [x] **e2e tests**: 116 items all passing (see Section 5)

### Still Planned / Not Implemented

- [ ] Yjs real-time collaboration
- [ ] Complete Hunspell large dictionary (100k English + 350k Chinese)
- [ ] Plugin system

---

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│  Front-end: React 18 + ProseMirror + Vite   │
├─────────────────────────────────────────────┤
│  Comm layer: Backend abstraction            │
│   (LocalBackend | RemoteBackend)            │
│   auto-detects window.go.main.App           │
├─────────────────────────────────────────────┤
│  Backend: Go + Gin + Wails                  │
│  ├─ parser:   docx/markdown/xlsx/pptx       │
│  ├─ renderer: docx/pdf                      │
│  ├─ dict:     symspell/hunspell/userdict/zh │
│  └─ pkg:      docgo/xlsgo/pptgo/pdfgo       │
└─────────────────────────────────────────────┘
```

**Dual-mode data flow**:
- Local mode: `main.go` launches a Wails window and starts a Gin service on `127.0.0.1:0` (random port); the front-end calls `OpenFile/SpellCheck/Suggest/LearnWord/HTTPPort` via Wails Bindings.
- Remote mode: `samoffice-server` exposes REST (`/api/doc/*`, `/api/dict/*`); the front-end uses `RemoteBackend`'s `fetch`.

### Key APIs

| Method | Description |
|--------|-------------|
| `GET /api/health` | Health check |
| `POST /api/doc/open` | Upload file for parsing (multipart) |
| `GET /api/doc/local?path=xxx` | Open from local path |
| `POST /api/doc/save` | Save UDM |
| `GET /api/dict/check?text=&lang=` | Spell check |
| `GET /api/dict/suggest?word=&lang=&n=` | Correction suggestions |
| `POST /api/dict/learn` | Learn user word `{word,lang,source}` |
| Wails `App.OpenFile / SpellCheck / Suggest / LearnWord / HTTPPort` | Local binding methods |

---

## 5. Test Results

- Files: `test-results.json` / `test-report.html` (source: `scripts/e2e/` end-to-end tests)
- Latest run: **116 total, 116 passed, 0 failed, 100.0% pass rate** (timestamp 2026-07-09)
- Coverage: home page loading, top bar/menus, tab switching, theme & language switching, status bar version, toast, document/spreadsheet/presentation editor interactions, etc.
- Go unit tests:
  ```bash
  go test ./...
  go test ./pkg/...   # docgo/xlsgo/pptgo/pdfgo create/save/read/style
  ```

---

## 6. Fault-Tolerance Design

```
Original document → Fault-tolerant ZIP unzip → Relaxed XML parsing → Schema validation → UDM mapping → Render degradation
                       ↓                        ↓                     ↓                    ↓                  ↓
                  Skip damaged entries    Fix unclosed tags      Degrade unknown fields   Placeholder display
```

Never crashes: unknown content is preserved in the `Raw` field; damaged content is skipped and a Warning is logged.

---

## 7. License

MIT
