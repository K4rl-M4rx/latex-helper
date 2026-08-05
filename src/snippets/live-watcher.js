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
}

module.exports = { LiveSnippetWatcher };
