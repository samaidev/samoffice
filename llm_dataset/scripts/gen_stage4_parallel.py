# -*- coding: utf-8 -*-
"""并行生成 stage4 数据：spawn 多个独立 python 子进程，最后合并去重。

usage: python scripts/gen_stage4_parallel.py -n 2000000 -w 6 -o C:/laldata/data/stage4
"""
import argparse
import json
import os
import subprocess
import sys
from multiprocessing import Process

PY = sys.executable
GEN = os.path.join(os.path.dirname(__file__), "..", "generators", "stage4_calculus.py")
GEN = os.path.abspath(GEN)


def worker(n, seed, outdir, tmpdir):
    """独立子进程：跑单个 stage4_calculus.py，写独立子目录避免并发冲突。"""
    os.makedirs(tmpdir, exist_ok=True)
    subprocess.run([
        PY, "-u", GEN, "-n", str(n), "--seed", str(seed), "-o", tmpdir,
    ], check=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--num", type=int, default=2000000)
    ap.add_argument("-w", "--workers", type=int, default=6)
    ap.add_argument("-o", "--outdir", required=True)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    per = args.num // args.workers
    procs = []
    for k in range(args.workers):
        tmpdir = os.path.join(args.outdir, f"_part{k}")
        p = Process(target=worker, args=(per, 1000 + k * 7, args.outdir, tmpdir))
        p.start()
        procs.append(p)

    for p in procs:
        p.join()

    # 合并：跨文件文本去重
    seen = set()
    out = os.path.join(args.outdir, "stage4_calculus.jsonl")
    total = 0
    uniq = 0
    with open(out, "w", encoding="utf-8") as fout:
        for k in range(args.workers):
            tmp = os.path.join(args.outdir, f"_part{k}", "stage4_calculus.jsonl")
            if not os.path.exists(tmp):
                continue
            with open(tmp, encoding="utf-8") as fin:
                for line in fin:
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    total += 1
                    try:
                        t = json.loads(line)["text"]
                    except Exception:
                        t = line
                    if t in seen:
                        continue
                    seen.add(t)
                    fout.write(line + "\n")
                    uniq += 1
            os.remove(tmp)
            try:
                os.rmdir(os.path.join(args.outdir, f"_part{k}"))
            except Exception:
                pass
    print(f"[merge] 读取 {total} 条，去重后唯一 {uniq} 条 -> {out}")


if __name__ == "__main__":
    main()
