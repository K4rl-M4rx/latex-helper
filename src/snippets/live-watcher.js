/**
 * 实时 snippet 展开：监听文本变化，自动替换匹配的 prefix。
 * 1:1 对齐 latex-utilities completionWatcher：
 * - 遍历事件中的全部 contentChanges（不限制单字符输入，粘贴/IME 也能触发）
 * - 纯删除（change.text 为空）不触发，避免 \norm{} 删括号时误展开 rm 类 snippet
 * - 每次成功替换后累计偏移量 offset，并重新读取行文本
 * - sameChanges 去重，防止自己触发的编辑事件被重复处理
 * - noPlaceholders 直接替换文本；否则先删除匹配范围再 insertSnippet
 * - SPECIAL_ACTION_FRACTION：闭括号向前配对开括号，整段替换为 \frac{内容}{$1}
 */

const vscode = require('vscode');
const os = require('os');
const { execFile } = require('child_process');
const { getLiveSnippets } = require('./config');
const { getModeAtPosition } = require('../utils/tex');
const { getPythonPath } = require('../utils/python');
const { expandBody } = require('./provider');
const { buildPrelude } = require('../sympy/calculator');
const { tex2wolfram } = require('./tex2wolfram');

/** sympy 求值占位符：匹配后先同步插入，异步替换为 sympy 的 LaTeX 输出 */
const SYMPY_PLACEHOLDER = 'SYMPY_CALCULATING';
/** sympy 求值失败时短暂显示的文本（400ms 后删除） */
const SYMPY_ERROR = 'SYMPY_ERROR';

/**
 * 解析 SYMPY 块内表达式与可选操作词（表达式里直接传参）：
 * - `expr`                          → evaluate（默认）
 * - `expr collect <var>`            → 按指定变量收集（对应 Wolfram Collect）
 * - `expr factor | expand | numerical | solve | evaluate` → 对应操作
 * @param {string} block 完整块捕获组 1（如 "x^2+2x+1 collect x"）
 * @returns {{ expr: string, op: string, arg: string | null }}
 */
function parseSympyBlock(block) {
    let m = /^(.*?)\s+collect\s+([A-Za-z_]\w*)$/s.exec(block);
    if (m) return { expr: m[1].trim(), op: 'collect', arg: m[2] };
    m = /^(.*?)\s+(factor|expand|numerical|solve|evaluate)$/s.exec(block);
    if (m) return { expr: m[1].trim(), op: m[2], arg: null };
    return { expr: block.trim(), op: 'evaluate', arg: null };
}

/**
 * 操作词 → sympy 函数包裹（collect/solve/evaluate 特殊处理，其余查表）。
 * fullsimplify 无直接对应 → simplify；trigreduce → trigsimp；trigexpand → expand_trig。
 */
const SYMPY_OP_FN = {
    expand: 'expand(__expr)',
    factor: 'factor(__expr)',
    simplify: 'simplify(__expr)',
    fullsimplify: 'simplify(__expr)',
    together: 'together(__expr)',
    apart: 'apart(__expr)',
    cancel: 'cancel(__expr)',
    trigreduce: 'trigsimp(__expr)',
    trigexpand: 'expand_trig(__expr)',
    powerexpand: 'powsimp(__expr)',
    numerical: 'N(__expr, 15)'
};

/**
 * 操作词 → Wolfram 函数名（collect/solve/evaluate 特殊处理，其余查表）。
 */
const WOLFRAM_OP_FN = {
    expand: 'Expand',
    factor: 'Factor',
    simplify: 'Simplify',
    fullsimplify: 'FullSimplify',
    together: 'Together',
    apart: 'Apart',
    cancel: 'Cancel',
    trigreduce: 'TrigReduce',
    trigexpand: 'TrigExpand',
    powerexpand: 'PowerExpand',
    numerical: 'N'
};

/**
 * 解析 prefix 正则捕获的操作词（组 2）：
 * - "collect x" → { op: 'collect', arg: 'x' }
 * - "expand" → { op: 'expand', arg: null }
 * @param {string} opRaw
 * @returns {{ op: string, arg: string | null }}
 */
function parseOpWord(opRaw) {
    const m = /^collect\s+([A-Za-z_]\w*)$/.exec(opRaw);
    if (m) return { op: 'collect', arg: m[1] };
    return { op: opRaw, arg: null };
}

