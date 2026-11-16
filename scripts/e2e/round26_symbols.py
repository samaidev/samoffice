#!/usr/bin/env python3
"""用 go tool nm 符号表解析卡死栈帧偏移 → 函数名。
疑点：TID 9720（消息循环线程）栈里的 samoffice.exe 回调链：
  +0x80f2d, +0x82be9, +0x82b60, +0x80fe1, +0x4151b, +0x41656, +0x40785,
  +0x5599d, +0x5346a, +0x510fa, +0x80fa3, +0x86305, +0x7f245, +0x7f1cf
"""
import subprocess, re

# 主线程栈里出现的 samoffice.exe RVA（相对模块基址）
RVAS = [
    0x80f2d, 0x34eead0, 0x82be9, 0x82b60, 0x80fe1, 0x4151b, 0x41656,
    0x40785, 0x415d6, 0x5599d, 0x5346a, 0x510fa, 0x80fa3, 0x86305,
    0x7f245, 0x7f1cf, 0x34ec540, 0x34ee780, 0x34eea88,
]

out = subprocess.run(['go', 'tool', 'nm', '/tmp/sam_sym.exe'],
                     capture_output=True, text=True,
                     env={'PATH': '/home/z/go/bin:/usr/bin:/bin', 'HOME': '/home/z'}).stdout

# 收集代码段符号（T/t = text）
syms = []
for line in out.splitlines():
    parts = line.split()
    if len(parts) >= 3 and parts[1] in 'TtWw':
        try:
            addr = int(parts[0], 16)
        except ValueError:
            continue
        syms.append((addr, parts[2]))
syms.sort()
print(f'{len(syms)} code symbols')

import bisect
addrs = [s[0] for s in syms]
for rva in RVAS:
    # PE 装载后 nm 的地址是 link-time VA；RVA = VA - ImageBase(0x140000000 默认)
    # 先试直接匹配（ImageBase 0x140000000）
    va = rva + 0x140000000
    i = bisect.bisect_right(addrs, va) - 1
    if i >= 0 and va - addrs[i] < 0x10000:
        name = syms[i][1]
        off = va - addrs[i]
        print(f'RVA 0x{rva:x} -> {name}+0x{off:x}')
    else:
        print(f'RVA 0x{rva:x} -> no symbol (nearest: {syms[i][1] if i>=0 else "?"})')
