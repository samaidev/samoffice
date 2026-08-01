#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据质量深度检查：字段完整性、空文本、token 估算、分词器、重复文本。"""
import json, os, sys, hashlib
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
try:
    import sentencepiece as spm
except ImportError:
    spm = None

DATA = r"C:\laldata\data"
TRAIN = r"C:\laldata\train.jsonl"
TOK = r"C:\laldata\tokenizer\chinese_bpe.model"

def open_jsonl(p):
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)

# 1) 字段完整性 + 空文本 检查（抽样 train.jsonl 全量）
req_fields = {"id", "stage", "subject", "grade", "type", "text"}
missing = Counter()
empty_text = 0
char_total = 0
n = 0
text_hashes = Counter()
for o in open_jsonl(TRAIN):
    n += 1
    miss = req_fields - set(o.keys())
    if miss:
        missing[tuple(sorted(miss))] += 1
    t = o.get("text", "")
    if not t or not t.strip():
        empty_text += 1
    else:
        char_total += len(t)
        text_hashes[hashlib.md5(t.encode("utf-8")).hexdigest()] += 1

dup_text = sum(c - 1 for c in text_hashes.values() if c > 1)
print(f"[字段] 总条数={n} 缺字段={sum(missing.values())} 缺字段类型={dict(missing)}")
print(f"[空文本] {empty_text} 条")
print(f"[字符] 总字符={char_total:,} 估算 tokens ≈ {char_total//1.6:,.0f} (中文约1.6字符/token)")
print(f"[重复文本] 完全相同的文本条数(跨全量)={dup_text}")

# 2) 分词器
if spm and os.path.exists(TOK):
    sp = spm.SentencePieceProcessor()
    sp.Load(TOK)
    print(f"[分词器] vocab_size={sp.vocab_size()}  文件存在 OK")
    # 用分词器真实估算 token 数（抽样 stage4 + general 各前 2000 条）
    tok_total = 0
    cnt = 0
    for o in open_jsonl(TRAIN):
        tok_total += len(sp.encode(o["text"]))
        cnt += 1
        if cnt >= 8000:
            break
    avg = tok_total / cnt
    print(f"[分词器] 抽样 {cnt} 条 平均 {avg:.1f} token/条 -> 全量估算 {int(avg*n):,} tokens")
else:
    print("[分词器] 未安装 sentencepiece 或文件缺失")

# 3) 课程顺序检查：train.jsonl 是否按 stage 升序区块排列
order = []
for o in open_jsonl(TRAIN):
    order.append(o["stage"])
# 找 stage 区块切换
blocks = []
cur = order[0]
start = 0
for i, s in enumerate(order):
    if s != cur:
        blocks.append((cur, start, i))
        cur = s
        start = i
blocks.append((cur, start, len(order)))
print("[课程顺序] 区块(按出现顺序):", [(b[0], b[2]-b[0]) for b in blocks])
istonotonic = all(blocks[i][0] <= blocks[i+1][0] for i in range(len(blocks)-1))
print(f"[课程顺序] 阶段是否非递减(课程学习 OK): {istonotonic}")

# 4) 随机抽查 3 条
import random
random.seed(0)
all_lines = list(open_jsonl(TRAIN))
print("\n[抽查] 随机 3 条:")
for o in random.sample(all_lines, 3):
    txt = o["text"].replace("\n", "\\n")
    print(f"  stage={o['stage']} subject={o['subject']} grade={o['grade']}: {txt[:120]}...")
