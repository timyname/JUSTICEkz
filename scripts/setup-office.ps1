param(
  [string]$Version = "26.8.0"
)

$ErrorActionPreference = "Stop"
$msi = Join-Path $env:TEMP "justicekz-libreoffice-$Version-x64.msi"
$log = Join-Path $env:TEMP "justicekz-libreoffice-install.log"
$url = "https://download.documentfoundation.org/libreoffice/stable/$Version/win/x86_64/LibreOffice_${Version}_Win_x86-64.msi"
$candidates = @(
  "${env:ProgramFiles}\LibreOffice\program\soffice.exe",
  "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe"
)

$installed = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($installed) {
  Write-Host "LibreOffice is already installed at $installed"
  exit 0
}

if (-not (Test-Path $msi) -or (Get-Item $msi).Length -lt 100000000) {
  Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
}
if ((Get-Item $msi).Length -lt 100000000) { throw "LibreOffice MSI download is incomplete." }

$process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $msi, "/qn", "/norestart", "/l*v", $log) -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "LibreOffice installer returned exit code $($process.ExitCode). Review $log." }

$installed = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $installed) { throw "LibreOffice installation completed but soffice.exe was not found." }
Write-Host "LibreOffice is installed at $installed"
