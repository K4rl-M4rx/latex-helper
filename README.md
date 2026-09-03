# LaTeX Helper

本地 VSCode 扩展：LaTeX 辅助工具集合。在写稿时提供公式 SVG 预览，以及两套符号计算入口——**选区快捷键（SymPy）**与 **`∴` 块 Wolfram 伪代码（wolframscript）**。

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

### 2. 实时计算块：Wolfram 伪代码（`∴ Fun[…] ∴c`）

#### 设计思想

`∴` 块不再使用「表达式 + 尾部命令词」（如 `∴ x^2-1 factor ∴c`），而是把块内正文当成**缩小版的 Wolfram 语言**：

1. **外层是算子，内层是对象**：写成 `Fun[args]` / `Fun1[Fun2[…]]`，嵌套即复合变换（例如先求行列式再化简：`Simplify[Det[…]]`）。也可用 Prefix **`@`**：`Simplify @ Det[…]`（右结合，同 Wolfram）。
2. **函数名大小写不敏感，语义对齐 Wolfram**：`simplify` / `Simplify` / `SIMPLIFY` 都归一成合法符号；裸参数里的别名同样归一（`Collect[eq, x, simplify]` → 第三参 `Simplify`），但**不会**把变量 `x` 改成 `X`。多驼峰名靠别名表（`replaceall` → `ReplaceAll`）。
3. **叶子允许混写 LaTeX**：矩阵、`\frac`、下标等仍按 TeX 写在参数里，由内置 `tex2wolfram` 转成 Wolfram 再求值；已是 `Sin[x]`、`{{a,b},{c,d}}` 的则原样保留。
4. **参数可携带函数本身**：与 Wolfram 一致，例如对系数做化简用三参  
   `Collect[expr, x, Simplify]`（第二参是变量，第三参是施加于系数的头）。
5. **分界默认逗号，可配置**：顶层用 `,` 拆参（`[]`/`()`/`{}` 内不拆）；若设 `wolframArgSeparator` 为 `@`，则 `@` **只分参、不再表示 Prefix 复合**（建议分参用 `;`，把 `@` 留给复合）。
6. **触发仍是 `∴c`**：写完伪代码后输入收尾的 `c`，整块同步换成占位符，再异步换成 TeXForm 结果。引擎固定为 **wolframscript**（`casBackend: sympy` 对 `∴` 已弃用）。

#### 示例

```
∴ Factor[x^2-1] ∴c
∴ Together[\frac{1}{x}+\frac{1}{x+1}] ∴c
∴ Solve[x^2=4, x] ∴c
∴ D[x^3+x^2+1, x] ∴c
∴ Integrate[x^2, x] ∴c
∴ Det[\begin{vmatrix}a&b\\c&d\end{vmatrix}] ∴c
∴ Simplify[Det[\begin{pmatrix}1&2\\3&4\end{pmatrix}]] ∴c
∴ Collect[x y + x^2, x, Simplify] ∴c
∴ Collect[x y + x^2 @ x @ simplify] ∴c   （若 wolframArgSeparator 为 @；此时 @ 不再表示复合）
∴ Simplify @ Expand @ (x+1)^2 ∴c
∴ Simplify @ Det[\begin{pmatrix}1&2\\3&4\end{pmatrix}] ∴c
∴ replaceall[expr, s_2 -> Sqrt[1-s_3^2-s_1^2]] ∴c
```

多行 `pmatrix` 等也可写在同一 `∴ … ∴c` 内。补全在 `∴` 后会提示 `Fun[$1]` 模板。

- **旧语法已移除**：请用 `∴ Factor[expr] ∴c`，不要再写 `∴ expr factor ∴c`
- 叶子 LaTeX → Wolfram：`\frac` `\sqrt` `\sin` `\int` `\frac{d}{dx}` `\sum` `\lim`、矩阵/`\det`、下标、隐式乘法等；`fs_{2}` 会先插 `*` 再保护 `Subscript`，避免关键字被拆开
- 行列式：`vmatrix` / `\det\begin{pmatrix|bmatrix}` → `Det[{{…}}]`；也可直接写 `Det[{{a,b},{c,d}}]`
- `∴ <…> ∴` 定界不触发；仅 **`∴c`** 触发
- 由 `latex-helper.snippets` 中 `SPECIAL_ACTION_SYMPY` 驱动；数学模式下 `lm` 可插入 `∴ $1 ∴`（snippet `lm$`）

### 3. 公式面板 / 公式浏览器

