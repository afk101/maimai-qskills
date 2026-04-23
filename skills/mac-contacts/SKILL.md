---
name: mac-contacts
description: Query macOS Contacts (Address Book) via osascript. Use this skill whenever the user asks to look up a contact, find someone's phone number or email, list all contacts, search contacts by name (including fuzzy/partial match), or do anything involving the Mac address book or Contacts app. Trigger even if the user just says a person's name and asks for their phone or email — don't try to answer from memory, always query the live Contacts database.

  ⚠️ IMPORTANT — 查电话必须同时调用两个 Skill：
  当用户说"给我 xxx 的电话"或类似查电话/联系方式的请求时，联系人信息可能存在于：
  1. macOS 通讯录（本 skill 负责）
  2. 电脑文件中（PDF/Word/Excel 等文档，由 file-explorer skill 负责）
  因此必须同时触发 mac-contacts 和 file-explorer 两个 skill，并将两个来源的结果合并呈现给用户，不能只用其中一个。
---

# Mac Contacts Skill

This skill lets you query the macOS Contacts app via `osascript` (AppleScript). You can list all contacts, look up a specific person, or do a fuzzy/partial name search.

## When to use which query mode

| User says | Mode |
|---|---|
| "show me all contacts" / "list everyone" | **All contacts** |
| "find 张三's phone" / "what's Li Ming's email" | **Exact/partial name search** |
| "anyone named 刘" / "contacts with 英" in their name | **Fuzzy search** |
| "does anyone called John work at Apple" | **Search + filter by org** |

## Core osascript snippets

### 1. Get all contacts (name + first phone + first email)

```bash
osascript << 'EOF'
tell application "Contacts"
    set output to ""
    repeat with p in every person
        set pName to name of p
        set pPhone to ""
        set pEmail to ""
        if (count of phones of p) > 0 then
            set pPhone to value of first phone of p
        end if
        if (count of emails of p) > 0 then
            set pEmail to value of first email of p
        end if
        set output to output & pName & " | " & pPhone & " | " & pEmail & linefeed
    end repeat
    return output
end tell
EOF
```

### 2. Search by name (partial / fuzzy match) — returns ALL results

Replace `QUERY` with the search string — AppleScript's `contains` does substring matching. **Always return every match, never truncate.** The user wants to see the complete list.

```bash
osascript << 'EOF'
tell application "Contacts"
    set matches to (every person whose name contains "QUERY")
    set total to count of matches
    if total = 0 then
        return "未找到匹配联系人"
    end if
    set output to "找到 " & total & " 个联系人：" & linefeed & linefeed
    repeat with p in matches
        set pName to name of p
        set phoneLines to ""
        repeat with ph in phones of p
            set phoneLines to phoneLines & (value of ph) & linefeed
        end repeat
        set org to organization of p
        set output to output & pName
        if org is not missing value and org is not "" then
            set output to output & " (" & org & ")"
        end if
        set output to output & linefeed
        if phoneLines is not "" then
            set output to output & phoneLines
        end if
    end repeat
    return output
end tell
EOF
```

### 3. List all contacts as JSON (for downstream processing)

Use JXA when you need structured data:

```bash
osascript -l JavaScript << 'EOF'
const app = Application("Contacts");
const results = app.people().map(p => ({
    name: p.name(),
    phones: p.phones().map(ph => ({ label: ph.label(), value: ph.value() })),
    emails: p.emails().map(e => ({ label: e.label(), value: e.value() })),
    org: p.organization() || ""
}));
JSON.stringify(results, null, 2);
EOF
```

## How to handle common user requests

### "查一下某某的电话" / "给我 xxx 的电话" / "find X's phone number"

⚠️ **必须同时调用 mac-contacts 和 file-explorer 两个 skill！**

电话信息可能存在于通讯录，也可能记录在电脑里的文件（PDF/Word/Excel）中，两者都要查。

执行步骤：
1. 提取姓名关键词。
2. **同时并行执行**：
   - （本 skill）运行 AppleScript snippet **#2** 在通讯录中搜索该姓名。
   - （file-explorer skill）用该姓名作为关键词，在配置目录的文件中搜索。
3. 汇总两个来源的结果，统一呈现给用户：
   - 先展示通讯录结果（如有）
   - 再展示文件中找到的结果（如有）
   - 如果两处都没有，明确告知用户。
4. 不能只查通讯录或只查文件，必须两个都查。

### "列出所有联系人" / "show all contacts"

1. Run snippet **#1**.
2. If the list is long (>50), summarize: show count + first 20 entries, offer to filter.

### "所有姓刘的" / "everyone named Smith"

1. Use the surname/partial string as `QUERY` in snippet **#2**.
2. Present **all** matches — do not truncate, even if there are hundreds of results.

### Fuzzy matching strategy

AppleScript `contains` is already a substring match, so `"刘"` matches `"刘xx"`, `"刘yy"`, etc. For typo tolerance (e.g., user types `"zhangsan"` for `"张三"`), try:
- First run with the exact input
- If 0 results, suggest the user try a shorter fragment or check spelling
- You can also try splitting the query and searching for each part

## Permissions

The first time this runs, macOS will ask: **"Terminal wants to access your contacts"** — the user must click **Allow**. If they previously denied it, they need to go to:

> System Settings → Privacy & Security → Contacts → enable Terminal

## Output format

Present results in a clean, simple format — one contact per block, no tables:

```
找到 3 个联系人：

xxx 
13311111111

yyy
122-2222-2222
123-2222-2222
```

Rules:
- **Search results**: Always list ALL matches, never truncate. Show count at the top.
- **Single contact lookup**: Show name, org (if any), all phone numbers, all emails.
- **All contacts list**: Show total count + names. If >100 contacts, show count first and offer to filter.
- No markdown tables. No emoji required (keep it simple unless the user seems to prefer it).
- If there are no matches, say so clearly and suggest trying a shorter/different search term.
