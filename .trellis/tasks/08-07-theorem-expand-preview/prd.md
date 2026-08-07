# Theorem 卡片点击展开编译预览（PDF 剪切效果）

## 概述

Theorems 视图中，点击定理卡片可就地展开**编译后的完整定理内容**（与公式
相同的 latex→dvisvgm→SVG 管道渲染，效果如同从 PDF 剪下）。按需懒编译，
不预先编译全部定理。

## 需求

### R1: 点击展开

- 定理卡片头部增加折叠箭头（复用 chevron 样式）
- 单击卡片 → 就地展开/收起预览区（250ms 延迟以区分双击跳转）
- 展开状态在搜索过滤等重渲染后保留

### R2: 懒编译

- 首次展开某定理时，向扩展端发送 `compileTheorem` 请求，复用
  `compileFormulas(preamble, [{label, body}])` 编译该环境为 SVG
- 等待期间显示 "Compiling preview..."；失败显示错误信息
- 结果在 webview 侧按 label 缓存；`updateFormulas`（文档刷新）时清空缓存
  与展开状态（preamble/内容可能已变）

### R3: 交互重排（定理卡片）

- 单击 = 展开/收起预览（原来单击复制 label 让位）
- Cmd/Ctrl+单击 = 复制 label
- 拖拽 = 插入 `\ref{label}`；Cmd/Ctrl+拖拽 = 插入环境源码（不变）
- 双击 = 跳转源码行（不变）

### R4: 已知限制（写入代码注释）

- 预览中定理编号从 1 起排，与原文档编号不一致（standalone 独立编译）
- 依赖 preamble 中的 `\newtheorem` 定义可被 standalone 文档继承（现有管道已包含 preamble）

## 验收标准

1. ✅ 单击定理卡片展开编译后的完整内容（含文字与公式）
2. ✅ 再次单击收起；展开状态在搜索过滤后保留
3. ✅ Cmd+单击复制 label；双击跳转；拖拽行为不变
4. ✅ 编译失败时展开区显示错误而非卡死
5. ✅ 文档刷新后缓存清空，再次展开得到新内容
