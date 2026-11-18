[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== launch v0.7.19 and watch child process tree ==="
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"pid=$($p.Id)"
Start-Sleep -Seconds 12
"--- child processes of samoffice:"
Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | Select-Object ProcessId, Name, CommandLine | Format-List | Out-String
"--- all msedgewebview2 started in last minute:"
Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-1) } | Select-Object Id, StartTime | Out-String
"--- WebView2 event log:"
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-3)} -MaxEvents 50 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -like '*WebView*' -or $_.Message -like '*edge*' -or $_.Message -like '*samoffice*' } |
  Select-Object -First 6 TimeCreated, Id, ProviderName, @{n='M';e={$_.Message.Substring(0,[Math]::Min(200,$_.Message.Length))}} | Format-List | Out-String
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
