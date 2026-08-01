#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
100M 参数中文 GPT 训练配置 + 轻量训练脚本。

模型规模（约 100M）：
  - n_layer=12, n_head=12, n_embd=768, vocab=32768, context=1024
  - 参数量 ≈ 12*12*768^2*2(attn+mlp) + embeddings ≈ 110M（含词表）
  - 用 4 步梯度累积 + bf16 可在单张 8~16G 显存跑

数据：
  - 输入 C:\laldata\train.jsonl（课程式数据）
  - 需先用 scripts/train_tokenizer.py 训练分词器

运行（先装 torch）:
  pip install torch
  python config/train_100m.py --data C:\laldata\train.jsonl \
      --tokenizer C:\laldata\tokenizer\chinese_bpe.model \
      --out C:\laldata\ckpt

注：本脚本用纯 torch 实现最小 GPT，便于你直接改/接 DeepSpeed/FSDP。
生产训练建议改用 nanoGPT / litGPT，本文件给出可直接运行的基线。
"""
import argparse
import json
import math
import os
import torch
import torch.nn as nn
from torch.nn import functional as F


# ----------------------------- 模型配置 -----------------------------
class Config:
    def __init__(self, vocab_size=32768, **kw):
        self.vocab_size = vocab_size
        self.n_layer = 12
        self.n_head = 12
        self.n_embd = 768
        self.block_size = 1024
        self.dropout = 0.1
        self.bias = True
        for k, v in kw.items():
            setattr(self, k, v)


# ----------------------------- 模型定义（GPT-2 风格） -----------------------------
class CausalSelfAttention(nn.Module):
    def __init__(self, c):
        super().__init__()
        assert c.n_embd % c.n_head == 0
        self.c_attn = nn.Linear(c.n_embd, 3 * c.n_embd, bias=c.bias)
        self.c_proj = nn.Linear(c.n_embd, c.n_embd, bias=c.bias)
        self.attn_dropout = nn.Dropout(c.dropout)
        self.resid_dropout = nn.Dropout(c.dropout)
        self.n_head = c.n_head
        self.n_embd = c.n_embd
        self.register_buffer("bias", torch.tril(torch.ones(c.block_size, c.block_size)).view(1, 1, c.block_size, c.block_size))

    def forward(self, x):
        B, T, C = x.size()
        q, k, v = self.c_attn(x).split(self.n_embd, dim=2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        att = (q @ k.transpose(-2, -1)) * (1.0 / math.sqrt(k.size(-1)))
        att = att.masked_fill(self.bias[:, :, :T, :T] == 0, float("-inf"))
        att = F.softmax(att, dim=-1)
        att = self.attn_dropout(att)
        y = att @ v
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_dropout(self.c_proj(y))


class MLP(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.c_fc = nn.Linear(c.n_embd, 4 * c.n_embd, bias=c.bias)
        self.gelu = nn.GELU()
        self.c_proj = nn.Linear(4 * c.n_embd, c.n_embd, bias=c.bias)
        self.dropout = nn.Dropout(c.dropout)

    def forward(self, x):
        return self.dropout(self.c_proj(self.gelu(self.c_fc(x))))


class Block(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.ln_1 = nn.LayerNorm(c.n_embd)
        self.attn = CausalSelfAttention(c)
        self.ln_2 = nn.LayerNorm(c.n_embd)
        self.mlp = MLP(c)

    def forward(self, x):
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x


class GPT(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.c = c
        self.transformer = nn.ModuleDict(dict(
            wte=nn.Embedding(c.vocab_size, c.n_embd),
            wpe=nn.Embedding(c.block_size, c.n_embd),
            drop=nn.Dropout(c.dropout),
            h=nn.ModuleList([Block(c) for _ in range(c.n_layer)]),
            ln_f=nn.LayerNorm(c.n_embd),
        ))
        self.lm_head = nn.Linear(c.n_embd, c.vocab_size, bias=False)
        self.apply(self._init_weights)
        for pn, p in self.named_parameters():
            if pn.endswith("c_proj.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * c.n_layer))

    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_params(self):
        return sum(p.numel() for p in self.parameters())

    def forward(self, idx, targets=None):
        B, T = idx.size()
        pos = torch.arange(0, T, dtype=torch.long, device=idx.device)
        tok = self.transformer.wte(idx)
        pos_emb = self.transformer.wpe(pos)
        x = self.transformer.drop(tok + pos_emb)
        for block in self.transformer.h:
            x = block(x)
        x = self.transformer.ln_f(x)
        logits = self.lm_head(x)
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1), ignore_index=-1)
        return logits, loss


# ----------------------------- 数据加载 -----------------------------
def load_dataset(path, sp, block_size, batch_size, device, grad_accum):
    """把 jsonl 全部 tokenize 成一个长序列，按 block_size 切分。"""
    ids = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = obj.get("text", "")
            if text:
                ids.extend(sp.encode(text))
    ids = torch.tensor(ids, dtype=torch.long)
    print(f"[data] 总 token 数: {len(ids):,}")
    n_seq = len(ids) // block_size
    # 打包成 (n_seq, block_size)
    data = ids[: n_seq * block_size].view(n_seq, block_size)
    return data.to(device)


# ----------------------------- 训练主循环 -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--out", default="ckpt")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch_size", type=int, default=8)
    ap.add_argument("--grad_accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--max_steps", type=int, default=20000)
    ap.add_argument("--warmup_steps", type=int, default=500)
    args = ap.parse_args()

    import sentencepiece as spm
    sp = spm.SentencePieceProcessor(model=args.tokenizer)
    vocab_size = sp.vocab_size()

    torch.manual_seed(42)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[device] {device}")

    cfg = Config(vocab_size=vocab_size)
    model = GPT(cfg).to(device)
    print(f"[model] 参数量: {model.num_params()/1e6:.1f}M")

    data = load_dataset(args.data, sp, cfg.block_size, args.batch_size, device, args.grad_accum)
    n_seq = data.size(0)

    optim = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.1)
    os.makedirs(args.out, exist_ok=True)

    step = 0
    model.train()
    for epoch in range(args.epochs):
        perm = torch.randperm(n_seq)
        for i in range(0, n_seq, args.batch_size):
            if step >= args.max_steps:
                break
            idx = perm[i: i + args.batch_size]
            x = data[idx]
            y = torch.roll(x, -1, dims=1)
            y[:, -1] = -1  # 末位不预测
            # 学习率 warmup + 余弦退火
            if step < args.warmup_steps:
                lr = args.lr * (step + 1) / args.warmup_steps
            else:
                progress = (step - args.warmup_steps) / max(1, args.max_steps - args.warmup_steps)
                lr = args.lr * 0.5 * (1 + math.cos(math.pi * min(1, progress)))
            for g in optim.param_groups:
                g["lr"] = lr

            logits, loss = model(x, y)
            loss = loss / args.grad_accum
            loss.backward()
            if (i // args.batch_size + 1) % args.grad_accum == 0:
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optim.step()
                optim.zero_grad()
                step += 1
                if step % 50 == 0:
                    print(f"[train] step {step} epoch {epoch} loss {loss.item()*args.grad_accum:.4f} lr {lr:.2e}")
                if step % 500 == 0:
                    torch.save(model.state_dict(), os.path.join(args.out, f"ckpt_{step}.pt"))
        if step >= args.max_steps:
            break

    torch.save(model.state_dict(), os.path.join(args.out, "ckpt_final.pt"))
    print(f"[done] 模型已保存 -> {args.out}/ckpt_final.pt")


if __name__ == "__main__":
    main()
