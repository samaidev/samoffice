# -*- coding: utf-8 -*-
"""按课程比例混合各阶段数据，输出课程顺序排列的最终训练集。

策略（v3，严格无重复 + 比例精确）：
1. 各阶段先按 text 内容去重（合成数据模板循环，剔除重复训练样本）。
2. 按 ratio 分配目标条数：以"去重后各阶段能按 ratio 提供的条数"为瓶颈，
   保证最终各阶段条数比例严格 = ratio。
3. 阶段内 shuffle，阶段间按 order 升序拼接（课程学习）。
4. 通用语料按 ratio 取固定条数，整体 shuffle 后均匀插入各阶段区块之间。

用法: python mix.py -c config/laldata.yaml -o C:/laldata/train.jsonl
"""
import argparse
import glob
import json
import os
import random

import yaml


def load_stage(dirs):
    recs = []
    for d in dirs:
        for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        recs.append(line)
    return recs


def dedup(recs):
    seen = set()
    out = []
    for line in recs:
        try:
            t = json.loads(line).get("text", "")
        except json.JSONDecodeError:
            continue
        if t in seen:
            continue
        seen.add(t)
        out.append(line)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-c", "--config", required=True)
    p.add_argument("-o", "--output", required=True)
    args = p.parse_args()

    with open(args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    rng = random.Random(cfg.get("output", {}).get("seed", 42))

    # 载入 + 去重 + shuffle
    stages, interleaves = [], []
    for s in cfg["stages"]:
        recs = dedup(load_stage(s["dirs"]))
        if not recs:
            print(f"[warn] {s['name']} 无数据，跳过（目录: {s['dirs']}）")
            continue
        rng.shuffle(recs)
        entry = {"name": s["name"], "order": s["order"], "ratio": s["ratio"], "recs": recs}
        (interleaves if s.get("interleave") else stages).append(entry)

    stages.sort(key=lambda e: e["order"])
    if not stages:
        raise SystemExit("[error] 没有任何阶段数据，请先运行生成器。")

    # 瓶颈：去重后各阶段条数 / ratio 的最小值 → 决定总条数上限，保证比例精确
    scale = min(len(e["recs"]) / e["ratio"] for e in stages + interleaves)

    out_blocks = []
    stats = {}
    for e in stages:
        n_take = int(scale * e["ratio"])
        take = e["recs"][:n_take]
        stats[e["name"]] = len(take)
        out_blocks.append((e["order"], take))

    inter_pool = []
    if interleaves:
        ie = interleaves[0]
        n_inter = int(scale * ie["ratio"])
        inter_pool = ie["recs"][:n_inter]
        rng.shuffle(inter_pool)
        stats[ie["name"]] = len(inter_pool)

    # 均匀穿插：inter_pool 切成 (阶段数-1) 片，插在每个阶段之间。
    # 阶段块内部连续（保持课程边界清晰），通用片自身 shuffle，全部用完。
    n_blocks = len(out_blocks)
    gaps = n_blocks - 1  # 阶段之间有 n_blocks-1 个插入点
    chunk = len(inter_pool) // gaps if gaps else len(inter_pool)
    merged = []
    for i, (order, block) in enumerate(out_blocks):
        rng.shuffle(block)
        merged.extend(block)
        if i < gaps:
            seg = inter_pool[i * chunk: (i + 1) * chunk]
            rng.shuffle(seg)
            merged.extend(seg)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n".join(merged) + "\n")

    total = len(merged)
    # 最终校验：文本零重复
    texts = [json.loads(l)["text"] for l in merged]
    dup_text = total - len(set(texts))
    print(f"[mix] 输出 {total} 条，完全重复文本={dup_text} -> {args.output}")
    total_chars = sum(len(t) for t in texts)
    for name, n in stats.items():
        print(f"  - {name}: {n} 条 ({n/total:.1%})")
    print(f"[mix] 阶段顺序(升序): {[b[0] for b in out_blocks]}")
    print(f"[mix] 总字符 ≈ {total_chars/1e6:.1f}M，估算 tokens ≈ {int(total_chars/1.6):,}")


if __name__ == "__main__":
    main()
