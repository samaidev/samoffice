[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== download v0.7.17 and test-run ==="
$tmp = "$env:TEMP\sam17"
New-Item -ItemType Directory -Force $tmp | Out-Null
if (-not (Test-Path "$tmp\sam17.exe")) {
  Invoke-WebRequest 'https://github.com/samaidev/samoffice/releases/download/v0.7.17/SamOffice-desktop-windows-x64-0.7.17.zip' -OutFile "$tmp\sam17.zip" -UseBasicParsing
  Expand-Archive "$tmp\sam17.zip" -DestinationPath $tmp -Force
}
$exe17 = Get-ChildItem $tmp -Recurse -Filter samoffice.exe | Select-Object -First 1 -ExpandProperty FullName
"v0.7.17 exe: $exe17 (size: $((Get-Item $exe17).Length))"
$p = Start-Process $exe17 -PassThru
"launched pid=$($p.Id), wait 35s"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  "V0.7.17 ALIVE ON THIS MACHINE"
  $alive | Select-Object Id, MainWindowHandle | Format-List | Out-String
  Stop-Process -Id $p.Id -Force
} else { "v0.7.17 DIES TOO — environment drifted since 09:49" }
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
"=== what changed on system since 09:49: recent installs/updates ==="
Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddHours(-6)} -MaxEvents 300 -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -in @('Microsoft-Windows-WindowsUpdateClient','MsiInstaller','Windows Error Reporting') -or $_.Message -like '*WebView*' -or $_.Message -like '*Edge*' } |
  Select-Object -First 10 TimeCreated, Id, @{n='M';e={$_.Message.Substring(0,[Math]::Min(120,$_.Message.Length))}} | Format-List | Out-String
