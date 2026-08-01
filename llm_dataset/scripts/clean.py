# -*- coding: utf-8 -*-
"""清洗开源语料：规范化 -> 长度过滤 -> MD5 精确去重 -> 输出统一 JSONL 格式。

支持输入：.jsonl（自动探测 text/content/raw 字段）与 .txt（按空行分段）。
用法: python clean.py raw/stage3 -o data/stage3 --stage 3 --subject mixed
"""
import argparse
import hashlib
import json
import os
import re
import unicodedata


def normalize(text):
    text = unicodedata.normalize("NFKC", text)          # 全角->半角等
    text = re.sub(r"[ \t\u3000]+", " ", text)            # 压缩空白
    text = re.sub(r"\n{3,}", "\n\n", text)               # 压缩空行
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)  # 控制字符
    return text.strip()


def chinese_ratio(text):
    if not text:
        return 0.0
    cn = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return cn / len(text)


TEXT_KEYS = ("text", "content", "raw", "data", "completion")


def iter_texts(path):
    if path.endswith(".jsonl") or path.endswith(".json"):
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, str):
                    yield obj
                    continue
                for k in TEXT_KEYS:
                    if isinstance(obj.get(k), str):
                        yield obj[k]
                        break
    elif path.endswith(".txt"):
        with open(path, encoding="utf-8", errors="ignore") as f:
            buf = []
            for line in f:
                if line.strip():
                    buf.append(line.rstrip("\n"))
                elif buf:
                    yield "\n".join(buf)
                    buf = []
            if buf:
                yield "\n".join(buf)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("indir", help="原始语料目录")
    p.add_argument("-o", "--outdir", required=True)
    p.add_argument("--stage", type=int, required=True)
    p.add_argument("--subject", default="mixed")
    p.add_argument("--min-len", type=int, default=20, help="最短字符数")
    p.add_argument("--max-len", type=int, default=20000, help="最长字符数")
    p.add_argument("--min-cn", type=float, default=0.3, help="最低中文占比")
    args = p.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    outpath = os.path.join(args.outdir, f"cleaned_stage{args.stage}.jsonl")
    seen, kept, total = set(), 0, 0

    with open(outpath, "w", encoding="utf-8") as out:
        for root, _, files in os.walk(args.indir):
            for fn in files:
                if not fn.endswith((".jsonl", ".json", ".txt")):
                    continue
                for text in iter_texts(os.path.join(root, fn)):
                    total += 1
                    text = normalize(text)
                    if not (args.min_len <= len(text) <= args.max_len):
                        continue
                    if chinese_ratio(text) < args.min_cn:
                        continue
                    h = hashlib.md5(text.encode("utf-8")).hexdigest()
                    if h in seen:
                        continue
                    seen.add(h)
                    kept += 1
                    out.write(json.dumps({
                        "id": f"s{args.stage}-clean-{kept:07d}",
                        "stage": args.stage,
                        "subject": args.subject,
                        "grade": "",
                        "type": "corpus",
                        "text": text,
                    }, ensure_ascii=False) + "\n")

    print(f"[clean] 输入 {total} 段，保留 {kept} 段，输出 -> {outpath}")
    print(f"[clean] 保留率 {kept / max(total, 1):.1%}")


if __name__ == "__main__":
    main()