/**
 * 生成 python3 -c 脚本：复用快捷键计算器的 latex2sympy2 管道
 * （buildPrelude + __parse，支持 \frac 等完整 LaTeX 语法；操作语义与快捷键命令一致）。
 * - solve：表达式含 = 按方程求解（Eq），否则求零点
 * - 所有用户输入经 JSON.stringify 注入，杜绝注入
 * @param {string} latexExpr
 * @param {string} op
 * @param {string | null} arg
 * @param {Map<string, string>} vars 变量表（live-watcher 无变量表，传空 Map）
 * @returns {string}
 */
function buildSympyScript(latexExpr, op, arg, vars) {
    const prelude = buildPrelude(vars);
    if (op === 'solve') {
        const eqIdx = latexExpr.indexOf('=');
        if (eqIdx !== -1) {
            const lhs = latexExpr.slice(0, eqIdx).trim();
            const rhs = latexExpr.slice(eqIdx + 1).trim();
            return prelude +
                '__lhs = __parse(' + JSON.stringify(lhs) + ')\n' +
                '__rhs = __parse(' + JSON.stringify(rhs) + ')\n' +
                'print(latex(solve(Eq(__lhs, __rhs))), end=\'\')';
        }
    }
    let apply = '__expr';
    if (op === 'collect') {
        apply = 'collect(__expr, Symbol(' + JSON.stringify(arg) + '))';
    } else if (SYMPY_OP_FN[op]) {
        apply = SYMPY_OP_FN[op];
    } else if (op === 'solve') {
        apply = 'solve(__expr)';
    }
    return prelude +
        '__expr = __parse(' + JSON.stringify(latexExpr) + ')\n' +
        // latex2sympy2 把 \frac{d}{dx}、\int 解析为未求值的 Derivative/Integral，
        // evaluate 语义要求算出结果；doit 对普通表达式是恒等，安全
        "__expr = __expr.doit() if hasattr(__expr, 'doit') else __expr\n" +
        'print(latex(' + apply + "), end='')";
}

/**
 * 生成 wolframscript 命令：ToString[expr, TeXForm] 输出 LaTeX。
 * - 注意：不能直接 TeXForm[...]——WolframScript 1.13 下 TeXForm 不作为
 *   函数求值（`TeXForm[x^2]` 原样返回），必须用 ToString[expr, TeXForm]。
 * - evaluate（命令词显式给出）：ToString[expr, TeXForm]，expr 为 Wolfram 表达式
 * - 代数操作词：ToString[Fn[expr], TeXForm] 等；collect → Collect[expr, var]；solve → Solve[expr == 0]
 * - 带参形式 fnName[fnArgs]：expr 作为第一参数 → ToString[Fn[expr, fnArgs], TeXForm]
 * @param {string} expr Wolfram 表达式
 * @param {string} op
 * @param {string | null} arg
 * @param {string | null} fnName 带参形式的 Wolfram 函数名（fn[args] 语法）
 * @param {string | null} fnArgs 带参形式的参数（Wolfram 语法，原样透传）
 * @returns {string}
 */
function buildWolframScript(expr, op, arg, fnName, fnArgs) {
    if (fnName) {
        const suffix = fnArgs ? ', ' + fnArgs : '';
        return 'ToString[' + fnName + '[' + expr + suffix + '], TeXForm]';
    }
    if (op === 'collect') return 'ToString[Collect[' + expr + ', ' + arg + '], TeXForm]';
    if (op === 'solve') {
        // 用户输入 LaTeX 风格单个 = 时转成 Wolfram 的 ==（x^2=4 → x^2==4），
        // 已有 ==/<=/>=/!= 不受影响；无等号才补 == 0
        const eq = expr.replace(/([^<>=!])=(?!=)/g, '$1==');
        return eq.includes('==')
            ? 'ToString[Solve[' + eq + '], TeXForm]'
            : 'ToString[Solve[' + eq + ' == 0], TeXForm]';
    }
    const fn = WOLFRAM_OP_FN[op];
    if (fn) return 'ToString[' + fn + '[' + expr + '], TeXForm]';
    return 'ToString[' + expr + ', TeXForm]';
}

/**
 * 读取 latex-helper.wolframPath 配置并展开开头的 ~/（默认 wolframscript，在 PATH 中）。
 * @returns {string}
 */
function getWolframPath() {
    let wolframPath = vscode.workspace.getConfiguration('latex-helper').get('wolframPath', 'wolframscript');
    if (wolframPath.startsWith('~/')) {
        wolframPath = os.homedir() + wolframPath.slice(1);
    }
    return wolframPath;
}

