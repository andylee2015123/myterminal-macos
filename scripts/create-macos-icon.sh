#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

source_icon="assets/app-icon.png"
iconset="assets/app-icon.iconset"
output_icon="assets/app-icon.icns"

if [[ ! -f "$source_icon" ]]; then
  echo "Source icon PNG not found: $source_icon" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "sips and node are required to create a macOS app icon." >&2
  exit 1
fi

rm -rf "$iconset"
mkdir -p "$iconset"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$source_icon" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  scaled_size=$((size * 2))
  sips -z "$scaled_size" "$scaled_size" "$source_icon" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

node <<'NODE'
const fs = require('fs');
const path = require('path');

const entries = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png']
];
const iconset = path.join('assets', 'app-icon.iconset');
const chunks = entries.map(([type, file]) => {
  const png = fs.readFileSync(path.join(iconset, file));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 8);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(totalLength, 4);
fs.writeFileSync(path.join('assets', 'app-icon.icns'), Buffer.concat([header, ...chunks]));
NODE
rm -rf "$iconset"

echo "macOS ICNS created:"
echo "  $project_root/$output_icon"
