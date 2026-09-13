#!/usr/bin/env bash
# Hardware-aware Ollama model selector for Neural Mesh.
# Can be sourced or executed. Test overrides:
#   NEURAL_TEST_RAM_MIB, NEURAL_TEST_CPU_CORES, NEURAL_TEST_GPU_VRAM_MIB, NEURAL_TEST_GPU_COUNT
set -u

_models=("qwen3:0.6b" "qwen3:1.7b" "qwen3:4b" "qwen3:8b" "qwen3:14b" "qwen3:30b")

_num() { [[ "${1:-}" =~ ^[0-9]+$ ]] && printf '%s' "$1" || printf '0'; }

_detect_ram_mib() {
  if [[ -n "${NEURAL_TEST_RAM_MIB:-}" ]]; then _num "$NEURAL_TEST_RAM_MIB"; return; fi
  if [[ -r /proc/meminfo ]]; then
    awk '/MemTotal:/ {printf "%d", $2/1024; exit}' /proc/meminfo
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    local bytes
    bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    [[ "$bytes" =~ ^[0-9]+$ ]] && echo $(( bytes / 1024 / 1024 )) || echo 0
    return
  fi
  echo 0
}

_detect_cpu_cores() {
  if [[ -n "${NEURAL_TEST_CPU_CORES:-}" ]]; then _num "$NEURAL_TEST_CPU_CORES"; return; fi
  if command -v nproc >/dev/null 2>&1; then nproc 2>/dev/null || echo 1; return; fi
  if command -v getconf >/dev/null 2>&1; then getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1; return; fi
  echo 1
}

_detect_gpu() {
  local count=0 total=0 max=0 line free
  if [[ -n "${NEURAL_TEST_GPU_VRAM_MIB:-}" ]]; then
    total="$(_num "$NEURAL_TEST_GPU_VRAM_MIB")"
    count="$(_num "${NEURAL_TEST_GPU_COUNT:-1}")"
    max=$(( count > 0 ? total / count : 0 ))
    printf '%s %s %s\n' "$count" "$total" "$max"
    return
  fi
  if command -v nvidia-smi >/dev/null 2>&1; then
    while IFS= read -r line; do
      free="${line//[^0-9]/}"
      [[ -z "$free" ]] && continue
      count=$((count+1)); total=$((total+free)); (( free > max )) && max=$free
    done < <(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null || true)
  fi
  printf '%s %s %s\n' "$count" "$total" "$max"
}

_rank_of() {
  local target="$1" i
  for i in "${!_models[@]}"; do [[ "${_models[$i]}" == "$target" ]] && { echo "$i"; return; }; done
  echo -1
}

select_neural_model() {
  local profile="${MODEL_PROFILE:-balanced}"
  local auto="${AUTO_MODEL:-true}"
  local explicit="${LLM_MODEL:-}"
  local ram cores gpu_count gpu_total gpu_max idx reason shift max_model max_rank
  ram="$(_detect_ram_mib)"; cores="$(_detect_cpu_cores)"
  read -r gpu_count gpu_total gpu_max < <(_detect_gpu)

  if [[ "${auto,,}" != "true" && "${auto}" != "1" && -n "$explicit" ]]; then
    SELECTED_MODEL="$explicit"
    MODEL_CANDIDATES="$explicit"
    MODEL_SELECTION_REASON="manual override (AUTO_MODEL=false)"
  else
    if (( gpu_count > 0 && gpu_total > 0 )); then
      # Thresholds intentionally leave headroom for KV cache and Ollama runtime.
      if   (( gpu_total >= 30000 )); then idx=5
      elif (( gpu_total >= 15000 )); then idx=4
      elif (( gpu_total >=  9000 )); then idx=3
      elif (( gpu_total >=  5500 )); then idx=2
      elif (( gpu_total >=  2800 )); then idx=1
      else idx=0; fi
      reason="GPU: ${gpu_count} NVIDIA device(s), ${gpu_total} MiB VRAM"
    else
      if   (( ram >= 65536 && cores >= 16 )); then idx=4
      elif (( ram >= 32768 && cores >= 12 )); then idx=3
      elif (( ram >= 16384 && cores >=  6 )); then idx=2
      elif (( ram >=  8192 && cores >=  2 )); then idx=1
      else idx=0; fi
      reason="CPU: ${cores} core(s), ${ram} MiB RAM"
    fi

    shift=0
    case "${profile,,}" in
      fast) shift=-1 ;;
      quality) shift=1 ;;
      balanced|auto|'') shift=0 ;;
      *) profile="balanced" ;;
    esac
    idx=$((idx + shift)); ((idx < 0)) && idx=0; ((idx > ${#_models[@]}-1)) && idx=$((${#_models[@]}-1))

    max_model="${AUTO_MODEL_MAX:-qwen3:30b}"
    max_rank="$(_rank_of "$max_model")"
    (( max_rank >= 0 && idx > max_rank )) && idx=$max_rank

    SELECTED_MODEL="${_models[$idx]}"
    MODEL_CANDIDATES=""
    local i
    for ((i=idx; i>=0; i--)); do
      [[ -n "$MODEL_CANDIDATES" ]] && MODEL_CANDIDATES+="," 
      MODEL_CANDIDATES+="${_models[$i]}"
    done
    MODEL_SELECTION_REASON="$reason; profile=${profile}"
  fi

  DETECTED_RAM_MIB="$ram"
  DETECTED_CPU_CORES="$cores"
  DETECTED_GPU_COUNT="$gpu_count"
  DETECTED_GPU_VRAM_MIB="$gpu_total"
  DETECTED_GPU_MAX_VRAM_MIB="$gpu_max"
  HARDWARE_PROFILE="$([[ "$gpu_count" -gt 0 ]] && echo gpu || echo cpu)-${profile}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  select_neural_model
  printf 'SELECTED_MODEL=%q\n' "$SELECTED_MODEL"
  printf 'MODEL_CANDIDATES=%q\n' "$MODEL_CANDIDATES"
  printf 'MODEL_SELECTION_REASON=%q\n' "$MODEL_SELECTION_REASON"
  printf 'DETECTED_RAM_MIB=%q\n' "$DETECTED_RAM_MIB"
  printf 'DETECTED_CPU_CORES=%q\n' "$DETECTED_CPU_CORES"
  printf 'DETECTED_GPU_COUNT=%q\n' "$DETECTED_GPU_COUNT"
  printf 'DETECTED_GPU_VRAM_MIB=%q\n' "$DETECTED_GPU_VRAM_MIB"
  printf 'DETECTED_GPU_MAX_VRAM_MIB=%q\n' "$DETECTED_GPU_MAX_VRAM_MIB"
  printf 'HARDWARE_PROFILE=%q\n' "$HARDWARE_PROFILE"
fi
