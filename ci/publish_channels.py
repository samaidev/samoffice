#!/usr/bin/env python3
"""SamAI 共享发布器：一次构建 → 三渠道（GitHub Release 之外 + HF + MS）+ catalog 重写。

GitHub Actions 与 wei 构建机共用同一份脚本，保证公开仓 / 私密仓发布行为一致。
依赖：pip install huggingface_hub modelscope（仅上传渠道用到，catalog 回写只用标准库）

环境变量：
    HF_TOKEN   对应产品分摊到的 HF 账号写 token（hf_*）
    MS_TOKEN   对应魔搭账号写 token（ms-*）
    GH_TOKEN   用于把 catalog.json 回写 samaidev/samai-releases（GitHub Contents API）

槽位规则（与 catalog.json channels.*.accounts 一一对应，同一产品恒落同一账号）：
    MS: sha256(id) % 5  -> liuwei168 / ctz168 / luoyunlan168 / zhuqingshui168 / zhubaohua168
    HF: sha256(id) % 3  -> tchbcn / gasschina / mojoz
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path


def slot_index(product_id: str, n_accounts: int) -> int:
    return int(hashlib.sha256(product_id.encode()).hexdigest(), 16) % n_accounts


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- 上传渠道

def upload_hf(file_path: Path, path_in_repo: str, repo: str) -> str:
    """上传到 HF dataset 仓，返回 resolve 直链。repo 形如 <account>/<product>-releases。"""
    from huggingface_hub import HfApi

    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(repo_id=repo, repo_type="dataset", exist_ok=True, private=False)
    api.upload_file(
        path_or_fileobj=str(file_path),
        path_in_repo=path_in_repo,
        repo_id=repo,
        repo_type="dataset",
        commit_message=f"release {path_in_repo}",
    )
    return f"https://huggingface.co/datasets/{repo}/resolve/main/{path_in_repo}"


def upload_ms(file_path: Path, path_in_repo: str, repo: str) -> str:
    """上传到 ModelScope model 仓（tag 作为 revision），返回 /repo?FilePath= 直链。"""
    from modelscope.hub.api import HubApi

    api = HubApi()
    api.login(os.environ["MS_TOKEN"])
    try:
        api.create_model(model_id=repo, visibility=5)  # 5 = 公开
    except Exception:
        pass  # 已存在则忽略
    api.upload_file(
        path_or_fileobj=str(file_path),
        path_in_repo=path_in_repo,
        repo_id=repo,
        repo_type="model",
    )
    # 用 tag 锁定 revision，避免 master 被后续版本覆盖后 URL 漂移
    try:
        api.create_model_tag(model_id=repo, tag_name=path_in_repo.split("/")[0])
    except Exception:
        pass
    return (
        f"https://modelscope.cn/api/v1/models/{repo}/repo"
        f"?Revision={path_in_repo.split('/')[0]}&FilePath={path_in_repo}"
    )


# ---------------------------------------------------------------- catalog

def detect_platform(name: str, default: str) -> str | None:
    """从产物文件名识别平台（三平台产物混在同一 dist 时用）。
    同时识别下划线（openbox_windows）与连字符（SamCDP-windows）两种命名。"""
    low = name.lower()
    if low.endswith(".apk"):
        return "android"
    if (low.endswith(".pkg") or "_macos" in low or "_mac" in low
            or "-macos" in low or "-darwin" in low or "-osx" in low):
        return "mac"
    if "_linux" in low or "-linux" in low:
        return "linux"
    if (low.endswith(".exe") or "_windows" in low or "_win" in low
            or "-windows" in low or "-win-" in low or "-win64" in low or "-x64" in low):
        return "win"
    return default


def detect_kind(name: str) -> str:
    """installer = 双击安装（setup.exe / .pkg）；portable = 解包即用。"""
    low = name.lower()
    if low.endswith("setup.exe") or low.endswith(".pkg"):
        return "installer"
    return "portable"


def update_catalog(catalog_path: Path, product: str, version: str, platform: str,
                   local: Path, hf_url: str, ms_url: str,
                   gh_release_repo: str | None = None) -> None:
    """把产物写入 catalog：首个 installer 条目为主文件，其余进 extras。"""
    cat = json.loads(catalog_path.read_text(encoding="utf-8"))
    gh_org = cat["channels"]["github"]["org"]
    repo_full = gh_release_repo or f"{gh_org}/{product}"
    v = version.lstrip("v")
    tag = version if version.startswith("v") else f"v{version}"
    urls = {
        "github": f"https://github.com/{repo_full}/releases/download/{tag}/{local.name}",
        "hf": hf_url,
        "ms": ms_url,
    }
    entry = {
        "name": local.name,
        "kind": detect_kind(local.name),
        "sha256": sha256_of(local),
        "size": local.stat().st_size,
        "url": urls,
    }
    for p in cat["products"]:
        if p["id"] == product:
            p["latest"] = v
            files = p.setdefault("files", {})
            cur = files.get(platform)
            if cur is None:
                files[platform] = entry
            elif entry["kind"] == "installer" and cur.get("kind") != "installer":
                # 主文件位让给安装包，原主文件降级为 extras
                entry.setdefault("extras", []).insert(0, cur)
                files[platform] = entry
            else:
                cur.setdefault("extras", []).append(entry)
            break
    else:
        raise KeyError(f"product {product} not in catalog")
    import datetime
    cat["updated"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    catalog_path.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")


def push_catalog_to_github(catalog_path: Path, repo: str, branch: str = "main") -> None:
    """经 GitHub Contents API 回写 catalog.json（无需 git/gh CLI，wei 与 Actions 通用）。"""
    token = os.environ["GH_TOKEN"]
    path = "catalog.json"
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {"Authorization": f"Bearer {token}",
               "Accept": "application/vnd.github+json", "User-Agent": "samai-ci"}
    # 取现有文件 sha（首次为空则跳过）
    req = urllib.request.Request(f"{api}?ref={branch}", headers=headers)
    file_sha = None
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            file_sha = json.load(r).get("sha")
    except Exception:
        pass
    content = base64.b64encode(catalog_path.read_bytes()).decode()
    body = {"message": f"catalog: auto update from publish_channels",
            "content": content, "branch": branch}
    if file_sha:
        body["sha"] = file_sha
    req = urllib.request.Request(api, method="PUT", headers=headers,
                                 data=json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"[catalog] pushed to {repo} ({r.status})")


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True, help="产物目录")
    ap.add_argument("--product", required=True)
    ap.add_argument("--version", required=True, help="tag 形式 vX.Y.Z 或纯版本号")
    ap.add_argument("--repo", required=True, help="源码仓 owner/name")
    ap.add_argument("--gh-release-repo", default=None,
                    help="GitHub Release 所在仓（*_r 产物仓模式；默认 owner/<product>）")
    ap.add_argument("--catalog", default="catalog.json")
    ap.add_argument("--glob", default=None,
                    help="产物文件名过滤（默认 {product}_<v>*，命名不同的产品如 OpenBox-* 用它指定）")
    ap.add_argument("--platform", default=os.environ.get("SAMAI_PLATFORM", "win"))
    ap.add_argument("--account-hf", default=None, help="覆盖 HF 账号名（默认按 slot 分摊）")
    ap.add_argument("--account-ms", default=None, help="覆盖魔搭账号名")
    ap.add_argument("--skip-catalog-push", action="store_true",
                    help="只改本地 catalog.json，不回写 GitHub（wei 无外网令牌时用）")
    args = ap.parse_args()

    dist = Path(args.dist)
    catalog_path = Path(args.catalog)
    cat0 = json.loads(catalog_path.read_text(encoding="utf-8"))
    ms_accounts = cat0["channels"]["ms"]["accounts"]
    hf_accounts = cat0["channels"]["hf"]["accounts"]
    ms_account = args.account_ms or ms_accounts[slot_index(args.product, len(ms_accounts))]
    hf_account = args.account_hf or hf_accounts[slot_index(args.product, len(hf_accounts))]
    print(f"[publish] slot: ms={ms_account} hf={hf_account}")

    v = args.version.lstrip("v")
    pattern = args.glob or f"{args.product}_{v}*"
    low_prefix = pattern.replace("*", "").lower()
    targets = sorted(p for p in dist.iterdir() if p.name.lower().startswith(low_prefix))
    if not targets:
        print(f"[publish] no artifacts matching {pattern} in {dist}")
        return 1

    hf_repo = f"{hf_account}/{args.product}-releases"
    ms_repo = f"{ms_account}/{args.product}-releases"
    version_dir = f"v{v}"

    for f in targets:
        if f.name.endswith(".sha256"):
            continue  # 校验文件随产物一起上传，但不写入 catalog
        rel = f"{version_dir}/{f.name}"
        hf_url = ms_url = ""
        if os.environ.get("HF_TOKEN"):
            hf_url = upload_hf(f, rel, hf_repo)
            print(f"[publish] HF ok: {hf_url}")
        if os.environ.get("MS_TOKEN"):
            ms_url = upload_ms(f, rel, ms_repo)
            print(f"[publish] MS ok: {ms_url}")
        plat = detect_platform(f.name, args.platform)
        if plat:
            update_catalog(catalog_path, args.product, args.version,
                           plat, f, hf_url, ms_url, args.gh_release_repo)
            print(f"[publish] catalog updated: {args.product}/{plat} <- {f.name}")

    # catalog.json 本身也推到本产品的 MS/HF 仓，保证任一渠道可引导
    if os.environ.get("HF_TOKEN"):
        upload_hf(catalog_path, "catalog.json", hf_repo)
    if os.environ.get("MS_TOKEN"):
        upload_ms(catalog_path, "catalog.json", ms_repo)

    # 回写统一 catalog 仓（GitHub Contents API）
    catalog_repo = cat0["channels"]["github"]["catalog_repo"]
    if not args.skip_catalog_push and os.environ.get("GH_TOKEN") and catalog_repo:
        push_catalog_to_github(catalog_path, catalog_repo)

    # 固定基础设施仓（catalog 三渠道副本）：HF=tchbcn / MS=luoyunlan168
    infra_hf = cat0["channels"]["hf"].get("catalog_repo")
    infra_ms = cat0["channels"]["ms"].get("catalog_repo")
    if not args.skip_catalog_push and os.environ.get("HF_TOKEN") and infra_hf:
        upload_hf(catalog_path, "catalog.json", infra_hf)
        print(f"[publish] catalog -> HF {infra_hf}")
    if not args.skip_catalog_push and os.environ.get("MS_TOKEN") and infra_ms:
        upload_ms(catalog_path, "catalog.json", infra_ms)
        print(f"[publish] catalog -> MS {infra_ms}")

    print("[publish] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
