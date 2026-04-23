#!/usr/bin/env bash
# -*- coding: utf-8 -*-
#
# 文件内容探索工具 - 主入口脚本
#
# 功能说明：
#   1. 搜索模式：在 PDF/DOCX/Excel 文件中搜索包含指定关键词（正则表达式）的文件，
#      输出所有匹配文件的路径。支持初始化配置、交互式选择目录。
#   2. 读取模式：根据文件路径（支持数组）读取文件完整文本内容并输出。
#
# 用法：
#   ./file_explorer.sh init                        # 交互式初始化配置
#   ./file_explorer.sh index                       # 构建文件内容索引
#   ./file_explorer.sh search <关键词>             # 搜索文件内容（支持正则）
#   ./file_explorer.sh read <路径1> [路径2 ...]    # 读取一个或多个文件的完整内容
#   ./file_explorer.sh index-status                # 查看索引状态
#   ./file_explorer.sh index-rebuild               # 强制重建索引
#   ./file_explorer.sh config                      # 查看/编辑配置
#   ./file_explorer.sh help                        # 显示帮助信息
#
# 依赖：
#   - python3
#   - fzf（交互式目录选择）
#   - Python 包：pdfplumber, python-docx, openpyxl
#

set -euo pipefail

# ============================================================
# 信号处理器
# ============================================================

cleanup() {
    # 后台索引器自动终止（daemon 线程）
    # 文件锁由 OS 在进程退出时自动释放
    print_info "正在退出..."
    exit 0
}

# 注册信号处理器
trap cleanup INT TERM

# ============================================================
# 常量定义
# ============================================================

# 脚本自身所在目录
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 虚拟环境 Python 路径（优先使用 .venv，不存在则回退到系统 python3）
if [ -x "${SCRIPT_DIR}/.venv/bin/python3" ]; then
    readonly PYTHON="${SCRIPT_DIR}/.venv/bin/python3"
else
    readonly PYTHON="python3"
fi

# 配置文件路径（统一存放在 ~/.fileIndex/ 目录）
readonly INDEX_ROOT="${HOME}/.fileIndex"
readonly CONFIG_FILE="${INDEX_ROOT}/file_explorer_config.json"
readonly INDEX_FILE="${INDEX_ROOT}/file_index.db"

# Python 引擎路径
readonly PYTHON_ENGINE="${SCRIPT_DIR}/file_explorer.py"

# 默认支持的文件扩展名
readonly DEFAULT_EXTENSIONS=".pdf,.docx,.xlsx,.xls"

