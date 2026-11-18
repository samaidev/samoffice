[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== samime's webview2 args (it works!) ==="
$ime = Get-Process samime -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ime) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ime.Id)" | Select-Object ProcessId, Name | Out-String
  $wv = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*samime*" } | Select-Object -First 1
  if ($wv) { "samime webview cmdline:"; $wv.CommandLine }
} 
"=== samime's user-data-dir on disk:"
Get-ChildItem "$env:APPDATA\samime*" -Directory -ErrorAction SilentlyContinue | Select-Object FullName | Out-String
Get-ChildItem "$env:LOCALAPPDATA\samime*" -Directory -ErrorAction SilentlyContinue | Select-Object FullName | Out-String
"=== EdgeWebView version folders (multiple runtimes?):"
Get-ChildItem "$env:ProgramFiles (x86)\Microsoft\EdgeWebView\Application" | Select-Object Name | Out-String
"=== pending Windows updates state ==="
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 HotFixID, InstalledOn | Out-String
