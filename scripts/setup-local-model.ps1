param(
  [string]$ModelUrl = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf?download=true",
  [long]$ExpectedModelBytes = 639446688
)

$ErrorActionPreference = "Stop"
$modelDir = Join-Path (Get-Location) ".justicekz\models"
$runtimeDir = Join-Path (Get-Location) ".justicekz\runtime\llama.cpp"
$modelPath = Join-Path $modelDir "Qwen3-0.6B-Q8_0.gguf"
New-Item -ItemType Directory -Force -Path $modelDir,$runtimeDir | Out-Null

$server = Get-ChildItem -LiteralPath $runtimeDir -Filter "llama-server.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $server) {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=1"
  $asset = $release[0].assets | Where-Object { $_.name -match "win-cpu-x64\.zip$" } | Select-Object -First 1
  if (-not $asset) { throw "No Windows CPU llama.cpp asset was found." }
  $archive = Join-Path $env:TEMP "justicekz-llama-cpu.zip"
  if (-not (Test-Path $archive) -or (Get-Item $archive).Length -eq 0) {
    Invoke-WebRequest -Uri $asset.url -Headers @{ Accept = "application/octet-stream"; "User-Agent" = "JUSTICEkz" } -OutFile $archive
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
  $server = Get-ChildItem -LiteralPath $runtimeDir -Filter "llama-server.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $server) { throw "llama-server.exe was not found after extraction." }
if (-not (Test-Path $modelPath) -or (Get-Item $modelPath).Length -ne $ExpectedModelBytes) {
  Write-Host "Downloading the Qwen3 0.6B GGUF model..."
  if (Test-Path $modelPath) {
    $currentBytes = (Get-Item $modelPath).Length
    if ($currentBytes -gt $ExpectedModelBytes) {
      Remove-Item -LiteralPath $modelPath -Force
    }
  }
  curl.exe -L --fail --retry 3 --retry-delay 2 -C - --output $modelPath $ModelUrl
  if ($LASTEXITCODE -ne 0) { throw "The model download failed." }
}
if (-not (Test-Path $modelPath) -or (Get-Item $modelPath).Length -ne $ExpectedModelBytes) {
  $actualBytes = if (Test-Path $modelPath) { (Get-Item $modelPath).Length } else { 0 }
  throw "The model download is incomplete. Expected $ExpectedModelBytes bytes, got $actualBytes."
}

$existing = Get-Process -Name "llama-server" -ErrorAction SilentlyContinue
if (-not $existing) {
  Start-Process -FilePath $server.FullName -ArgumentList @(
    "-m", $modelPath,
    "--host", "127.0.0.1",
    "--port", "11434",
    "--ctx-size", "4096",
    "--threads", "4"
  ) -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

$envPath = Join-Path (Get-Location) ".env"
$envContent = @"
JUSTICE_PORT=4317
JUSTICE_HOST=127.0.0.1
JUSTICE_MODEL_URL=http://127.0.0.1:11434/v1/chat/completions
JUSTICE_MODEL_NAME=qwen3-0.6b
"@
Set-Content -LiteralPath $envPath -Value $envContent -Encoding utf8
Write-Host "Local llama.cpp server is configured for Qwen3 0.6B."
