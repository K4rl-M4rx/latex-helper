#!/bin/bash
# 清理项目 temp/ 目录（公式预览编译缓存、调试产物等）
# 用法：./scripts/clean-temp.command  或双击运行

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR="$PROJECT_DIR/temp"

echo "======================================"
echo "  LaTeX Helper · 清理 temp"
echo "======================================"
echo "项目目录：$PROJECT_DIR"
echo "目标目录：$TEMP_DIR"
echo ""

if [ ! -d "$TEMP_DIR" ]; then
    echo "ℹ️  temp/ 不存在，无需清理。"
    exit 0
fi

# 统计后再删，方便确认
COUNT=$(find "$TEMP_DIR" -mindepth 1 | wc -l | tr -d ' ')
SIZE=$(du -sh "$TEMP_DIR" 2>/dev/null | awk '{print $1}')

echo "将删除 temp/ 下 $COUNT 项（约 $SIZE）。"
read -r -p "确定继续？[y/N] " ans
if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
    echo "已取消。"
    exit 0
fi

rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
echo "✅ 已清空：$TEMP_DIR"
