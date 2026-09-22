param([Parameter(Mandatory=$true)][string]$ParentWindow)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path (Join-Path $PSScriptRoot 'program-window-host.cs') -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll'
[ProgramWindowHost]::Run($ParentWindow)
