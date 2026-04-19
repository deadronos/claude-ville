#!/bin/bash

# sync-assets.sh
# Builds the frontend and copies files to Android assets folder.

set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Project root is one level up from the android directory
PROJECT_ROOT="$SCRIPT_DIR/.."

# 1. Build the frontend
echo "Building frontend..."
cd "$PROJECT_ROOT"
npm run build:frontend

# 2. Define paths
ANDROID_ASSETS_DIR="$SCRIPT_DIR/app/src/main/assets/www"
DIST_DIR="$PROJECT_ROOT/dist/frontend"

# 3. Create assets directory if it doesn't exist
mkdir -p "$ANDROID_ASSETS_DIR"

# 4. Clean existing assets
echo "Cleaning old assets..."
rm -rf "${ANDROID_ASSETS_DIR:?}"/*

# 5. Copy new assets
echo "Copying new assets to $ANDROID_ASSETS_DIR..."
cp -r "$DIST_DIR"/* "$ANDROID_ASSETS_DIR/"

echo "Sync complete!"
