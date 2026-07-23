# LaTeX Formula Panel & Snippet Migration

## Goal

在 VSCode 中提供两个 LaTeX 辅助功能：

1. **公式筛选面板**：将当前 `.tex` 文件中所有带 `\label` 的公式用 LaTeX 引擎渲染并集中展示在侧边栏，支持筛选、复制 label、拖放 label
2. **Snippet 迁移**：将用户 `settings.json` 中 `latex-utilities.liveReformat.snippets` 的约 135 个 snippet 迁移到本扩展自有配置中

## Background

- 用户使用 `\mathtoolsset{showonlyrefs}`，只有被 `\ref` / `\eqref` 引用过的公式才显示编号；有 `\label` 但未被引用的公式不编号
- 扩展是本地 VSCode 扩展，纯 JavaScript（CommonJS），目标 VSCode ≥ 1.85.0
- 旧 snippets 格式：`{prefix, body, mode ("maths"|"text"|"any"), description, triggerWhenComplete, priority?}`

## Design Decisions

| 决策 | 结论 |
|------|------|
| 作用范围 | **单文件**，仅解析当前打开的 `.tex` |
| Preamble | 从当前文件提取 `\documentclass` → `\begin{document}` 区间，暂不考虑子文件/多文件项目 |
| 公式渲染 | **LaTeX 引擎真实编译**（`pdflatex` + standalone 文档类批量编译 → PDF → 逐页转 SVG），在 WebView 中展示 |
| 变更检测 | **内容哈希**（`hash(preamble)` + 每个公式 `hash(label + content)`），编辑后 debounce ~500ms 重新解析 |
| 未引用公式 | 不参与搜索，面板中保留显示（可折叠/灰显） |
| 拖放行为 | 仅输出 label 原始文本，不包裹 `\ref`/`\eqref` |
| 筛选搜索 | 搜索框实时过滤，三种模式可切换：① 仅 label ② 仅公式内容 ③ 两者 |
| 面板位置 | **WebviewView**（侧边栏/底部面板），注册到 `contributes.views` |
| 补全方式 | VSCode `CompletionItemProvider`，根据 `mode` 控制触发 context（`maths` → 仅数学环境，`text` → 文本模式，`any` → 始终） |
| Snippet 配置 | **扩展自有配置** `latex-helper.snippets`，首次启动从旧 `settings.json` 一次性导入 |
| SPECIAL_ACTION | **暂不实现**，标记为 TODO（FRACTION / BREAK / SYMPY） |

## Requirements

### 公式筛选面板

1. 解析当前 `.tex` 文件中所有带 `\label{...}` 的公式环境（`equation`、`align`、`gather`、`multline` 等及 starred 版本）
2. 提取 preamble（`\documentclass` → `\begin{document}`）
3. 解析 `\ref`/`\eqref` 引用，区分"被引用"和"未被引用"的公式
4. 将公式批量编译为 standalone PDF → 转 SVG → 在 WebviewView 中展示，带缓存机制
5. 编辑后 debounce 重新解析，基于 hash 增量更新
6. 搜索框：三种模式切换（label / 内容 / 两者），未引用公式不参与搜索
7. 点击复制 label 到剪贴板
8. 支持拖放 label 文本到编辑器

### Snippet 迁移

9. 读取 `settings.json` 中 `latex-utilities.liveReformat.snippets` 并转换格式
10. 导入到扩展自有配置 `latex-helper.snippets`，初次启动自动执行
11. 注册 `CompletionItemProvider`，根据 `mode` 控制触发 context
12. `SPECIAL_ACTION_*` snippet 跳过不导入

## Acceptance Criteria

- [ ] 打开 `.tex` 文件时，侧边栏公式面板自动加载并渲染所有带 label 的公式
- [ ] 编辑公式后，面板在 debounce 后自动更新
- [ ] 搜索框可按 label、内容、或两者搜索，未引用公式不出现在搜索结果中
- [ ] 点击公式条目复制其 label 到剪贴板
- [ ] 拖放公式条目到编辑器粘贴 label 文本
- [ ] 数学环境内输入 snippet prefix 时，`CompletionItemProvider` 弹出补全
- [ ] 首次启动时自动从旧 `settings.json` 导入 snippets
- [ ] 未被 `\ref`/`\eqref` 引用的公式在面板中灰显/折叠，不参与搜索

## TODO / Future

- [ ] 实现 `SPECIAL_ACTION_FRACTION` — 解析式分数
- [ ] 实现 `SPECIAL_ACTION_BREAK` — sympy 阻断
- [ ] 实现 `SPECIAL_ACTION_SYMPY` — sympy 计算块
