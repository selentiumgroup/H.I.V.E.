#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log(){ printf '[Neural Mesh] %s\n' "$*"; }
warn(){ printf '[Neural Mesh] WARNING: %s\n' "$*" >&2; }
die(){ printf '[Neural Mesh] ERROR: %s\n' "$*" >&2; exit 1; }

read_env(){
  local key="$1" def="${2:-}" line
  if [[ -f .env ]]; then
    line="$(grep -E "^[[:space:]]*${key}=" .env 2>/dev/null | tail -n1 || true)"
    [[ -n "$line" ]] && { printf '%s' "${line#*=}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^\"//' -e 's/\"$//' -e "s/^'//" -e "s/'$//"; return; }
  fi
  printf '%s' "$def"
}
truthy(){ [[ "${1:-}" =~ ^(1|true|yes|on)$ ]]; }

export AUTO_MODEL="${AUTO_MODEL:-$(read_env AUTO_MODEL true)}"
export MODEL_PROFILE="${MODEL_PROFILE:-$(read_env MODEL_PROFILE balanced)}"
export AUTO_MODEL_MAX="${AUTO_MODEL_MAX:-$(read_env AUTO_MODEL_MAX qwen3:30b)}"
export AUTO_INSTALL_RUNTIME="${AUTO_INSTALL_RUNTIME:-$(read_env AUTO_INSTALL_RUNTIME true)}"
export AUTO_INSTALL_GPU_RUNTIME="${AUTO_INSTALL_GPU_RUNTIME:-$(read_env AUTO_INSTALL_GPU_RUNTIME true)}"
export EVOLUTION_MODEL_POOL="${EVOLUTION_MODEL_POOL:-$(read_env EVOLUTION_MODEL_POOL "")}"
export MOCK_LLM="${MOCK_LLM:-$(read_env MOCK_LLM false)}"
export AUTO_PULL_MODEL="${AUTO_PULL_MODEL:-$(read_env AUTO_PULL_MODEL true)}"
export MODEL_SMOKE_TEST="${MODEL_SMOKE_TEST:-$(read_env MODEL_SMOKE_TEST true)}"
export MODEL_TEST_TIMEOUT_SEC="${MODEL_TEST_TIMEOUT_SEC:-$(read_env MODEL_TEST_TIMEOUT_SEC 300)}"
export LLM_MODEL="${LLM_MODEL:-$(read_env LLM_MODEL '')}"

# shellcheck source=scripts/select-model.sh
source "$ROOT/scripts/select-model.sh"
select_neural_model

print_profile(){
  log "hardware: CPU=${DETECTED_CPU_CORES} core(s), RAM=${DETECTED_RAM_MIB} MiB, NVIDIA GPU=${DETECTED_GPU_COUNT}, VRAM=${DETECTED_GPU_VRAM_MIB} MiB"
  log "model policy: AUTO_MODEL=${AUTO_MODEL}, profile=${MODEL_PROFILE}, selected=${SELECTED_MODEL}"
  log "selection: ${MODEL_SELECTION_REASON}"
}
print_profile

if truthy "${DRY_RUN:-false}"; then
  log "dry-run requested; no runtime/model changes were made."
  exit 0
fi

SUDO=()
if [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then SUDO=(sudo); fi
DOCKER=(docker)

ensure_curl(){
  command -v curl >/dev/null 2>&1 && return 0
  [[ "$(uname -s)" == "Linux" ]] || return 1
  if command -v apt-get >/dev/null 2>&1; then
    "${SUDO[@]}" apt-get update -y && "${SUDO[@]}" apt-get install -y --no-install-recommends curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    "${SUDO[@]}" dnf install -y curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    "${SUDO[@]}" yum install -y curl ca-certificates
  else return 1; fi
}

docker_ok(){
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && { DOCKER=(docker); return 0; }
  if ((${#SUDO[@]})) && sudo docker info >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then DOCKER=(sudo docker); return 0; fi
  return 1
}

install_docker(){
  truthy "$AUTO_INSTALL_RUNTIME" || return 1
  [[ "$(uname -s)" == "Linux" ]] || return 1
  ensure_curl || return 1
  if [[ "$(id -u)" -ne 0 && ${#SUDO[@]} -eq 0 ]]; then return 1; fi
  log "Docker not found; installing Docker Engine using Docker's official convenience installer..."
  local tmp
  tmp="$(mktemp)"
  curl -fsSL https://get.docker.com -o "$tmp" || { rm -f "$tmp"; return 1; }
  "${SUDO[@]}" sh "$tmp" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  "${SUDO[@]}" systemctl enable --now docker >/dev/null 2>&1 || true
  sleep 2
  docker_ok
}

install_nvidia_container_toolkit(){
  truthy "$AUTO_INSTALL_GPU_RUNTIME" || return 1
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  [[ "$(uname -s)" == "Linux" ]] || return 1
  if [[ "$(id -u)" -ne 0 && ${#SUDO[@]} -eq 0 ]]; then return 1; fi
  ensure_curl || return 1
  log "GPU detected but Docker GPU runtime is unavailable; attempting NVIDIA Container Toolkit setup..."
  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      "${SUDO[@]}" apt-get update -y
      "${SUDO[@]}" apt-get install -y --no-install-recommends ca-certificates curl gnupg2
      curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | "${SUDO[@]}" gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
      curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | "${SUDO[@]}" tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
      "${SUDO[@]}" apt-get update -y
      "${SUDO[@]}" apt-get install -y nvidia-container-toolkit
    elif command -v dnf >/dev/null 2>&1; then
      curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | "${SUDO[@]}" tee /etc/yum.repos.d/nvidia-container-toolkit.repo >/dev/null
      "${SUDO[@]}" dnf install -y nvidia-container-toolkit
    else
      return 1
    fi
  fi
  command -v nvidia-ctk >/dev/null 2>&1 || return 1
  "${SUDO[@]}" nvidia-ctk runtime configure --runtime=docker >/dev/null
  "${SUDO[@]}" systemctl restart docker >/dev/null 2>&1 || return 1
  sleep 3
  docker_ok
}

wait_docker_ollama(){
  local i
  for i in $(seq 1 90); do
    if dc exec -T ollama ollama list >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

model_installed_docker(){ dc exec -T ollama ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$1"; }
model_test_docker(){
  local model="$1"
  truthy "$MODEL_SMOKE_TEST" || return 0
  if command -v timeout >/dev/null 2>&1; then
    timeout "${MODEL_TEST_TIMEOUT_SEC}s" "${DOCKER[@]}" compose "${COMPOSE_ARGS[@]}" exec -T ollama ollama run "$model" "Reply with exactly OK." >/tmp/neural-model-test.$$ 2>&1
  else
    dc exec -T ollama ollama run "$model" "Reply with exactly OK." >/tmp/neural-model-test.$$ 2>&1
  fi
}

choose_working_model_docker(){
  local candidates model
  candidates="$MODEL_CANDIDATES"
  IFS=',' read -r -a arr <<< "$candidates"
  for model in "${arr[@]}"; do
    log "checking model ${model}..."
    if ! model_installed_docker "$model"; then
      truthy "$AUTO_PULL_MODEL" || { warn "$model is not installed and AUTO_PULL_MODEL=false"; continue; }
      log "pulling ${model} (first launch only)..."
      if ! dc exec -T ollama ollama pull "$model"; then warn "pull failed for $model; trying smaller model"; continue; fi
    fi
    log "running model smoke test for ${model}..."
    if model_test_docker "$model"; then FINAL_MODEL="$model"; rm -f /tmp/neural-model-test.$$; return 0; fi
    warn "$model failed to load/respond; falling back to a smaller model"
    [[ -f /tmp/neural-model-test.$$ ]] && tail -n 20 /tmp/neural-model-test.$$ >&2 || true
    rm -f /tmp/neural-model-test.$$
  done
  return 1
}

write_runtime_env(){
  cat > "$ROOT/.runtime.env" <<ENV
# Generated automatically by ./start.sh. Safe to delete; it will be regenerated.
LLM_MODEL=${FINAL_MODEL}
EVOLUTION_MODEL_POOL=${EVOLUTION_MODEL_POOL:-$FINAL_MODEL}
AUTO_MODEL=${AUTO_MODEL}
MODEL_PROFILE=${MODEL_PROFILE}
HARDWARE_PROFILE=${HARDWARE_PROFILE}
DETECTED_RAM_MIB=${DETECTED_RAM_MIB}
DETECTED_CPU_CORES=${DETECTED_CPU_CORES}
DETECTED_GPU_COUNT=${DETECTED_GPU_COUNT}
DETECTED_GPU_VRAM_MIB=${DETECTED_GPU_VRAM_MIB}
MODEL_SELECTION_REASON=${MODEL_SELECTION_REASON}
ENV
  chmod 0644 "$ROOT/.runtime.env"
}

run_docker(){
  COMPOSE_ARGS=(-f docker-compose.yml)
  local gpu_requested=false
  if (( DETECTED_GPU_COUNT > 0 )); then gpu_requested=true; fi

  if $gpu_requested; then
    log "NVIDIA GPU detected; attempting GPU Ollama container."
    COMPOSE_ARGS+=(-f docker-compose.gpu.yml)
    if ! dc up -d ollama; then
      if install_nvidia_container_toolkit; then
        log "NVIDIA Container Toolkit configured; retrying GPU stack."
        if ! dc up -d ollama; then
          warn "GPU container still failed after toolkit setup; falling back to CPU inference."
          COMPOSE_ARGS=(-f docker-compose.yml)
          NEURAL_TEST_GPU_VRAM_MIB=0 NEURAL_TEST_GPU_COUNT=0 select_neural_model
          unset NEURAL_TEST_GPU_VRAM_MIB NEURAL_TEST_GPU_COUNT
          print_profile
          dc up -d ollama
        fi
      else
        warn "Docker GPU runtime is unavailable and could not be auto-configured; falling back to CPU inference."
        COMPOSE_ARGS=(-f docker-compose.yml)
        NEURAL_TEST_GPU_VRAM_MIB=0 NEURAL_TEST_GPU_COUNT=0 select_neural_model
        unset NEURAL_TEST_GPU_VRAM_MIB NEURAL_TEST_GPU_COUNT
        print_profile
        dc up -d ollama
      fi
    fi
  else
    log "starting CPU Ollama container."
    dc up -d ollama
  fi
  wait_docker_ollama || die "Ollama container did not become ready"
  choose_working_model_docker || die "No compatible Ollama model could be provisioned"
  export LLM_MODEL="$FINAL_MODEL"
  export EVOLUTION_MODEL_POOL="${EVOLUTION_MODEL_POOL:-$FINAL_MODEL}"
  export HARDWARE_PROFILE DETECTED_RAM_MIB DETECTED_CPU_CORES DETECTED_GPU_COUNT DETECTED_GPU_VRAM_MIB MODEL_SELECTION_REASON
  write_runtime_env
  log "selected working model: $FINAL_MODEL"
  dc up -d --build neuron
  log "ready: http://127.0.0.1:48686  model=$FINAL_MODEL"
  log "runtime profile saved to .runtime.env"
}

# Compose wrapper must be defined after COMPOSE_ARGS exists; Bash resolves it at call time.
dc(){ "${DOCKER[@]}" compose "${COMPOSE_ARGS[@]}" "$@"; }

ollama_reachable_native(){ ollama list >/dev/null 2>&1; }
install_ollama_native(){
  truthy "$AUTO_INSTALL_RUNTIME" || return 1
  [[ "$(uname -s)" == "Linux" ]] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  log "Ollama not found; installing Ollama using the official Linux installer..."
  curl -fsSL https://ollama.com/install.sh | sh
}
start_ollama_native(){
  ollama_reachable_native && return 0
  mkdir -p "$ROOT/data"
  nohup ollama serve >"$ROOT/data/ollama.log" 2>&1 &
  local i
  for i in $(seq 1 60); do ollama_reachable_native && return 0; sleep 1; done
  return 1
}
model_installed_native(){ ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fxq "$1"; }
model_test_native(){
  local model="$1"
  truthy "$MODEL_SMOKE_TEST" || return 0
  if command -v timeout >/dev/null 2>&1; then timeout "${MODEL_TEST_TIMEOUT_SEC}s" ollama run "$model" "Reply with exactly OK." >/tmp/neural-model-test.$$ 2>&1
  else ollama run "$model" "Reply with exactly OK." >/tmp/neural-model-test.$$ 2>&1; fi
}
choose_working_model_native(){
  local model
  IFS=',' read -r -a arr <<< "$MODEL_CANDIDATES"
  for model in "${arr[@]}"; do
    if ! model_installed_native "$model"; then
      truthy "$AUTO_PULL_MODEL" || continue
      log "pulling ${model}..."
      ollama pull "$model" || { warn "pull failed for $model"; continue; }
    fi
    log "testing ${model}..."
    if model_test_native "$model"; then FINAL_MODEL="$model"; rm -f /tmp/neural-model-test.$$; return 0; fi
    warn "$model failed; trying smaller model"
    rm -f /tmp/neural-model-test.$$
  done
  return 1
}

run_native(){
  command -v node >/dev/null 2>&1 || die "Node.js is unavailable and Docker could not be installed"
  local major minor
  major="$(node -p 'Number(process.versions.node.split(".")[0])')"; minor="$(node -p 'Number(process.versions.node.split(".")[1])')"
  (( major > 22 || (major == 22 && minor >= 16) )) || die "Neural Mesh requires Node.js >=22.16 or Docker"
  if [[ "${MOCK_LLM:-false}" != "true" ]]; then
    command -v ollama >/dev/null 2>&1 || install_ollama_native || die "Could not install Ollama automatically"
    start_ollama_native || die "Ollama service did not start"
    choose_working_model_native || die "No compatible Ollama model could be provisioned"
    export LLM_MODEL="$FINAL_MODEL"
  else FINAL_MODEL="mock-neuron"; export LLM_MODEL="$FINAL_MODEL"; fi
  export EVOLUTION_MODEL_POOL="${EVOLUTION_MODEL_POOL:-$FINAL_MODEL}"
  export HARDWARE_PROFILE DETECTED_RAM_MIB DETECTED_CPU_CORES DETECTED_GPU_COUNT DETECTED_GPU_VRAM_MIB MODEL_SELECTION_REASON
  write_runtime_env
  log "starting native neuron with model $FINAL_MODEL"
  exec node src/index.js
}

if docker_ok || install_docker; then
  run_docker
  exit 0
fi

warn "Docker is unavailable; using native Node.js/Ollama mode."
run_native
