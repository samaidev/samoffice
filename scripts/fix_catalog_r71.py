#!/usr/bin/env python3
"""round71 发版补丁：把 samai-releases catalog.json 里 samoffice 更新到 v0.8.20。
CI mirror-catalog job 失败（与 v0.8.18/19 同因 —— HF/MS 上传环节），产物已在 GitHub
Release（setup exe 19341KB + portable zip 23366KB）。
对齐 round70 补丁流程：主文件位 = v0.8.20 installer；extras 收录 portable zip；
latest: 0.8.20。sha256/size 从 Release assets 实取。"""
import json, base64, urllib.request, os, hashlib

TOKEN = os.environ['GH_TOKEN']
REPO = 'samaidev/samoffice'
CAT_REPO = 'samaidev/samai-releases'
API = f'https://api.github.com/repos/{CAT_REPO}/contents/catalog.json'
VER = '0.8.20'

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
        assets[a['name']] = {'size': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(), 'url': url}
        print(f'[asset] {a["name"]} size={len(blob)} sha256={assets[a["name"]]["sha256"][:16]}…')

# ── 2. 取现有 catalog + sha ──
with gh_req(API + '?ref=main') as r:
    d = json.load(r)
    sha, content = d['sha'], base64.b64decode(d['content']).decode()

cat = json.loads(content)
p = next(x for x in cat['products'] if x['id'] == 'samoffice')

def entry(name, kind):
    a = assets[name]
    return {'name': name, 'kind': kind, 'size': a['size'], 'sha256': a['sha256'], 'url': {'github': a['url']}}

# 主文件位：installer；extras：portable（同版本不重复）
p['files']['win'] = entry(f'SamOffice-setup-{VER}.exe', 'installer')
p['files']['win']['extras'] = [entry(f'SamOffice-desktop-windows-x64-{VER}.zip', 'portable')]
p['latest'] = VER

# ── 3. 校验后回写 ──
f = p['files']['win']
assert f['name'] == f'SamOffice-setup-{VER}.exe', f['name']
assert f['url']['github'].endswith(f'v{VER}/SamOffice-setup-{VER}.exe'), f['url']['github']
assert p['latest'] == VER

body = json.dumps({'message': f'catalog: samoffice v{VER} latest + main-file (round71 manual)',
                   'content': base64.b64encode(json.dumps(cat, ensure_ascii=False, indent=2).encode()).decode(),
                   'branch': 'main', 'sha': sha}).encode()
with gh_req(API, 'PUT', body) as r:
    print('PUT status:', r.status)
    print('main file:', f['name'], '| extras:', [e['name'] for e in f['extras']])
