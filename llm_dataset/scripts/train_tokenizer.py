#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
训练中文 BPE 分词器（sentencepiece）。

针对 100M 参数的中文课程数据集优化：
  - vocab_size=32768，byte_fallback 保证任意字符可还原
  - character_coverage=0.9995 覆盖绝大多数汉字
  - 中文不加空格，用 BPE 直接切

用法:
  python scripts/train_tokenizer.py \
      --input C:\laldata\train.jsonl \
      --output C:\laldata\tokenizer\chinese_bpe \
      --vocab_size 32768
"""
import argparse
import json
import os
import tempfile


def iter_text(jsonl_path):
    """从 jsonl 里取 text 字段，逐行 yield。"""
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = obj.get("text")
            if text:
                yield text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="train.jsonl 路径（或目录，会扫描 *.jsonl）")
    ap.add_argument("--output", required=True, help="输出前缀，如 C:\\laldata\\tokenizer\\chinese_bpe")
    ap.add_argument("--vocab_size", type=int, default=32768)
    ap.add_argument("--character_coverage", type=float, default=0.9995)
    ap.add_argument("--model_type", default="bpe", choices=["bpe", "unigram"])
    args = ap.parse_args()

    import sentencepiece as spm

    # 收集输入文件
    inputs = []
    if os.path.isdir(args.input):
        for root, _, files in os.walk(args.input):
            for fn in files:
                if fn.endswith(".jsonl"):
                    inputs.append(os.path.join(root, fn))
    else:
        inputs = [args.input]

    if not inputs:
        raise SystemExit("未找到任何 .jsonl 输入文件")

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    # sentencepiece 需要纯文本输入，先写出临时文本文件
    tmp_path = args.output + ".corpus.txt"
    n_lines = 0
    with open(tmp_path, "w", encoding="utf-8") as out:
        for path in inputs:
            for text in iter_text(path):
                out.write(text.replace("\n", " ").strip())
                out.write("\n")
                n_lines += 1
    print(f"[tokenizer] 已抽取 {n_lines} 行文本 -> {tmp_path}")

    spm.SentencePieceTrainer.train(
        input=tmp_path,
        model_prefix=args.output,
        vocab_size=args.vocab_size,
        character_coverage=args.character_coverage,
        model_type=args.model_type,
        byte_fallback=True,
        normalization_rule_name="nfkc",
        add_dummy_prefix=False,
        split_by_whitespace=False,        # 中文不加空格切分
        split_by_number=True,
        num_threads=max(1, os.cpu_count() // 2),
        hard_vocab_limit=False,
    )
    print(f"[tokenizer] 训练完成 -> {args.output}.model / {args.output}.vocab")

    # 冒烟测试
    sp = spm.SentencePieceProcessor()
    sp.Load(args.output + ".model")
    sample = "小明买了一斤苹果，付了三元五角钱。二次函数 y = x^2 的导数是 2x。"
    ids = sp.encode(sample)
    print(f"[tokenizer] 示例: {len(ids)} tokens -> {ids[:20]}...")
    print(f"[tokenizer] 还原: {sp.decode(ids)}")


if __name__ == "__main__":
    main()
