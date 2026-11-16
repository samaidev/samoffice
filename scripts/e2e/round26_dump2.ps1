$ErrorActionPreference = 'Continue'
$p = Get-Process samoffice -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output 'no-process'; exit }
Write-Output ("target pid=" + $p.Id)
# 抓 session2 卡死实例转储
rundll32.exe comsvcs.dll,MiniDump $p.Id C:\samdumps\sam_hung2.dmp full
Start-Sleep 12
if (Test-Path C:\samdumps\sam_hung2.dmp) { Write-Output ("dump2=" + [math]::Round((Get-Item C:\samdumps\sam_hung2.dmp).Length/1MB,1) + "MB") } else { Write-Output 'dump2-failed' }

# 枚举该进程的窗口（在 session2 交互会话内执行才可见！）
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class W2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$targetPid = $p.Id
$found = 0
$cb = {
  param($h, $l)
  [uint32]$procId = 0
  [W2]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($procId -eq $script:targetPid) {
    $sb = New-Object System.Text.StringBuilder 256
    [W2]::GetClassName($h, $sb, 256) | Out-Null
    $st = New-Object System.Text.StringBuilder 256
    [W2]::GetWindowText($h, $st, 256) | Out-Null
    Write-Output ("win class=[" + $sb.ToString() + "] visible=" + [W2]::IsWindowVisible($h) + " text=[" + $st.ToString() + "]")
    $script:found++
  }
  return $true
}
[W2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Write-Output ("windows=" + $script:found)
