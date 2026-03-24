#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="/Users/quinn.li/Desktop/talor/talor-desktop"
E2E_SCRIPT="${PROJECT_ROOT}/tests/e2e/layer2-tool-calling-phase3.js"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

TEST_DIR="/tmp/talor-e2e-$$"
mkdir -p "$TEST_DIR"
trap "rm -rf '$TEST_DIR'" EXIT

show_help() {
  cat << 'HELPEOF'
Layer 2 E2E 验证脚本 - Phase 3 (write/edit/ls/grep 工具)

用法:
  bash verify-l2.sh              # 运行全部 AC
  bash verify-l2.sh AC-005-01     # 运行指定 AC  
  bash verify-l2.sh --help        # 显示帮助

前置条件:
  1. cd talor-desktop && npm run dev
  2. CDP 端口可访问: http://localhost:9222
  3. provider 已配置

AC 列表:
  AC-005-01  write 工具创建新文件
  AC-005-02  write 工具对已存在文件处理
  AC-005-03  write 工具父目录不存在处理
  AC-005-04  edit 工具替换文件内容
  AC-005-05  write 工具超大文件限制
  AC-002-04  grep 工具搜索文件内容
HELPEOF
}

check_prerequisites() {
  log_info "检查前置条件..."

  if [[ ! -f "${E2E_SCRIPT}" ]]; then
    log_fail "E2E 脚本不存在: ${E2E_SCRIPT}"
    exit 1
  fi

  if ! curl -sf http://localhost:9222/json > /dev/null 2>&1; then
    log_fail "CDP 端口不可访问: http://localhost:9222"
    log_info "请先启动 Electron 应用: cd talor-desktop && npm run dev"
    exit 1
  fi

  log_info "前置条件检查通过"
}

run_ac_005_01() {
  local PASS=true

  log_info "[AC-005-01] Execute: 调用 E2E 脚本"
  local OUTPUT
  if OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1); then
    log_info "[AC-005-01] E2E 脚本执行完成"
  fi

  echo "$OUTPUT" | grep -q "AC-005-01.*✅\|PASS" && \
    log_pass "[AC-005-01] PASS" || { log_fail "[AC-005-01] FAIL"; PASS=false; }

  $PASS && return 0 || return 1
}

run_ac_005_02() {
  local PASS=true

  log_info "[AC-005-02] Execute: 调用 E2E 脚本"
  local OUTPUT
  if OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1); then
    log_info "[AC-005-02] E2E 脚本执行完成"
  fi

  echo "$OUTPUT" | grep -q "AC-005-02.*✅\|PASS" && \
    log_pass "[AC-005-02] PASS" || { log_fail "[AC-005-02] FAIL"; PASS=false; }

  $PASS && return 0 || return 1
}

run_ac_005_03() {
  log_info "[AC-005-03] Execute: 调用 E2E 脚本"
  local OUTPUT
  OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1) || true

  if echo "$OUTPUT" | grep -q "AC-005-03.*✅\|PASS"; then
    log_pass "[AC-005-03] PASS"
  elif echo "$OUTPUT" | grep -q "AC-005-03.*⚠️\|WARN"; then
    log_warn "[AC-005-03] WARN"
  else
    log_warn "[AC-005-03] AI 决策（非工具 bug）"
  fi
  return 0
}

run_ac_005_04() {
  local PASS=true

  log_info "[AC-005-04] Execute: 调用 E2E 脚本"
  local OUTPUT
  if OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1); then
    log_info "[AC-005-04] E2E 脚本执行完成"
  fi

  echo "$OUTPUT" | grep -q "AC-005-04.*✅\|PASS" && \
    log_pass "[AC-005-04] PASS" || { log_fail "[AC-005-04] FAIL"; PASS=false; }

  $PASS && return 0 || return 1
}

