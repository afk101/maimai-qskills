---
name: maimai-phone-exchange
description: 在脉脉人才银行消息列表中查看哪些候选人已交换手机号。通过 Chrome CDP 控制浏览器，分段滚动虚拟化消息列表，按日期筛选并汇总"对方已与您交换手机号"的候选人。当用户要求查看脉脉消息、谁回复了、谁交换了电话、查看沟通状态时使用此 skill。依赖 chrome-cdp skill。
---

# 脉脉消息 - 查看交换手机号

## 前置条件

同 maimai-batch-message：Chrome 调试模式运行，已登录脉脉，`CDP_PORT_FILE` 已设置。

## 流程

### 进入消息页面

消息页在 iframe 中，直接 nav 到 iframe src URL：

```bash
$CDP nav <target> "https://maimai.cn/chat?fr=ent&in_iframe=1&scene=talent_bank&ui_type=page"
sleep 5
```

### 收集交换手机号记录

消息列表虚拟化渲染，DOM 仅保留视口内容。**关键特点：消息按时间从新到旧排列**，所以**直接从顶部开始往下滚动即可**，看到"昨天"就可以停止，不需要先滚到底加载全部。

**推荐方式：用 `snap`（无障碍树）收集**，比 DOM querySelector 更可靠稳定。

快速版：直接运行 [scripts/collect-exchanges.sh](scripts/collect-exchanges.sh)。

手动版：

```bash
# 找到可滚动列表容器并滚到顶部
$CDP eval <target> "
  var divs = document.querySelectorAll('div');
  var best = null;
  for (var i = 0; i < divs.length; i++) {
    var d = divs[i];
    if (d.scrollHeight > d.clientHeight + 50 && d.getBoundingClientRect().width < 350 && d.getBoundingClientRect().height > 300) {
      if (!best || d.scrollHeight > best.scrollHeight) best = d;
    }
  }
  if (!best) return 'NOT_FOUND';
  window._scrollList = best;
  best.scrollTop = 0;
  return 'ok, h=' + best.scrollHeight;
"

# 分段滚动 + snap 收集，每次步长约 350 CSS px（约 1-2 屏消息）
# 从顶部开始，看到"昨天"就停止
for step in $(seq 0 350 3000); do
  [ "$step" -gt 0 ] && $CDP eval <target> "
    try { window._scrollList.scrollTop = $step; } catch(e) {}
  "
  sleep 0.4

  # snap 输出无障碍树，每条消息结构：
  #   [heading] 人名
  #   [StaticText] 人名
  #   [StaticText] ·公司职位
  #   [StaticText] HH:MM 或 "昨天"
  #   [StaticText] 对方已与您交换手机号
  $CDP snap <target> 2>&1 | grep -E "交换手机号|昨天"

  # 如果出现"昨天"说明已到昨日消息，退出
done
```

### 数据提取技巧

snap 输出中每条消息的完整上下文用 `grep -B5 "交换手机号"` 获取：

```
[heading] 张康康          ← 人名
[StaticText] 张康康
[StaticText] ·上海零壹思维智能网络科技有限公司技术合伙人兼ceo  ← 公司职位
[StaticText] 12:20        ← 时间（HH:MM = 今天，"昨天" = 昨天）
[StaticText] 对方已与您交换手机号  ← 状态
```

去重：多次滚动会重复获取同一条消息，最终结果需要 `sort -u` 去重。

### 筛选结果

状态分类：

| 系统提示 | 含义 |
|----------|------|
| 对方已与您交换手机号 | ✅ 成功交换 |
| 对方忽略了您交换手机号的申请 | ❌ 被拒绝 |
| 您向对方发起了交换手机号的申请 | ⏳ 已发起，等待中 |
| 已发起交换手机号申请，等待XXX处理中 | ⏳ 等待对方处理 |

日期判断：今天消息时间为 `HH:MM`，昨天/更早为 `昨天` 或 `MM/DD`。

### 输出格式

```
今天（MM-DD）交换手机号成功的人：
1. 人名 — 公司，职位，HH:MM
2. ...

其他状态：
- XXX（公司）— 忽略了申请
- XXX（公司）— 等待处理
```

## 注意事项

- **消息从新到旧排列**：顶部是最新的，往下是更早的。看到"昨天"就停止。
- **不用滚到底**：之前的方式（先滚到底加载全部再滚回来）浪费 20-40 秒，完全没必要。
- **snap 比 DOM querySelector 更可靠**：snap 输出结构化无障碍树，不受 CSS 类名变化影响。
- **滚动步长 350px 足够**：确保每屏消息不会因步长太大而跳过。
- 手机号**不直接显示**在消息列表中，需进入具体聊天查看（网页端可能脱敏，完整号码在 App 查看）
- 详见 [references/pitfalls.md](references/pitfalls.md)
