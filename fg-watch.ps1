Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FGWatch {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
while ($true) {
  try {
    $h = [FGWatch]::GetForegroundWindow()
    $r = New-Object FGWatch+RECT
    [void][FGWatch]::GetWindowRect($h, [ref]$r)
    $procId = 0
    [void][FGWatch]::GetWindowThreadProcessId($h, [ref]$procId)
    $name = ''
    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    $style = [FGWatch]::GetWindowLong($h, -16)
    $w = $r.Right - $r.Left
    $hh = $r.Bottom - $r.Top
    Write-Output "$name|$($r.Left)|$($r.Top)|$w|$hh|$style"
  } catch {}
  Start-Sleep -Milliseconds 800
}
