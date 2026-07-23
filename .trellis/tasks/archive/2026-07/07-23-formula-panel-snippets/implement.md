# Implementation Plan: LaTeX Formula Panel & Snippet Migration

## Phase 1: Extension Skeleton & Package Configuration

**目标**：扩展可加载，所有命令、视图、配置项注册到 VSCode。

### 1.1 更新 `package.json`

- [ ] 添加 `activationEvents`：`onLanguage:latex`（打开 LaTeX 文件时激活）
- [ ] 注册 `viewsContainers.activitybar`：LaTeX Helper 图标
- [ ] 注册 `views`：`latex-helper.formulaPanel`（WebviewView）
- [ ] 注册 `commands`：
  - `latex-helper.showFormulaPanel` — 显示公式面板
  - `latex-helper.importSnippets` — 手动触发导入
- [ ] 注册 `configuration`：
  - `latex-helper.snippets`（array，默认 `[]`）
  - `latex-helper.pdflatexPath`（string，默认 `"pdflatex"`）
  - `latex-helper.pdf2svgPath`（string，默认 `"pdf2svg"`）

**验证**：`F5` 启动扩展 → 打开 `.tex` 文件 → 侧边栏可见 LaTeX Helper 图标 → 面板可展开（空白/占位）

### 1.2 创建模块骨架文件

- [ ] `src/formula/parser.js` — 导出占位函数
- [ ] `src/formula/compiler.js` — 导出占位函数
- [ ] `src/formula/cache.js` — 导出占位函数
- [ ] `src/formula/panel.js` — 导出 `FormulaPanelProvider` 类
- [ ] `src/snippets/importer.js` — 导出 `importSnippets()` 函数
- [ ] `src/snippets/provider.js` — 导出 `registerSnippetProvider()` 函数
- [ ] `src/snippets/config.js` — 导出 `getSnippets()` 辅助函数
- [ ] `src/utils/tex.js` — 导出共享工具函数

**验证**：`F5` → 扩展无加载错误

---

## Phase 2: Snippet Migration

**目标**：旧 snippets 可一次性导入，补全功能可用。

### 2.1 `snippets/importer.js`

- [ ] 实现 `importSnippets(context)`：
  - 读取 `latex-helper.snippets` 配置，若非空则跳过（已导入过）
  - 尝试读取 user settings 中的 `latex-utilities.liveReformat.snippets`
  - JSON 解析（容错注释 + 尾部逗号，使用 `JSON.parse` + regex 预处理，或尝试多次解析策略）
  - 过滤 `SPECIAL_ACTION_*` body
  - 写入 `latex-helper.snippets`（`vscode.workspace.getConfiguration().update()`）
  - 弹窗 `vscode.window.showInformationMessage("Imported N snippets, skipped M special actions")`

**验证**：`F5` → 执行 `latex-helper.importSnippets` 命令 → 查看设置中是否出现 snippets

### 2.2 `snippets/provider.js` — 数学环境检测

- [ ] 实现 `isInMathContext(document, position)`：
  - 获取光标前文本和光标后文本
  - 状态机扫描：track `$`/`$$`/`\(`/`\)`/`\[`/`\]` 开关、`\begin{env}`/`\end{env}` 堆栈深度
  - 返回 `{ inMath: boolean, depth: number }`

### 2.3 `snippets/provider.js` — CompletionItemProvider

- [ ] 实现 `registerSnippetProvider(context)`：
  - 读取 `latex-helper.snippets` 配置
  - 注册 `vscode.languages.registerCompletionItemProvider('latex', ...)`
  - 在 `provideCompletionItems` 中：
    - 检测 cursor context（`isInMathContext`）
    - 按 `mode` 过滤 snippets
    - 将匹配的 snippet 转为 `vscode.CompletionItem`
    - `CompletionItem` 的 `insertText` 设为 snippet body，`kind` 设为 `Snippet`

**验证**：`F5` → 打开 `.tex` 文件 → 数学环境内输入 `L1` → 弹出补全 "Lebesgue L¹" → 选择后插入 `L^1`

---

## Phase 3: Formula Parser

**目标**：正确提取 preamble、公式列表、引用关系。

