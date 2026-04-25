#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

LOG_FILE="$LOG_DIR/run-all.log"
mkdir -p "$LOG_DIR"

echo "========================================="
echo "MCP Phase 6 Verification - Run All ACs"
echo "========================================="
echo "Start time: $(date)"
echo "Log file: $LOG_FILE"
echo ""

TOTAL=0
PASSED=0
FAILED=0
FAILED_AC=""

echo "[Phase 1] Environment Setup..."
if ! bash "$SCRIPT_DIR/_env-setup.sh" 2>&1 | tee -a "$LOG_FILE"; then
    echo "[ERROR] Environment setup failed"
    exit 1
fi
echo ""

AC_LIST=(
    "ac-001-01.sh"
    "ac-001-02.sh"
    "ac-001-03.sh"
    "ac-002-01.sh"
    "ac-002-02.sh"
    "ac-002-03.sh"
    "ac-003-01.sh"
    "ac-003-02.sh"
    "ac-004-01.sh"
    "ac-007-01.sh"
    "ac-007-02.sh"
    "ac-007-03.sh"
    "ac-007-04.sh"
    "ac-008-01.sh"
    "ac-008-02.sh"
)

echo "[Phase 2] Running AC Verification..."
for ac_script in "${AC_LIST[@]}"; do
    TOTAL=$((TOTAL + 1))
    ac_id="${ac_script%.sh}"
    echo ""
    echo "----------------------------------------"
    echo "Running: $ac_id"
    echo "----------------------------------------"
    
    set +e
    bash "$SCRIPT_DIR/$ac_script" 2>&1 | tee -a "$LOG_FILE"
    exit_code=${PIPESTATUS[0]}
    set -e
    
    if [[ $exit_code -eq 0 ]]; then
        PASSED=$((PASSED + 1))
        echo "[$ac_id] ✅ PASS"
    else
        FAILED=$((FAILED + 1))
        FAILED_AC="$FAILED_AC $ac_id"
        echo "[$ac_id] ❌ FAIL"
    fi
done

echo ""
echo "========================================="
echo "Verification Complete!"
echo "========================================="
echo "Total ACs: $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
if [[ -n "$FAILED_AC" ]]; then
    echo "Failed ACs:$FAILED_AC"
fi
echo "End time: $(date)"
echo ""

echo "[Phase 3] Cleanup..."
bash "$SCRIPT_DIR/_cleanup.sh" 2>&1 | tee -a "$LOG_FILE" || true

echo ""
echo "总计: PASS=$PASSED, FAIL=$FAILED"

if [[ $FAILED -gt 0 ]]; then
    echo "❌ VERIFICATION FAILED"
    exit 1
else
    echo "✅ ALL ACs PASSED"
    exit 0
fi