- **Formula Panel**：侧边栏 Webview，公式 + 定理列表（搜索、刷新、清缓存、onlyRef 开关、显示最近）
- **Formula Browser**：编辑器区独立 Tab 的完整列表
- 编译管道：`standalone 文档 → latex (DVI) → dvisvgm --no-fonts → SVG`
- 增量缓存：公式按 bodyHash、文档按 preambleHash 缓存到 `temp/latex-helper-cache/`（或 globalStorage 回退），preamble 未变时直接命中磁盘缓存
- **onlyRef 模式**：只编译被 `\ref` 引用的公式，节省编译时间
- **定理预览**：定理卡片折叠时显示一行编译预览（批量编译，坏定理单条隔离），点击展开懒编译单条
- **Group By 树**：公式 / 定理视图分别按 Section / Subsection / Type 分类
- 已解析环境：`equation`、`align`、`gather`、`multline`、`flalign`、`eqnarray`、`array` 及 starred 版本；定理类环境内置 `theorem/lemma/...` + 自定义 `\newtheorem`
- **physics `\qty` 兼容**：预览编译前去掉公式 body 中的纯空白行（TeX 视为 `\par`，会触发 `Paragraph ended before \@quantity was complete`）；若同时加载 physics + siunitx，自动注入 `\RenewCommandCopy\qty\SI`（运行时 `\IfPackageLoadedTF`，兼容 `\input` 间接加载）
- **编译失败留档**：失败时把 `formulas.tex` / `formulas.log` 写到 `~/.latex-helper-last-fail/`，弹窗可一键打开

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
| `latex-helper.casBackend` | `wolfram` | `∴` 块固定 wolfram；`sympy` 选项已弃用（忽略）。选区快捷键仍用 python |
| `latex-helper.sympyPythonPath` | `python3` | 带 sympy 的 python3 路径（仅选区快捷键计算器） |
| `latex-helper.wolframPath` | `wolframscript` | wolframscript 可执行文件路径（`∴` 块与 Wolfram Engine） |
| `latex-helper.wolframArgSeparator` | `,` | `∴ Fun[…]` 顶层参数分界符。设为 `@` 时 `@` 只分参、Prefix 复合停用；建议分参用 `;`，复合用 `@` |
| `latex-helper.latexPath` | `latex` | latex 可执行文件路径（DVI 模式） |
| `latex-helper.dvisvgmPath` | `dvisvgm` | dvisvgm 可执行文件路径 |
| `latex-helper.auxPath` | `./temp` | `.aux` 辅助文件目录（引用检测用） |

## 依赖

- **LaTeX**（DVI 模式）+ **dvisvgm**：公式 / 定理 SVG 预览
- **python3 + sympy**：选区快捷键计算器（`∴` 块已不用）
- **latex2sympy2**（推荐）：快捷键计算器完整 LaTeX 解析，`pip install latex2sympy2`
- **Wolfram Engine + wolframscript**（`∴` 块必需）：伪代码求值

## 参考与致谢

本项目的若干功能在设计与实现上参考了以下 VSCode 扩展，在此向它们的作者致以诚挚谢意：

- [latex-sympy-calculator](https://marketplace.visualstudio.com/items?itemName=bcongdon.latex-sympy-calculator)（bcongdon）——符号计算器交互原型：选中表达式求值、快捷键计算器（Evaluate / Replace / Factor / Expand / Numerical）即移植自它的选中求值交互
- [latex-utilities](https://marketplace.visualstudio.com/items?itemName=tecosaur.latex-utilities)（tecosaur）——`SPECIAL_ACTION_*` 特殊动作机制（SYMPY 块、FRACTION、BREAK 熔断）、live-reformat 的 snippet 触发与熔断模式；`latex-helper.snippets` 配置结构兼容其 `latex-utilities.liveReformat.snippets`，可无缝沿用既有配置

感谢这些开源项目的作者：正是你们的灵感与无私分享，让本项目得以站在前人的肩膀上，用更少的时间做出更有用的工具。

## 开发

```bash
npm run lint                 # ESLint
npm test                     # 全量单元测试（scripts/run-tests.js → test/*.test.js）
npm run clean-temp           # 清空项目 temp/（公式预览缓存、调试产物）
./scripts/clean-temp.command # 同上，带确认提示（可双击）
```

`temp/` 已在 `.gitignore` 中忽略，不入库。公式预览的增量缓存默认也在工作区 `temp/latex-helper-cache/`。

## 已知限制

- 快捷键计算器每次调用起一个 python 进程，首次调用较慢（15s 超时）
- wolframscript 引擎启动较慢（块求值超时放宽到 30s）
- 定理预览的编号从 1 起排，与原文档编号不一致（standalone 独立编译所致）
- 批量公式编译使用 `-halt-on-error`：一条坏公式会使整批失败；失败产物见 `~/.latex-helper-last-fail/`
- 预览侧去掉空白行只影响 standalone 编译稿，不会改写用户源文件
- 矩阵转换不支持嵌套矩阵、`array` 列格式；行列式请用 `∴ Det[…]` / wolfram 伪代码
- 公式预览使用 `latex`（DVI）：中文文档的 `ctex` 在 macOS 上会选 `macold` 字库并报错；扩展会在预览稿中强制 `fontset=fandol`，并剥离 `xeCJK` / `\setCJKmainfont`（不影响用户源文件）