### 3.1 `utils/tex.js` — 共享工具函数

- [ ] `extractPreamble(text)` — 截取 `\documentclass` → `\begin{document}` 区间
- [ ] `findFormulaEnvironments(text)` — 返回 `{ env, body, startLine, endLine }[]`，正则扫描 `\begin{<env>}...\end{<env>}`，匹配已知公式环境列表
- [ ] `extractLabel(body)` — 从公式 body 中提取 `\label{...}` → label 字符串
- [ ] `findReferences(text)` — 提取所有 `\ref{...}` 和 `\eqref{...}` 中的引用名，返回 `Set<string>`

### 3.2 `formula/parser.js`

- [ ] 实现 `parseDocument(text)`：
  1. 提取 preamble
  2. 提取所有公式环境
  3. 筛选含有 `\label` 的公式
  4. 提取引用集合
  5. 标记每个公式的 `referenced` 状态
  6. 计算 hash
  7. 返回结构化结果

**验证**：`F5` → 在 extension.js 临时调用 `parseDocument` → 打印解析结果到 console → 确认 label、body、referenced 正确

---

## Phase 4: LaTeX Compiler & Cache

**目标**：公式可被 pdflatex 编译为 SVG，结果可缓存。

### 4.1 `formula/compiler.js`

- [ ] 实现 `checkTool(name, configPath)` — 检测 `pdflatex`/`pdf2svg` 是否可用
- [ ] 实现 `buildStandaloneDoc(preamble, formulas)` — 构建 standalone `.tex` 文件内容
- [ ] 实现 `runPdflatex(texContent, workDir)` — 在临时目录执行 pdflatex，捕获 stdout/stderr
- [ ] 实现 `convertToSVG(pdfPath, outputDir)` — 用 pdf2svg 逐页转换
- [ ] 实现 `compileFormulas(preamble, formulas)` — 组合上述步骤

**错误处理细节**：
- 临时目录用 `fs.mkdtempSync()` 创建，流程结束后清理
- pdflatex 超时 30s → `child_process.spawn` + `setTimeout` kill
- 编译失败 → throw with LaTeX log 最后 50 行
- pdf2svg 不可用 → fallback `pdftocairo -svg`，都不可用 → throw descriptive error

### 4.2 `formula/cache.js`

- [ ] 实现 `getCacheDir(context)` — 确保 `<globalStoragePath>/cache/` 存在
- [ ] 实现 `computeHash(content)` — SHA256 → hex 前 16 字符
- [ ] 实现 `needsRecompile(preambleHash, formulas, cacheDir)` — 对比 hash，判断是否需要编译
- [ ] 实现 `writeCache(results, cacheDir)` — 写 SVG 文件 + 更新 `index.json`
- [ ] 实现 `readAllFromCache(formulas, cacheDir)` — 全部命中缓存时直接返回

**验证**：`F5` → 在 extension.js 临时调用编译管道 → 检查 cache 目录是否产生 `.svg` 文件 → 打开 SVG 确认公式渲染正确

---

## Phase 5: Webview Panel

**目标**：侧边栏展示公式列表，搜索、复制、拖放交互可用。

### 5.1 `formula/panel.js` — WebviewView Provider

- [ ] 实现 `FormulaPanelProvider` 类（implements `vscode.WebviewViewProvider`）
- [ ] `resolveWebviewView` 中设置 webview 选项：
  - `enableScripts: true`
  - `localResourceRoots` 包含 extension 资源路径
  - 设置 HTML 内容（内联 CSS + JS，暂不引用外部文件）
- [ ] 实现消息处理（`onDidReceiveMessage`）：
  - `copyLabel` → `vscode.env.clipboard.writeText(label)` + `showInformationMessage("Copied: <label>")`
  - `gotoLine` → 跳转到编辑器对应行

### 5.2 WebView UI（内联 HTML）

