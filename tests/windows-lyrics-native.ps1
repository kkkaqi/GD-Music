param([ValidateSet('Close', 'Unlock')][string]$Mode = 'Unlock')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GDLyricsMouseCheck {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
 public static IntPtr Find(uint target, string title) {
  IntPtr found = IntPtr.Zero;
  EnumWindows((h,p)=>{ uint pid; GetWindowThreadProcessId(h,out pid); if(pid==target){var text=new StringBuilder(512);GetWindowText(h,text,512); if(text.ToString()==title){found=h;return false;}}return true;},IntPtr.Zero);
  return found;
 }
}
'@
$projectForCheck = Split-Path $PSScriptRoot -Parent
$musicAppInfo = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object {
  $_.CommandLine -like "*$projectForCheck*" -and $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -notlike '*electron-smoke.cjs*'
} | Select-Object -First 1
if (-not $musicAppInfo) { throw 'Music app is not running' }
if ($Mode -eq 'Close') {
  $mainWindow = [GDLyricsMouseCheck]::Find($musicAppInfo.ProcessId, 'GD Music')
  if ($mainWindow -eq [IntPtr]::Zero) { throw 'Main window not found' }
  $musicProcess = Get-Process -Id $musicAppInfo.ProcessId
  [GDLyricsMouseCheck]::PostMessage($mainWindow, 16, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  if (-not $musicProcess.WaitForExit(4000)) { throw 'Music app did not close normally' }
  exit 0
}
$lyricsWindow = [GDLyricsMouseCheck]::Find($musicAppInfo.ProcessId, 'GD Music 桌面歌词')
if ($lyricsWindow -eq [IntPtr]::Zero) { throw 'Lyrics window not found' }
$previousDpiContext = [GDLyricsMouseCheck]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$oldCursor = [GDLyricsMouseCheck+Point]::new()
[GDLyricsMouseCheck]::GetCursorPos([ref]$oldCursor) | Out-Null
try {
  $rect = [GDLyricsMouseCheck+Rect]::new()
  [GDLyricsMouseCheck]::GetWindowRect($lyricsWindow, [ref]$rect) | Out-Null
  $scale = [GDLyricsMouseCheck]::GetDpiForWindow($lyricsWindow) / 96.0
  $point = [GDLyricsMouseCheck+Point]::new()
  $lockRightInset = if (($rect.Right - $rect.Left) / $scale -le 640) { 68 } else { 85 }
  $point.X = [int]($rect.Right - $lockRightInset * $scale)
  $point.Y = [int]($rect.Top + 32 * $scale)
  [GDLyricsMouseCheck]::SetCursorPos($point.X, $point.Y) | Out-Null
  [System.Threading.Thread]::Sleep(250)
  $hitWindow = [GDLyricsMouseCheck]::GetAncestor([GDLyricsMouseCheck]::WindowFromPoint($point), 2)
  if ($hitWindow -ne $lyricsWindow) {
    [pscustomobject]@{ Rect = $rect; Scale = $scale; Point = $point; Expected = $lyricsWindow.ToInt64(); Hit = $hitWindow.ToInt64(); Saved = (Get-Content -LiteralPath (Join-Path $env:APPDATA 'GD Music/desktop-lyrics.json') -Raw | ConvertFrom-Json).bounds } | ConvertTo-Json -Compress
    throw 'Unlock button did not receive hit-test; no click sent'
  }
  [GDLyricsMouseCheck]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [System.Threading.Thread]::Sleep(60)
  [GDLyricsMouseCheck]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  [System.Threading.Thread]::Sleep(400)
  $configFile = Join-Path $env:APPDATA 'GD Music/desktop-lyrics.json'
  $preferences = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
  [pscustomobject]@{ NativeUnlockClick = (-not $preferences.locked); OverlayStillVisible = $preferences.visible } | ConvertTo-Json -Compress
  if ($preferences.locked) { throw 'Native click did not unlock lyrics' }
} finally {
  [GDLyricsMouseCheck]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null
  [GDLyricsMouseCheck]::SetThreadDpiAwarenessContext($previousDpiContext) | Out-Null
}
