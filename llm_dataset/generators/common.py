# -*- coding: utf-8 -*-
"""生成器公共工具：JSONL 写出、命令行参数。

JsonlWriter 支持 dedup 模式：自动剔除重复文本，并可在达到
max_unique 个唯一样本后停止（避免合成模板循环浪费）。
write() 返回 True 表示本次写入成功（唯一），False 表示重复被跳过。
"""
import argparse
import json
import os
import random


def make_argparser(desc):
    p = argparse.ArgumentParser(description=desc)
    p.add_argument("-n", "--num", type=int, default=10000, help="最大生成尝试次数")
    p.add_argument("-o", "--outdir", type=str, required=True, help="输出目录")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max_unique", type=int, default=0,
                   help="唯一样本上限，0=不限制（仍按文本去重）。达到上限后 write 返回 'STOP'")
    p.add_argument("--dedup", action="store_true", help="按文本去重（默认开启）")
    return p


class JsonlWriter:
    def __init__(self, outdir, filename, max_unique=0, dedup=True):
        os.makedirs(outdir, exist_ok=True)
        self.path = os.path.join(outdir, filename)
        self.f = open(self.path, "w", encoding="utf-8")
        self.count = 0
        self.unique = 0
        self.max_unique = max_unique
        self.dedup = dedup
        self.seen = set()

    def write(self, prefix, stage, subject, grade, text, dtype="synthetic"):
        # STOP：已达到唯一上限
        if self.max_unique and self.unique >= self.max_unique:
            return "STOP"
        # 去重
        if self.dedup and text in self.seen:
            return False
        self.count += 1
        self.unique += 1
        self.seen.add(text)
        rec = {
            "id": f"{prefix}-{self.count:07d}",
            "stage": stage,
            "subject": subject,
            "grade": grade,
            "type": dtype,
            "text": text,
        }
        self.f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return True

    def close(self):
        self.f.close()
        print(f"[done] 写入 {self.count} 条（唯一 {self.unique}）-> {self.path}")


def weighted_choice(rng: random.Random, items):
    """items: [(weight, value), ...]"""
    total = sum(w for w, _ in items)
    r = rng.uniform(0, total)
    acc = 0
    for w, v in items:
        acc += w
        if r <= acc:
            return v
    return items[-1][1]
