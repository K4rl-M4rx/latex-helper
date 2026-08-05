# Theorem Environment Browser — 定理/命题/引理环境的 label 浏览与拖拽引用

## 概述

公式浏览器目前只处理数学环境（equation/align/...）中带 `\label` 的公式。
写论文时同样高频的操作是引用定理类环境（theorem / lemma / proposition /
corollary / definition / remark / example 及 `\newtheorem` 自定义环境）。
本任务在现有 Formula Browser Tab 中新增 **Theorems 视图**：解析当前文档中的
定理类环境及其 label，列表浏览，点击复制 label，拖拽插入 `\ref{label}`。

## 需求

### R1: 环境识别

- 内置环境名：theorem, lemma, proposition, corollary, definition, remark,
  example, claim, conjecture, notation, assumption（含 starred 变体）
- 额外解析 preamble 中的 `\newtheorem{name}...` / `\newtheorem*{name}...`
  声明，把自定义环境名并入识别列表
- 只收录带 `\label` 的环境（与公式处理一致）

### R2: 数据提取

- 每个定理条目：label、环境名、可选标题（`\begin{theorem}[Title]` 的
  optional argument）、正文预览（去命令后的前 ~100 字符）、行号、
  是否被 `\ref`/`\eqref` 引用、所属 section/subsection
- 定理不需要编译 SVG，随每次文档刷新同步解析，开销可忽略

### R3: 浏览器 UI

- 工具栏左侧新增视图切换：**Formulas | Theorems**（会话内状态，默认 Formulas）
- Theorems 视图按环境类型分组（Theorem / Lemma / ...，可折叠，复用现有分组组件）
- 卡片内容：环境名徽标 + label + 可选标题 + 正文预览 + 行号
- 搜索框对 Theorems 视图同样生效（匹配 label / 环境名 / 标题 / 预览）
- 交互：单击复制 label；双击跳转源码行；拖拽向编辑器插入 `\ref{label}`
  （Cmd/Ctrl+拖拽插入定理环境源码，与公式卡片的修饰键语义一致）

### R4: 边界

- 视图切换、Pinned 过滤、Recently Used 分组只作用于 Formulas 视图，
  Theorems 视图不显示这些控件状态
- 侧边栏 Panel 的公式计数不变（不含定理）

## 非需求

- 不为定理编译预览 SVG
- 不改变公式视图的任何现有行为
- 定理使用不计入 Recently Used（该分组是公式语义）
- 不支持 `\cref` / `\autoref` 等引用形式的选择（固定 `\ref`）

## 验收标准

1. ✅ 文档含 `\begin{lemma}...\label{lem:x}...\end{lemma}` 时，Theorems 视图出现该卡片
2. ✅ preamble 中 `\newtheorem{prop}{Proposition}` 声明的自定义环境也被识别
3. ✅ 无 label 的定理环境不出现在列表中
4. ✅ 单击卡片复制 label；双击跳转到环境起始行
5. ✅ 拖拽卡片到编辑器插入 `\ref{lem:x}`；Cmd/Ctrl+拖拽插入环境源码
6. ✅ 搜索框在 Theorems 视图正常过滤
7. ✅ 公式视图行为与之前完全一致（回归）
