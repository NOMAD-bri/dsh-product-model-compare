<#
.SYNOPSIS
  Build a distributable zip of the plugin.

.DESCRIPTION
  Copies the files listed under "files" in package.json (plus README, LICENSE,
  .gitignore, UI-ARCHITECTURE.md) into a staging folder named <name>-<version>,
  then compresses it into ./dist. The legacy/ folder is never packaged.
  On macOS/Linux use:  zip -r dist/<name>-<version>.zip <listed files>

.EXAMPLE
  pwsh -File scripts/pack.ps1
#>
[CmdletBinding()]
param([string]$OutDir)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$name = $manifest.name
$version = $manifest.version
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('pack-' + $name + '-' + [guid]::NewGuid().ToString('N'))
$target = Join-Path $staging ($name + '-' + $version)
New-Item -ItemType Directory -Path $target -Force | Out-Null

function Get-Relative([string]$basePath, [string]$fullPath) {
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $baseFull = [System.IO.Path]::GetFullPath($basePath).TrimEnd([char]'\', [char]'/') + $separator
  $pathFull = [System.IO.Path]::GetFullPath($fullPath)
  if ($pathFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $pathFull.Substring($baseFull.Length)
  }
  return [System.IO.Path]::GetFileName($fullPath)
}

function Copy-File([string]$source, [string]$relative) {
  $destination = Join-Path $target $relative
  $parent = Split-Path $destination -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

$patterns = @('package.json') + @($manifest.files) + @('README.md', 'LICENSE', '.gitignore', 'UI-ARCHITECTURE.md')
foreach ($pattern in $patterns) {
  if ($pattern.Contains('/**')) {
    $base = Join-Path $root $pattern.Substring(0, $pattern.IndexOf('/**'))
    if (-not (Test-Path -LiteralPath $base)) { continue }
    foreach ($file in (Get-ChildItem -LiteralPath $base -Recurse -File)) {
      Copy-File $file.FullName (Get-Relative $root $file.FullName)
    }
  } elseif ($pattern.Contains('*')) {
    $slash = $pattern.LastIndexOf('/')
    $base = Join-Path $root $pattern.Substring(0, $slash)
    $leaf = $pattern.Substring($slash + 1)
    if (-not (Test-Path -LiteralPath $base)) { continue }
    foreach ($file in (Get-ChildItem -LiteralPath $base -File -Filter $leaf)) {
      Copy-File $file.FullName (Get-Relative $root $file.FullName)
    }
  } else {
    $full = Join-Path $root $pattern
    if (Test-Path -LiteralPath $full -PathType Leaf) { Copy-File $full $pattern }
  }
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$zip = Join-Path $OutDir ($name + '-' + $version + '.zip')
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $target -DestinationPath $zip -CompressionLevel Optimal
Remove-Item -LiteralPath $staging -Recurse -Force
$size = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 2)
Write-Host ('packed ' + $zip + ' (' + $size + ' MB)')
