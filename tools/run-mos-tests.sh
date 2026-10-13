#!/usr/bin/env bash
# VFIB Marketing OS V0.1 —— BUILD-01/02/03 + V0.1 综合整改 回归测试统一入口
#
# 用法: bash tools/run-mos-tests.sh [smoke|unit|sec|e2e|e2e02|e2e03|ui|all]
#
# 设计要点：
#   - 每个子套件自带「独立数据目录 + 运行期随机口令」，互不干扰，也不触碰 data/。
#   - 全部结果为机器可读 JSON，统一归档到 TEST_EVIDENCE_MOS_BUILD01/，并由本脚本汇总 summary.json。
#   - 任一子套件失败 → 本脚本退出码非 0（可接入 CI）。
#   - ui 用例需要本机 Chrome/Edge（通过 CDP 驱动真实浏览器），缺失时按失败计。
set -uo pipefail
cd "$(dirname "$0")/.."

NODE="${NODE:-node}"
OUT_DIR="TEST_EVIDENCE_MOS_BUILD01"
SUITES="${1:-all}"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/summary.json"

declare -a RAN=()
declare -a FAILED=()

run_one() {
  local key="$1" file="$2"
  echo ""
  echo "============================================================"
  echo "  [$key] $file"
  echo "============================================================"
  "$NODE" "$file"
  local code=$?
  RAN+=("$key")
  if [ "$code" -ne 0 ]; then
    FAILED+=("$key")
    echo "[run-mos-tests] $key 失败（exit=$code）"
  else
    echo "[run-mos-tests] $key 通过"
  fi
  return 0
}

if [ "$SUITES" = "all" ] || [ "$SUITES" = "smoke" ]; then run_one smoke tools/mos-smoke-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "unit"  ]; then run_one unit  tools/mos-unit-test.js;  fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "sec"   ]; then run_one sec   tools/mos-security-egress-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e"   ]; then run_one e2e   tools/mos-e2e-test.js;   fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e02" ]; then run_one e2e02 tools/mos-e2e-build02.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e03" ]; then run_one e2e03 tools/mos-e2e-build03.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "ui"    ]; then run_one ui    tools/mos-ui-check.js;   fi

# 汇总：把各套件 JSON 归并成 summary.json（BUILD-01 / 02 / 03 证据目录合并统计）
"$NODE" -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const dirs = ["TEST_EVIDENCE_MOS_BUILD01", "TEST_EVIDENCE_MOS_BUILD02", "TEST_EVIDENCE_MOS_BUILD03"];
const files = {
  smoke: "smoke-result.json",
  unit: "unit-result.json",
  sec: "security-egress-result.json",
  e2e: "e2e-result.json",
  e2e02: "e2e-build02-result.json",
  e2e03: "e2e-build03-result.json",
  ui: "ui-check-result.json"
};
const suites = {};
let total = 0, passed = 0, failed = 0;
for (const dir of dirs) {
  for (const [key, rel] of Object.entries(files)) {
    if (suites[key]) continue;
    const p = path.join(root, dir, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      suites[key] = { file: path.join(dir, rel), total: j.total, passed: j.passed, failed: j.failed };
      total += j.total || 0; passed += j.passed || 0; failed += j.failed || 0;
    } catch (e) {
      suites[key] = { file: path.join(dir, rel), error: String(e.message) };
    }
  }
}
const out = {
  project: "VFIB Marketing OS V0.1",
  build: "BUILD-01 + BUILD-02 + BUILD-03 + V0.1 综合整改（Phase 1）",
  mosVersion: "0.1.0",
  ranAt: new Date().toISOString(),
  suites, total, passed, failed,
  ok: failed === 0 && Object.keys(suites).length > 0
};
fs.writeFileSync(path.join(root, dirs[0], "summary.json"), JSON.stringify(out, null, 2), "utf8");
console.log("\n汇总：" + passed + "/" + total + " 断言通过" + (out.ok ? "（全部套件通过）" : "（存在失败）"));
' "$(pwd)"

echo ""
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "[run-mos-tests] 失败套件：${FAILED[*]}"
  echo "[run-mos-tests] 证据目录：$OUT_DIR"
  exit 1
fi
if [ "${#RAN[@]}" -eq 0 ]; then
  echo "[run-mos-tests] 未识别任何套件：$SUITES"
  exit 2
fi
echo "[run-mos-tests] 全部套件通过：${RAN[*]}"
echo "[run-mos-tests] 证据目录：$OUT_DIR"
exit 0