- [ ] 搜索栏：输入框 + 三个模式切换按钮（Label | Content | Both），CSS active 状态
- [ ] 公式列表：每个条目包含 SVG 图片 + label 名 + 行号
- [ ] 未引用公式折叠区（`<details><summary>Unreferenced (N)</summary>...</details>`），灰显样式
- [ ] 点击条目 → 复制 label → 发送 `copyLabel` 消息
- [ ] 拖放：`dragstart` 设置 `e.dataTransfer.setData('text/plain', label)` — 原生支持拖入编辑器
  - **注**：WebView `dragstart` 的 `dataTransfer` 在 VSCode 中直接拖入编辑器依赖 VSCode 版本。作为渐进实现：先实现点击复制 + 提示，拖放作为增强。

### 5.3 公式列表更新消息

- [ ] Extension → WebView：`postMessage({ type: 'updateFormulas', formulas: [...] })`
- [ ] WebView 收到消息后重建列表 DOM
- [ ] 搜索框实时过滤（`input` 事件），纯前端实现（不经过 extension 往返）

**验证**：`F5` → 打开 `.tex` 文件 → Formula Panel 出现 → 看到公式列表 → 搜索功能正常 → 点击复制 label

---

## Phase 6: 集成 & 生命周期

**目标**：所有模块在 `extension.js` 中正确连接，完整的编辑-解析-渲染循环。

### 6.1 `extension.js` — 完整 activate

- [ ] 初始化：创建 `FormulaPanelProvider` 实例并注册
- [ ] 创建 `PanelController` 对象，管理 parser → compiler → panel 的数据流
- [ ] 监听 `onDidChangeActiveTextEditor`：
  - 若新 editor 的 `languageId === 'latex'` → 触发完整解析-渲染流程
  - 若切换到非 LaTeX 文件 → 清空面板或保持上一状态
- [ ] 监听 `onDidChangeTextDocument`：
  - debounce 500ms
  - 仅当变化文件是当前活跃编辑器的文件时触发
  - hash 变化检测 → 需要时重新编译 → 更新 panel
- [ ] 首次启动 + snippet 导入检查

### 6.2 `PanelController` — 数据流编排

```js
class PanelController {
    async refresh(document) {
        const text = document.getText();
        const parsed = parseDocument(text);                         // Phase 3
        const needsCompile = needsRecompile(parsed);                // Phase 4.2

        let results;
        if (needsCompile) {
            results = await compileFormulas(parsed.preamble,
                parsed.formulas.map(f => ({label:f.label, body:f.body})));  // Phase 4.1
            writeCache(results);                                    // Phase 4.2
        } else {
            results = readAllFromCache(parsed.formulas);
        }

        this.panel.update(parsed.formulas, results);                // Phase 5.3
    }
}
```

**验证**：`F5` → 完整集成测试：
- 打开 `.tex` 文件 → 面板加载公式
- 编辑公式 → 等待 debounce → 面板更新
- 切换文件 → 面板内容切换
- 搜索 → 复制 → 粘贴到编辑器

---

## Phase 7: 收尾

- [ ] 清理临时 console.log
- [ ] 确认所有 TODO 标记
- [ ] 检查 `package.json` 与 `extension.js` 的注册一致性
- [ ] F5 最终全流程测试

## Validation Commands

由于扩展不支持 CLI 测试，所有验证通过 F5 在 Extension Development Host 中手动执行：

1. **代码**：`node -e "require('./src/formula/parser')"`（语法检查）
2. **编译工具链**：`pdflatex --version && pdf2svg --version 2>/dev/null || pdftocairo --version`
3. **Snippet 导入**：`F5` → Cmd+Shift+P → `Import Snippets from latex-utilities`

## Risky Points

| 风险 | 缓解 |
|------|------|
| WebView 拖放 bridge 复杂 | 先实现点击复制，拖放作为增强 |
| 数学环境检测不准确 | 状态机 + 已知环境名列表，明确测试边界（嵌套、转义 `\$`） |
| LaTeX 编译超时 | 30s timeout + 错误日志展示 |
| settings.json JSONC 解析 | 预处理 strip 注释和尾部逗号 |
| SVG 在 WebView 中不渲染 | **已知问题** — pdf2svg 输出使用 `xlink:href` + `<use>` 引用字形，尝试 innerHTML/innerHTML+replace/DOMParser/Blob URL 均失败。可尝试方向: (1) 用 dvisvgm (latex→DVI→SVG) 替代 pdf2svg (2) 用 PNG (pdftoppm) 替代 SVG |
