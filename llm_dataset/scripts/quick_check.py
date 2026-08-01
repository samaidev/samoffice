import json, hashlib
from collections import Counter

TRAIN = r"C:\laldata\train.jsonl"
TOK = r"C:\laldata\tokenizer\chinese_bpe.model"

lines = [l.strip() for l in open(TRAIN, encoding="utf-8") if l.strip()]
ids = [json.loads(l)["id"] for l in lines]
dup_id = len(ids) - len(set(ids))

texts = [json.loads(l)["text"] for l in lines]
h = [hashlib.md5(t.encode()).hexdigest() for t in texts]
dup_text = len(h) - len(set(h))

empty = sum(1 for t in texts if not t.strip())
charc = sum(len(t) for t in texts)
stages = Counter(json.loads(l)["stage"] for l in lines)

# 课程顺序：扫描阶段是否整体保持升序块
seq = [json.loads(l)["stage"] for l in lines]
blocks = []
cur = seq[0]; st = 0
for i, s in enumerate(seq):
    if s != cur:
        blocks.append((cur, i - st)); cur = s; st = i
blocks.append((cur, len(seq) - st))
mono = all(blocks[i][0] <= blocks[i+1][0] for i in range(len(blocks)-1))

# token 估算（抽样 5000 条）
import sentencepiece as spm
sp = spm.SentencePieceProcessor(); sp.Load(TOK)
tok = sum(len(sp.encode(t)) for t in texts[:5000])
avg = tok / 5000
est = int(avg * len(texts))

print(f"总条数        : {len(lines):,}")
print(f"重复ID        : {dup_id}")
print(f"完全相同文本  : {dup_text}  ({dup_text/len(lines):.1%})")
print(f"空文本        : {empty}")
print(f"总字符        : {charc:,}")
print(f"估算tokens    : {est:,}  (抽样avg={avg:.1f} tok/条)")
print(f"阶段分布      : {dict(sorted(stages.items()))}")
print(f"课程块顺序    : {[b[0] for b in blocks]}")
print(f"课程升序OK    : {mono}")
