#!/usr/bin/env bash
# VFIB Marketing OS V0.1.3 —— 交付源码包打包脚本
#
# 产物：<仓库根>/VFIB_MARKETING_OS_V0.1.3_SOURCE.zip
#   = 完整可运行源码 + 变更日志 + 分阶段报告（reports/）+ 测试证据（TEST_EVIDENCE_*）
#     + 浏览器操作证据（UI_EVIDENCE/ 三段阶段证据 + UI_EVIDENCE_*）+ AI 接口调用证据（REAL_PROVIDER_EVIDENCE/）
#     + V1.1 / V1.2 两代交付包与联合验收报告
#
# 严格排除（绝不入库/入包）：
#   data/、config.json、.env、.workbuddy/、node_modules/、*.log、data-mos-*/、.git/
#
# 用法：bash tools/package-mos-source.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
# 版本号自动取 package.json（曾写死 V0.1.3 导致 V0.1.4+ 打包名过期）
APP_VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
NAME="VFIB_MARKETING_OS_V${APP_VERSION}_SOURCE"
STAGE="dist/${NAME}"
OUT="${ROOT}/${NAME}.zip"

echo "[package] 仓库：$ROOT"
echo "[package] 暂存区：$STAGE"
# 只清理**本脚本自己的**暂存目录，不整体清空 dist/（dist/ 另含 SHA256SUMS.txt 与其他历史暂存）
rm -rf "$STAGE"
mkdir -p "$STAGE"

# ---------- 1. 源码与文档（逐项显式列举，避免误收敏感文件） ----------
copy() { # copy <relative-path>
  if [ -e "$1" ]; then
    cp -r "$1" "$STAGE/"
    echo "  + $1"
  else
    echo "  ! 缺失（跳过）：$1"
  fi
}

copy server.js
copy package.json
copy config.example.json
copy .env.example
copy README.md
copy CHANGELOG.md
copy lib
copy public
copy tools
copy docs
copy reports
# ---------- 1b. V1.1 三包整改交付物（MARKETING_HANDOFF_BUNDLE_V1.1 + 联合验收报告） ----------
copy MARKETING_HANDOFF_BUNDLE_V1.1
copy JOINT_ACCEPTANCE_REPORT.md
# ---------- 1c. V1.2 整改交付物（MARKETING_HANDOFF_BUNDLE_V1.2 + 联合验收报告 V1.2） ----------
copy MARKETING_HANDOFF_BUNDLE_V1.2
copy JOINT_ACCEPTANCE_REPORT_V1.2.md
# ---------- 1d. V0.1.2 执行包强制交付文件 ----------
copy PHASE0_BASELINE_AND_IMPACT.md
copy PHASE_A_UI_AND_I18N_REPORT.md
copy PHASE_B_AI_INTELLIGENCE_REPORT.md
copy PHASE_C_TASK_WORKFLOW_REPORT.md
copy SPECIAL01_SOURCE_MAPPING.md
copy PROVIDER_REAL_MOCK_MATRIX.md
copy SECURITY_REGRESSION_REPORT.md
copy E2E_RUN_LOG.md
copy MIGRATION_AND_ROLLBACK.md
copy docs/RELEASE_REGISTER.md
copy FINAL_ACCEPTANCE_V0.1.2.md
copy UI_SCREENSHOTS
# ---------- 1e. V0.1.3 五阶段交付物 ----------
# 阶段报告在 reports/（已整目录入包）：PHASE0_BASELINE.md / PHASE_A_UX.md /
# PHASE_B_REAL_RESEARCH.md / PHASE_C_CONTENT_I18N.md / FINAL_ACCEPTANCE_V0.1.3.md / OPEN_ITEMS_V0.1.3.md
copy REAL_PROVIDER_EVIDENCE
copy UI_EVIDENCE

# ---------- 2. 测试证据（必需交付物 ⑤） ----------
for d in TEST_EVIDENCE_MOS_BUILD01 TEST_EVIDENCE_MOS_BUILD02 TEST_EVIDENCE_MOS_BUILD03 \
         TEST_EVIDENCE_MOS_BUILD04 TEST_EVIDENCE_MOS_BUILD06 \
         TEST_EVIDENCE_MOS_V012_RESEARCH TEST_EVIDENCE_MOS_V012_EDITORIAL \
         TEST_EVIDENCE_MOS_V013_STUDIO TEST_EVIDENCE_MOS_V013_RESEARCH \
         TEST_EVIDENCE_MOS_V013_I18N \
         UI_EVIDENCE_MOS_BUILD01 UI_EVIDENCE_MOS_BUILD02 UI_EVIDENCE_MOS_BUILD03 \
         UI_EVIDENCE_MOS_BUILD04 UI_EVIDENCE_MOS_BUILD05; do
  [ -d "$d" ] && copy "$d"
done

# ---------- 3. 安全兜底：确保敏感物不在暂存区 ----------
for bad in data config.json .env .workbuddy node_modules; do
  if [ -e "$STAGE/$bad" ]; then
    echo "[package] ⚠ 移除敏感路径：$bad"
    rm -rf "$STAGE/$bad"
  fi
done
find "$STAGE" -name '*.log' -delete 2>/dev/null || true
find "$STAGE" -name 'data-mos-*' -prune -exec rm -rf {} + 2>/dev/null || true
# 二次核验：任何疑似凭据文件都不允许残留
if find "$STAGE" -name 'config.json' -o -name '.env' -o -name 'mos.json' | grep -q .; then
  echo "[package] ✖ 检测到疑似含凭据文件，已中止打包"; exit 1
fi

# ---------- 4. 生成 manifest ----------
{
  echo "# ${NAME}"
  echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# git: $(git rev-parse --short HEAD 2>/dev/null || echo 'n/a') $(git log -1 --pretty=%s 2>/dev/null || echo '')"
  echo "# files:"
  (cd "$STAGE" && find . -type f | sed 's#^\./##' | sort)
} > "$STAGE/PACKAGE_MANIFEST.txt"
echo "[package] manifest：$(grep -c '^' "$STAGE/PACKAGE_MANIFEST.txt") 行（含表头）"

# ---------- 5. 压缩（优先零依赖 Node 写入器，跨平台正斜杠路径） ----------
rm -f "$OUT"
NODE_BIN="${NODE:-node}"
if command -v "$NODE_BIN" >/dev/null 2>&1; then
  "$NODE_BIN" tools/mos-zip.js "$OUT" "$STAGE"
elif command -v zip >/dev/null 2>&1; then
  (cd dist && zip -qr "$OUT" "$NAME")
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -NonInteractive -Command \
    "Compress-Archive -Path 'dist\\${NAME}' -DestinationPath '${NAME}.zip' -Force" >/dev/null
else
  echo "[package] ✖ 未找到 node / zip / powershell.exe，无法生成 ZIP"; exit 1
fi

echo "[package] 产物：$OUT"
ls -la "$OUT"
if command -v sha256sum >/dev/null 2>&1; then
  # 只在清单里记裸文件名（不用绝对路径），便于跨机校验
  (cd "$ROOT" && sha256sum "$(basename "$OUT")") | tee dist/SHA256SUMS.txt
fi
echo "[package] 完成。"
