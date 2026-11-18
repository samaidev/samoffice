[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== WinINET proxy (user) ==="
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' | Select-Object ProxyEnable, ProxyServer, ProxyOverride, AutoConfigURL | Format-List | Out-String
"=== WinHTTP proxy ==="
netsh winhttp show proxy
"=== env proxy vars ==="
"HTTP_PROXY=$env:HTTP_PROXY HTTPS_PROXY=$env:HTTPS_PROXY NO_PROXY=$env:NO_PROXY"
"=== proxy-related processes ==="
Get-Process | Where-Object { $_.Name -match 'clash|v2ray|sing|mihomo|hysteria|shadowsocks|ssr|trojan|naive|leaf|tuic' } | Select-Object Id, Name, Path | Format-List | Out-String
"=== can we resolve wails.localhost? ==="
try { Resolve-DnsName wails.localhost -ErrorAction Stop | Out-String } catch { "DNS: $($_.Exception.Message)" }
"=== hosts file tail ==="
Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" | Select-Object -Last 10 | Out-String
