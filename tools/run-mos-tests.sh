#!/usr/bin/env bash
# VFIB Marketing OS V0.1.1 —— BUILD-01/02/03 + V0.1 综合整改 + V1.2 整改 回归测试统一入口
#
# 用法: bash tools/run-mos-tests.sh [smoke|unit|sec|sched|provider|workspace|dual|e2e|e2e02|e2e03|ui|research|editorial|studio|build06|joint|all]
#       注：`joint`（双系统真实 HTTP 端到端）与 `build06`（V1.2 双系统真实 HTTP 安全负例）需要同机存在
#           企业资料库源码，故**均不纳入 all**，需按需显式运行。
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
if [ "$SUITES" = "all" ] || [ "$SUITES" = "sched" ]; then run_one sched tools/mos-scheduler-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "provider" ]; then run_one provider tools/mos-provider-contract-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "workspace" ]; then run_one workspace tools/mos-workspace-contract-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "dual" ]; then run_one dual tools/mos-dual-identity-test.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e"   ]; then run_one e2e   tools/mos-e2e-test.js;   fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e02" ]; then run_one e2e02 tools/mos-e2e-build02.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "e2e03" ]; then run_one e2e03 tools/mos-e2e-build03.js; fi
if [ "$SUITES" = "all" ] || [ "$SUITES" = "ui"    ]; then run_one ui    tools/mos-ui-check.js;   fi
# V0.1.2 Phase B：AI 情报研究 / 候选选题（真实 HTTP + 隔离实例；单机即可，纳入 all）
if [ "$SUITES" = "all" ] || [ "$SUITES" = "research" ]; then run_one research tools/mos-e2e-v012-research.js; fi
# V0.1.2 Phase C：编辑域（批准入池 / 幂等 Saga 派工 / 同源视图）
if [ "$SUITES" = "all" ] || [ "$SUITES" = "editorial" ]; then run_one editorial tools/mos-e2e-v012-editorial.js; fi

# V0.1.3 Phase A：一站式任务工作空间（真实 HTTP + 隔离实例；纳入 all）
if [ "$SUITES" = "all" ] || [ "$SUITES" = "studio" ]; then run_one studio tools/mos-e2e-v013-studio.js; fi
# `joint` / `build06` 需要同机存在资料库源码，因此**不纳入 all**（避免在他机 CI 上出现假失败）；按需显式运行：
#   bash tools/run-mos-tests.sh joint      # V1.1 双系统真实 HTTP 正向端到端
#   bash tools/run-mos-tests.sh build06    # V1.2 双系统真实 HTTP 安全负例 + B1 正式输出门禁
if [ "$SUITES" = "joint" ]; then run_one joint tools/mos-e2e-build04-dual.js; fi
if [ "$SUITES" = "build06" ]; then run_one build06 tools/mos-e2e-build06-dual.js; fi

# 汇总：把各套件 JSON 归并成 summary.json（BUILD-01 / 02 / 03 证据目录合并统计）
"$NODE" -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const dirs = ["TEST_EVIDENCE_MOS_BUILD01", "TEST_EVIDENCE_MOS_BUILD02", "TEST_EVIDENCE_MOS_BUILD03", "TEST_EVIDENCE_MOS_BUILD04", "TEST_EVIDENCE_MOS_BUILD06", "TEST_EVIDENCE_MOS_V012_RESEARCH", "TEST_EVIDENCE_MOS_V012_EDITORIAL", "TEST_EVIDENCE_MOS_V013_STUDIO"];
const files = {
  smoke: "smoke-result.json",
  unit: "unit-result.json",
  sec: "security-egress-result.json",
  sched: "scheduler-result.json",
  provider: "provider-contract-result.json",
  workspace: "workspace-contract-result.json",
  dual: "dual-identity-result.json",
  e2e: "e2e-result.json",
  e2e02: "e2e-build02-result.json",
  e2e03: "e2e-build03-result.json",
  ui: "ui-check-result.json",
  research: "v012-research-result.json",
  editorial: "v012-editorial-result.json",
  studio: "v013-studio-result.json",
  joint: "dual-e2e-result.json",
  build06: "dual-security-result.json"
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
  project: "VFIB Marketing OS V0.1.1",
  build: "BUILD-01 + BUILD-02 + BUILD-03 + V0.1 综合整改（Phase 1—3）+ V1.2 整改（真实 HTTP 安全负例 / 正式输出门禁）",
  mosVersion: "0.1.1",
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