/**
 * SPECIAL_ACTION_FRACTION 的核心计算（纯函数，便于单测）。
 * 1:1 对齐原插件 getFraction：
 * - match[1] 是闭括号 ) ] }，查表得开括号，从 match.index 向前 depth 计数，
 *   depth 归 0 处即配对开括号（只计同一对括号字符）
 * - 闭括号是 } 且开括号前紧邻 \command 时，把 \command 一并吞入替换范围，
 *   内容保留 \command（如 \hat{x}/ → \frac{\hat{x}}{$1} ）
 * - 找不到配对开括号时返回空范围 + 空替换（no-op，与原插件一致）
 * @param {string} lineText
 * @param {RegExpExecArray} match
 * @returns {{ start: number, end: number, replacement: string }}
 */
function computeFraction(lineText, match) {
    const closing = match[1];
    const opening = { ')': '(', ']': '[', '}': '{' }[closing];
    if (!opening) {
        return { start: match.index + match[0].length, end: match.index + match[0].length, replacement: '' };
    }
    let depth = 0;
    for (let i = match.index; i >= 0; i--) {
        const ch = lineText[i];
        if (ch === closing) depth--;
        else if (ch === opening) depth++;
        if (depth === 0) {
            let command = '';
            if (closing === '}') {
                const commandMatch = /.*(\\\w+)$/.exec(lineText.substring(0, i));
                if (commandMatch) {
                    i -= commandMatch[1].length;
                    command = '\\';
                }
            }
            return {
                start: i,
                end: match.index + match[0].length,
                replacement: '\\frac{' + command + lineText.substring(i + 1, match.index) + '}{$1} '
            };
        }
    }
    return { start: match.index + match[0].length, end: match.index + match[0].length, replacement: '' };
}

class LiveSnippetWatcher {
    constructor() {
        /** @type {boolean} 正在应用编辑，阻止重入 */
        this.isApplyingEdit = false;
        /** @type {vscode.TextDocumentChangeEvent | null} */
        this.lastChanges = null;
        /** @type {{ position: vscode.Position, mode: string } | null} 模式检测缓存 */
        this.lastKnownType = null;
    }

    /**
     * 处理文档变化事件。
     * @param {vscode.TextDocumentChangeEvent} event
     */
    async watcher(event) {
        if (event.document.languageId !== 'latex') return;
        if (!event.contentChanges || event.contentChanges.length === 0) return;
        if (this.isApplyingEdit) return;
        if (this.sameChanges(event)) return;
        if (!vscode.window.activeTextEditor) return;

        this.lastChanges = event;

        const snippets = getLiveSnippets();
        if (snippets.length === 0) return;

        let offset = 0;
        for (const change of event.contentChanges) {
            // 纯删除不触发：删除没有"输完"任何 prefix，
            // 例如 \norm{} 删掉括号剩 \norm 时不应误展开 rm → \mathrm
            if (change.text.length === 0) continue;

            const mode = getModeAtPosition(event.document, change.range.start, this.lastKnownType);
            this.lastKnownType = { position: change.range.start, mode };

            if (!change.range.isSingleLine) continue;

            let line = event.document.lineAt(change.range.start.line);
            for (const s of snippets) {
                if (s.mode !== 'any' && s.mode !== mode) continue;

                const delta = await this.execSnippet(s, line, change, offset);
                // SPECIAL_ACTION_BREAK：熔断哨兵，当前 change 不再尝试后续 snippet
                if (delta === 'break') break;
                if (delta !== undefined) {
                    offset += delta;
                    line = event.document.lineAt(change.range.start.line);
                }
            }
        }
    }

    /**
     * 与上一次事件完全相同（自己触发的编辑回显）则跳过。
     * @param {vscode.TextDocumentChangeEvent} event
     * @returns {boolean}
     */
    sameChanges(event) {
        if (!this.lastChanges) return false;
        const prev = this.lastChanges.contentChanges;
        const curr = event.contentChanges;
        if (prev.length !== curr.length) return false;
        return prev.every((p, i) =>
            p.text === curr[i].text && p.range.isEqual(curr[i].range)
        );
    }

    /**
     * 对单个 snippet 尝试匹配并展开。
     * @param {import('./config').NormalizedSnippet} snippet
     * @param {vscode.TextLine} line
     * @param {vscode.TextDocumentContentChangeEvent} change
     * @param {number} offset 本次事件中此前替换造成的列偏移
     * @returns {Promise<number | undefined>} 替换长度差；未匹配返回 undefined
     */
    async execSnippet(snippet, line, change, offset) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;

        const upto = change.range.start.character + change.text.length + offset;
        const match = snippet.prefixRegex.exec(line.text.substring(0, upto));
        if (!match) return undefined;

