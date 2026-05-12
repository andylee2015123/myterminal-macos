$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$source = Join-Path $projectRoot "assets\app-icon.png"
$output = Join-Path $projectRoot "assets\app-icon.ico"

if (-not (Test-Path $source)) {
  throw "Source icon PNG not found: $source"
}

$python = @'
from pathlib import Path
from PIL import Image

source = Path("assets/app-icon.png")
output = Path("assets/app-icon.ico")
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]

img = Image.open(source).convert("RGBA")
side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
canvas.save(output, format="ICO", sizes=sizes)

print(output.resolve())
'@

$created = $python | python -
Write-Host "Windows ICO created:" -ForegroundColor Green
Write-Host "  $created"
