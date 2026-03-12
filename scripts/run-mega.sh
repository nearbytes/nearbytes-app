#!/usr/bin/env bash
set -euo pipefail

# Explicitly set storage directory to a MEGA sync folder (override-friendly).
export NEARBYTES_STORAGE_DIR="${NEARBYTES_STORAGE_DIR:-$HOME/MEGA/nearbytes}"

# Ensure directory exists
mkdir -p "$NEARBYTES_STORAGE_DIR"

# Log the storage directory being used
echo "Using storage dir: $NEARBYTES_STORAGE_DIR"

# Run the server
yarn server
