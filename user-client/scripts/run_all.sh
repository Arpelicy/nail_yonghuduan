#!/bin/bash
# 一键运行三个数据生成脚本（按顺序）
# 用法：bash scripts/run_all.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== [1/3] 生成趋势仿真数据 ==="
python3 scripts/simulate_nail_trends.py

echo ""
echo "=== [2/3] 构建运营 mock 数据 ==="
python3 scripts/build_xhs_operational_mock.py

echo ""
echo "=== [3/3] 导入 SQLite ==="
python3 scripts/import_simulation_to_sqlite.py

echo ""
echo "✓ 全部完成。mock-server 会在 500ms 内自动重载 CSV 数据。"
