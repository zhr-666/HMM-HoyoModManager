$ErrorActionPreference = 'Stop'
$game = Get-Process -Name 'YuanShen','GenshinImpact' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $game) { Write-Output 'NOT_RUNNING'; exit 0 }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HoyoWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
$handle = $game.MainWindowHandle
[HoyoWindow]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 250
if ([HoyoWindow]::GetForegroundWindow() -ne $handle) { Write-Output 'MANUAL'; exit 0 }
[HoyoWindow]::keybd_event(0x79, 0, 0, [UIntPtr]::Zero)
[HoyoWindow]::keybd_event(0x79, 0, 2, [UIntPtr]::Zero)
Write-Output 'SENT'
