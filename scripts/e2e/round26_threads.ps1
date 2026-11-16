$ErrorActionPreference = 'Continue'
Write-Output '--- stuck process dump: wait chain via thread states ---'
$proc = Get-Process samoffice -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'no process (relaunching)'; $doc = (Get-ChildItem "$env:USERPROFILE\Desktop" -Filter '*.docx' | Select-Object -First 1).FullName; $run = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -ArgumentList @($doc) -PassThru; Start-Sleep 15; $proc = Get-Process -Id $run.Id -ErrorAction SilentlyContinue }
if ($proc) {
  Write-Output ("pid=" + $proc.Id + " cpu=" + [math]::Round($proc.CPU,1) + "s")
  Write-Output '--- wails window class search (all desktops) ---'
  Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WF {
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string t);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
  $found = 0
  $cb = {
    param($h, $l)
    [uint32]$procId = 0
    [WF]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
    if ($procId -eq $script:targetPid) {
      $script:found++
      $sb = New-Object System.Text.StringBuilder 256
      [WF]::GetWindowText($h, $sb, 256) | Out-Null
      Write-Output ("  hwnd=$h visible=" + [WF]::IsWindowVisible($h) + " text=[" + $sb.ToString() + "]")
    }
    return $true
  }
  $script:targetPid = $proc.Id
  [WF]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  Write-Output ("windows-found=" + $script:found)
  Write-Output '--- thread states ---'
  $proc.Threads | Group-Object WaitReason | ForEach-Object { Write-Output ("  " + $_.Name + " x" + $_.Count) }
  Write-Output '--- modules ok ---'
  try { $proc.Modules | Select-Object -First 3 | ForEach-Object { Write-Output ("  " + $_.ModuleName) } } catch { Write-Output ("  modules-access-failed: " + $_.Exception.Message) }
} else { Write-Output 'process not running' }
