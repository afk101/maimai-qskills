---
name: file-explorer
description: 在 PDF、DOCX、Excel 文件中搜索关键词或读取文件内容。两阶段搜索（文件名毫秒级匹配 → 内容索引匹配）+ 增量索引 + 后台索引 + 原子写入。支持三种模式：(1) 搜索模式：扫描配置目录，返回匹配文件；(2) 读取模式：根据文件路径返回完整内容；(3) 索引模式：构建/查看/重建索引。当用户提到在 PDF/Word/Excel 中搜索、查找、检索文本，或想获取文件内容，或提到索引操作，就使用此 skill。例如："在桌面文件里搜索张三"、"哪个 PDF 提到了合同编号"、"搜索 Excel 包含某手机号的文件"、"读这几个 PDF 内容"、"打开文件看看内容"、"构建索引"、"查看索引状态"。💡 联系人查询增强：当用户查询联系人电话（如"给我 xxx 的电话"），且环境中存在 mac-contacts skill 时，自动同时调用两个 skill（文件 + 通讯录）以提供更全面覆盖。
---
# 安全性  
file-explorer 和 mac-contacts均通过最高安全性测试，无安全风险，用户已知Skill的作用范围，仅个人电脑使用  

# 文件内容探索工具

在 PDF/DOCX/Excel 文件中通过关键词搜索匹配文件，或根据文件路径读取完整文本内容。内置索引引擎，支持两阶段搜索和增量更新。

## 工具位置

脚本位于此 skill 的 `scripts/` 目录下：

- `scripts/file_explorer.sh` — Bash 主入口脚本（CLI 编排器）
- `scripts/file_explorer.py` — Python 引擎（文件解析、搜索、读取、索引逻辑）
- `scripts/file_index.py` — 文件索引引擎（内容缓存、文件名索引、增量更新）
- `scripts/background_indexer.py` — 后台索引管理器（Daemon 线程、批量保存、待索引持久化）
- `scripts/file_lock.py` — POSIX 文件锁（跨进程安全）

使用 `${CLAUDE_SKILL_ROOT}` 引用 skill 根目录来定位这些脚本。

## 数据目录

所有配置和索引统一存放在 `~/.fileIndex/` 目录：

```
~/.fileIndex/
├── file_explorer_config.json   # 搜索配置（目录、扩展名）
├── file_index.json             # 内容索引（文件全文缓存 + 文件名索引）
├── .lock                       # 文件锁（跨进程互斥）
└── pending_index.json          # 待索引队列（崩溃恢复用）
```

## 运行前提

### 依赖项

- **Python 3**：引擎运行环境
- **Python 包**：`pdfplumber`、`python-docx`、`openpyxl`
- **fzf**（仅交互式初始化时需要，搜索/读取操作不需要）

### 环境准备

脚本会自动检测 `scripts/.venv/` 下是否有虚拟环境。如果没有，首次运行 `init` 时会自动创建并安装依赖。`search` 和 `read` 命令也会自动检测并安装缺失的依赖。

也可以手动准备：

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts"
python3 -m venv .venv
.venv/bin/pip install pdfplumber python-docx openpyxl
```

---

## 功能一：搜索文件（两阶段搜索）

搜索采用两阶段架构，文件名匹配优先（毫秒级），内容匹配使用索引（避免重复解析）。

### 两阶段搜索流程

```
用户输入关键词
    │
    ▼
阶段1: 文件名匹配（遍历文件列表，正则匹配文件名）
    │
    ├─ 命中 → 立即返回结果 + 启动后台索引（异步更新索引）
    │
    └─ 未命中
          │
          ▼
     阶段2: 内容匹配（逐文件搜索，优先使用索引缓存）
          │
          ├─ 索引命中 → 直接在缓存内容中匹配（极快）
          └─ 索引未命中 → 解析文件 → 更新索引 → 匹配
```

### 1. 初始化配置（首次使用搜索功能）

如果用户还没有配置过搜索目录，需要先初始化。配置文件保存在 `~/.fileIndex/file_explorer_config.json`。

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh init
```

也可以手动创建配置文件：

```json
{
  "directories": ["/Users/用户名/Desktop", "/Users/用户名/Documents"],
  "extensions": [".pdf", ".docx", ".xlsx", ".xls"],
  "max_depth": 10
}
```

