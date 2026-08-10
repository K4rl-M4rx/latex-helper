# 调研：latex-utilities SPECIAL_ACTION 语义

来源：`tecosaur/LaTeX-Utilities` master 分支 `src/components/completionWatcher.ts`
（2026-08-05 通过 raw.githubusercontent.com 获取）。

## 判定方式

`execSnippet` 中按 `snippet.body` 精确匹配：

- `body === 'SPECIAL_ACTION_BREAK'` → `resolve('break')`，watcher 内层循环 break，
  不再对当前 change 尝试后续 snippet；无文本替换。
- `body === 'SPECIAL_ACTION_FRACTION'` → `getFraction(match, line)` 计算
  `[matchRange, replacement]`。
- `body === 'SPECIAL_ACTION_SYMPY'` → matchRange 为常规匹配范围，
  `replacement = execSympy(match, line)`（先返回占位符，异步替换）。

其他 body 走常规 `match[0].replace(prefix, body).replace(/\$\$/g, '$')`。

## getFraction

- `match[1]` 是闭括号 `)` / `]` / `}`，开括号查表得到。
- 从 `match.index` 向前逐字符 depth 计数，depth 归 0 即找到配对开括号位置 `i`。
- 闭括号是 `}` 时，若开括号前紧邻 `\command`（正则 `/.*(\\\w+)$/`），把 `i`
  再前移 command 长度（连命令名一起吞掉）。
- matchRange = `[i, match.index + match[0].length)`；
  replacement = `` \frac{${line.text.substring(i + 1, match.index)}}{$1}  ``。
  注意 substring 从 `i + 1` 开始，即开括号本身被丢弃、闭括号被 `/` 覆盖。
- 找不到配对时 range 为空、replacement 为 `''`。

## execSympy

- 立即返回占位符 `'SYMPY_CALCULATING'`（先同步替换进文档）。
- command 转换：`match[1].replace(/\\(\w+) ?/g, '$1').replace(/\^/, '**').replace('{', '(').replace('}', ')')`。
- 执行：

  ```
  python3 -c "from sympy import *
  import re
  a, b, c, x, y, z, t = symbols('a b c x y z t')
  k, m, n = symbols('k m n', integer=True)
  f, g, h = symbols('f g h', cls=Function)
  init_printing()
  print(eval('''latex(<command>)'''), end='')"
  ```

- 回调里把占位符 range 替换为 stdout；有 stderr 时先写入 `SYMPY_ERROR`，
  400ms 后删除该段文本。
- 原实现用 shell 模板拼接命令；本项目移植时用 `execFile('python3', ['-c', script])`
  避免 shell 引号问题（语义等价、更安全）。

## 移植注意点

- FRACTION 的 replacement 含 `$1` tabstop：原插件因 body 无 `$$N` 会把
  noPlaceholders 默认为 true（纯文本替换），`$1` 变字面量——疑似原插件缺陷。
  本项目移植时强制走 delete + insertSnippet 路径，保证 tabstop 可用。
- BREAK 哨兵只在 snippet 匹配时生效。
- SYMPY 的两次编辑都会被 watcher 自身的 `isApplyingEdit` / `sameChanges` 防护，
  移植时保持重入防护。
