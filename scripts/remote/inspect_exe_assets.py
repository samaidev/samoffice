#!/usr/bin/env python3
"""从 v0.7.19 Windows exe 中提取 go:embed 的前端资源清单，定位 GET / 404 根因。
Wails assetserver 用 gzip 压缩嵌入的 FS；go:embed 的文件在 PE 的 .rsrc/.data 段
以明文或 gzip 存放。直接在二进制里搜 index.html / assets/ 文件名与内容标记。"""
import re
import sys

exe = sys.argv[1] if len(sys.argv) > 1 else "/tmp/relchk/SamOffice-windows-x64/samoffice.exe"
data = open(exe, "rb").read()
print(f"size: {len(data):,}")

# 1) go:embed 文件名表：embed.FS 里会有 "index.html"、"assets/xxx.js" 字符串
for marker in [b"index.html", b"frontend/dist", b"assets/index-"]:
    idxs = [m.start() for m in re.finditer(re.escape(marker), data)]
    print(f"{marker!r}: {len(idxs)} hits", idxs[:6])

# 2) 找 vite index.html 的特征内容（<title>）
for pat in [rb"<title>[^<]{0,60}</title>", rb'<script[^>]{0,80}assets/index-[^"]{0,40}']:
    ms = re.findall(pat, data)
    print(f"{pat!r}: {len(ms)} hits", [m[:80] for m in ms[:3]])

# 3) gzip 头（1f 8b）附近是否有 embed 资产 —— Wails assetserver 打包方式
gz = [m.start() for m in re.finditer(rb"\x1f\x8b\x08", data)]
print(f"gzip headers: {len(gz)}")

# 4) 检查 v0.7.19 tag 字符串确认二进制版本
v = re.findall(rb"v0\.7\.\d+", data)
from collections import Counter
print("version strings:", Counter(x.decode() for x in v).most_common(6))