        // SPECIAL_ACTION_BREAK：熔断哨兵（无文本替换）
        if (snippet.specialAction === 'break') return 'break';

        // SPECIAL_ACTION_SYMPY：先把匹配文本替换为占位符，异步求值后替换为结果
        if (snippet.specialAction === 'sympy') {
            const sympyRange = new vscode.Range(
                new vscode.Position(line.lineNumber, match.index),
                new vscode.Position(line.lineNumber, match.index + match[0].length)
            );
            const placeholder = this.execSympy(match);
            this.isApplyingEdit = true;
            try {
                await editor.edit(editBuilder => {
                    editBuilder.replace(sympyRange, placeholder);
                }, { undoStopBefore: true, undoStopAfter: true });
                return placeholder.length - match[0].length;
            } finally {
                this.isApplyingEdit = false;
            }
        }

        // SPECIAL_ACTION_FRACTION：替换范围向前延伸到配对开括号，强制 insertSnippet
        // （replacement 含 $1 tabstop；原插件因 body 无 $$N 走纯文本会丢失 tabstop，
        // 本项目按调研结论强制走 delete + insertSnippet 路径）
        if (snippet.specialAction === 'fraction') {
            const frac = computeFraction(line.text, match);
            const fracRange = new vscode.Range(
                new vscode.Position(line.lineNumber, frac.start),
                new vscode.Position(line.lineNumber, frac.end)
            );
            this.isApplyingEdit = true;
            try {
                await editor.edit(editBuilder => {
                    editBuilder.delete(fracRange);
                }, { undoStopBefore: true, undoStopAfter: false });
                if (frac.replacement === '') return 0; // 找不到配对开括号：no-op
                await editor.insertSnippet(
                    new vscode.SnippetString(frac.replacement),
                    undefined,
                    { undoStopBefore: true, undoStopAfter: true }
                );
                return frac.replacement.length - (frac.end - frac.start);
            } finally {
                this.isApplyingEdit = false;
            }
        }

        const range = new vscode.Range(
            new vscode.Position(line.lineNumber, match.index),
            new vscode.Position(line.lineNumber, match.index + match[0].length)
        );
        const replacement = expandBody(snippet, match);

