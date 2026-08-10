# SPECIAL_ACTION 支持 — latex-utilities 遗留的 FRACTION / BREAK / SYMPY 特殊动作

## 概述

从 latex-utilities 导入的 live snippets 中，有一类 `body` 为
`SPECIAL_ACTION_FRACTION` / `SPECIAL_ACTION_BREAK` / `SPECIAL_ACTION_SYMPY`
的特殊动作条目。目前 importer 直接跳过它们、config 归一化时也丢弃。
本任务实现这三个动作，语义 1:1 对齐 latex-utilities `completionWatcher.ts`
（调研记录见 `research/special-actions.md`）。

## 需求

### R1: SPECIAL_ACTION_FRACTION

- snippet 匹配且捕获组 1 为闭括号（`)` `]` `}`）时，向前扫描找到对应开括号
  （`}` 的情况还要吞掉前面的 `\command`），把 `<开括号>...<闭括号>/` 整段替换为
  `\frac{<括号内容>}{$1} `（`$1` 为 tabstop，走 insertSnippet 路径）
- 找不到配对开括号时替换为空字符串（与原插件一致）

### R2: SPECIAL_ACTION_BREAK

- snippet 匹配时，中止当前 change 对后续 snippet 的匹配尝试（"熔断"哨兵），
  不做任何文本替换

### R3: SPECIAL_ACTION_SYMPY

- snippet 匹配时，先把匹配文本替换为占位符 `SYMPY_CALCULATING`，
  然后调用 `python3` + sympy 对捕获组 1 的表达式求值并输出 LaTeX，
  异步把占位符替换为结果
- 转换规则与原插件一致：`\command ` → `command`、`^` → `**`、`{}` → `()`
- 求值出错时短暂显示 `SYMPY_ERROR` 后删除（400ms），不中断编辑

### R4: 导入与归一化

- importer 不再跳过 SPECIAL_ACTION 条目（原样导入）
- config 归一化保留 SPECIAL_ACTION 条目并标记动作类型
- SPECIAL_ACTION 条目不进入普通补全列表（completion provider 过滤）

## 非需求

- 不检查/安装 sympy；缺少 python3 或 sympy 时走 R3 的错误路径即可
- 不支持原插件之外的其他 SPECIAL_ACTION

## 验收标准

1. ✅ 导入含 SPECIAL_ACTION 的 snippets 配置后条目保留，不再提示 skipped
2. ✅ 数学模式输入 `(x+1)/` 触发 FRACTION → 变为 `\frac{x+1}{|} `（光标在分母）
3. ✅ 配置 BREAK snippet 后，匹配时后续 snippet 不再展开
4. ✅ 触发 SYMPY snippet（如 `x^2+2x+1` 求值）后占位符被替换为 sympy 的 LaTeX 输出
5. ✅ 无 sympy 环境时不抛未捕获异常，占位符被清理
6. ✅ 普通补全列表中不出现字面 `SPECIAL_ACTION_*` 文本