# 颜色常量
readonly COLOR_RED='\033[0;31m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_CYAN='\033[0;36m'
readonly COLOR_BOLD='\033[1m'
readonly COLOR_RESET='\033[0m'

# ============================================================
# 工具函数
# ============================================================

print_info() {
    # 输出蓝色信息文本
    # @param $1 - 要输出的信息
    echo -e "${COLOR_BLUE}[信息]${COLOR_RESET} $1"
}

print_success() {
    # 输出绿色成功文本
    # @param $1 - 要输出的信息
    echo -e "${COLOR_GREEN}[成功]${COLOR_RESET} $1"
}

print_warning() {
    # 输出黄色警告文本
    # @param $1 - 要输出的信息
    echo -e "${COLOR_YELLOW}[警告]${COLOR_RESET} $1"
}

print_error() {
    # 输出红色错误文本
    # @param $1 - 要输出的信息
    echo -e "${COLOR_RED}[错误]${COLOR_RESET} $1" >&2
}

print_separator() {
    # 输出分隔线
    echo -e "${COLOR_CYAN}────────────────────────────────────────────${COLOR_RESET}"
}

# ============================================================
# 依赖检查函数
# ============================================================

check_fzf() {
    # 检查 fzf 是否安装
    # @returns 0 表示已安装，1 表示未安装
    if ! command -v fzf &>/dev/null; then
        print_error "未检测到 fzf，请先安装: brew install fzf"
        return 1
    fi
    return 0
}

check_python() {
    # 检查 Python3 是否安装
    # @returns 0 表示已安装，1 表示未安装
    if ! command -v python3 &>/dev/null && [ ! -x "${SCRIPT_DIR}/.venv/bin/python3" ]; then
        print_error "未检测到 python3，请先安装 Python3"
        return 1
    fi
    return 0
}

check_python_deps() {
    # 检查 Python 依赖包是否已安装
    # @returns 0 表示全部已安装，1 表示有未安装的包
    local deps_json
    deps_json=$("${PYTHON}" "${PYTHON_ENGINE}" check 2>/dev/null)

    local pdfplumber docx openpyxl
    pdfplumber=$(echo "$deps_json" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d.get('pdfplumber', False))" 2>/dev/null)
    docx=$(echo "$deps_json" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d.get('docx', False))" 2>/dev/null)
    openpyxl=$(echo "$deps_json" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d.get('openpyxl', False))" 2>/dev/null)

    local missing=()
    if [ "$pdfplumber" != "True" ]; then
        missing+=("pdfplumber")
    fi
    if [ "$docx" != "True" ]; then
        missing+=("python-docx")
    fi
    if [ "$openpyxl" != "True" ]; then
        missing+=("openpyxl")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        print_warning "以下 Python 依赖未安装: ${missing[*]}"
        # 自动安装依赖（不询问）
        print_info "正在自动安装依赖..."

        # 如果 .venv 不存在，先创建
        if [ ! -d "${SCRIPT_DIR}/.venv" ]; then
            print_info "正在创建虚拟环境 .venv ..."
            python3 -m venv "${SCRIPT_DIR}/.venv" || {
                print_error "创建虚拟环境失败"
                return 1
            }
        fi

        # 安装依赖
        "${SCRIPT_DIR}/.venv/bin/pip" install "${missing[@]}" || {
            print_error "依赖安装失败"
            return 1
        }
        print_success "依赖安装完成"
    fi
    return 0
}

# ============================================================
# 配置管理函数
# ============================================================

config_exists() {
    # 检查配置文件是否存在
    # @returns 0 表示存在，1 表示不存在
    [ -f "$CONFIG_FILE" ]
}

read_config_dirs() {
    # 从配置文件中读取目录列表
    # @returns 以换行分隔的目录列表（输出到 stdout）
    if ! config_exists; then
        return 1
    fi
    "${PYTHON}" -c "
import json, sys
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
for d in config.get('directories', []):
    print(d)
"
}

read_config_extensions() {
    # 从配置文件中读取扩展名列表
    # @returns 以逗号分隔的扩展名字符串（输出到 stdout）
    if ! config_exists; then
        echo "$DEFAULT_EXTENSIONS"
        return
    fi
    "${PYTHON}" -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
exts = config.get('extensions', ['$DEFAULT_EXTENSIONS'])
print(','.join(exts))
"
}

save_config() {
    # 保存配置到 JSON 文件
    # @param $1 - 以换行分隔的目录列表
    # @param $2 - 以逗号分隔的扩展名列表（可选，默认使用 DEFAULT_EXTENSIONS）
    local dirs_input="$1"
    local extensions="${2:-$DEFAULT_EXTENSIONS}"

    "${PYTHON}" -c "
import json
dirs = '''${dirs_input}'''.strip().split('\n')
dirs = [d.strip() for d in dirs if d.strip()]
exts = '${extensions}'.split(',')
exts = [e.strip() for e in exts if e.strip()]
config = {
    'directories': dirs,
    'extensions': exts,
    'max_depth': 10
}
with open('${CONFIG_FILE}', 'w') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
print(json.dumps(config, ensure_ascii=False, indent=2))
"
}

# ============================================================
# init 子命令 - 交互式初始化
# ============================================================

cmd_init() {
    # 交互式初始化配置
    # 使用 fzf 让用户选择要遍历的目录，然后写入配置文件
    echo ""
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo -e "${COLOR_BOLD}       文件内容探索工具 - 初始化       ${COLOR_RESET}"
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo ""

    # 检查依赖
    check_python || return 1
    check_fzf || return 1
    check_python_deps || return 1

    echo ""
    print_info "请选择要遍历搜索的文件夹（可多选）"
    print_info "操作说明："
    echo -e "  ${COLOR_CYAN}TAB${COLOR_RESET}     - 选中/取消选中"
    echo -e "  ${COLOR_CYAN}Enter${COLOR_RESET}   - 确认选择"
    echo -e "  ${COLOR_CYAN}Ctrl+C${COLOR_RESET}  - 取消"
    echo ""

    # 使用 fzf 选择起始目录
    local start_dir
    read -rp "请输入起始浏览目录（默认为 ${HOME}）: " start_dir
    start_dir="${start_dir:-${HOME}}"

    if [ ! -d "$start_dir" ]; then
        print_error "目录不存在: $start_dir"
        return 1
    fi

    # 使用 find + fzf 交互式选择目录（只列出一级子目录，避免列表过长）
    local selected_dirs
    selected_dirs=$(find "$start_dir" -mindepth 1 -maxdepth 1 -type d \
        ! -name '.*' \
        2>/dev/null | sort | \
        fzf --multi \
            --height=60% \
            --layout=reverse \
            --border=rounded \
            --prompt="选择目录 > " \
            --header="TAB 多选 | Enter 确认 | Ctrl+C 取消" \
            --preview='ls -1 {} 2>/dev/null | head -30' \
            --preview-window=right:40%:wrap \
        2>/dev/null) || true

    if [ -z "$selected_dirs" ]; then
        print_warning "未选择任何目录，初始化取消"
        return 1
    fi

    # 配置文件扩展名
    echo ""
    print_info "配置要搜索的文件类型"
    echo -e "  默认扩展名: ${COLOR_GREEN}${DEFAULT_EXTENSIONS}${COLOR_RESET}"
    read -rp "请输入文件扩展名（逗号分隔，直接回车使用默认值）: " custom_extensions
    local extensions="${custom_extensions:-$DEFAULT_EXTENSIONS}"

    # 保存配置
    echo ""
    print_info "正在保存配置..."
    local config_output
    config_output=$(save_config "$selected_dirs" "$extensions")

    print_success "配置已保存到: ${CONFIG_FILE}"
    echo ""
    print_separator
    echo -e "${COLOR_BOLD}当前配置:${COLOR_RESET}"
    echo "$config_output"
    print_separator
    echo ""
    print_info "现在可以使用 ${COLOR_GREEN}./file_explorer.sh search${COLOR_RESET} 进行搜索了"
}

# ============================================================
# search 子命令 - 执行关键词搜索
# ============================================================

cmd_search() {
    # CLI 搜索文件内容
    # 通过命令行参数直接传入搜索关键词，调用 Python 引擎搜索
    # @param $1 - 搜索关键词（支持正则表达式）
    local pattern="${1:-}"

    if [ -z "$pattern" ]; then
        print_error "请提供搜索关键词"
        echo ""
        echo -e "用法: ${COLOR_GREEN}./file_explorer.sh search <关键词>${COLOR_RESET}"
        echo ""
        echo -e "示例:"
        echo -e "  ${COLOR_CYAN}./file_explorer.sh search 张三${COLOR_RESET}"
        echo -e "  ${COLOR_CYAN}./file_explorer.sh search \"张[三四五]\"${COLOR_RESET}"
        return 1
    fi

    # 检查配置是否存在
    if ! config_exists; then
        print_warning "尚未初始化配置，使用默认配置（全部目录）"
        echo ""
        # 自动生成默认配置
        _generate_default_config
    fi

    # 读取配置并验证目录是否存在
    local dirs_list extensions_str
    dirs_list=$(read_config_dirs)
    extensions_str=$(read_config_extensions)

    # 验证目录是否存在，过滤不存在的目录
    local valid_dirs=""
    local invalid_dirs=""
    while IFS= read -r dir; do
        if [ -d "$dir" ]; then
            valid_dirs="${valid_dirs}${dir}"$'\n'
        else
            invalid_dirs="${invalid_dirs}${dir}"$'\n'
        fi
    done <<< "$dirs_list"

    # 如果有无效目录，警告并更新配置
    if [ -n "$invalid_dirs" ]; then
        print_warning "以下目录不存在，已跳过:"
        echo "$invalid_dirs" | while IFS= read -r dir; do
            [ -n "$dir" ] && echo "  - $dir"
        done

        # 如果所有目录都无效，重新生成默认配置
        if [ -z "$valid_dirs" ]; then
            print_warning "配置中所有目录均不存在，重新生成默认配置"
            _generate_default_config
            dirs_list=$(read_config_dirs)
            extensions_str=$(read_config_extensions)
        else
            # 更新配置为有效目录
            dirs_list="$valid_dirs"
            # 移除末尾空行
            dirs_list=$(echo "$dirs_list" | sed '/^$/d')
        fi
    fi

    if [ -z "$dirs_list" ]; then
        print_error "没有有效的搜索目录"
        return 1
    fi

    # 显示搜索信息
    print_info "搜索关键词: ${COLOR_GREEN}${pattern}${COLOR_RESET}"
    print_info "搜索范围："
    echo "$dirs_list" | while IFS= read -r dir; do
        [ -n "$dir" ] && echo -e "  ${COLOR_CYAN}${dir}${COLOR_RESET}"
    done
    echo -e "  ${COLOR_CYAN}文件类型: ${extensions_str}${COLOR_RESET}"
    print_separator

    # 将目录列表拼接为逗号分隔
    local dirs_csv
    dirs_csv=$(echo "$dirs_list" | tr '\n' ',' | sed 's/,$//')

    # 调用 Python 引擎
    local result
    result=$("${PYTHON}" "${PYTHON_ENGINE}" search \
        --dirs "$dirs_csv" \
        --pattern "$pattern" \
        --extensions "$extensions_str" \
        2>/dev/null)

    # 解析并格式化输出结果
    local total_files matched_files filename_matches content_matches
    total_files=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d['total_files'])" 2>/dev/null)
    matched_files=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d['matched_files'])" 2>/dev/null)
    filename_matches=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d.get('filename_matches', 0))" 2>/dev/null)
    content_matches=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d.get('content_matches', 0))" 2>/dev/null)

    echo ""
    print_separator
    echo -e "${COLOR_BOLD}搜索结果:${COLOR_RESET}"
    echo -e "  扫描文件总数: ${COLOR_CYAN}${total_files}${COLOR_RESET}"
    echo -e "  匹配文件数量: ${COLOR_GREEN}${matched_files}${COLOR_RESET}"
    if [ "$filename_matches" -gt 0 ] 2>/dev/null; then
        echo -e "    - 文件名匹配: ${COLOR_GREEN}${filename_matches}${COLOR_RESET} (快速路径)"
    fi
    if [ "$content_matches" -gt 0 ] 2>/dev/null; then
        echo -e "    - 内容匹配: ${COLOR_GREEN}${content_matches}${COLOR_RESET} (使用索引)"
    fi
    print_separator

    if [ "$matched_files" -eq 0 ] 2>/dev/null; then
        echo ""
        print_warning "未找到匹配的文件"
        return 0
    fi

    # 输出匹配的文件路径
    echo ""
    echo -e "${COLOR_BOLD}匹配的文件列表:${COLOR_RESET}"
    echo ""
    printf '%s\n' "$result" | "${PYTHON}" -c "