        this.isApplyingEdit = true;
        try {
            if (snippet.noPlaceholders) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(range, replacement);
                }, { undoStopBefore: true, undoStopAfter: true });

                // 文本变长时把光标移到替换文本末尾
                const delta = replacement.length - match[0].length;
                if (delta > 0 && editor.selection) {
                    const newAnchor = editor.selection.anchor.translate(0, delta);
                    editor.selection = new vscode.Selection(newAnchor, newAnchor);
                }
                return delta;
            } else {
                // 先删除匹配范围，再在光标处插入 snippet（与原插件一致）
                await editor.edit(editBuilder => {
                    editBuilder.delete(range);
                }, { undoStopBefore: true, undoStopAfter: false });

                await editor.insertSnippet(
                    new vscode.SnippetString(replacement),
                    undefined,
                    { undoStopBefore: true, undoStopAfter: true }
                );
                return replacement.length - match[0].length;
            }
        } finally {
            this.isApplyingEdit = false;
        }
    }

    /**
     * SPECIAL_ACTION_SYMPY：启动 python3 + sympy 异步求值，返回占位符。
     * 求值完成后把占位符替换为 LaTeX 输出；失败则短暂显示 SYMPY_ERROR（400ms 后删除）。
     * 占位符定位不靠记忆 range（期间用户可能继续编辑），而是在文档中重新搜索。
     * @param {RegExpExecArray} match
     * @returns {string} 占位符文本
     */
    execSympy(match) {
        // 触发解析（prefix 正则 `∴ ?(.+?) ?(?:<命令词>|([A-Za-z]+)\[([^\]]*)\]) ?∴ ?c$`）：
        // match[1] = 表达式；match[2] = 命令词（collect x / expand / ... / evaluate）
        // match[3]/match[4] = 带参 Wolfram 函数形式 fn[args]（如 Collect[x]、D[x]、Solve[x]）
        // 仅 ∴c 命令触发；∴ 定界与 ∴d 后缀均不触发（settings prefix 无对应分支）
        const expr = match[1].trim();
        let op;
        let arg;
        let fnName = null;
        let fnArgs = null;
        if (match[3]) {
            // 带参形式 fn[args]：expr 作为 Wolfram 函数的第一参数
            fnName = match[3];
            fnArgs = match[4] !== undefined ? match[4] : '';
            op = 'fn';
            arg = null;
        } else {
            ({ op, arg } = match[2] ? parseOpWord(match[2]) : { op: 'evaluate', arg: null });
        }
        if (!expr) {
            // 空表达式（如 "∴  ∴c" 之类无有效表达式）：不调引擎，走错误路径清理占位符
            this.applySympyResult(match[0], new Error('empty expression'), '', '');
            return SYMPY_PLACEHOLDER;
        }
        // 双后端：latex-helper.casBackend 决定块求值引擎
        // - sympy：latex2sympy2 管道（默认，快捷键计算器同源）
        // - wolfram：wolframscript -code "ToString[..., TeXForm]"
        const backend = vscode.workspace.getConfiguration('latex-helper').get('casBackend', 'sympy');
        // 带参 fn[args] 是 Wolfram 函数语义，仅 wolfram 后端支持
        if (fnName && backend !== 'wolfram') {
            this.applySympyResult(match[0], new Error('fn[args] only supported by wolfram backend'), '', '');
            return SYMPY_PLACEHOLDER;
        }
        let execPath;
        let args;
        if (backend === 'wolfram') {
            execPath = getWolframPath();
            // 用户输入 LaTeX 语法（\frac \sin \int 等）→ 先转 Wolfram 表达式
            args = ['-code', buildWolframScript(tex2wolfram(expr), op, arg, fnName, fnArgs)];
        } else {
            execPath = getPythonPath();
            args = ['-c', buildSympyScript(expr, op, arg, new Map())];
        }
        // wolframscript 引擎启动较慢，超时放宽到 30s；sympy 保持 15s
        const timeout = backend === 'wolfram' ? 30000 : 15000;
        execFile(execPath, args, { timeout }, (err, stdout, stderr) => {
            this.applySympyResult(expr, err, stdout, stderr);
        });
        return SYMPY_PLACEHOLDER;
    }

    /**
     * sympy 求值回调：在文档中搜索占位符并替换为结果；找不到说明用户已改动，放弃。
     * @param {string} command 求值命令（日志用）
     * @param {Error | null} err
     * @param {string} stdout
     * @param {string} stderr
     */
    applySympyResult(command, err, stdout, stderr) {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const failed = Boolean(err) || Boolean(stderr);
            if (failed) {
                console.error('LaTeX Helper: sympy failed for', command, err ? err.message : stderr);
            }
            const result = failed ? SYMPY_ERROR : stdout.trim();

            // 全文搜索占位符（通常在同一行；用户期间编辑过也能找到）
            const fullText = editor.document.getText();
            const idx = fullText.indexOf(SYMPY_PLACEHOLDER);
            if (idx === -1) return; // 占位符已被用户删掉/改动，不干预
            const startPos = editor.document.positionAt(idx);
            const range = new vscode.Range(startPos, startPos.translate(0, SYMPY_PLACEHOLDER.length));

            this.isApplyingEdit = true;
            editor.edit(editBuilder => {
                editBuilder.replace(range, result);
            }, { undoStopBefore: false, undoStopAfter: false }).then((applied) => {
                this.isApplyingEdit = false;
                if (!applied) {
                    console.error('LaTeX Helper: sympy result edit was not applied');
                    return;
                }
                if (failed) {
                    setTimeout(() => {
                        // 重新搜索 SYMPY_ERROR 位置再删（期间可能又变化）
                        const text = editor.document.getText();
                        const eidx = text.indexOf(SYMPY_ERROR);
                        if (eidx === -1) return;
                        const es = editor.document.positionAt(eidx);
                        const eRange = new vscode.Range(es, es.translate(0, SYMPY_ERROR.length));
                        this.isApplyingEdit = true;
                        editor.edit(editBuilder => {
                            editBuilder.delete(eRange);
                        }, { undoStopBefore: false, undoStopAfter: false }).then(() => {
                            this.isApplyingEdit = false;
                        }, () => { this.isApplyingEdit = false; });
                    }, 400);
                }
            }, (editErr) => {
                this.isApplyingEdit = false;
                console.error('LaTeX Helper: sympy result edit failed', editErr);
            });
        } catch (callbackErr) {
            this.isApplyingEdit = false;
            console.error('LaTeX Helper: sympy callback error', callbackErr);
        }
    }
}

module.exports = {
    LiveSnippetWatcher,
    computeFraction,
    parseSympyBlock,
    parseOpWord,
    buildSympyScript,
    buildWolframScript,
    SYMPY_PLACEHOLDER,
    SYMPY_ERROR
};
