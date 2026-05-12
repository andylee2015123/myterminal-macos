$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$profilePath = Join-Path ([System.IO.Path]::GetTempPath()) "MyTerminal\electron-dev-profile-$PID"
$sessionDataPath = Join-Path $profilePath 'Session Data'
$cachePath = Join-Path $profilePath 'Cache'

New-Item -ItemType Directory -Force -Path $sessionDataPath, $cachePath | Out-Null

$env:MYTERMINAL_CONNECTIONS_DIR = Join-Path $env:APPDATA 'myterminal'
$env:ELECTRON_CLI_ARGS = ConvertTo-Json @(
  "--user-data-dir=$profilePath",
  "--disk-cache-dir=$cachePath",
  '--disable-gpu',
  '--disable-gpu-shader-disk-cache',
  '--disable-http-cache',
  '--log-level=3'
) -Compress

& (Join-Path $root 'node_modules\.bin\electron-vite.cmd') dev
exit $LASTEXITCODE
