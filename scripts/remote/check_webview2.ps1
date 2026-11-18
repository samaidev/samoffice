[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== WebView2 runtime installed? ==="
foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
               'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
               'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
  $v = Get-ItemProperty $k -ErrorAction SilentlyContinue
  if ($v) { "FOUND: $k -> pv=$($v.pv) name=$($v.name)" }
}
"--- msedgewebview2.exe on disk:"
Get-ChildItem "$env:ProgramFiles (x86)\Microsoft\EdgeWebView\Application" -ErrorAction SilentlyContinue | Select-Object Name | Out-String
Get-ChildItem "$env:ProgramFiles\Microsoft\EdgeWebView\Application" -ErrorAction SilentlyContinue | Select-Object Name | Out-String
"=== WebView2 user-data dir (EBWebView) ==="
foreach ($p in @("$env:LOCALAPPDATA\SamOffice\EBWebView", "$env:APPDATA\SamOffice\EBWebView", "$env:LOCALAPPDATA\Programs\SamOffice\EBWebView")) {
  if (Test-Path $p) { "EXISTS: $p (files: $((Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count))" }
}
"=== WebView2 processes now ==="
Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Id, StartTime | Format-Table | Out-String
"=== samoffice watchdog goroutine check: 09:49 ok vs 11:33+ fail — what else changed? Prefetch hint of last runs ==="
Get-ChildItem "$env:LOCALAPPDATA\SamOffice" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 15 FullName, LastWriteTime, Length | Format-Table -AutoSize | Out-String
