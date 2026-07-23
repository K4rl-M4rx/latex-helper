# Design: LaTeX Formula Panel & Snippet Migration

## Architecture Overview

```
src/
├── extension.js              # 入口：注册 providers、commands、listeners
├── formula/
│   ├── parser.js             # TeX 解析：preamble、公式环境、label、ref 引用
│   ├── compiler.js           # LaTeX 编译管道：standalone 文档 → pdflatex → PDF → SVG
│   ├── cache.js              # 缓存管理：哈希计算、文件缓存读写、失效策略
│   └── panel.js              # WebviewView Provider：面板 UI、与 extension 双向通信
├── snippets/
│   ├── importer.js           # 一次性导入：旧 settings.json → extension 配置
│   ├── provider.js           # CompletionItemProvider：context 感知补全
│   └── config.js             # 配置注册 helpers
└── utils/
    └── tex.js                # 共享 TeX 工具函数
```

## Module Design

### 1. `formula/parser.js` — TeX 文档解析

**职责**：从 `.tex` 文本中提取结构化信息。

**输入**：文件文本内容（`string`）
**输出**：
```js
{
  preamble: string,           // \documentclass → \begin{document} 之间的全部内容
  preambleHash: string,       // preamble 的 SHA256 前 16 位 hex
  formulas: [
    {
      label: string,          // \label{eq:xxx} 中的 eq:xxx
      body: string,           // 公式环境完整内容（含 \begin{...} ... \end{...}）
      bodyHash: string,       // body 的 SHA256 前 16 位 hex
      envType: string,        // "equation", "align", "gather", "multline" 等
      line: number,           // 公式在源文件中的起始行号
      referenced: boolean,    // 是否被 \ref{...} 或 \eqref{...} 引用
    }
  ]
}
```

**解析策略**：
- 用正则 + 栈扫描提取 `\begin{<env>}...\end{<env>}` 块，匹配已知公式环境名
- 在公式块内查找 `\label{...}`，提取 label 名
- 全文档扫描 `\ref{...}` 和 `\eqref{...}` 收集引用集合
- preamble 取 `\documentclass` 到 `\begin{document}` 之间的内容

**需要处理的边界情况**：
- 嵌套 `\label`（`\begin{aligned}` 内嵌于 `\begin{equation}`）→ 取最外层公式环境的 label
- `\label` 在公式环境之外（如图表 `\label`）→ 应忽略
- 无 `\label` 的公式 → 跳过（不参与面板展示）
- 无 `\documentclass` 的文件 → preamble 为空，编译时使用默认最小 preamble

### 2. `formula/compiler.js` — LaTeX 编译管道

**职责**：用 LaTeX 引擎批量渲染公式。

**流程**：
1. 构建 standalone 文档：
   ```latex
   \documentclass[multi={minipage},border=2pt,preview]{standalone}
   <preamble 内容>
   \begin{document}
   \begin{minipage}{0.95\textwidth}
     <formula 1>
   \end{minipage}
   \begin{minipage}{0.95\textwidth}
     <formula 2>
   \end{minipage}
   % ...
   \end{document}
   ```
2. 调用 `pdflatex -interaction=nonstopmode -halt-on-error <file>.tex`
   - 工作目录在临时文件夹中，添加 `-output-directory <tmpdir>`
   - 超时保护（默认 30s）
3. 用 `pdf2svg`（fallback: `pdftocairo -svg`）逐页转 SVG
4. 返回 `string[]`（每页一个 SVG 字符串）

**API**：
```js
/**
 * @param {string} preamble - LaTeX preamble
 * @param {{ label: string, body: string }[]} formulas
 * @returns {Promise<{label: string, svg: string}[]>}
 */
async function compileFormulas(preamble, formulas)
```

**错误处理**：
- 编译失败 → 捕获 `pdflatex` stderr，返回错误信息（不 crash）
- 单个公式编译错误 → standalone 用 `\begin{minipage}` 分隔，某公式出错不影响其余
- 工具未找到 → 检测 `pdflatex`、`pdf2svg` 是否在 PATH 中，否则提示用户安装

### 3. `formula/cache.js` — 缓存管理

**职责**：管理公式渲染结果的持久化缓存。

**缓存 key**：`hash(preamble + label + body)` → 对应一个 SVG 文件

**存储**：`context.globalStoragePath` 下的文件系统缓存
```
<globalStoragePath>/
  cache/
    <hash>.svg        # 单个公式的 SVG 缓存
    index.json        # hash → (label, body 前 50 字符, timestamp) 映射，用于调试和清理
```

**API**：
```js
/**
 * 检查哪些公式需要重新编译。
 * @returns {{ stale: Formula[], fresh: {label, svg}[] }}
 */
function diffFormulas(preambleHash, formulas, cacheDir)

/**
 * 将编译结果写入缓存。
 */
function writeCache(results, cacheDir)

/**
 * 从缓存读取单个 SVG。
 */
function readCachedSVG(hash, cacheDir)
```

**失效策略**：
- 任何公式 body 的 hash 变化 → 该公式 + 所有公式重新编译（因为是一次 standalone 编译）
- 实际优化：如果只有少数公式变化，仍然全量重编。缓存只用于：完全没变化时跳过编译

### 4. `formula/panel.js` — WebviewView Provider

**职责**：提供侧边栏 WebView，展示公式列表和搜索 UI。

**架构**：Extension ↔ WebView 双向通信（`postMessage`）

**Extension → WebView 消息**：
```js
{
  type: "updateFormulas",
  formulas: [
    { label, svg, line, referenced, envType }
  ]
}
```

