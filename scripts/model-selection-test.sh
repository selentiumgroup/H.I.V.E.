#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_case(){
  local ram="$1" cpu="$2" gpu="$3" profile="$4" expected="$5"
  local out model
  out="$(NEURAL_TEST_RAM_MIB="$ram" NEURAL_TEST_CPU_CORES="$cpu" NEURAL_TEST_GPU_VRAM_MIB="$gpu" NEURAL_TEST_GPU_COUNT="$([[ "$gpu" -gt 0 ]] && echo 1 || echo 0)" MODEL_PROFILE="$profile" AUTO_MODEL=true "$ROOT/scripts/select-model.sh")"
  eval "$out"
  model="$SELECTED_MODEL"
  [[ "$model" == "$expected" ]] || { echo "FAIL ram=$ram cpu=$cpu gpu=$gpu profile=$profile expected=$expected got=$model" >&2; exit 1; }
  echo "OK $profile ram=${ram}MiB cpu=$cpu gpu=${gpu}MiB -> $model"
}
run_case 4096 2 0 balanced qwen3:0.6b
run_case 8192 4 0 balanced qwen3:1.7b
run_case 16384 8 0 balanced qwen3:4b
run_case 32768 12 0 balanced qwen3:8b
run_case 65536 24 0 balanced qwen3:14b
run_case 16384 8 10000 balanced qwen3:8b
run_case 32768 16 16000 balanced qwen3:14b
run_case 65536 32 32000 balanced qwen3:30b
run_case 16384 8 10000 fast qwen3:4b
run_case 16384 8 10000 quality qwen3:14b
printf 'MODEL SELECTION OK\n'
