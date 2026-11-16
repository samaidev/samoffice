#!/usr/bin/env python3
"""分析 samoffice 卡死 minidump：列出全部线程的用户态栈帧。
minidump 库不解析栈回溯，但可以：
1) 拿到线程列表 + 每线程的 ContextRecord / Stack 内存
2) 用栈内存里的返回地址匹配模块基址，粗略重建调用链
"""
import sys
import struct
from minidump.minidumpfile import MinidumpFile

DMP = '/tmp/samdump/sam_hung.dmp'
mf = MinidumpFile.parse(DMP)

print('=== modules (non-system) ===')
mods = {}
for m in mf.modules.modules:
    mods[m.name.split('\\')[-1].lower()] = (m.baseaddress, m.size, m.name)
for name, (base, size, full) in sorted(mods.items()):
    if any(k in name for k in ('samoffice', 'wails', 'webview', 'edge')):
        print(f'{name}: base=0x{base:x} size=0x{size:x}')

reader = mf.get_reader()
DUMP = open(DMP, 'rb')

def loc(addr):
    for name, (base, size, full) in mods.items():
        if base <= addr < base + size:
            return f'{name}+0x{addr-base:x}'
    return None

def read_at_rva(rva, size):
    DUMP.seek(rva)
    return DUMP.read(size)

print('\n=== threads ===')
tl = mf.threads.threads
print(f'total threads: {len(tl)}')
for t in tl:
    tid = t.ThreadId
    frames = []
    try:
        ctxld = t.ThreadContext
        raw = read_at_rva(ctxld.Rva, ctxld.DataSize)
        rsp = rip = 0
        if len(raw) >= 0x100:
            rsp = struct.unpack('<Q', raw[0x98:0xA0])[0]
            rip = struct.unpack('<Q', raw[0xF8:0x100])[0]
        frames.append(rip)
        sd = t.Stack
        stack_start = sd.StartOfMemoryRange
        stack_bytes = read_at_rva(sd.Rva, sd.DataSize)
        for off in range(0, len(stack_bytes) - 8, 8):
            val = struct.unpack('<Q', stack_bytes[off:off+8])[0]
            l = loc(val)
            if l and ('samoffice' in l or 'webview' in l):
                frames.append(val)
            if len(frames) > 20: break
    except Exception as e:
        print(f'TID {tid}: error {e}')
        continue
    sam = [f for f in frames if loc(f) and 'samoffice' in loc(f)]
    print(f'\nTID {tid} RIP=0x{frames[0]:x} ({loc(frames[0]) or "?"}) sam-frames={len(sam)}')
    for f in frames[:10]:
        l = loc(f)
        if l: print(f'  0x{f:x} {l}')
