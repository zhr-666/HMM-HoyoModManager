param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'program-window-fixture.cs'
Add-Type -Path $source -ReferencedAssemblies 'System.dll','System.Windows.Forms.dll','System.Drawing.dll' -OutputAssembly (Join-Path $Destination 'Parent.exe') -OutputType WindowsApplication
Copy-Item (Join-Path $Destination 'Parent.exe') (Join-Path $Destination 'First.exe')
Copy-Item (Join-Path $Destination 'Parent.exe') (Join-Path $Destination 'Second.exe')
