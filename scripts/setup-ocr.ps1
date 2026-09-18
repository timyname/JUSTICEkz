param(
  [string]$Version = "5.5.3.20260724",
  [string]$SevenZipVersion = "26.03"
)

$ErrorActionPreference = "Stop"
$toolDir = Join-Path (Get-Location) ".justicekz\tools\Tesseract-OCR"
$installer = Join-Path $env:TEMP "justicekz-tesseract-$Version.exe"
$sevenZipMsi = Join-Path $env:TEMP "justicekz-7z-$SevenZipVersion-x64.msi"
$sevenZipDir = Join-Path $env:TEMP "justicekz-7z-$SevenZipVersion-admin"
New-Item -ItemType Directory -Force -Path $toolDir | Out-Null

$installerUrl = "https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-$Version.exe"
if (-not (Test-Path $installer) -or (Get-Item $installer).Length -lt 1000000) {
  Invoke-WebRequest -Uri $installerUrl -OutFile $installer -UseBasicParsing
}
if ((Get-Item $installer).Length -lt 1000000) { throw "Tesseract installer download is incomplete." }

# The upstream Windows package is an NSIS installer. Use the full official 7-Zip binary from an administrative MSI extraction.
if (-not (Test-Path $sevenZipMsi)) {
  Invoke-WebRequest -Uri "https://github.com/ip7z/7zip/releases/download/$SevenZipVersion/7z$($SevenZipVersion.Replace('.', ''))-x64.msi" -OutFile $sevenZipMsi -UseBasicParsing
}
if (-not (Test-Path (Join-Path $sevenZipDir "Files\7-Zip\7z.exe"))) {
  if (Test-Path $sevenZipDir) { Remove-Item -LiteralPath $sevenZipDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $sevenZipDir | Out-Null
  $sevenZipInstall = Start-Process -FilePath "msiexec.exe" -ArgumentList @('/a', $sevenZipMsi, "TARGETDIR=$sevenZipDir", '/qn', '/norestart') -Wait -PassThru
  if ($sevenZipInstall.ExitCode -ne 0) { throw "7-Zip administrative extraction failed with exit code $($sevenZipInstall.ExitCode)." }
}

$sevenZip = Join-Path $sevenZipDir "Files\7-Zip\7z.exe"
if (-not (Test-Path $sevenZip)) { throw "7-Zip extractor was not unpacked at $sevenZip." }
& $sevenZip x $installer "-o$toolDir" "-y"
if ($LASTEXITCODE -ne 0) { throw "Tesseract archive extraction failed with exit code $LASTEXITCODE." }

$tessdataDir = Join-Path $toolDir "tessdata"
New-Item -ItemType Directory -Force -Path $tessdataDir | Out-Null
foreach ($language in @("eng", "rus", "kaz")) {
  $languagePath = Join-Path $tessdataDir "$language.traineddata"
  if (-not (Test-Path $languagePath) -or (Get-Item $languagePath).Length -lt 100000) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$language.traineddata" -OutFile $languagePath -UseBasicParsing
  }
  if ((Get-Item $languagePath).Length -lt 100000) { throw "Tesseract language data is incomplete: $language" }
}

$binary = Join-Path $toolDir "tesseract.exe"
if (-not (Test-Path $binary)) { throw "Tesseract was not extracted at $binary." }
& $binary --version
& $binary --list-langs
Write-Host "Tesseract is installed locally. Restart JUSTICEkz to use OCR."
