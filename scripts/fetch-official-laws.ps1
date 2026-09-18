param(
  [string]$DataDir = ".justicekz\data"
)

$ErrorActionPreference = "Stop"
$sourceDir = Join-Path $DataDir "legal\official"
$rawDir = Join-Path $sourceDir "raw"
$recordDir = Join-Path $sourceDir "records"
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
New-Item -ItemType Directory -Force -Path $recordDir | Out-Null

$sources = @(
  @{ Slug = "civil-code-general"; Id = "K940001000_"; EffectiveFrom = "1994-12-27"; DateNote = "Adoption date of the General Part of the Civil Code" },
  @{ Slug = "civil-code-special"; Id = "K990000409_"; EffectiveFrom = "1999-07-01"; DateNote = "Adoption date of the Special Part of the Civil Code" },
  @{ Slug = "civil-procedure-code"; Id = "K1500000377"; EffectiveFrom = "2015-10-31"; DateNote = "Adoption date of the Civil Procedure Code" },
  @{ Slug = "enforcement-and-bailiffs"; Id = "Z100000261_"; EffectiveFrom = "2010-04-02"; DateNote = "Adoption date of the enforcement law" },
  @{ Slug = "entrepreneurial-code"; Id = "K1500000375"; EffectiveFrom = "2015-10-29"; DateNote = "Adoption date of the Entrepreneurial Code" }
)

foreach ($source in $sources) {
  $source.Url = "https://old.adilet.zan.kz/rus/docs/$($source.Id)"
  $canonicalUrl = "https://adilet.zan.kz/rus/docs/$($source.Id)"
  $htmlPath = Join-Path $rawDir "$($source.Slug).html"
  $downloadPath = "$htmlPath.download"
  if (Test-Path $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
  $downloaded = $false
  try {
    Invoke-WebRequest -Uri $source.Url -OutFile $downloadPath -UseBasicParsing -Headers @{ "User-Agent" = "JUSTICEkz" }
    $downloaded = (Test-Path $downloadPath) -and ((Get-Item $downloadPath).Length -gt 0)
  } catch { }
  if (-not $downloaded) {
    if (Test-Path $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
    try {
      Invoke-WebRequest -Uri $canonicalUrl -OutFile $downloadPath -UseBasicParsing -Headers @{ "User-Agent" = "JUSTICEkz" }
      $downloaded = (Test-Path $downloadPath) -and ((Get-Item $downloadPath).Length -gt 0)
    } catch { }
  }
  if (-not $downloaded) { throw "Empty official page response for $($source.Id)." }
  Move-Item -LiteralPath $downloadPath -Destination $htmlPath -Force
  $html = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($htmlPath))
  $articleMatch = [regex]::Match($html, '(?is)<article[^>]*>(.*?)</article>')
  if (-not $articleMatch.Success) { throw "No legal text article found for $($source.Id)." }
  $titleMatch = [regex]::Match($html, '(?is)<title[^>]*>(.*?)</title>')
  $title = [System.Net.WebUtility]::HtmlDecode($titleMatch.Groups[1].Value).Trim()
  $title = [regex]::Replace($title, '\s+-\s+.*$', '').Trim()
  $content = $articleMatch.Groups[1].Value
  $content = [regex]::Replace($content, '(?is)<(script|style)[^>]*>.*?</\1>', '')
  $content = [regex]::Replace($content, '(?i)<br\s*/?>', "`n")
  $content = [regex]::Replace($content, '(?i)</(p|h[1-6]|li|tr|div)>', "`n")
  $content = [regex]::Replace($content, '(?is)<[^>]+>', '')
  $content = [System.Net.WebUtility]::HtmlDecode($content).Replace([char]0xA0, ' ')
  $content = [regex]::Replace($content, '[ \t]+', ' ')
  $content = [regex]::Replace($content, '\r?\n{3,}', "`n`n").Trim()
  $effectiveFrom = $source.EffectiveFrom
  if (-not $effectiveFrom) { throw "No effective date configured for $($source.Id)." }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $htmlPath).Hash.ToLowerInvariant()
  $record = [ordered]@{ title = $title; kind = "official_code"; content = $content; sourceUrl = $canonicalUrl; effectiveFrom = $effectiveFrom; sourceSha256 = $hash; downloadedAt = (Get-Date).ToUniversalTime().ToString("o"); sourceNote = "$($source.DateNote). The Adilet page is a consolidated snapshot as of the download date; import separate snapshots for historical editions." }
  $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $recordDir "$($source.Slug).json") -Encoding utf8
  $meta = [ordered]@{ slug = $source.Slug; sourceUrl = $canonicalUrl; archiveUrl = $source.Url; downloadedAt = (Get-Date).ToUniversalTime().ToString("o"); sha256 = $hash; rawFile = $htmlPath; recordFile = (Join-Path $recordDir "$($source.Slug).json"); effectiveFrom = $effectiveFrom; dateNote = $source.DateNote; snapshotNote = "Consolidated official page text as of the download date; import separate snapshots for historical analysis." }
  $meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sourceDir "$($source.Slug).source.json") -Encoding utf8
  Write-Host "$($source.Slug): $hash"
}

Write-Host "Official pages are stored locally with explicit act dates. Review the snapshot metadata before importing."
