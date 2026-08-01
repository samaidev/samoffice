# -*- coding: utf-8 -*-
"""接入大规模真实开源中文语料，补足 100M 模型训练所需的 token 量。

为什么需要它：
  课程式合成数据（stage0~4 + general_corpus）总计约 9.8M tokens，对 100M
  模型（Chinchilla 约需 2B tokens，建议 2~5B）远远不够。纯合成路线无法跨越
  两个数量级的差距，必须引入真实开源语料。本脚本把 sources.md 中列出的高质量
  中文语料（CCI3-HQ / SkyPile-150B / 中文维基）自动下载、清洗、去重，并路由到
  data/general（通用语料，mix 占比 30%）或 data/stage3（高中学科，占比 25%）。

用法示例：
  # 1. 安装依赖（在联网机器上）
  pip install huggingface_hub pyarrow

  # 2. 拉取 CCI3-HQ 中文网页语料 -> data/general（推荐首选，质量高、纯中文）
  python ingest_corpus.py --repo BAAI/CCI3-HQ --split train \\
      --text-field text --target general --max-docs 3000000 \\
      --min-len 50 --max-len 4000 --min-cn 0.5

  # 3. 拉取 SkyPile-150B（体量极大，按需截断）
  python ingest_corpus.py --repo Skywork/SkyPile-150B --split train \\
      --text-field text --target general --max-docs 5000000

  # 4. 拉取中文维基 -> 同时供给 stage3（学科词条）与 general
  python ingest_corpus.py --repo wikimedia/wikipedia --config zh --split train \\
      --text-field text --target general --max-docs 2000000

说明：
  - 输出文件命名：data/<target>/corpus_<repo_tag>.jsonl，与现有合成数据并列，
    mix.py 会自动合并并按 ratio 截断，无需改配置。
  - 全程 MD5 去重 + 与已有数据不会冲突（mix.py 二次去重兜底）。
  - 下载量远大于所需时，--max-docs 控制上限；clean 后随机采样即可。
  - 注意许可证与评测集隔离（见 sources.md）。
"""
import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata

# 让脚本可在仓库内直接运行
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

DATA_ROOT = r"C:\laldata\data"


def normalize(text):
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text.strip()


def chinese_ratio(text):
    if not text:
        return 0.0
    cn = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return cn / len(text)


def load_stream(args):
    """按仓库类型返回逐条文本的迭代器。"""
    if args.local_dir:
        return _iter_local(args.local_dir)
    try:
        from datasets import load_dataset
    except ImportError:
        sys.stderr.write("[error] 需要 datasets 与 huggingface_hub：pip install datasets huggingface_hub pyarrow\n")
        sys.exit(1)

    name = args.repo
    cfg = args.config
    split = args.split
    print(f"[load] 流式加载 {name} (config={cfg}, split={split}) ...", flush=True)
    ds = load_dataset(name, cfg, split=split, streaming=True)
    return ds


def _iter_local(path):
    """遍历本地目录下的 .txt / .jsonl / .json，逐条产出 dict(text=...)。"""
    import glob
    files = []
    for ext in ("*.txt", "*.jsonl", "*.json"):
        files += glob.glob(os.path.join(path, "**", ext), recursive=True)
    if not files:
        sys.stderr.write(f"[error] 本地目录未找到语料文件：{path}\n")
        sys.exit(1)
    print(f"[load] 本地目录扫描到 {len(files)} 个文件", flush=True)
    for fp in files:
        if fp.endswith(".txt"):
            with open(fp, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        yield {"text": line}
        else:
            with open(fp, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        yield {"text": line}


def extract_text(ex, field):
    if field:
        v = ex.get(field)
        if isinstance(v, str):
            return v
    for k in ("text", "content", "raw", "completion", "article", "text_zh"):
        if isinstance(ex.get(k), str):
            return ex[k]
    return None


def main():
    p = argparse.ArgumentParser(description="接入真实开源中文语料到课程数据集")
    p.add_argument("--repo", default=None, help="HuggingFace 仓库名，如 BAAI/CCI3-HQ（与 --local-dir 二选一）")
    p.add_argument("--local-dir", default=None, help="本地语料目录（.txt/.jsonl/.json），无需联网即可清洗并入")
    p.add_argument("--config", default=None, help="数据集 config（如 wikipedia 的 zh）")
    p.add_argument("--split", default="train")
    p.add_argument("--text-field", default=None, help="文本字段名，缺省自动探测")
    p.add_argument("--target", choices=["general", "stage3", "stage2", "stage0",
                                        "stage1", "stage4"], default="general")
    p.add_argument("--max-docs", type=int, default=1_000_000, help="最多处理文档数")
    p.add_argument("--min-len", type=int, default=50)
    p.add_argument("--max-len", type=int, default=4000)
    p.add_argument("--min-cn", type=float, default=0.5)
    p.add_argument("--data-root", default=DATA_ROOT)
    args = p.parse_args()
    if not args.repo and not args.local_dir:
        sys.stderr.write("[error] 必须指定 --repo（联网下载）或 --local-dir（本地语料）之一\n")
        sys.exit(1)

    out_dir = os.path.join(args.data_root, args.target)
    os.makedirs(out_dir, exist_ok=True)
    tag = args.repo or ("local_" + os.path.basename(os.path.normpath(args.local_dir)))
    safe = re.sub(r"[^A-Za-z0-9]", "_", tag)
    out_path = os.path.join(out_dir, f"corpus_{safe}.jsonl")

    stage_map = {"general": 9, "stage0": 0, "stage1": 1, "stage2": 2,
                 "stage3": 3, "stage4": 4}
    stage = stage_map[args.target]
    subject = "mixed" if args.target != "general" else "corpus"

    ds = load_stream(args)
    seen = set()
    kept = 0
    total = 0
    dup = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for ex in ds:
            total += 1
            if total > args.max_docs:
                break
            if total % 50000 == 0:
                print(f"[prog] 已扫描 {total:,}，保留 {kept:,}", flush=True)
            text = extract_text(ex, args.text_field)
            if not text:
                continue
            text = normalize(text)
            if not (args.min_len <= len(text) <= args.max_len):
                continue
            if chinese_ratio(text) < args.min_cn:
                continue
            h = hashlib.md5(text.encode("utf-8")).hexdigest()
            if h in seen:
                dup += 1
                continue
            seen.add(h)
            kept += 1
            out.write(json.dumps({
                "id": f"s{stage}-corpus-{kept:08d}",
                "stage": stage,
                "subject": subject,
                "grade": "",
                "type": "corpus",
                "text": text,
            }, ensure_ascii=False) + "\n")
    print(f"[done] 扫描 {total:,}，去重丢弃 {dup:,}，保留 {kept:,} -> {out_path}")
    print(f"[done] 估算 tokens(1.6) ≈ {int(kept * (args.min_len + args.max_len) / 2 / 1.6):,}")


if __name__ == "__main__":
    main()
