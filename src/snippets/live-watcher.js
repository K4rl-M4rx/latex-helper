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
const { execFile } = require('child_process');
const { getLiveSnippets } = require('./config');
const { getModeAtPosition } = require('../utils/tex');
const { getPythonPath } = require('../utils/python');
const { expandBody } = require('./provider');
const { buildPrelude } = require('../sympy/calculator');

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
    if (op === 'factor') apply = 'factor(__expr)';
    else if (op === 'expand') apply = 'expand(__expr)';
    else if (op === 'numerical') apply = 'N(__expr, 15)';
    else if (op === 'collect') apply = 'collect(__expr, Symbol(' + JSON.stringify(arg) + '))';
    else if (op === 'solve') apply = 'solve(__expr)';
    return prelude +
        '__expr = __parse(' + JSON.stringify(latexExpr) + ')\n' +
        // latex2sympy2 把 \frac{d}{dx}、\int 解析为未求值的 Derivative/Integral，
        // evaluate 语义要求算出结果；doit 对普通表达式是恒等，安全
        "__expr = __expr.doit() if hasattr(__expr, 'doit') else __expr\n" +
        'print(latex(' + apply + "), end='')";
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
        const text = line.text.substring(0, upto);
        let match = snippet.prefixRegex.exec(text);
        // SYMPY 模板交互：完整块未匹配时，尝试行尾的开头词（如 "sympy" 在行尾）。
        // 命中则插入 "open $1" 模板（tabstop 光标停在表达式处），用户输完表达式
        // 再输入收尾词，完整块正则匹配后走下方占位符求值路径。
        let isTemplateTrigger = false;
        if (!match && snippet.specialAction === 'sympy' && snippet.sympyOpenRegex) {
            const openMatch = snippet.sympyOpenRegex.exec(text);
            if (openMatch) {
                match = openMatch;
                isTemplateTrigger = true;
            }
        }
        if (!match) return undefined;

        // SPECIAL_ACTION_BREAK：熔断哨兵（无文本替换）
        if (snippet.specialAction === 'break') return 'break';

        // SPECIAL_ACTION_SYMPY：先把匹配文本替换为占位符，异步求值后替换为结果
        if (snippet.specialAction === 'sympy') {
            if (isTemplateTrigger) {
                // 模板触发：把行尾的开头词替换为 "open $1"，光标停在 tabstop 输入表达式。
                // 不包含收尾词——用户输完表达式后自行输入收尾词才触发求值（掌控时机）
                const openRange = new vscode.Range(
                    new vscode.Position(line.lineNumber, match.index),
                    new vscode.Position(line.lineNumber, match.index + match[0].length)
                );
                this.isApplyingEdit = true;
                try {
                    await editor.edit(editBuilder => {
                        editBuilder.delete(openRange);
                    }, { undoStopBefore: true, undoStopAfter: false });
                    await editor.insertSnippet(
                        new vscode.SnippetString(snippet.sympyOpen + ' $1'),
                        undefined,
                        { undoStopBefore: true, undoStopAfter: true }
                    );
                    return (snippet.sympyOpen + ' ').length - match[0].length;
                } finally {
                    this.isApplyingEdit = false;
                }
            }
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
        const block = match[1];
        const parsed = parseSympyBlock(block);
        if (!parsed.expr) {
            // 空表达式（如 "sympy collect x sympy"）：不调 python，走错误路径清理占位符
            this.applySympyResult(block, new Error('empty expression'), '', '');
            return SYMPY_PLACEHOLDER;
        }
        const script = buildSympyScript(parsed.expr, parsed.op, parsed.arg, new Map());
        const pythonPath = getPythonPath();
        execFile(pythonPath, ['-c', script], { timeout: 15000 }, (err, stdout, stderr) => {
            this.applySympyResult(block, err, stdout, stderr);
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
            const result = failed ? SYMPY_ERROR : stdout;

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
    buildSympyScript,
    SYMPY_PLACEHOLDER,
    SYMPY_ERROR
};
