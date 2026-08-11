# LaTeX Helper

本地 VSCode 扩展：LaTeX 辅助工具集合。基于 Python、SymPy、LaTeX 与 dvisvgm 在文档编写时提供公式预览与符号计算能力。

> 个人使用，暂时不发布到市场。目标平台 macOS，要求 VSCode ≥ 1.85.0。本人只会 vibe coding，发 issue 不一定能解决，欢迎大家拿去自行修改。

## 功能

### 1. SymPy 计算器（选中 + 快捷键）

选中 LaTeX 表达式后按快捷键求值，结果追加到选区后（或替换选区）。解析管道：`latex2sympy2`（支持 `\frac`、`\int`、`\frac{d}{dx}` 等完整 LaTeX 语法）→ SymPy 求值 → LaTeX 输出；未安装 latex2sympy2 时回退 SymPy `parse_expr`（仅近 Python 语法）。

| 快捷键 | 命令 | 行为 |
|---|---|---|
| `ctrl+alt+e` | Evaluate | 求值并追加 ` = 结果`（如 `\frac{d}{dx}(x^3+x^2+1) = x (3 x + 2)`） |
| `ctrl+alt+r` | Replace | 求值并替换选区 |
| `ctrl+alt+f` | Factor | 因式分解 |
| `ctrl+alt+x` | Expand | 展开 |
| `ctrl+alt+n` | Numerical | 数值计算（15 位） |

命令面板（无默认快捷键）：

- **Collect**：按指定变量收集，选区语法 `x*y + x^2 collect x`
- **Solve**：解方程（选区含 `=` 按方程处理，否则求零点）
- **Eval At**：代入求值，选区语法 `(x+2)|_{x=y+1}`
- **Define**：定义变量 `name = expr`，之后 Evaluate 自动代入
- **Show Variables / Reset Variables**：查看 / 清空变量表（存于 workspaceState）

变量值经 JSON 注入拼进 python 脚本，杜绝 shell / 脚本注入。每次调用 spawn 一次 python 进程（无常驻服务）。

### 2. 实时公式计算块（`∴ ... ∴c`）

在文档中直接书写 `∴ <表达式> <命令> ∴c`，输入最后一个 `c` 的瞬间，整块替换为计算结果（表达式用 LaTeX 语法，两个引擎都支持）：

```
∴ x^2-1 factor ∴c       →  (x-1) (x+1)
∴ \frac{1}{x}+\frac{1}{x+1} together ∴c →  \frac{2 x+1}{x (x+1)}
∴ x^2=4 solve ∴c         →  \{\{x\to -2\},\{x\to 2\}\}
∴ \frac{d}{dx}(x^3+x^2+1) evaluate ∴c →  3 x^2+2 x
∴ \int x^2 dx evaluate ∴c →  \frac{x^3}{3}
∴ \lim_{x \to 0} \frac{\sin x}{x} evaluate ∴c →  1
```