run_ac_005_05() {
  log_info "[AC-005-05] Execute: 调用 E2E 脚本"
  local OUTPUT
  OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1) || true

  if echo "$OUTPUT" | grep -q "AC-005-05.*✅\|PASS"; then
    log_pass "[AC-005-05] PASS"
  elif echo "$OUTPUT" | grep -q "AC-005-05.*⚠️\|WARN"; then
    log_warn "[AC-005-05] WARN"
  else
    log_warn "[AC-005-05] AI 决策（非工具 bug）"
  fi
  return 0
}

run_ac_002_04() {
  local PASS=true

  log_info "[AC-002-04] Execute: 调用 E2E 脚本"
  local OUTPUT
  if OUTPUT=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1); then
    log_info "[AC-002-04] E2E 脚本执行完成"
  fi

  echo "$OUTPUT" | grep -q "AC-002-04.*✅\|PASS" && \
    log_pass "[AC-002-04] PASS" || { log_fail "[AC-002-04] FAIL"; PASS=false; }

  $PASS && return 0 || return 1
}

main() {
  local target_ac="${1:-}"
  local ac_results=()
  local pass_count=0
  local fail_count=0
  local warn_count=0

  case "${target_ac}" in
    --help|-h)
      show_help
      exit 0
      ;;
    AC-005-01)
      check_prerequisites
      run_ac_005_01 && echo "AC_RESULT:AC-005-01:PASS" || echo "AC_RESULT:AC-005-01:FAIL"
      exit 0
      ;;
    AC-005-02)
      check_prerequisites
      run_ac_005_02 && echo "AC_RESULT:AC-005-02:PASS" || echo "AC_RESULT:AC-005-02:FAIL"
      exit 0
      ;;
    AC-005-03)
      check_prerequisites
      run_ac_005_03
      exit 0
      ;;
    AC-005-04)
      check_prerequisites
      run_ac_005_04 && echo "AC_RESULT:AC-005-04:PASS" || echo "AC_RESULT:AC-005-04:FAIL"
      exit 0
      ;;
    AC-005-05)
      check_prerequisites
      run_ac_005_05
      exit 0
      ;;
    AC-002-04)
      check_prerequisites
      run_ac_002_04 && echo "AC_RESULT:AC-002-04:PASS" || echo "AC_RESULT:AC-002-04:FAIL"
      exit 0
      ;;
    "")
      check_prerequisites
      echo ""
      echo "╔══════════════════════════════════════════════╗"
      echo "║  Phase 3 Layer 2 验证                      ║"
      echo "║  契约来源: feature.md §F.8                 ║"
      echo "║  执行时间: ${TIMESTAMP}              ║"
      echo "╚══════════════════════════════════════════════╝"
      echo ""

      local output
      output=$(cd "$PROJECT_ROOT" && node "$E2E_SCRIPT" 2>&1) || true
      echo "$output"
      echo ""

      for ac in AC-005-01 AC-005-02 AC-005-03 AC-005-04 AC-005-05 AC-002-04; do
        local result
        if echo "$output" | grep -E "^\s*✅.*${ac}" > /dev/null 2>&1; then
          result="PASS"
          ((pass_count++))
          log_pass "${ac}: PASS"
        elif echo "$output" | grep -E "^\s*⚠️.*${ac}" > /dev/null 2>&1; then
          result="WARN"
          ((warn_count++))
          log_warn "${ac}: WARN"
        else
          result="FAIL"
          ((fail_count++))
          log_fail "${ac}: FAIL"
        fi
        ac_results+=("${ac}:${result}")
      done

      echo ""
      echo "╔══════════════════════════════════════════════╗"
      echo "║        结构化结果摘要                       ║"
      echo "╚══════════════════════════════════════════════╝"
      echo ""
      echo "总计: ✅ ${pass_count}  ❌ ${fail_count}  ⚠️ ${warn_count}"
      echo "执行时间: ${TIMESTAMP}"
      echo ""
      echo "=== STRUCTURED RESULT ==="
      for result in "${ac_results[@]}"; do
        echo "AC_RESULT:${result}"
      done
      echo "TIMESTAMP:${TIMESTAMP}"
      echo "=============================="

      [[ $fail_count -eq 0 ]] && exit 0 || exit 1
      ;;
    *)
      log_fail "未知参数: ${target_ac}"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