**WebView → Extension 消息**：
```js
{ type: "copyLabel", label: string }           // 用户点击复制
{ type: "dragLabel", label: string }            // 用户拖放
{ type: "gotoLine", line: number }              // 点击公式跳转到源文件
```

**WebView UI**：
- 顶部搜索栏（含三种模式切换按钮：label / 内容 / 两者）
- 公式列表（每项显示渲染后的 SVG + label 名 + 行号）
- 未引用公式折叠加灰显
- 点击复制 label → `vscode.env.clipboard.writeText()`（由 extension 侧执行）
- 拖放：自定义 `dragstart` 事件设置 `dataTransfer` 为 label 文本

**拖放实现**：
- WebView 内每个公式条目设置 `draggable="true"`
- `dragstart` 时通过 postMessage 发送 label 文本
- VSCode WebView 的拖放 bridge 较为复杂；备选方案是：点击公式条目时 label 自动复制 + 闪烁提示"已复制"，拖放作为增强实现

### 5. `snippets/importer.js` — Snippet 导入

**职责**：一次性从旧配置导入 snippets。

**流程**：
1. 检查 `vscode.workspace.getConfiguration('latex-helper').get('snippets')` 是否为空
2. 若为空，读取 user settings 中的 `latex-utilities.liveReformat.snippets`
3. 解析 JSON，过滤掉 `SPECIAL_ACTION_*` 条目
4. 写入 `latex-helper.snippets` 配置
5. 弹窗提示用户导入结果（导入了 N 个，跳过了 M 个特殊 action）

**配置格式**（`latex-helper.snippets`）：
```json
[
  {
    "prefix": "L1$",
    "body": "L^1",
    "mode": "maths",
    "description": "Lebesgue L¹"
  }
]
```
与旧格式保持兼容，去除 `triggerWhenComplete`（始终为 true，由 provider 控制），去除 `priority`（VSCode 补全自有排序机制）。

### 6. `snippets/provider.js` — CompletionItemProvider

**职责**：在 LaTeX 编辑器中提供 context 感知的 snippet 补全。

**注册**：`vscode.languages.registerCompletionItemProvider('latex', ...)`

**Context 检测**：
- 判断光标当前位置是否在数学环境内（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`、`\begin{equation}...` 等）
- 若 `mode: "maths"` 且光标不在数学环境 → 不提供该 snippet
- 若 `mode: "text"` 且光标在数学环境内 → 不提供该 snippet
- 若 `mode: "any"` → 始终提供

**数学环境检测**：用简单状态机扫描光标前行内容：
- 跟踪 `$`、`$$`、`\(`/`\)`、`\[`/`\]` 的开关状态
- 跟踪 `\begin{<math-env>}` / `\end{<math-env>}` 的嵌套深度

### 7. `extension.js` — 入口模块

**activate 流程**：
1. 注册 `latex-helper.formulaPanel` WebviewView Provider → 注入到 `contributes.views`
2. 加载 snippet 配置，注册 CompletionItemProvider
3. 监听 `vscode.window.onDidChangeActiveTextEditor` → 触发公式面板刷新
4. 监听 `vscode.workspace.onDidChangeTextDocument` → debounce 后触发公式面板刷新
5. 首次启动：检查并执行 snippet 导入

## Configuration (`package.json` contributes)

```json
{
  "contributes": {
    "commands": [
      {
        "command": "latex-helper.showFormulaPanel",
        "title": "Show Formula Panel"
      },
      {
        "command": "latex-helper.importSnippets",
        "title": "Import Snippets from latex-utilities"
      }
    ],
    "views": {
      "latex-helper": [
        {
          "id": "latex-helper.formulaPanel",
          "name": "Formula Panel",
          "type": "webview"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "latex-helper",
          "title": "LaTeX Helper",
          "icon": "$(symbol-misc)"
        }
      ]
    },
    "configuration": {
      "title": "LaTeX Helper",
      "properties": {
        "latex-helper.snippets": {
          "type": "array",
          "default": [],
          "description": "LaTeX snippets for auto-completion"
        },
        "latex-helper.pdflatexPath": {
          "type": "string",
          "default": "pdflatex",
          "description": "Path to pdflatex executable"
        },
        "latex-helper.pdf2svgPath": {
          "type": "string",
          "default": "pdf2svg",
          "description": "Path to pdf2svg (or pdftocairo) executable"
        }
      }
    }
  }
}
```

## Dependencies

### 外部工具（需用户自行安装）
- `pdflatex` — 自带于 MacTeX / TeX Live（用户已安装）
- `pdf2svg` 或 `pdftocairo` — PDF → SVG 转换（`brew install pdf2svg` 或 poppler）

### Node 依赖（无需额外 npm 包）
- `vscode` — VSCode Extension API
- `child_process` — 调用 LaTeX 工具链（Node 内置）
- `crypto` — SHA256 哈希（Node 内置）
- `fs` / `path` — 文件系统操作（Node 内置）

## Error & Edge Cases

| 场景 | 处理 |
|------|------|
| 文件没有 preamble（子文件） | 使用默认最小 preamble（`article` + `amsmath` + `mathtools`） |
| 文件无公式 | 面板显式 "No labeled formulas found" |
| `pdflatex` 不在 PATH | 面板显示错误提示 + 设置项链接 |
| 编译超时 | 30s 超时后 kill 进程，显示 "Compilation timed out" |
| pdf2svg 不在 PATH | fallback 到 `pdftocairo`，都不可用则提示安装 |
| 旧 snippets 配置不存在 | 跳过导入，不报错 |
| snippet 配置格式错误 | 捕获解析异常，弹窗提示用户检查 JSON |