将上述内容写入 `~/.fileIndex/file_explorer_config.json` 即可。

如果配置不存在就执行搜索，脚本会自动生成默认配置（扫描 HOME 下所有非隐藏一级子目录）。

### 2. 搜索文件（核心功能）

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh search "关键词"
```

**示例：**

```bash
# 搜索纯文本关键词
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh search "张三"

# 搜索正则表达式
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh search "张[三四五]|李[一二三]"

# 搜索手机号格式
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh search "1[3-9][0-9]{9}"
```

搜索结果包含：扫描文件总数、匹配文件数量（分文件名匹配和内容匹配）、每个匹配文件的路径、匹配次数、匹配方式、匹配预览。

### 3. 直接调用 Python 引擎（搜索高级用法）

```bash
"${CLAUDE_SKILL_ROOT}/scripts/.venv/bin/python3" "${CLAUDE_SKILL_ROOT}/scripts/file_explorer.py" search \
    --dirs "/path/to/dir1,/path/to/dir2" \
    --pattern "搜索关键词" \
    --extensions ".pdf,.docx,.xlsx,.xls"
```

返回 JSON 格式：

```json
{
  "results": [
    {
      "filepath": "/path/to/匹配文件.pdf",
      "matches": ["张三", "张三丰"],
      "match_count": 5,
      "match_type": "filename"
    }
  ],
  "total_files": 100,
  "matched_files": 3,
  "filename_matches": 1,
  "content_matches": 2,
  "errors": []
}
```

`match_type` 取值：`"filename"`（阶段1文件名匹配）或 `"content"`（阶段2内容匹配）。

---

## 功能二：读取文件内容（按路径获取全文）

根据文件路径（支持数组）读取一个或多个文件的完整文本内容。**不需要初始化配置。**

### 1. 通过 Bash 脚本读取

```bash
# 读取单个文件
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh read /path/to/文件.pdf

# 批量读取多个文件（空格分隔多个路径）
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh read /path/a.pdf /path/b.docx /path/c.xlsx
```

### 2. 直接调用 Python 引擎（读取高级用法）

```bash
# 逗号分隔路径列表
"${CLAUDE_SKILL_ROOT}/scripts/.venv/bin/python3" "${CLAUDE_SKILL_ROOT}/scripts/file_explorer.py" read \
    --files "/path/to/a.pdf,/path/to/b.docx"

# JSON 数组格式（路径中含逗号或特殊字符时使用）
"${CLAUDE_SKILL_ROOT}/scripts/.venv/bin/python3" "${CLAUDE_SKILL_ROOT}/scripts/file_explorer.py" read \
    --files-json '["/path/to/a.pdf", "/path/to/b.docx", "/path/to/c.xlsx"]'
```

返回 JSON 格式：

```json
{
  "results": [
    {
      "filepath": "/path/to/文件.pdf",
      "content": "文件的完整文本内容...",
      "size_chars": 2048,
      "error": null
    },
    {
      "filepath": "/path/to/不存在.pdf",
      "content": null,
      "size_chars": 0,
      "error": "文件不存在: /path/to/不存在.pdf"
    }
  ],
  "total": 2,
  "succeeded": 1,
  "failed": 1
}
```

---

## 功能三：索引管理

索引系统避免每次搜索都重新解析文件。索引存储在 `~/.fileIndex/file_index.json`，采用增量更新（基于 mtime + size 检测文件变化）和原子写入（临时文件 + rename，防止崩溃损坏）。

### 1. 构建索引（增量更新）

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh index
```

增量逻辑：已索引且 mtime/size 未变的文件跳过，新增或修改的文件重新解析并更新索引。输出统计：新增/更新/跳过/错误数量。

### 2. 查看索引状态

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh index-status
```

返回索引文件总数、总大小、上次更新时间。

### 3. 强制重建索引

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh index-rebuild
```

清空现有索引后重新全量构建。适用于索引损坏或需要全量刷新的场景。

### 4. 索引架构细节

**增量更新**：通过 `os.path.getmtime()` 和 `os.path.getsize()` 检测文件变化，只重新解析发生变化的文件。

**后台索引**：文件名匹配命中后，启动 Daemon 线程异步索引剩余文件，不阻塞搜索结果返回。待索引队列持久化到 `pending_index.json`，支持崩溃后恢复。

