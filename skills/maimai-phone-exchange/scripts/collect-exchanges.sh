#!/bin/bash
# 脉脉消息 - 收集交换手机号记录（优化版）
# 用法: ./collect-exchanges.sh <target_id>
#   target_id: CDP 目标 ID 前缀
# 依赖: CDP_PORT_FILE 环境变量，chrome-cdp skill
#
# 核心改进：
#   1. 消息从新到旧排列，直接从顶部开始，看到"昨天"就停
#   2. 用 snap（无障碍树）代替 DOM querySelector，更稳定
#   3. 无需先滚到底加载全部，大幅减少时间（5s vs 30s+）

set -euo pipefail

TARGET="${1:?用法: $0 <target_id>}"
CDP_PORT_FILE="${CDP_PORT_FILE:-$HOME/ChromeDebug9222/DevToolsActivePort}"
CDP="${CDP:-$HOME/.openclaw/workspace/skills/chrome-cdp/scripts/cdp.mjs}"

# 1. 导航到消息页面
echo "[1/3] 导航到消息页面..."
node "$CDP" nav "$TARGET" \
  "https://maimai.cn/chat?fr=ent&in_iframe=1&scene=talent_bank&ui_type=page" >/dev/null 2>&1
sleep 5

# 2. 找到可滚动列表并滚到顶部
echo "[2/3] 初始化滚动容器..."
node "$CDP" eval "$TARGET" "
  var divs = document.querySelectorAll('div');
  var best = null;
  for (var i = 0; i < divs.length; i++) {
    var d = divs[i];
    if (d.scrollHeight > d.clientHeight + 50 && d.getBoundingClientRect().width < 350 && d.getBoundingClientRect().height > 300) {
      if (!best || d.scrollHeight > best.scrollHeight) best = d;
    }
  }
  if (!best) { return 'ERROR: NOT_FOUND'; }
  window._scrollList = best;
  best.scrollTop = 0;
  return 'ok, h=' + best.scrollHeight;
" 2>&1

# 3. 分段滚动 + snap 收集
echo "[3/3] 收集交换手机号记录..."
ALL_RAW=""
FOUND_TODAY=false
FOUND_YESTERDAY=false

for step in $(seq 0 350 3000); do
  # 滚动
  [ "$step" -gt 0 ] && node "$CDP" eval "$TARGET" "
    try { window._scrollList.scrollTop = $step; } catch(e) {}
  " >/dev/null 2>&1
  sleep 0.4

  # 用 snap 获取当前可见区域的无障碍树
  SNAP=$(node "$CDP" snap "$TARGET" 2>&1)

  # 检查是否到了昨天的消息
  if echo "$SNAP" | grep -q "昨天"; then
    # 即使到了昨天，也把昨天的交换手机号记录收集进来（用于区分）
    FOUND_YESTERDAY=true
    EXCHANGES=$(echo "$SNAP" | grep -B5 "交换手机号" | grep -E "heading|StaticText")
    if [ -n "$EXCHANGES" ]; then
      ALL_RAW="$ALL_RAW
=== YESTERDAY ===
$EXCHANGES"
    fi
    echo "  到达昨日消息，停止滚动"
    break
  fi

  # 收集含"交换手机号"的条目上下文（前后5行）
  EXCHANGES=$(echo "$SNAP" | grep -B5 "交换手机号" | grep -E "heading|StaticText")
  if [ -n "$EXCHANGES" ]; then
    FOUND_TODAY=true
    ALL_RAW="$ALL_RAW
$EXCHANGES"
  fi
done

# 输出结果
echo ""
echo "====== 交换手机号汇总 ======"

if [ "$FOUND_TODAY" = true ]; then
  echo ""
  echo "✅ 今天成功交换手机号："
  # 提取格式: 人名 — 公司职位，时间
  echo "$ALL_RAW" | grep -B3 "对方已与您交换手机号" | grep -v "昨天\|=== YESTERDAY ===\|--" | \
    awk '
    /\[heading\]/ { name=$0; gsub(/.*\[heading\]\s*/, "", name) }
    /\[StaticText\]\s*·/ { company=$0; gsub(/.*\[StaticText\]\s*·?/, "", company) }
    /\[StaticText\]\s*[0-9]/ { time=$0; gsub(/.*\[StaticText\]\s*/, "", time); if (time ~ /^[0-9]/) print name " — " company "，" time }
    /交换手机号$/ { if (name != "" && time == "") print name " — " company }
    ' | sort -u -t'，' -k2 -r

  echo ""
  echo "⏳ 等待处理："
  echo "$ALL_RAW" | grep -B3 "发起了交换手机号的申请" | grep -v "昨天\|=== YESTERDAY ===\|--" | \
    awk '
    /\[heading\]/ { name=$0; gsub(/.*\[heading\]\s*/, "", name) }
    /\[StaticText\]\s*·/ { company=$0; gsub(/.*\[StaticText\]\s*·?/, "", company) }
    /\[StaticText\]\s*[0-9]/ { time=$0; gsub(/.*\[StaticText\]\s*/, "", time); if (time ~ /^[0-9]/) print name "（" company "）— 等待处理，" time }
    ' | sort -u

  echo ""
  echo "❌ 被拒绝："
  echo "$ALL_RAW" | grep -B3 "忽略了" | grep -v "昨天\|=== YESTERDAY ===\|--" | \
    awk '
    /\[heading\]/ { name=$0; gsub(/.*\[heading\]\s*/, "", name) }
    /\[StaticText\]\s*·/ { company=$0; gsub(/.*\[StaticText\]\s*·?/, "", company) }
    /\[StaticText\]\s*[0-9]/ { time=$0; gsub(/.*\[StaticText\]\s*/, "", time); if (time ~ /^[0-9]/) print name "（" company "）— 忽略了申请，" time }
    ' | sort -u
else
  echo ""
  echo "今天暂无交换手机号记录"
fi
