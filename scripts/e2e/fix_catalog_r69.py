#!/usr/bin/env python3
"""round69 发版补丁：修正 samai-releases catalog.json 里 samoffice 的 win 主文件位。
publish_channels.py 的『主文件位让给安装包』逻辑只对【旧主文件非 installer】的情况换位，
连续版本的主文件永远停在 0.7.19（首个 installer），后续新版全被塞进 extras。
本脚本：主文件位 = 当前 latest 版本的 installer，extras 去掉同版本的两个文件（避免重复）。"""
import json, base64, urllib.request, os, sys

TOKEN = os.environ['GH_TOKEN']
REPO = 'samaidev/samai-releases'
API = f'https://api.github.com/repos/{REPO}/contents/catalog.json'

def gh_req(url, method='GET', data=None):
    req = urllib.request.Request(url, method=method, headers={
        'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json',
        'User-Agent': 'samai-ci'}, data=data)
    return urllib.request.urlopen(req, timeout=60)

# 取现有 catalog + sha
with gh_req(API + '?ref=main') as r:
    d = json.load(r)
    sha, content = d['sha'], base64.b64decode(d['content']).decode()

cat = json.loads(content)
p = next(x for x in cat['products'] if x['id'] == 'samoffice')
latest = p['latest']  # 0.8.18
f = p['files']['win']

# 1) 主文件位：从 extras 里取【当前 latest 的 installer】顶上来
extras = f.get('extras', [])
installer = next((e for e in extras if e['name'] == f'SamOffice-setup-{latest}.exe'), None)
portable = next((e for e in extras if e['name'] == f'SamOffice-desktop-windows-x64-{latest}.zip'), None)
if installer:
    old_main = dict(f, name=f['name'])  # 旧主文件降级
    new_f = dict(installer)
    new_f.setdefault('extras', [])
    if not any(e['name'] == old_main['name'] for e in new_f['extras']):
        new_f['extras'].append(old_main)
    f.clear(); f.update(new_f)
    p['files']['win'] = f
# 2) extras 去掉与主文件同版本的重复项
if portable and installer:
    p['files']['win']['extras'] = [e for e in p['files']['win'].get('extras', [])
                                   if e['name'] not in (installer['name'], portable['name'])]

# 校验
f = p['files']['win']
assert f['name'] == f'SamOffice-setup-{latest}.exe', f['name']
assert f['url']['github'].endswith(f'v{latest}/SamOffice-setup-{latest}.exe'), f['url']['github']
assert not any(e['name'] == f'SamOffice-setup-{latest}.exe' for e in f.get('extras', []))

body = json.dumps({'message': f'catalog: samoffice latest {latest} main-file fix (round69)',
                   'content': base64.b64encode(json.dumps(cat, ensure_ascii=False, indent=2).encode()).decode(),
                   'branch': 'main', 'sha': sha}).encode()
with gh_req(API, 'PUT', body) as r:
    print('PUT status:', r.status)
    print('main file:', f['name'])
    print('extras 尾部:', [e['name'] for e in f.get('extras', [])][-4:])
