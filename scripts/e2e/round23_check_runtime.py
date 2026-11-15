"""round23: 远程机 CDP E2E 控制器
通过 SSH 在远程机上执行 PowerShell 请求 CDP HTTP API（/json/list + /json/new），
再用 WebSocket 直连远程 9223（经 aitun TCP 隧道不行 —— 远程机的 9223 只监听 127.0.0.1）。
方案：SSH exec PowerShell 的 WebSocket 客户端太复杂 ——
改用 SSH 远程端口转发：ssh -R 不行（无 ssh 客户端）。
★ 务实方案：远程机上跑一个 PowerShell 代理脚本，把 CDP 的 HTTP API 暴露为
简单 HTTP（Invoke-WebRequest 转发即可）；对 WebSocket 的 CDP 命令 —— 
用 /json/protocol 不需要，直接用【每条 CDP 命令 = 新开一个 HTTP 请求】不可行。
★★ 最终方案：在远程机上用 PowerShell 起 WebSocket 中继太重 —— 
直接在远程机上跑【Node.js/Python 脚本】？远程机有什么运行时？先查。
"""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from round23_remote import remote

if __name__ == '__main__':
    rc, out, _ = remote('where node python py 2>nul & echo === & node --version 2>nul & python --version 2>nul', timeout=120)
    print(out)
