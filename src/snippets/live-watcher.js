/**
 * 实时 snippet 展开：监听文本变化，自动替换匹配的 prefix。
 * 1:1 对齐 latex-utilities completionWatcher：
 * - 遍历事件中的全部 contentChanges（不限制单字符输入，粘贴/IME 也能触发）
 * - 纯删除（change.text 为空）不触发，避免 \norm{} 删括号时误展开 rm 类 snippet
 * - 每次成功替换后累计偏移量 offset，并重新读取行文本
 * - sameChanges 去重，防止自己触发的编辑事件被重复处理
 * - noPlaceholders 直接替换文本；否则先删除匹配范围再 insertSnippet
 */

const vscode = require('vscode');
const { execFile } = require('child_process');
const { getLiveSnippets } = require('./config');
const { getModeAtPosition } = require('../utils/tex');
const { expandBody } = require('./provider');

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
                if (delta === 'break') {
                    // SPECIAL_ACTION_BREAK：熔断，当前 change 不再尝试后续 snippet
                    break;
                }
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
     * @returns {Promise<number | 'break' | undefined>} 替换长度差；'break' 表示熔断后续 snippet；未匹配返回 undefined
     */
    async execSnippet(snippet, line, change, offset) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;

        const upto = change.range.start.character + change.text.length + offset;
        const match = snippet.prefixRegex.exec(line.text.substring(0, upto));
        if (!match) return undefined;

        // SPECIAL_ACTION_BREAK：匹配即熔断，不再对当前 change 尝试后续 snippet
        if (snippet.specialAction === 'BREAK') return 'break';

        /** @type {vscode.Range} */
        let range;
        /** @type {string} */
        let replacement;
        // FRACTION 的替换文本含 $1 tabstop，强制走 insertSnippet 路径
        let forceSnippetInsert = false;

        if (snippet.specialAction === 'FRACTION') {
            [range, replacement] = getFraction(match, line);
            forceSnippetInsert = true;
        } else {
            range = new vscode.Range(
                new vscode.Position(line.lineNumber, match.index),
                new vscode.Position(line.lineNumber, match.index + match[0].length)
            );
            if (snippet.specialAction === 'SYMPY') {
                return this.execSympy(match, line, range);
            }
            replacement = expandBody(snippet, match);
        }

        this.isApplyingEdit = true;
        try {
            if (snippet.noPlaceholders && !forceSnippetInsert) {
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
     * SPECIAL_ACTION_SYMPY：把匹配文本替换为占位符，异步调用 python3 + sympy
     * 求值并输出 LaTeX，再把占位符替换为结果；出错时短暂显示 SYMPY_ERROR 后删除。
     * 转换规则与原插件一致：\command → command、^ → **、{} → ()。
     * @param {RegExpExecArray} match
     * @param {vscode.TextLine} line
     * @param {vscode.Range} range 匹配文本的范围
     * @returns {Promise<number | undefined>} 同步阶段（占位符替换）的长度差
     */
    async execSympy(match, line, range) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;

        const PLACEHOLDER = 'SYMPY_CALCULATING';
        this.isApplyingEdit = true;
        try {
            await editor.edit(editBuilder => {
                editBuilder.replace(range, PLACEHOLDER);
            }, { undoStopBefore: true, undoStopAfter: false });
        } finally {
            this.isApplyingEdit = false;
        }

        const command = match[1]
            .replace(/\\(\w+) ?/g, '$1')
            .replace(/\^/, '**')
            .replace('{', '(')
            .replace('}', ')');

        // JSON.stringify 产出的是合法 Python 字符串字面量（双引号 + 转义规则兼容），
        // 避免原插件 shell 模板拼接的引号注入问题
        const script = [
            'from sympy import *',
            "a, b, c, x, y, z, t = symbols('a b c x y z t')",
            "k, m, n = symbols('k m n', integer=True)",
            "f, g, h = symbols('f g h', cls=Function)",
            'init_printing()',
            `print(latex(eval(${JSON.stringify(command)})), end='')`
        ].join('\n');

        const placeholderRange = new vscode.Range(
            new vscode.Position(line.lineNumber, match.index),
            new vscode.Position(line.lineNumber, match.index + PLACEHOLDER.length)
        );

        execFile('python3', ['-c', script], { timeout: 10000 }, async (err, stdout, stderr) => {
            const ed = vscode.window.activeTextEditor;
            if (!ed) return;
            this.isApplyingEdit = true;
            try {
                if (err || stderr) {
                    // 失败：短暂显示 SYMPY_ERROR 后删除（与原插件一致）
                    await ed.edit(editBuilder => {
                        editBuilder.replace(placeholderRange, 'SYMPY_ERROR');
                    }, { undoStopBefore: false, undoStopAfter: false });
                    setTimeout(() => {
                        const ed2 = vscode.window.activeTextEditor;
                        if (!ed2) return;
                        this.isApplyingEdit = true;
                        ed2.edit(editBuilder => {
                            editBuilder.delete(new vscode.Range(
                                placeholderRange.start,
                                placeholderRange.start.translate(0, 'SYMPY_ERROR'.length)
                            ));
                        }, { undoStopBefore: false, undoStopAfter: true })
                            .finally(() => { this.isApplyingEdit = false; });
                    }, 400);
                    return;
                }
                await ed.edit(editBuilder => {
                    editBuilder.replace(placeholderRange, stdout);
                }, { undoStopBefore: false, undoStopAfter: true });
            } finally {
                this.isApplyingEdit = false;
            }
        });

        return PLACEHOLDER.length - match[0].length;
    }
}

