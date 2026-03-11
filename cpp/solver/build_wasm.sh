#!/usr/bin/env bash
set -euo pipefail

# Requires emsdk activated and emcc in PATH.
# Outputs solver artifacts consumable by frontend.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT_DIR="${SCRIPT_DIR}/../../public/solver"
mkdir -p "${OUT_DIR}"

emcc "${SCRIPT_DIR}/solver_core.cpp" \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=0 \
  -s EXPORT_NAME='"CSPWasmSolver"' \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  --bind \
  -o "${OUT_DIR}/solver_wasm.js"

echo "Built ${OUT_DIR}/solver_wasm.js and solver_wasm.wasm"
