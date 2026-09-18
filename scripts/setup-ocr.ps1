param(
  [string]$Version = "5.5.3.20260724"
)

$ErrorActionPreference = "Stop"
$toolDir = Join-Path (Get-Location) ".justicekz\tools\Tesseract-OCR"
$installer = Join-Path $env:TEMP "justicekz-tesseract-$Version.exe"
New-Item -ItemType Directory -Force -Path $toolDir | Out-Null

$url = "https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-$Version.exe"
if (-not (Test-Path $installer) -or (Get-Item $installer).Length -lt 1000000) {
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
}
if ((Get-Item $installer).Length -lt 1000000) { throw "Tesseract installer download is incomplete." }

$args = @('/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=$toolDir")
$process = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Tesseract installer returned exit code $($process.ExitCode)." }

$binary = Join-Path $toolDir "tesseract.exe"
if (-not (Test-Path $binary)) { throw "Tesseract was not installed at $binary." }
$tessdataDir = Join-Path $toolDir "tessdata"
New-Item -ItemType Directory -Force -Path $tessdataDir | Out-Null
foreach ($language in @("rus", "kaz")) {
  $languagePath = Join-Path $tessdataDir "$language.traineddata"
  if (-not (Test-Path $languagePath)) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$language.traineddata" -OutFile $languagePath -UseBasicParsing
  }
  if ((Get-Item $languagePath).Length -lt 100000) { throw "Tesseract language data is incomplete: $language" }
}
& $binary --version
& $binary --list-langs
Write-Host "Tesseract is installed locally. Restart JUSTICEkz to use OCR."
