$ErrorActionPreference = 'Continue'
Write-Output '--- process state ---'
Get-Process samoffice -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("pid=" + $_.Id + " hwnd=" + $_.MainWindowHandle + " responding=" + $_.Responding + " cpu=" + [math]::Round($_.CPU,1) + "s threads=" + $_.Threads.Count)
}
Write-Output '--- window enum (all samoffice) ---'
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct RECT { public int L, T, R, B; }
}
"@
Add-Type -TypeDefinition $sig
$targets = @(Get-Process samoffice -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$cb = {
  param($h, $l)
  [uint32]$procId = 0
  [WEnum]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($targets -contains [int]$procId) {
    $sb = New-Object System.Text.StringBuilder 256
    [WEnum]::GetClassName($h, $sb, 256) | Out-Null
    $r = New-Object WEnum+RECT
    [WEnum]::GetWindowRect($h, [ref]$r) | Out-Null
    Write-Output ("win class=" + $sb.ToString() + " visible=" + [WEnum]::IsWindowVisible($h) + " rect=" + $r.L + "," + $r.T + "," + $r.R + "," + $r.B)
  }
  return $true
}
[WEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Write-Output '--- webview2 cmdlines (browser args) ---'
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match 'samoffice' } | Select-Object -First 2 | ForEach-Object {
  $cl = $_.CommandLine
  if ($cl.Length -gt 220) { $cl = $cl.Substring(0, 220) + '...' }
  Write-Output ("wv pid=" + $_.ProcessId + " " + $cl)
}
Write-Output '--- user session ---'
qwinsta 2>$null | Select-String -Pattern 'rdp|console' | ForEach-Object { Write-Object $_.Line }