/**
 * SPECIAL_ACTION_FRACTION：match[1] 为闭括号（) ] }），向前扫描配对开括号；
 * 闭括号是 } 时连同前面的 \command 一起吞掉（保留命令名进分子）。
 * 与原插件的两处刻意差异：
 * 1. 反斜杠前缀只在命令被吞掉时补回，避免 `\sin(x)/` 误产 `\x`；
 * 2. 吞掉命令时分子包含配对闭括号（如 \bar{x}/ → \frac{\bar{x}}{$1} ），
 *    原插件会丢掉最后一个 } 导致分子不闭合。
 * @param {RegExpExecArray} match
 * @param {vscode.TextLine} line
 * @returns {[vscode.Range, string]} 替换范围与替换文本（含 $1 tabstop）
 */
function getFraction(match, line) {
    const closingBracket = match[1];
    const openingBracket = { ')': '(', ']': '[', '}': '{' }[closingBracket];
    let depth = 0;
    for (let i = match.index; i >= 0; i--) {
        if (line.text[i] === closingBracket) {
            depth--;
        } else if (line.text[i] === openingBracket) {
            depth++;
        }
        if (depth === 0) {
            let prefix = '';
            // 分子内容的终点：默认到配对闭括号前（闭括号被 match[0] 覆盖）
            let contentEnd = match.index;
            if (closingBracket === '}') {
                const commandMatch = /.*(\\\w+)$/.exec(line.text.substr(0, i));
                if (commandMatch !== null) {
                    i -= commandMatch[1].length;
                    prefix = '\\';
                    // 命令被吞掉时配对闭括号属于分子内容（如 \bar{x}）
                    contentEnd = match.index + 1;
                }
            }
            const range = new vscode.Range(
                new vscode.Position(line.lineNumber, i),
                new vscode.Position(line.lineNumber, match.index + match[0].length)
            );
            const replacement = '\\frac{' + prefix + line.text.substring(i + 1, contentEnd) + '}{$1} ';
            return [range, replacement];
        }
    }
    // 找不到配对开括号：替换为空（与原插件一致）
    return [
        new vscode.Range(
            new vscode.Position(line.lineNumber, match.index + match[0].length),
            new vscode.Position(line.lineNumber, match.index + match[0].length)
        ),
        ''
    ];
}

module.exports = { LiveSnippetWatcher, getFraction };
