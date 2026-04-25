#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

assert_eq() {
    local actual="$1"
    local expected="$2"
    local msg="${3:-Assertion failed}"
    if [[ "$actual" == "$expected" ]]; then
        echo "[PASS] $msg: '$actual' == '$expected'"
        return 0
    else
        echo "[FAIL] $msg: expected '$expected', got '$actual'"
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-Assertion failed}"
    # Use set +e to prevent exit on grep failure, then check return value
    set +e
    echo "$haystack" | grep -q "$needle"
    local result=$?
    set -e
    if [[ $result -eq 0 ]]; then
        echo "[PASS] $msg: contains '$needle'"
        return 0
    else
        echo "[FAIL] $msg: does not contain '$needle'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local msg="${2:-Assertion failed}"
    if [[ -n "$value" ]]; then
        echo "[PASS] $msg: not empty"
        return 0
    else
        echo "[FAIL] $msg: is empty"
        return 1
    fi
}

run_ac() {
    local ac_id="$1"
    local script="$2"
    echo "========================================"
    echo "Running AC: $ac_id"
    echo "========================================"
    if bash "$script" 2>&1 | tee "$LOG_DIR/${ac_id}.log"; then
        echo "[$ac_id] ✅ PASS"
        return 0
    else
        echo "[$ac_id] ❌ FAIL"
        return 1
    fi
}

require_tool() {
    local tool="$1"
    if ! command -v "$tool" &> /dev/null; then
        echo "[ERROR] Required tool not found: $tool"
        return 1
    fi
    echo "[OK] Tool available: $tool"
    return 0
}

require_tools() {
    local tools=("$@")
    local failed=0
    for tool in "${tools[@]}"; do
        require_tool "$tool" || failed=1
    done
    return $failed
}

require_service() {
    local name="$1"
    local url="$2"
    local timeout="${3:-30}"
    echo "Checking service: $name at $url"
    
    local start_time=$(date +%s)
    while true; do
        if curl -s --max-time 5 "$url" &> /dev/null; then
            echo "[OK] Service $name is ready"
            return 0
        fi
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        if [[ $elapsed -ge $timeout ]]; then
            echo "[ERROR] Service $name not ready after ${timeout}s"
            return 1
        fi
        echo "Waiting for $name... (${elapsed}s)"
        sleep 2
    done
}

db_query() {
    local db_path="$1"
    local query="$2"
    sqlite3 "$db_path" "$query"
}

get_talor_desktop_path() {
    echo "/Users/quinn.li/Desktop/talor/talor-desktop"
}

get_db_path() {
    echo "/Users/quinn.li/.talor/talor.db"
}

log_info() {
    echo "[INFO] $*"
}

log_error() {
    echo -e "${RED}[ERROR] $*${NC}" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN] $*${NC}"
}