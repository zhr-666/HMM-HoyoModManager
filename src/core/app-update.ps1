param([Parameter(Mandatory=$true)][string]$PlanFile,[switch]$RecoverOnly,[string]$Token='')
$ErrorActionPreference = 'Stop'
$job = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PlanFile))
$log = Join-Path $job 'update.log'
function Log([string]$text) { Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + ' ' + $text) -Encoding UTF8 }
function Exists([string]$p) { return Test-Path -LiteralPath $p }
function IsInside([string]$parent,[string]$child) {
 $a = [IO.Path]::GetFullPath($parent).TrimEnd('\')
 $b = [IO.Path]::GetFullPath($child).TrimEnd('\')
 return $b.Equals($a,[StringComparison]::OrdinalIgnoreCase) -or $b.StartsWith($a+'\',[StringComparison]::OrdinalIgnoreCase)
}
function NoLinks([string]$p) {
 if (!(Exists $p)) { return }
 $item = Get-Item -LiteralPath $p -Force
 if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Link path rejected: $p" }
 if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $p -Force | ForEach-Object { NoLinks $_.FullName } }
}
function Allowed([string]$name) {
 return $name -cmatch '^(HoYoMod\.exe|resources|locales|LICENSE\.electron\.txt|LICENSES\.chromium\.html|LICENSE-HoYoMod\.txt|THIRD-PARTY-NOTICES\.md|使用说明\.md|Windows验收说明\.md|vk_swiftshader_icd\.json)$' -or $name -match '^[a-z0-9_-]+\.(dll|pak|bin|dat)$'
}
function MoveRetry([string]$source,[string]$destination) {
 for ($attempt=0;$attempt -lt 60;$attempt++) {
  try { if ([IO.Directory]::Exists($source)) { [IO.Directory]::Move($source,$destination) } else { [IO.File]::Move($source,$destination) }; return } catch { if ($attempt -eq 59) { throw }; Start-Sleep -Milliseconds 500 }
 }
}
function Status([string]$text) { [IO.File]::WriteAllText((Join-Path $job 'status.txt'),$text) }
function Rollback {
 $reverse = @($plan.entries); [array]::Reverse($reverse)
 foreach ($entry in $reverse) {
  $target=Join-Path $plan.appDir $entry.name; $saved=Join-Path $backup $entry.name; $fresh=Join-Path $plan.staging $entry.name
  if (Exists $saved) {
   if (Exists $target) { Remove-Item -LiteralPath $target -Recurse -Force }
   MoveRetry $saved $target
  } elseif (!$entry.hadOld -and !(Exists $fresh) -and (Exists $target)) { Remove-Item -LiteralPath $target -Recurse -Force }
 }
 Status 'rolledback'
}
try {
 if ($Token) { [IO.File]::WriteAllText((Join-Path $job 'started.txt'),$Token) }
 $helperLock=[IO.File]::Open((Join-Path $job 'helper.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 Log 'Helper started; validating update files'
 $plan = Get-Content -LiteralPath $PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
 $updateHome=Join-Path $plan.appDir '.hoyo-updates'; $backup=Join-Path $job 'backup'
 if (!(IsInside $updateHome $job) -or ([IO.Path]::GetDirectoryName($job) -ne $updateHome) -or $plan.staging -ne (Join-Path $job 'staging')) { throw 'Invalid updater workspace' }
 NoLinks $job
 $protected=@((Join-Path $plan.appDir 'data'),$updateHome)+@($plan.protectedPaths)
 $seen=@{}
 foreach ($entry in $plan.entries) {
  if (!(Allowed $entry.name) -or $seen.ContainsKey($entry.name.ToLowerInvariant())) { throw 'Invalid update entry' }; $seen[$entry.name.ToLowerInvariant()]=$true
  $target=Join-Path $plan.appDir $entry.name
  foreach ($p in $protected) { if ((IsInside $target $p) -or (IsInside $p $target)) { throw 'Update overlaps protected data' } }
  NoLinks $target
 }
 if (!$seen.ContainsKey('hoyomod.exe') -or !$seen.ContainsKey('resources')) { throw 'Incomplete application update' }
 if (!(Exists $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
 Log 'Validation complete; waiting for HoYoMod to close'
 [IO.File]::WriteAllText((Join-Path $job 'ready'),'ready')
 # Wait only for this application; never terminate the game, mod loader, or other processes.
 $exe=Join-Path $plan.appDir 'HoYoMod.exe'
 $running=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe } catch { $false } })
 foreach ($process in $running) { if (!$process.WaitForExit(60000)) { throw 'HoYoMod is still running; close it and retry recovery' } }
 if ($RecoverOnly) { Rollback; Log 'Recovered prior application files' }
 else {
  Status 'updating'
  try {
   foreach ($entry in $plan.entries) {
    $target=Join-Path $plan.appDir $entry.name; $saved=Join-Path $backup $entry.name; $fresh=Join-Path $plan.staging $entry.name
    Log ('Replacing '+$entry.name)
    if ($entry.hadOld) { MoveRetry $target $saved }
    MoveRetry $fresh $target
   }
   Status 'complete'; Log 'Update completed; data directory was untouched'
  } catch { $failure=$_.Exception.Message; try { Log $failure } catch {}; Rollback; try { Log 'Restored previous application' } catch {}; Start-Process -FilePath $exe -WorkingDirectory $plan.appDir; throw }
 }
 Start-Process -FilePath $exe -WorkingDirectory $plan.appDir
} catch {
 try { Log $_.Exception.ToString() } catch {}
 Write-Error $_.Exception.Message
 exit 1
}
