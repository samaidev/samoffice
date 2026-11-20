# cmd/wasm — 浏览器 WASM 构建

把 SamOffice 的文档引擎（解析 + 写回）编译成浏览器可用的 WASM，供网页内直接打开/编辑 md 与 Office 文件，无需服务端。

> **定位说明**：本包是给**外部网页内嵌**用的轻量引擎入口（5 个方法的小 API）。
> SamOffice 应用自身的浏览器形态（完整打开/保存链路、pptx 写回、PDF 懒加载导出、
> mode 徽标、dist-web 构建）请用 **`cmd/samoffice-wasm`**（+ `cmd/samoffice-wasm-pdf`
> PDF 子模块），前端入口见 `frontend/src/services/wasmBackend.ts` 与
> `scripts/build-web.sh`。两者共享同一套 internal 内核（解析器/渲染器/xlsx 字节级
> 读写），`window.samoffice` 同名但分属不同页面，切勿在同一页面同时加载两个模块。

## 构建

```bash
GOOS=js GOARCH=wasm go build -o samoffice.wasm ./cmd/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .   # Go 运行时胶水
```

## 页面接入

先加载 `wasm_exec.js`，再实例化 `samoffice.wasm`，全局对象 `window.samoffice` 提供：

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `version()` | — | 引擎版本字符串 |
| `parse(ext, base64)` | 扩展名 + 文件字节（base64） | `{ok, doc, rawContent?, warnings, error}`；`doc` 为 UDM JSON；文本类格式（md/mdx/txt/text/html/htm/csv）额外回传 `rawContent`（原文 base64）；warnings 为 `/api/doc/open` 同构的 JSON 字符串。txt/text/html/htm 无注册解析器时桥内合成 UDM（txt 逐行段落、html 入 RawBlock{kind:"html"}），mdx 走 markdown 解析 |
| `xlsxOpen(base64)` | 文件字节 | `{ok, workbook, error}`，工作簿 JSON（sheets/cells，含样式/合并/列宽/冻结） |
| `saveDocx(docJSON)` | UDM JSON 字符串 | `{ok, data, error}`，docx 字节（base64） |
| `saveXlsx(workbookJSON)` | 工作簿 JSON 字符串 | `{ok, data, error}`，xlsx 字节（base64） |
| `savePptx(slidesJSON)` | 幻灯片 JSON（pageW/pageH/slides/masterShapes，与桌面 binding 同契约） | `{ok, data, error}`，pptx 字节（base64） |

别名（与 `cmd/samoffice-wasm` 应用后端同名的等价方法，两个引擎共享一套调用面）：`readXLSXBytes` = `xlsxOpen`、`renderDocx` = `saveDocx`、`writeXLSX` = `saveXlsx`、`writePPTX` = `savePptx`。

- md / csv 的保存是纯文本写回，无需引擎参与。
- pptx 经 `savePptx` 写回：幻灯片 JSON 取自 parse 结果中 RawBlock{kind:"slide"} 的 shapes（几何/逐段样式完整）；doc / xls 为只读解析，.ppt 的幻灯片 JSON 同样可经 `savePptx` 另存为 .pptx。
- 不含拼写字库（internal/dict，约 5.5MB）与 PDF 中文字体（约 15MB）——本构建不 import dict/sqlite；PDF 导出见 `cmd/samoffice-wasm-pdf`（懒加载）。
- 二进制出入参均为 base64 字符串；所有调用同步执行。

## 参考实现

`finger-workbench` 单文件页面（内联 wasm）见 sznm 仓库交付物：打开工作目录 → 列出 md/Office 文件 → 编辑 → Ctrl+S 原地写回。
