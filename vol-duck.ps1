param([string]$Dir = 'down')
$vk = if ($Dir -eq 'down') { 0xAE } else { 0xAF }
$sig = '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);'
Add-Type -MemberDefinition $sig -Name K -Namespace W
1..10 | ForEach-Object {
  [W.K]::keybd_event($vk, 0, 0, 0)
  [W.K]::keybd_event($vk, 0, 2, 0)
  Start-Sleep -Milliseconds 40
}
