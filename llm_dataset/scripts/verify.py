# -*- coding: utf-8 -*-
"""校验 JSONL 数据文件：行数、JSON 有效性、ID 唯一性、各阶段统计。
用法: python verify.py <file_or_dir> [file_or_dir ...]
"""
import glob
import json
import os
import sys
from collections import Counter


def check(path):
    total = good = bad = 0
    ids = set()
    stages = Counter()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                o = json.loads(line)
                ids.add(o["id"])
                stages[o.get("stage")] += 1
                good += 1
            except Exception:
                bad += 1
    dup = good - len(ids)
    print(f"{path}\n  行数={total} 有效={good} 损坏={bad} 重复ID={dup} stage分布={dict(stages)}")
    return bad, dup


def main():
    targets = []
    for arg in sys.argv[1:]:
        if os.path.isdir(arg):
            targets += glob.glob(os.path.join(arg, "**", "*.jsonl"), recursive=True)
        else:
            targets.append(arg)
    total_bad = total_dup = 0
    for t in targets:
        b, d = check(t)
        total_bad += b
        total_dup += d
    print(f"\n[verify] 共 {len(targets)} 个文件，损坏行 {total_bad}，重复ID {total_dup}")


if __name__ == "__main__":
    main()
