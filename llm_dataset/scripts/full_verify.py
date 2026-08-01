#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端完整性验证：生成器 API 一致、数据池、最终训练集、分词器。

覆盖:
1. 所有生成器能否独立 import（语法/依赖正确）
2. 各阶段数据池存在且 JSON 全部合法，字段齐全
3. train.jsonl 全量 JSON 合法、零重复 ID、零重复文本
4. 比例是否≈配置、课程顺序是否升序
5. 分词器模型/词表存在且可 encode/decode
用法: python full_verify.py
"""
import importlib.util
import json
import os
import sys

ROOT = r"C:\Users\Administrator\samoffice\llm_dataset"
DATA = r"C:\laldata\data"
TRAIN = r"C:\laldata\train.jsonl"
TOK_MODEL = r"C:\laldata\tokenizer\chinese_bpe.model"
CFG = r"C:\Users\Administrator\samoffice\llm_dataset\config\laldata.yaml"

REQ_FIELDS = {"id", "stage", "subject", "grade", "type", "text"}
errors = []


def err(msg):
    errors.append(msg)
    print("  [FAIL]", msg)


def ok(msg):
    print("  [OK]  ", msg)


# ---------- 1. 生成器 import 检查 ----------
print("== 1. 生成器 import 检查 ==")
gen_dir = os.path.join(ROOT, "generators")
if gen_dir not in sys.path:
    sys.path.insert(0, gen_dir)
for name in ["common", "stage0_basics", "stage1_math", "stage1_chinese",
             "stage2_science", "stage3_senior", "stage4_calculus", "general_corpus"]:
    path = os.path.join(gen_dir, name + ".py")
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        # 检查 make_argparser / JsonlWriter 存在
        assert hasattr(mod, "make_argparser") or name == "common"
        assert hasattr(mod, "JsonlWriter") or name == "common"
        ok(f"{name} 可导入，API 完整")
    except Exception as e:
        err(f"{name} 导入失败: {e}")

# ---------- 2. 数据池检查 ----------
print("== 2. 各阶段数据池检查 ==")
stages = {
    "stage0": (0, "语言启蒙"),
    "stage1": (1, "小学"),
    "stage2": (2, "初中"),
    "stage3": (3, "高中"),
    "stage4": (4, "大学"),
    "general": (9, "通用"),
}
total_pool = 0
for st, (order, label) in stages.items():
    d = os.path.join(DATA, st)
    if not os.path.isdir(d):
        err(f"{st} 目录不存在")
        continue
    files = [f for f in os.listdir(d) if f.endswith(".jsonl")]
    if not files:
        err(f"{st} 无 .jsonl 文件")
        continue
    n = 0
    bad = 0
    for fn in files:
        for line in open(os.path.join(d, fn), encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            miss = REQ_FIELDS - set(o.keys())
            if miss:
                bad += 1
            n += 1
    total_pool += n
    if bad == 0:
        ok(f"{st}({label}): {n} 条，全部合法，字段齐全")
    else:
        err(f"{st}({label}): {n} 条，损坏/缺字段 {bad} 条")

# ---------- 3. 最终训练集检查 ----------
print("== 3. train.jsonl 检查 ==")
if not os.path.exists(TRAIN):
    err("train.jsonl 不存在")
else:
    lines = []
    bad = 0
    for line in open(TRAIN, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            lines.append(json.loads(line))
        except json.JSONDecodeError:
            bad += 1
    if bad:
        err(f"train.jsonl 损坏行: {bad}")
    else:
        ok(f"train.jsonl JSON 全部合法: {len(lines)} 条")

    ids = [o["id"] for o in lines]
    dup_id = len(ids) - len(set(ids))
    texts = [o["text"] for o in lines]
    dup_text = len(texts) - len(set(texts))
    if dup_id == 0:
        ok("ID 零重复")
    else:
        err(f"ID 重复: {dup_id}")
    if dup_text == 0:
        ok("文本零重复")
    else:
        err(f"文本重复: {dup_text}")

    # 比例 + 课程顺序
    from collections import Counter
    cnt = Counter(o["stage"] for o in lines)
    seq = [o["stage"] for o in lines]
    # 提取"阶段块"序列（忽略通用语料 stage=9 的穿插）
    blocks = []
    cur = None
    for s in seq:
        if s == 9:
            continue
        if cur is None or s != cur:
            blocks.append(s)
            cur = s
    mono = all(blocks[i] <= blocks[i + 1] for i in range(len(blocks) - 1))
    if mono:
        ok(f"课程阶段块升序(通用穿插被忽略): {blocks}")
    else:
        err(f"课程阶段块非升序: {blocks}")

    # 比例对照配置
    try:
        import yaml
        with open(CFG, encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        target = {s["order"]: s["ratio"] for s in cfg["stages"]}
        print("  比例对照 (实际 / 目标):")
        allclose = True
        for stg, ratio in target.items():
            actual = cnt.get(stg, 0) / len(lines)
            flag = "OK" if abs(actual - ratio) < 0.02 else "X"
            if flag == "X":
                allclose = False
            print(f"    stage {stg}: 实际 {actual:.1%} / 目标 {ratio:.0%} {flag}")
        if allclose:
            ok("各阶段比例符合配置(±2%)")
        else:
            err("比例偏离配置超过 2%")
    except Exception as e:
        err(f"无法读配置校验比例: {e}")

# ---------- 4. 分词器检查 ----------
print("== 4. 分词器检查 ==")
if not os.path.exists(TOK_MODEL):
    err("分词器模型不存在")
else:
    try:
        import sentencepiece as spm
        sp = spm.SentencePieceProcessor()
        sp.Load(TOK_MODEL)
        vocab = sp.vocab_size()
        sample = "小明买了一斤苹果，付了三元五角钱。二次函数 y = x^2 的导数是 2x。"
        ids = sp.encode(sample)
        dec = sp.decode(ids)
        # NFKC 归一化会把全角标点转半角，这是预期行为；只校验
        # 汉字/字母/数字核心内容是否保留（忽略全半角标点差异）。
        import re
        norm = lambda s: re.sub(r"[\s\.,，。、；;：:！!？?（）()\"'\"'《》<>]", "", s)
        if norm(dec) == norm(sample):
            ok(f"分词器 vocab={vocab}, 编码{len(ids)}tokens, 核心内容还原一致 OK")
        else:
            err(f"分词器还原不一致(核心内容): 原={sample!r} 还原={dec!r}")
    except Exception as e:
        err(f"分词器检查失败: {e}")

# ---------- 汇总 ----------
print("\n== 汇总 ==")
print(f"数据池总条数: {total_pool:,}")
print(f"train.jsonl 条数: {len(lines):,}" if 'lines' in dir() else "N/A")
if errors:
    print(f"\n发现 {len(errors)} 个问题:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
else:
    print("\n[PASS] 全部检查通过，数据集完整。")
