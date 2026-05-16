#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

echo "Building MyTerminal for macOS..."

if [[ ! -d "node_modules" ]]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

npm run icon:mac
npm run build
npx electron-builder --mac zip

archive="$(find release -maxdepth 1 -name 'MyTerminal-*.zip' -type f -print | sort | tail -n 1)"
app_bundle="$(find release -maxdepth 2 -name 'MyTerminal.app' -type d -print | sort | tail -n 1)"

if [[ -z "$archive" ]]; then
  echo "ZIP package was not created." >&2
  exit 1
fi

echo
echo "macOS ZIP package created:"
echo "  $project_root/$archive"

if [[ -n "$app_bundle" ]]; then
  echo
  echo "App bundle for quick local testing:"
  echo "  $project_root/$app_bundle"
fi
