#!/bin/bash

# sync-assets.sh
# Builds the frontend and copies files to Android assets folder.

set -e

# 1. Build the frontend
echo "Building frontend..."
npm run build:frontend

# 2. Define pathes
PROJECT_ROOT=$(pwd)
ANDROID_ASSETS_DIR="$PROJECT_ROOT/android/app/src/main/assets/www"
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
