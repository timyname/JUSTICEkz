param(
  [string]$DataDir = ".justicekz\data",
  [string]$ManifestPath = "data\seed\official-sources.json"
)

$ErrorActionPreference = "Stop"
& node (Join-Path (Get-Location) "scripts\fetch-official-laws.mjs") --data-dir $DataDir --manifest $ManifestPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
