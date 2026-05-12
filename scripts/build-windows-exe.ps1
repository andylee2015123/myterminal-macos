$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

Write-Host "Building MyTerminal Windows installer..." -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
  Write-Host "node_modules not found. Installing dependencies..." -ForegroundColor Yellow
  npm install
}

& (Join-Path $PSScriptRoot "create-windows-icon.ps1")
npm run build
npx electron-builder --win nsis

$installer = Get-ChildItem -Path "release" -Filter "MyTerminal-*-Setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Installer was not created."
}

$unpackedExe = Join-Path $projectRoot "release\win-unpacked\MyTerminal.exe"

Write-Host ""
Write-Host "Windows installer created:" -ForegroundColor Green
Write-Host "  $($installer.FullName)"

if (Test-Path $unpackedExe) {
  Write-Host ""
  Write-Host "Unpacked executable for quick local testing:" -ForegroundColor Green
  Write-Host "  $unpackedExe"
}

Write-Host ""
Write-Host "Run the installer to create desktop and Start Menu shortcuts." -ForegroundColor Cyan