- 命令词（表达式后、收尾 `∴` 前）：`collect <var>`、`expand`、`factor`、`simplify`、`fullsimplify`、`together`、`apart`、`cancel`、`trigreduce`、`trigexpand`、`powerexpand`、`numerical`、`solve`、`evaluate`
- 引擎由 `latex-helper.casBackend` 切换（见[配置](#配置)）：
  - `sympy`：表达式直接用 latex2sympy2 解析
  - `wolfram`：表达式先经内置 LaTeX → Wolfram 转换器（`\frac` `\sqrt` `\sin` `\int` `\frac{d}{dx}` `\sum` `\lim` 下标、隐式乘法等），再交给 wolframscript 求值；也兼容直接写 Wolfram 语法（`Sin[x]`、`D[...]`）
- `∴ <expr> ∴` 定界不触发；`∴d` 后缀触发已移除，仅 `∴c` 命令触发
- 该块语法由 `latex-helper.snippets` 中的 SYMPY 条目（`SPECIAL_ACTION_SYMPY`）驱动；数学模式下输入 `lm` 可快速插入 `∴ $1 ∴` 块（snippet `lm$`）

### 3. 公式面板 / 公式浏览器

- **Formula Panel**：侧边栏 Webview，公式 + 定理列表（搜索、刷新、清缓存、onlyRef 开关、显示最近）
- **Formula Browser**：编辑器区独立 Tab 的完整列表
- 编译管道：`standalone 文档 → latex (DVI) → dvisvgm --no-fonts → SVG`
- 增量缓存：公式按 bodyHash、文档按 preambleHash 缓存到 `temp/latex-helper-cache/`（或 globalStorage 回退），preamble 未变时直接命中磁盘缓存
- **onlyRef 模式**：只编译被 `\ref` 引用的公式，节省编译时间
- **定理预览**：定理卡片折叠时显示一行编译预览（批量编译，坏定理单条隔离），点击展开懒编译单条
- **Group By 树**：公式 / 定理视图分别按 Section / Subsection / Type 分类
- 已解析环境：`equation`、`align`、`gather`、`multline`、`flalign`、`eqnarray`、`array` 及 starred 版本；定理类环境内置 `theorem/lemma/...` + 自定义 `\newtheorem`

### 4. Snippet 补全与实时展开

- `latex-helper.snippets` 配置驱动（配置项结构兼容 latex-utilities），补全 context 感知（数学模式 / 文本模式）
- 实时展开：数学模式下输入 snippet 的收尾字符即时展开（如 `\mathrm` 自动补全、`SPECIAL_ACTION_FRACTION` 分数 `(x+1)/` → `\frac{x+1}{...}`）
- 首次启动时若 `latex-helper.snippets` 为空，自动从旧配置导入

## 安装

方式 A（开发调试）：在 VSCode 中按 `F5` 启动扩展开发主机。

方式 B（装载脚本，软链接到扩展目录）：

```bash
./install.command        # 双击运行亦可；卸载：./uninstall.command
```

装完后重启 VSCode（或 `Developer: Reload Window`）。若旧扩展 tecosaur.latex-utilities 也在启用，建议二选一禁用，避免双重展开。

## 配置

| 配置项 | 默认 | 说明 |
|---|---|---|
| `latex-helper.snippets` | `[]` | LaTeX snippet 定义（含 SYMPY 块、BREAK 熔断、FRACTION 等特殊动作） |
| `latex-helper.casBackend` | `sympy` | `∴ ... ∴c` 块求值引擎：`sympy`（latex2sympy2 管道）或 `wolfram`（wolframscript + 内置 LaTeX→Wolfram 转换器） |
| `latex-helper.sympyPythonPath` | `python3` | 带 sympy 的 python3 路径（pipx 安装如 `~/.local/pipx/venvs/sympy/bin/python3`） |
| `latex-helper.wolframPath` | `wolframscript` | wolframscript 可执行文件路径（Wolfram Engine） |
| `latex-helper.latexPath` | `latex` | latex 可执行文件路径（DVI 模式） |
| `latex-helper.dvisvgmPath` | `dvisvgm` | dvisvgm 可执行文件路径 |
| `latex-helper.auxPath` | `./temp` | `.aux` 辅助文件目录（引用检测用） |

## 依赖

- **LaTeX**（DVI 模式）+ **dvisvgm**：公式 / 定理 SVG 预览
- **python3 + sympy**：快捷键计算器与 `∴ ... ∴c` 块的 sympy 后端
- **latex2sympy2**（推荐）：完整 LaTeX 语法解析，`pip install latex2sympy2`
- **Wolfram Engine + wolframscript**（可选）：`casBackend: wolfram` 时使用

## 参考与致谢

本项目的若干功能在设计与实现上参考了以下 VSCode 扩展，在此向它们的作者致以诚挚谢意：

- [latex-sympy-calculator](https://marketplace.visualstudio.com/items?itemName=bcongdon.latex-sympy-calculator)（bcongdon）——符号计算器交互原型：选中表达式求值、快捷键计算器（Evaluate / Replace / Factor / Expand / Numerical）即移植自它的选中求值交互
- [latex-utilities](https://marketplace.visualstudio.com/items?itemName=tecosaur.latex-utilities)（tecosaur）——`SPECIAL_ACTION_*` 特殊动作机制（SYMPY 块、FRACTION、BREAK 熔断）、live-reformat 的 snippet 触发与熔断模式；`latex-helper.snippets` 配置结构兼容其 `latex-utilities.liveReformat.snippets`，可无缝沿用既有配置

感谢这些开源项目的作者：正是你们的灵感与无私分享，让本项目得以站在前人的肩膀上，用更少的时间做出更有用的工具。

## 开发

```bash
npm run lint                 # ESLint
node test/*.test.js          # 单元测试（cache/compiler/live-watcher/parser/snippets/sympy/webview）
```

## 已知限制

- 快捷键计算器每次调用起一个 python 进程，首次调用较慢（15s 超时）
- wolframscript 引擎启动较慢（块求值超时放宽到 30s）
- 定理预览的编号从 1 起排，与原文档编号不一致（standalone 独立编译所致）
