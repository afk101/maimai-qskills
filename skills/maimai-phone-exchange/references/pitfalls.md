# 踩坑记录

## iframe 跨域

脉脉人才银行 IM 页面在 `<iframe id="imIframe">` 中，主页面 snap/eval 无法访问 iframe DOM。直接 nav 到 iframe src：
```
https://maimai.cn/chat?fr=ent&in_iframe=1&scene=talent_bank&ui_type=page
```

## 虚拟化渲染

消息列表 DOM 仅保留视口内约 10-20 条。scrollHeight 可超 400 万 px（上千条消息）。滚动后 DOM 被替换，`document.body.innerText` 在滚到底后可能为空。必须分段滚动、每段用 CSS 选择器收集当前可见项。

## 消息排序方向（重要！）

消息**从新到旧排列**，顶部是最新的。所以只需要从顶部往下滚动，看到"昨天"就停。**千万不要先滚到底再滚回来**，浪费 20-40 秒且容易出错。

## snap vs DOM querySelector

- **snap（推荐）**：输出结构化无障碍树 `[heading]` / `[StaticText]`，不受 CSS 类名变化影响，稳定可靠
- **DOM querySelector**：依赖 CSS 类名如 `[class*=item]`，脉脉频繁更新前端代码，容易失效
- snap 每次输出约 100 行文本，用 `grep -B5 "交换手机号"` 提取上下文即可

## 滚动步长

350 CSS px（约 1-2 屏高度）足够覆盖所有可见消息，不会跳过任何条目。步长太大（500+）可能漏掉部分消息。

## 不需要滚到底

旧版脚本先滚到底加载全部（scrollHeight 持续增长到 400 万+），再滚回顶部收集。完全没有必要：
- 只看今天消息的话，顶部 ~2500px 就够了
- 先滚到底会触发大量懒加载请求，可能被限流
- 滚动过程中 scrollHeight 持续增长，可能永远"滚不到底"

## 日期识别

今天：`HH:MM`（如 `16:03`）。昨天：`昨天`。更早：`MM/DD`（如 `02/25`）。

## 手机号不直接显示

消息列表只显示系统提示"对方已与您交换手机号"，不包含手机号码。完整号码需在脉脉 App 中查看。

## eval 不支持 async/await

用 bash 循环 + sleep 替代。

## 去重

分段滚动时，相邻步骤的 snap 输出会重叠包含相同消息。最终结果需要 `sort -u` 去重。
