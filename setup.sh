#!/usr/bin/env bash
# Distilled from README: Professor Quick Start + Installation.
# Run from repo root. Uses scripts/run-mega-dev.sh for "start server and UI".
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

LOG="${REPO_ROOT}/setup.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== Nearbytes setup (run once) ==="
echo "Repo root: $REPO_ROOT"
echo ""

echo "Installing root dependencies..."
npm install

echo "Installing UI dependencies..."
(cd ui && npm install)

echo "Building..."
npm run build

echo ""
echo "=== Setup complete ==="
echo "Next: start server and UI with  npm run mega"
echo "       (or: bash scripts/run-mega-dev.sh)"
echo "       Then open http://localhost:5173 and use secret e.g. LeedsUnited"
echo ""
echo "To verify MEGA folder first: ls -la \"\${NEARBYTES_STORAGE_DIR:-$HOME/MEGA/nearbytes}\" | head"
