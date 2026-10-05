param(
  [Parameter(Mandatory = $true)] [string] $Directory,
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
$installerName = "${ProductName}_${Version}_x64-setup.exe"
$portableName = "$($ProductName.Replace(' ', '-'))_${Version}_Windows-x64-portable.zip"
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) "stride-artifact-tests-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $fixture | Out-Null

function Restore-Fixture {
  foreach ($name in @($installerName, $portableName, 'SHA256SUMS.txt')) {
    Copy-Item -LiteralPath (Join-Path $Directory $name) -Destination (Join-Path $fixture $name) -Force
  }
}

function Expect-ArtifactFailure([string] $message) {
  try {
    & "$PSScriptRoot/verify-windows-artifacts.ps1" -Directory $fixture -Version $Version -ProductName $ProductName
  } catch {
    if ($_.Exception.Message -match $message) { return }
    throw
  }
  throw 'Artifact verification accepted an intentionally invalid download.'
}

try {
  Restore-Fixture
  & "$PSScriptRoot/verify-windows-artifacts.ps1" -Directory $fixture -Version $Version -ProductName $ProductName

  [System.IO.File]::AppendAllText((Join-Path $fixture $installerName), 'tampered-download')
  Expect-ArtifactFailure 'checksum mismatch'

  Restore-Fixture
  $archive = [System.IO.Compression.ZipFile]::Open((Join-Path $fixture $portableName), [System.IO.Compression.ZipArchiveMode]::Update)
  try { $null = $archive.CreateEntry('debug.pdb') } finally { $archive.Dispose() }
  @($installerName, $portableName) | Sort-Object | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath (Join-Path $fixture $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $_"
  } | Set-Content -LiteralPath (Join-Path $fixture 'SHA256SUMS.txt') -Encoding ascii
  Expect-ArtifactFailure 'Portable ZIP must contain only'

  Restore-Fixture
  Remove-Item -LiteralPath (Join-Path $fixture $portableName)
  Expect-ArtifactFailure 'Distribution must contain only'
  Write-Output 'Windows artifact regression checks passed (4 cases: valid downloads, altered bytes, extra debug artifact, missing download).'
} finally {
  foreach ($name in @($installerName, $portableName, 'SHA256SUMS.txt')) {
    $fixtureFile = Join-Path $fixture $name
    if (Test-Path -LiteralPath $fixtureFile) { Remove-Item -LiteralPath $fixtureFile }
  }
  Remove-Item -LiteralPath $fixture
}
