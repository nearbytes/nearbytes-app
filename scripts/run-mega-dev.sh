#!/usr/bin/env bash
set -euo pipefail

# Explicitly set storage directory to a MEGA sync folder (override-friendly).
export NEARBYTES_STORAGE_DIR="${NEARBYTES_STORAGE_DIR:-$HOME/MEGA/nearbytes}"

# Log the storage directory being used
echo "Using MEGA storage dir: $NEARBYTES_STORAGE_DIR"

# Run both server and UI
yarn dev
