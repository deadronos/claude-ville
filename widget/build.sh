#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$SCRIPT_DIR"

echo "Starting ClaudeVille Widget build..."

# Compile Swift
swiftc Sources/main.swift \
  -framework Cocoa -framework WebKit \
  -o ClaudeVilleWidget

# Remove existing app bundle
rm -rf ClaudeVilleWidget.app

# Create app bundle
mkdir -p ClaudeVilleWidget.app/Contents/MacOS
mkdir -p ClaudeVilleWidget.app/Contents/Resources
cp ClaudeVilleWidget ClaudeVilleWidget.app/Contents/MacOS/
cp Info.plist ClaudeVilleWidget.app/Contents/
cp -R Resources/. ClaudeVilleWidget.app/Contents/Resources/

# Record project path for .env.local runtime settings
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
echo "$PROJECT_ROOT" > ClaudeVilleWidget.app/Contents/Resources/project_path
echo "  Project: $PROJECT_ROOT"

rm ClaudeVilleWidget

echo "Build complete: ClaudeVilleWidget.app"
