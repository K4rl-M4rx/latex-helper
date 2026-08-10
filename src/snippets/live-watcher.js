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

/** sympy 求值占位符：匹配后先同步插入，异步替换为 sympy 的 LaTeX 输出 */
const SYMPY_PLACEHOLDER = 'SYMPY_CALCULATING';
/** sympy 求值失败时短暂显示的文本（400ms 后删除） */
const SYMPY_ERROR = 'SYMPY_ERROR';

/**
 * 捕获组表达式 → sympy 可求值形式（1:1 原插件转换规则）：
 * \command + 可选空格 → command；^ → **；{ → (；} → )（后三项仅替换首个，与原插件一致）
 * @param {string} expr
 * @returns {string}
 */
function buildSympyCommand(expr) {
    return expr
        .replace(/\\(\w+) ?/g, '$1')
        .replace(/\^/, '**')
        .replace('{', '(')
        .replace('}', ')');
}

/**
 * 生成 python3 -c 脚本（符号预定义与原插件一致）。
 * eval 参数用 JSON 字符串字面量注入，避免命令内引号破坏脚本（比原插件 shell 拼接更安全）。
 * @param {string} command
 * @returns {string}
 */
function buildSympyScript(command) {
    return 'from sympy import *\n' +
        'import re\n' +
        "a, b, c, x, y, z, t = symbols('a b c x y z t')\n" +
        "k, m, n = symbols('k m n', integer=True)\n" +
        "f, g, h = symbols('f g h', cls=Function)\n" +
        'init_printing()\n' +
        'print(eval(' + JSON.stringify('latex(' + command + ')') + "), end='')";
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
        const command = buildSympyCommand(match[1]);
        const script = buildSympyScript(command);
        const pythonPath = getPythonPath();
        execFile(pythonPath, ['-c', script], { timeout: 15000 }, (err, stdout, stderr) => {
            this.applySympyResult(command, err, stdout, stderr);
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
    buildSympyCommand,
    buildSympyScript,
    SYMPY_PLACEHOLDER,
    SYMPY_ERROR
};