import sys, json
data = json.load(sys.stdin)
for i, item in enumerate(data['results'], 1):
    filepath = item['filepath']
    count = item['match_count']
    matches = item.get('matches', [])
    match_type = item.get('match_type', 'content')
    print(f'  \033[0;32m{i}.\033[0m \033[1m{filepath}\033[0m')
    print(f'     匹配次数: \033[0;36m{count}\033[0m')
    if match_type == 'filename':
        print(f'     匹配方式: \033[0;32m文件名匹配 (快速)\033[0m')
    else:
        print(f'     匹配方式: \033[0;33m内容匹配 (索引)\033[0m')
    if matches:
        preview = ', '.join(str(m) for m in matches[:3])
        if len(matches) > 3:
            preview += ' ...'
        print(f'     匹配预览: \033[0;33m{preview}\033[0m')
    print()
"

    # 额外输出纯路径列表，方便复制使用
    print_separator
    echo -e "${COLOR_BOLD}纯路径列表（可直接复制）:${COLOR_RESET}"
    echo ""
    printf '%s\n' "$result" | "${PYTHON}" -c "
import sys, json
data = json.load(sys.stdin)
for item in data['results']:
    print(item['filepath'])
"
    echo ""
}

# 生成默认配置（全部一级子目录）
_generate_default_config() {
    # 确保 INDEX_ROOT 目录存在
    mkdir -p "${INDEX_ROOT}"

    # 扫描 HOME 下所有一级子目录
    local all_dirs=""
    for dir in "${HOME}"/*; do
        if [ -d "$dir" ] && [ ! -L "$dir" ]; then
            # 排除隐藏目录和 ~/.fileIndex/ 目录
            local basename=$(basename "$dir")
            if [[ ! "$basename" =~ ^\. ]] && [ "$dir" != "${INDEX_ROOT}" ]; then
                all_dirs="${all_dirs}${dir}"$'\n'
            fi
        fi
    done

    # 保存配置
    save_config "$all_dirs" "$DEFAULT_EXTENSIONS"
    print_info "已自动生成默认配置"
}

# ============================================================
# read 子命令 - 根据文件路径读取文件内容
# ============================================================

cmd_read() {
    # 根据一个或多个文件路径读取文件完整文本内容
    # 支持 PDF/DOCX/Excel 格式
    # @param $@ - 一个或多个文件路径（空格分隔）
    #
    # 用法示例：
    #   ./file_explorer.sh read /path/to/file.pdf
    #   ./file_explorer.sh read /path/to/a.pdf /path/to/b.docx /path/to/c.xlsx

    if [ $# -eq 0 ]; then
        print_error "请提供至少一个文件路径"
        echo ""
        echo -e "用法: ${COLOR_GREEN}./file_explorer.sh read <文件路径1> [文件路径2 ...]${COLOR_RESET}"
        echo ""
        echo -e "示例:"
        echo -e "  ${COLOR_CYAN}./file_explorer.sh read /Users/wcm/Documents/合同.pdf${COLOR_RESET}"
        echo -e "  ${COLOR_CYAN}./file_explorer.sh read /path/a.pdf /path/b.docx${COLOR_RESET}"
        return 1
    fi

    # 将所有路径参数拼接为逗号分隔字符串
    local files_csv
    files_csv=$(printf '%s,' "$@" | sed 's/,$//')

    print_info "读取文件数量: ${COLOR_GREEN}$#${COLOR_RESET}"
    for f in "$@"; do
        echo -e "  ${COLOR_CYAN}📄 ${f}${COLOR_RESET}"
    done
    print_separator

    # 调用 Python 引擎
    local result
    result=$("${PYTHON}" "${PYTHON_ENGINE}" read \
        --files "$files_csv" \
        2>/dev/null)

    # 解析统计信息
    local total succeeded failed
    total=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d['total'])" 2>/dev/null)
    succeeded=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d['succeeded'])" 2>/dev/null)
    failed=$(printf '%s\n' "$result" | "${PYTHON}" -c "import sys,json; d=json.load(sys.stdin); print(d['failed'])" 2>/dev/null)

    echo ""
    print_separator
    echo -e "${COLOR_BOLD}读取结果:${COLOR_RESET}"
    echo -e "  文件总数: ${COLOR_CYAN}${total}${COLOR_RESET}  成功: ${COLOR_GREEN}${succeeded}${COLOR_RESET}  失败: ${COLOR_RED}${failed}${COLOR_RESET}"
    print_separator
    echo ""

    # 逐个输出文件内容
    printf '%s\n' "$result" | "${PYTHON}" -c "
import sys, json
SEP = '=' * 60
data = json.load(sys.stdin)
for i, item in enumerate(data['results'], 1):
    filepath = item['filepath']
    content = item.get('content')
    error = item.get('error')
    size = item.get('size_chars', 0)

    print(f'\033[1m{SEP}\033[0m')
    print(f'\033[0;32m[{i}/{len(data[\"results\"])}]\033[0m \033[1m{filepath}\033[0m')

    if error:
        print(f'\033[0;31m[错误] {error}\033[0m')
    else:
        print(f'\033[0;36m[字符数: {size}]\033[0m')
        print()
        if content:
            print(content)
        else:
            print('\033[0;33m（文件内容为空）\033[0m')
    print()
"

    print_separator
    echo ""
}

# ============================================================
# config 子命令 - 查看/编辑配置
# ============================================================

cmd_config() {
    # 查看或编辑当前配置
    echo ""
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo -e "${COLOR_BOLD}       ⚙️  文件内容探索工具 - 配置        ${COLOR_RESET}"
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo ""

    if ! config_exists; then
        print_warning "尚未初始化配置"
        print_info "请运行: ./file_explorer.sh init"
        return 0
    fi

    # 显示当前配置
    print_info "当前配置文件: ${CONFIG_FILE}"
    echo ""
    print_separator
    "${PYTHON}" -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
print(json.dumps(config, ensure_ascii=False, indent=2))
"
    print_separator
    echo ""

    # 提供编辑选项
    echo -e "操作选项："
    echo -e "  ${COLOR_CYAN}1${COLOR_RESET}) 添加目录"
    echo -e "  ${COLOR_CYAN}2${COLOR_RESET}) 删除目录"
    echo -e "  ${COLOR_CYAN}3${COLOR_RESET}) 修改文件类型"
    echo -e "  ${COLOR_CYAN}4${COLOR_RESET}) 重新初始化"
    echo -e "  ${COLOR_CYAN}0${COLOR_RESET}) 退出"
    echo ""
    read -rp "请选择操作 [0-4]: " choice

    case "$choice" in
        1)
            config_add_dir
            ;;
        2)
            config_remove_dir
            ;;
        3)
            config_change_extensions
            ;;
        4)
            cmd_init
            ;;
        0|"")
            print_info "退出配置"
            ;;
        *)
            print_error "无效的选项"
            ;;
    esac
}

config_add_dir() {
    # 向配置中添加新目录
    check_fzf || return 1

    local start_dir
    read -rp "请输入起始浏览目录（默认为 ${HOME}）: " start_dir
    start_dir="${start_dir:-${HOME}}"

    local new_dirs
    new_dirs=$(find "$start_dir" -mindepth 1 -maxdepth 1 -type d \
        ! -name '.*' \
        2>/dev/null | sort | \
        fzf --multi \
            --height=60% \
            --layout=reverse \
            --border=rounded \
            --prompt="选择要添加的目录 > " \
            --header="TAB 多选 | Enter 确认" \
        2>/dev/null) || true

    if [ -z "$new_dirs" ]; then
        print_warning "未选择任何目录"
        return 0
    fi

    # 合并到现有配置
    "${PYTHON}" -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
new = '''${new_dirs}'''.strip().split('\n')
new = [d.strip() for d in new if d.strip()]
existing = set(config.get('directories', []))
added = [d for d in new if d not in existing]
config['directories'] = list(existing) + added
with open('${CONFIG_FILE}', 'w') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
print(f'已添加 {len(added)} 个目录')
for d in added:
    print(f'  + {d}')
"
    print_success "配置已更新"
}

config_remove_dir() {
    # 从配置中删除目录
    local dirs_list
    dirs_list=$(read_config_dirs)

    if [ -z "$dirs_list" ]; then
        print_warning "配置中没有任何目录"
        return 0
    fi

    # 如果有 fzf 就用 fzf 选择要删除的目录
    if command -v fzf &>/dev/null; then
        local to_remove
        to_remove=$(echo "$dirs_list" | \
            fzf --multi \
                --height=40% \
                --layout=reverse \
                --border=rounded \
                --prompt="选择要删除的目录 > " \
                --header="TAB 多选 | Enter 确认" \
            2>/dev/null) || true

        if [ -z "$to_remove" ]; then
            print_warning "未选择任何目录"
            return 0
        fi

        "${PYTHON}" -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
remove = set('''${to_remove}'''.strip().split('\n'))
remove = {d.strip() for d in remove}
before = len(config['directories'])
config['directories'] = [d for d in config['directories'] if d not in remove]
after = len(config['directories'])
with open('${CONFIG_FILE}', 'w') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
print(f'已删除 {before - after} 个目录')
"
        print_success "配置已更新"
    else
        # 没有 fzf 时提示手动编辑
        echo "当前目录列表："
        local i=1
        echo "$dirs_list" | while IFS= read -r dir; do
            echo "  $i) $dir"
            i=$((i + 1))
        done
        print_info "请手动编辑配置文件: ${CONFIG_FILE}"
    fi
}

config_change_extensions() {
    # 修改配置中的文件扩展名
    local current_exts
    current_exts=$(read_config_extensions)
    echo -e "当前文件类型: ${COLOR_GREEN}${current_exts}${COLOR_RESET}"
    read -rp "请输入新的文件扩展名（逗号分隔）: " new_exts

    if [ -z "$new_exts" ]; then
        print_warning "输入为空，未做修改"
        return 0
    fi

    "${PYTHON}" -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
exts = '${new_exts}'.split(',')
config['extensions'] = [e.strip() for e in exts if e.strip()]
with open('${CONFIG_FILE}', 'w') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
print('文件类型已更新')
"
    print_success "配置已更新"
}

# ============================================================
# help 子命令 - 显示帮助
# ============================================================

cmd_help() {
    # 显示帮助信息
    echo ""
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo -e "${COLOR_BOLD}       文件内容探索工具 - 帮助         ${COLOR_RESET}"
    echo -e "${COLOR_BOLD}═══════════════════════════════════════════${COLOR_RESET}"
    echo ""
    echo -e "${COLOR_BOLD}描述:${COLOR_RESET}"
    echo "  在 PDF/DOCX/Excel 文件中搜索关键词，或根据文件路径读取文件完整内容"
    echo "  支持正则表达式搜索，支持批量读取多个文件"
    echo "  新功能：两阶段搜索（文件名匹配 + 内容索引）"
    echo ""
    echo -e "${COLOR_BOLD}用法:${COLOR_RESET}"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh init${COLOR_RESET}                       交互式初始化配置（选择目录）"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh index${COLOR_RESET}                       构建文件内容索引（首次使用）"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh search <关键词>${COLOR_RESET}            搜索文件内容（支持正则，自动使用索引）"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh read <路径1> [路径2 ...]${COLOR_RESET}   读取一个或多个文件的完整内容"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh index-status${COLOR_RESET}                查看索引状态"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh index-rebuild${COLOR_RESET}               强制重建索引"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh config${COLOR_RESET}                     查看/编辑配置"
    echo -e "  ${COLOR_GREEN}./file_explorer.sh help${COLOR_RESET}                       显示帮助信息"
    echo ""
    echo -e "${COLOR_BOLD}示例:${COLOR_RESET}"
    echo -e "  # 第一步：初始化配置，选择要搜索的目录"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh init${COLOR_RESET}"
    echo ""
    echo -e "  # 第二步：构建索引（首次使用或文件有大量更新时）"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh index${COLOR_RESET}"
    echo ""
    echo -e "  # 搜索包含\"张三\"的文件（文件名匹配优先，然后内容匹配）"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh search 张三${COLOR_RESET}"
    echo ""
    echo -e "  # 支持正则表达式搜索"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh search \"张[三四五]|李[一二三]\"${COLOR_RESET}"
    echo ""
    echo -e "  # 读取单个文件的完整内容"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh read /Users/wcm/Documents/合同.pdf${COLOR_RESET}"
    echo ""
    echo -e "  # 批量读取多个文件的完整内容"
    echo -e "  ${COLOR_CYAN}./file_explorer.sh read /path/to/a.pdf /path/to/b.docx /path/to/c.xlsx${COLOR_RESET}"
    echo ""
    echo -e "${COLOR_BOLD}支持的文件格式:${COLOR_RESET}"
    echo "  .pdf   - PDF 文件"
    echo "  .docx  - Word 文档"
    echo "  .xlsx  - Excel 电子表格"
    echo "  .xls   - Excel 旧版格式"
    echo ""
    echo -e "${COLOR_BOLD}性能优化:${COLOR_RESET}"
    echo "  - 文件名匹配：毫秒级响应（简历场景优化）"
    echo "  - 内容索引：避免重复解析，第二次搜索极快"
    echo "  - 增量更新：自动检测文件变化，保持索引最新"
    echo ""
    echo -e "${COLOR_BOLD}直接调用 Python 引擎（高级用法）:${COLOR_RESET}"
    echo -e "  # 读取文件，逗号分隔路径"
    echo -e "  ${COLOR_CYAN}\${PYTHON} \${SCRIPT_DIR}/file_explorer.py read --files \"/a.pdf,/b.docx\"${COLOR_RESET}"
    echo -e "  # 读取文件，JSON 数组格式"
    echo -e "  ${COLOR_CYAN}\${PYTHON} \${SCRIPT_DIR}/file_explorer.py read --files-json '[\"/a.pdf\",\"/b.docx\"]'${COLOR_RESET}"
    echo ""
    echo -e "${COLOR_BOLD}配置文件:${COLOR_RESET}"
    echo "  ${CONFIG_FILE}"
    echo ""
    echo -e "${COLOR_BOLD}索引文件:${COLOR_RESET}"
    echo "  ${SCRIPT_DIR}/file_index.json"
    echo ""
    echo -e "${COLOR_BOLD}依赖:${COLOR_RESET}"
    echo "  python3, fzf"
    echo "  依赖安装在 .venv 虚拟环境中（init 时自动创建）"
    echo ""
}

# ============================================================
# 主入口
# ============================================================

main() {
    # 主入口函数，根据子命令分发到对应的处理函数
    # @param $1 - 子命令（init/index/search/read/index-status/index-rebuild/config/help）
    local command="${1:-help}"

    case "$command" in
        init)
            cmd_init
            ;;
        index)
            cmd_index
            ;;
        search)
            shift
            cmd_search "$@"
            ;;
        read)
            shift
            cmd_read "$@"
            ;;
        index-status)
            cmd_index_status
            ;;
        index-rebuild)
            cmd_index_rebuild
            ;;
        config)
            cmd_config
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            print_error "未知命令: $command"
            echo ""
            cmd_help
            exit 1
            ;;
    esac
}

# ============================================================
# index 子命令 - 构建索引
# ============================================================

cmd_index() {
    # 构建文件内容索引
    print_info "开始构建文件内容索引..."
    print_separator

    "${PYTHON}" "${PYTHON_ENGINE}" index
}

# ============================================================
# index-status 子命令 - 查看索引状态
# ============================================================

cmd_index_status() {
    # 查看索引状态
    "${PYTHON}" "${PYTHON_ENGINE}" index-status
}

# ============================================================
# index-rebuild 子命令 - 强制重建索引
# ============================================================

cmd_index_rebuild() {
    # 强制重建索引（不询问）
    print_warning "清空现有索引并重新构建..."

    "${PYTHON}" "${PYTHON_ENGINE}" index-rebuild
}

main "$@"
