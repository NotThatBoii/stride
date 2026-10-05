param(
  [Parameter(Mandatory = $true)] [string] $Directory,
  [Parameter(Mandatory = $true)] [string] $Version,
  [string] $ProductName = 'Stride'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$distributionPath = [System.IO.Path]::GetFullPath($Directory)
$installerName = "${ProductName}_${Version}_x64-setup.exe"
$portableName = "$($ProductName.Replace(' ', '-'))_${Version}_Windows-x64-portable.zip"
$expectedNames = @($installerName, $portableName, 'SHA256SUMS.txt') | Sort-Object
$actualFiles = @(Get-ChildItem -LiteralPath $distributionPath -Force)
if (@($actualFiles | Where-Object { $_.PSIsContainer }).Count -ne 0 -or
    (Compare-Object $expectedNames @($actualFiles.Name | Sort-Object))) {
  throw 'Distribution must contain only the expected installer, portable ZIP, and checksum file.'
}
$checksumLines = @(Get-Content -LiteralPath (Join-Path $distributionPath 'SHA256SUMS.txt'))
if ($checksumLines.Count -ne 2) { throw 'Expected exactly two download checksums.' }
$verifiedNames = @()
foreach ($line in $checksumLines) {
  if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid SHA256SUMS format.' }
  $expectedHash = $Matches[1]
  $name = $Matches[2]
  if ($name -notin @($installerName, $portableName) -or $name -in $verifiedNames) {
    throw 'Checksum contains an unexpected or repeated download filename.'
  }
  $actualHash = (Get-FileHash -LiteralPath (Join-Path $distributionPath $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "Download checksum mismatch: $name" }
  $verifiedNames += $name
}
$installerMetadata = [System.Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $distributionPath $installerName))
if ($installerMetadata.ProductVersion -ne $Version -or $installerMetadata.ProductName -ne $ProductName) {
  throw 'Installer metadata does not match the intended product and version.'
}
$archive = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $distributionPath $portableName))
$temporaryExecutable = Join-Path ([System.IO.Path]::GetTempPath()) "stride-artifact-$([guid]::NewGuid()).exe"
try {
  if (Compare-Object @('LICENSE', 'README.txt', 'stride.exe') @($archive.Entries.FullName | Sort-Object)) {
    throw 'Portable ZIP must contain only stride.exe, LICENSE, and README.txt.'
  }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('stride.exe'), $temporaryExecutable)
  $bytes = [System.IO.File]::ReadAllBytes($temporaryExecutable)
  if ($bytes.Length -lt 64 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 2) -ne 'MZ') {
    throw 'Portable executable is not a Windows PE executable.'
  }
  $peOffset = [System.BitConverter]::ToInt32($bytes, 60)
  if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length -or
      [System.BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x00004550 -or
      [System.BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x8664) {
    throw 'Portable executable must target Windows x64.'
  }
  $portableMetadata = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($temporaryExecutable)
  if ($portableMetadata.ProductVersion -ne $Version -or $portableMetadata.ProductName -ne $ProductName) {
    throw 'Portable executable metadata does not match the intended product and version.'
  }
  Write-Output "Verified Windows x64 installer, portable ZIP contents and version, and both SHA-256 checksums ($Version)."
} finally {
  $archive.Dispose()
  if (Test-Path -LiteralPath $temporaryExecutable) { Remove-Item -LiteralPath $temporaryExecutable }
}
