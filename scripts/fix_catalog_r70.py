#!/usr/bin/env python3
"""round70 发版补丁：把 samai-releases catalog.json 里 samoffice 更新到 v0.8.19。
CI 的 mirror-catalog job 失败（与 v0.8.18 同因 —— HF/MS 上传环节），产物本身已
在 GitHub Release 上（setup exe 19340KB + portable zip 23359KB）。
本脚本（对齐 round69 手动补丁流程）：
  1) 主文件位 = v0.8.19 installer（github 直链；hf/ms 链接按既有版本条目模式补）
  2) extras 收录 portable zip（同版本）
  3) latest: 0.8.19
产物 sha256/size 从 GitHub Release assets API 实取，不手填。"""
import json, base64, urllib.request, os, sys, hashlib

TOKEN = os.environ['GH_TOKEN']
REPO = 'samaidev/samoffice'
CAT_REPO = 'samaidev/samai-releases'
API = f'https://api.github.com/repos/{CAT_REPO}/contents/catalog.json'
VER = '0.8.19'

def gh_req(url, method='GET', data=None):
    req = urllib.request.Request(url, method=method, headers={
        'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json',
        'User-Agent': 'samai-ci'}, data=data)
    return urllib.request.urlopen(req, timeout=60)

# ── 1. Release assets 实取（下载→算 sha256→拿 size）──
assets = {}
with gh_req(f'https://api.github.com/repos/{REPO}/releases/tags/v{VER}') as r:
    rel = json.load(r)
    for a in rel['assets']:
        url = a['browser_download_url']
        with urllib.request.urlopen(urllib.request.Request(url, headers={
            'Authorization': f'Bearer {TOKEN}', 'User-Agent': 'samai-ci'}), timeout=300) as resp:
            blob = resp.read()
        assets[a['name']] = {
            'size': len(blob),
            'sha256': hashlib.sha256(blob).hexdigest(),
            'url': url,
        }
        print(f'[asset] {a["name"]} size={len(blob)} sha256={assets[a["name"]]["sha256"][:16]}…')

installer = assets[f'SamOffice-setup-{VER}.exe']
portable = assets[f'SamOffice-desktop-windows-x64-{VER}.zip']

# ── 2. 取现有 catalog + sha ──
with gh_req(API + '?ref=main') as r:
    d = json.load(r)
    sha, content = d['sha'], base64.b64decode(d['content']).decode()

cat = json.loads(content)
p = next(x for x in cat['products'] if x['id'] == 'samoffice')

# ── 3. 从既有 0.8.18 条目复制 hf/ms url 模板（镜像未上传，沿用最近版本镜像路径
#       会 404 —— 但 CI 失败本就没传镜像；url 只保留 github，避免死链）──
old_win = p['files']['win']
def entry(name):
    a = assets[name]
    return {'name': name,
            'size': a['size'],
            'sha256': a['sha256'],
            'url': {'github': a['url']}}

# 主文件位：installer；extras：portable（同版本不重复）
p['files']['win'] = entry(f'SamOffice-setup-{VER}.exe')
p['files']['win']['kind'] = 'installer'
p['files']['win']['extras'] = [dict(entry(f'SamOffice-desktop-windows-x64-{VER}.zip'), kind='portable')]
p['latest'] = VER

# ── 4. 校验后回写 ──
f = p['files']['win']
assert f['name'] == f'SamOffice-setup-{VER}.exe', f['name']
assert f['url']['github'].endswith(f'v{VER}/SamOffice-setup-{VER}.exe'), f['url']['github']
assert p['latest'] == VER

body = json.dumps({'message': f'catalog: samoffice v{VER} latest + main-file (round70 manual)',
                   'content': base64.b64encode(json.dumps(cat, ensure_ascii=False, indent=2).encode()).decode(),
                   'branch': 'main', 'sha': sha}).encode()
with gh_req(API, 'PUT', body) as r:
    print('PUT status:', r.status)
    print('main file:', f['name'], '| extras:', [e['name'] for e in f['extras']])