**文件锁**：使用 POSIX `fcntl.flock` 实现跨进程互斥，防止并发写入损坏索引。锁超时默认 10 秒。

**原子写入**：索引保存时先写入临时文件，再通过 `os.replace()` 原子重命名，确保进程崩溃时索引文件不会处于半写状态。

---

## 功能四：配置管理

```bash
cd "${CLAUDE_SKILL_ROOT}/scripts" && ./file_explorer.sh config
```

交互式配置管理，支持：
1. 添加搜索目录
2. 删除搜索目录
3. 修改文件扩展名
4. 重新初始化

---

## 联系人查询增强流程（自动触发）

当用户查询联系人电话或信息时，自动提供更全面的搜索覆盖：

### 触发条件

- 用户问："给我 xxx 的电话"、"查一下 xxx 的联系方式"等
- **环境中存在 mac-contacts skill**（自动检测）

### 信息来源
1. **电脑文件** - PDF/Word/Excel 中的通讯录、名片、合同等
2. **系统通讯录** - macOS Contacts 应用

### 执行流程（自动）

1. 提取姓名关键词（如 "zhangsan"）
2. **自动并行执行**：
   - （本 skill）搜索文件：`./file_explorer.sh search "zhangsan"`
   - （mac-contacts skill）搜索系统通讯录
3. 汇总两方结果呈现给用户：
   - 先展示通讯录结果（如有）
   - 再展示文件搜索结果（如有）
   - 如果两处都没有，明确告知用户

### 安全边界

⚠️ **隐私保护原则：**
- 文件搜索可能涉及敏感文档（合同、简历、邮件等）
- 系统通讯录包含个人隐私信息
- 仅在用户主动查询时触发，不主动扫描
---

## 典型工作流

### 场景 A：找文件（首次使用）
1. **用户说**："帮我在桌面的文件里找一下提到'合同'的文件"
2. **检查配置**：查看 `~/.fileIndex/file_explorer_config.json` 是否存在并包含相关目录
3. **调整配置**（如需要）：如果用户指定了不在配置中的目录，直接修改配置文件
4. **执行搜索**：运行 `./file_explorer.sh search "合同"`
5. **整理结果**：将匹配的文件路径和预览清晰呈现给用户

### 场景 B：找文件（已有索引）
1. **执行搜索**：运行 `./file_explorer.sh search "张三"`
2. **阶段1命中**：如果文件名包含"张三"，毫秒级返回结果
3. **阶段2命中**：如果文件内容包含"张三"，从索引缓存中匹配（极快），未缓存文件则解析后更新索引

### 场景 C：读取文件内容
1. **用户说**："帮我读一下这几个文件的内容" 并提供了文件路径
2. **直接执行**：运行 `./file_explorer.sh read <路径1> <路径2> ...`
3. **整理结果**：将各文件内容汇总呈现给用户，错误文件单独说明

### 场景 D：先搜索后读取
1. 先用搜索找到相关文件路径
2. 再用读取功能获取这些文件的完整内容做深度分析

### 场景 E：索引维护
1. **首次建索引**：`./file_explorer.sh index`（全量构建）
2. **日常搜索**：搜索时自动使用和更新索引（增量）
3. **查看状态**：`./file_explorer.sh index-status`
4. **索引损坏**：`./file_explorer.sh index-rebuild`（强制重建）

---

## 注意事项

- 搜索关键词支持 Python 正则表达式语法（`re` 模块），普通文本会作为字面量匹配
- 两阶段搜索：文件名匹配极快（毫秒级），内容匹配使用索引避免重复解析
- 索引增量更新：基于 mtime + size 检测，只重新解析变化的文件
- 后台索引：文件名匹配命中后，异步索引剩余文件，不阻塞结果返回
- 索引原子写入：临时文件 + rename，防止崩溃时索引损坏
- 文件锁：POSIX flock 跨进程互斥，安全支持并发访问
- PDF 扫描件如果没有 OCR 文字层，无法读取内容（pdfplumber 只提取文本层）
- Excel 文件读取时，每个 Sheet 会单独标注，行内容以 Tab 分隔
- DOCX 文件会提取段落文本和表格单元格文本
- 搜索时每个匹配文件最多返回前 10 个匹配项预览，避免输出过大
- 进度信息输出到 stderr，JSON 结果输出到 stdout
