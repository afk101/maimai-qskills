# maimai-qskills

OpenClaw skills 交互式安装器。包含以下 skills：

- **chrome-cdp** — Chrome DevTools Protocol CLI
- **file-explorer** — 文件内容搜索（支持 PDF/DOCX/Excel）
- **mac-contacts** — macOS 通讯录查询
- **maimai-batch-message** — 脉脉批量沟通
- **maimai-phone-exchange** — 脉脉电话交换记录

---

## 用户：安装 / 更新

```bash
npx maimai-qskills@latest
```

交互提示选择安装路径（默认 `~/.openclaw/workspace/skills/`）和要安装的 skills。每次运行自动拉取最新版本覆盖更新。

> **file-explorer** 需要额外安装 Python 依赖：`pip install pdfplumber python-docx openpyxl`

---

## 维护者：发布流程

### 前置条件

- 已登录 npm：`npm login`
- Node.js >= 16.7.0

### 一键发布

```bash
cd /path/to/maimai-qskills
node publish.mjs
```

脚本会依次执行：
1. **同步** — 从 `~/.openclaw/workspace/skills/` rsync 到本仓库 `skills/`
2. **升级版本** — 提示选择 patch / minor / major，自动 `npm version`
3. **发布** — 执行 `npm publish`

### 分步操作

如果需要手动控制某一步：

```bash
# 仅同步源文件
node sync.mjs

# 仅升级版本
npm version patch   # 或 minor / major

# 仅发布
npm publish
```

### 项目结构

```
maimai-qskills/
├── install.mjs      # 安装脚本（npx 入口）
├── sync.mjs         # 同步源文件
├── publish.mjs      # 一键发布
├── package.json
└── skills/          # skill 文件（由 sync.mjs 从源目录同步）
```

### 数据流

```
日常编辑                         发布
~/.openclaw/workspace/skills/  →  maimai-qskills/skills/  →  npm registry
              (sync.mjs)               (npm publish)
```
