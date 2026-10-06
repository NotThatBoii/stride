param(
  [string] $BuildDirectory = 'src-tauri/target/release',
  [string] $OutputDirectory = 'work/windows-distribution',
  [string] $Version,
  [string] $ProductName,
  [string] $NativeConfig
)

$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content -LiteralPath "$releaseRoot/package.json" | ConvertFrom-Json).version }
if (-not $ProductName) { $ProductName = (Get-Content -LiteralPath "$releaseRoot/src-tauri/tauri.conf.json" | ConvertFrom-Json).productName }
if ($NativeConfig) {
  $nativeMetadata = Get-Content -LiteralPath (Join-Path $releaseRoot $NativeConfig) | ConvertFrom-Json
  if ($nativeMetadata.productName) { $ProductName = $nativeMetadata.productName }
}
$buildPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $BuildDirectory))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $OutputDirectory))
if (Test-Path -LiteralPath $outputPath) { throw 'Distribution output already exists; use a fresh output directory.' }
$installerName = "${ProductName}_${Version}_x64-setup.exe"
$portableName = "$($ProductName.Replace(' ', '-'))_${Version}_Windows-x64-portable.zip"
$installer = Get-Item -LiteralPath (Join-Path $buildPath "bundle/nsis/$installerName")
$executable = Get-Item -LiteralPath (Join-Path $buildPath 'stride.exe')
New-Item -ItemType Directory -Path $outputPath | Out-Null
$portableStage = Join-Path ([System.IO.Path]::GetTempPath()) "stride-portable-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $portableStage | Out-Null
try {
  Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $outputPath $installerName)
  Copy-Item -LiteralPath $executable.FullName -Destination (Join-Path $portableStage 'stride.exe')
  Copy-Item -LiteralPath (Join-Path $releaseRoot 'LICENSE') -Destination (Join-Path $portableStage 'LICENSE')
  Copy-Item -LiteralPath (Join-Path $releaseRoot 'docs/PORTABLE.txt') -Destination (Join-Path $portableStage 'README.txt')
  Compress-Archive -LiteralPath @(
    (Join-Path $portableStage 'stride.exe'),
    (Join-Path $portableStage 'LICENSE'),
    (Join-Path $portableStage 'README.txt')
  ) -DestinationPath (Join-Path $outputPath $portableName)
  @($installerName, $portableName) | Sort-Object | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath (Join-Path $outputPath $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $_"
  } | Set-Content -LiteralPath (Join-Path $outputPath 'SHA256SUMS.txt') -Encoding ascii
  & "$PSScriptRoot/verify-windows-artifacts.ps1" -Directory $outputPath -Version $Version -ProductName $ProductName
  if (-not $?) { throw 'Windows distribution verification failed.' }
} finally {
  foreach ($name in @('stride.exe', 'LICENSE', 'README.txt')) {
    $stageFile = Join-Path $portableStage $name
    if (Test-Path -LiteralPath $stageFile) { Remove-Item -LiteralPath $stageFile }
  }
  Remove-Item -LiteralPath $portableStage
}
