# Decisions & Post-Implementation Review: Hybrid Live Snippet System

记录 2026-07-24 复刻 latex-utilities snippet 行为时的关键决策与教训。
**修改本目录下任何 snippet 相关代码前，先读本文档。**

## 决策 1：导入必须保留全部字段（triggerWhenComplete / priority / noPlaceholders）

`importer.js` 曾只保留 prefix/body/mode/description，导致 `getLiveSnippets()` 永远为空，
实时自动展开完全失效（127/128 条原配置都是 `triggerWhenComplete: true`）。
规则：导入是**透传**，不是重塑；默认值只在 `config.js` 的 normalize 层补。

## 决策 2：补全项三件套（filterText / sortText / range）不可省

latex-utilities 的 snippet prefix 是**正则字符串**，直接当 CompletionItem label
会被 VSCode 的客户端过滤全部挡掉。必须按原插件做法：

- `label` = 展开后的替换文本
- `filterText` / `sortText` = 实际匹配到的文本（`match[0]`）
- `range` = 匹配的精确范围（否则只替换"当前单词"，文本错乱）

## 决策 3：body 展开顺序——先捕获组替换，再折叠 `$$` → `$`

正确管线（`provider.js` 的 `expandBody`）：

```js
match[0].replace(prefixRegex, body).replace(/\$\$/g, '$')
```

`$$N` 是占位符（tabstop），`$N` 是捕获组引用，顺序反了会把捕获组引用吞掉。
历史 bug：`replace(/\$\$(\d+|\{\d+\})/g, '$$$$$1')` 是 no-op（替换串解析回原文）。

## 决策 4：模式检测 1:1 复刻原插件的反向扫描，**不识别 `$...$`**

`utils/tex.js` 的 `getModeAtPosition` 移植自原插件 `typeFinder.getTypeAtPosition`
（反向逐行扫描 env token + lastKnown 缓存）。注意：

- 原插件 env 表**没有 `$` / `$$`**——`$...$` 行内数学被判定为 `text`，
  maths snippet 在其中不触发。这是原插件的真实行为，**为保真而保留**，
  不要"顺手修掉"（这会偏离 PRD 但符合复刻目标，已与用户确认）。
- env 表：`\(` `\[` equation/displaymath/align/gather/flalign/multline/alignat/split
  （含 starred）+ `\text` + 文本地标（`\begin{document}`、`\section` 等）。

## 决策 5：纯删除不触发 live snippet（2026-07-24，用户案例驱动）

规则：`change.text.length === 0` 的 contentChange 一律跳过匹配。

**案例**：`\norm{}` 删除括号，删到剩 `\norm` 的瞬间，行末恰好命中
`(\\?[A-Za-z]*)rm$` → 误展开为 `\mathrm{\no}`。删除没有"输完"任何 prefix，
语义上就不该触发。原插件对删除也会触发，这是有意修复的原生缺陷。

**约束**：不要靠改正则排除 `\` 来规避——用户明确需要 `\rm`、`\norm` 等
手工输入场景照常触发（回归测试：`test/live-watcher.test.js` 场景 2/3）。

已知边界：撤销（Cmd+Z）以插入型 change 恢复文本，理论上可能重新触发，与原插件一致。

## 决策 6：watcher 主循环对齐原插件

- 遍历**全部** contentChanges，不限制单字符输入（粘贴/IME/覆盖输入都要触发）；
- 每次替换后累计列偏移 `offset` 并重新读取行文本；
- `isApplyingEdit` 防重入 + `sameChanges` 去重自己产生的编辑回显；
- 占位符 snippet 走"删除匹配范围 → `insertSnippet`（不带 range）"。

## 验证基线

- `test/snippets.test.js`：26 断言（模式检测 12 + expandBody 4 + normalize 10）
- `test/live-watcher.test.js`：6 断言（纯删除不触发 / 正常输入触发 / 覆盖输入触发）
- `npm run lint`：0 错误
- 手动 F5：`\begin{equation}` 内输 `x2` → `x_2`，输 `L1` → `L^1`

## 遗留

- `SPECIAL_ACTION_BREAK/FRACTION/SYMPY` 未实现（导入时跳过，3 条）。
- `latex-helper.liveSnippets.enabled` 开关未加（PRD open question，未做）。
- 用户全局 settings.json 修复脚本：`scripts/repair-snippets-flags.js`
  （一次性，备份在 `.backups/`）。
