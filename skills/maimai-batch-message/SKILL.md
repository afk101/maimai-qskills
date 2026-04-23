---
name: maimai-batch-message
description: 在脉脉人才银行搜索人才、批量勾选候选人、JD匹配、发送沟通消息。通过 Chrome CDP 控制浏览器完成搜索→筛选→简历匹配→批量勾选→沟通的完整流程。当用户要求在脉脉上搜索人才、找人、发消息给候选人、人才银行操作时使用此 skill。依赖 chrome-cdp skill。
---

# 脉脉人才银行 - 批量沟通

## 前置条件

1. Chrome 已开启远程调试（`chrome://inspect/#remote-debugging`），已登录脉脉
2. `cdp.mjs list` 可看到人才银行 tab 的 targetId
3. 当前页面在人才银行搜索结果列表

## 脚本总览

| 脚本 | 用途 | 用法 |
|------|------|------|
| `scripts/auto-filter.mjs` | 搜索+全部筛选（城市/年限/性别/学历/年龄） | `node auto-filter.mjs <target> --keyword 智能体 --city 北京 --age-min 25 --age-max 33 [--no-search] [--no-filter]` |
| `scripts/set-age.cjs` | 单独设置年龄筛选（搜索重置+键盘导航方案） | `node set-age.cjs <target> <minAge> <maxAge>` |
| `scripts/read-candidates.mjs` | 读取候选人列表，输出 JSON | `node read-candidates.mjs <target> [output.json]` |
| `scripts/batch-communicate.mjs` | 读取+JD匹配+批量勾选+发送沟通 | `node batch-communicate.mjs <target> [--score-min N] [--message "msg"] [--keywords "kw1,kw2"] [--dry-run]` |
| `scripts/send-keys.cjs` | 通用键盘事件发送（通过 CDP daemon socket） | `node send-keys.cjs <target> <key> <count> [--sleep N]` |

所有脚本路径相对于 skill 目录：`~/.openclaw/workspace/skills/maimai-batch-message/scripts/`

## 完整流程

### Step 1: 搜索 + 筛选

```bash
node scripts/auto-filter.mjs <target> --keyword <关键词> --city <城市> \
  --education <学历> --experience <年限> --gender <性别> \
  --age-min <最小年龄> --age-max <最大年龄>
```

- `--no-search` 跳过搜索步骤（页面已有搜索结果时使用）
- `--no-filter` 跳过筛选步骤（只搜索不筛选时使用）
- 筛选结果后等待 3s 页面刷新，底部显示候选人总数

### Step 2: 读取候选人 + JD 匹配

`batch-communicate.mjs` 内置了候选人读取和 JD 匹配，无需单独运行。如需单独分析：

```bash
node scripts/read-candidates.mjs <target> /tmp/candidates.json
```

输出 JSON 数组，每人含 `name`、`info`（卡片完整文本）、`canContact`、`alreadyContacted`。

**匹配逻辑**：内置关键词列表对 `info` 字段打分（`--score-min` 控制阈值，默认 2 分）。

### Step 3: 批量勾选 + 发送沟通

```bash
# 预览模式（只勾选不发送，自动取消勾选）
node scripts/batch-communicate.mjs <target> --score-min 2 --keywords "ai agent,智能体,prompt,大模型" --dry-run

# 正式发送
node scripts/batch-communicate.mjs <target> --score-min 2 --keywords "ai agent,智能体,prompt,大模型" --message "您好，方便聊聊吗？"
```

> **注意**：`--keywords` 是 JD 匹配关键词，由 AI 根据用户提供的岗位描述动态生成，不写死在脚本中。不传 `--keywords` 时所有候选人均 0 分，不会自动勾选（等同于跳过匹配）。

流程：
1. 读取候选人列表
2. JD 关键词匹配打分，筛选 ≥ scoreMin 的人
3. 逐个 `scrollIntoView` → `.ant-checkbox-input.click()` 勾选
4. 点击头部批量"立即沟通"按钮（`mui-btn-noBackground`，勾选后出现）
5. 弹窗中**先清空输入框再填入预制文案**（`select()` → `Backspace` → `type`，不能用 `value=""`，否则 React 状态未清空会追加而非替换） → 勾选"发送后留在此页" → 发送

> ⚠️ **清空输入框是关键步骤！** React 受控组件的 textarea，直接 `value=""` 只改 DOM 不改 React 内部状态，后续 `Input.insertText` 会追加到旧文案后面。正确做法：`focus()` → `select()` 全选 → `Backspace` 删除（触发 React onChange） → 再 `type` 新文案。

## 异常处理

### 职位已关闭
弹窗提示"当前职位已关闭" → 点"重启职位" → 确认 → **勾选状态丢失，需重新运行**

### 企业号已添加
弹窗提示"N位人才已被企业号添加为联系人" → 点"知道了" → 从列表排除已联系的人，重新勾选发送

## 关键踩坑

### cdp.mjs @file 支持
`eval` 和 `evalraw` 命令支持 `@filepath` 参数从文件读取内容，避免 shell 引号问题：
```bash
cdp.mjs eval <target> @script.js
cdp.mjs evalraw <target> Input.dispatchKeyEvent @params.json
```

### 点击方式

| 操作 | 推荐方式 | 说明 |
|------|----------|------|
| 筛选面板（城市/年限/性别） | `eval` + `.click()` | 在弹出层 fixed/absolute 内搜索避免点到候选人卡片 |
| 学历要求 | `eval` + `.click()` | 面板+子弹窗，两步选择 |
| 年龄筛选 | `set-age.cjs` | **搜索重置+键盘导航**（见下方） |
| 复选框勾选 | `eval` + `cb.click()` | React checkbox 用原生 click 即可 |
| 批量"立即沟通" | `cdp.mjs click` | 勾选后头部出现的 `mui-btn-noBackground` 按钮 |
| 消息输入 | `cdp.mjs type` | ⚠️ **必须先清空再输入**：`focus()` → `select()` → `Backspace` → `type`。不能只 `value=""`，React 受控组件状态不会被清除 |

### 年龄筛选（set-age.cjs）原理
- 打开年龄面板 → 读取当前 select 值和坐标
- **如果当前已有筛选值**（非"不限"）→ Escape 关闭面板 → 重新搜索同一关键词（重置所有筛选）→ 重新打开面板
- 从"不限"状态出发，mouseClick 打开每个 select → ArrowDown 键盘导航到目标年龄（minAge - 15 次 ArrowDown）→ Enter 确认
- 点击"确定"按钮提交
- 关键：`Runtime.evaluate`（eval/evalraw）会关闭 select 下拉，但 `Input.dispatchKeyEvent` 不会

### send-keys.cjs 通用键盘工具
- 通过 CDP daemon socket 直接发送 `Input.dispatchKeyEvent`，比 execSync 调用 cdp.mjs 快得多
- 支持：ArrowDown、ArrowUp、Enter、Home、End、Escape
- `--sleep` 控制按键间隔（默认 15ms）
- 被 `set-age.cjs` 内部使用，也可独立调用
