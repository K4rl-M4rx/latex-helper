/**
 * CompletionItemProvider：context 感知的 LaTeX snippet 补全。
 * 对齐 latex-utilities：补全项使用实际匹配文本作为 filterText/sortText，
 * 并显式给出替换 range（否则 VSCode 按 label 过滤，正则 label 永远匹配不上）。
 */

const vscode = require('vscode');
const { getCompletionSnippets } = require('./config');
const { getModeAtPosition } = require('../utils/tex');

/**
 * 注册 snippet 补全 provider。
 * @param {vscode.ExtensionContext} _context
 * @returns {vscode.Disposable}
 */
function registerSnippetProvider(_context) {
    return vscode.languages.registerCompletionItemProvider(
        'latex',
        {
            provideCompletionItems(document, position) {
                const snippets = getCompletionSnippets();
                if (snippets.length === 0) return [];

                const mode = getModeAtPosition(document, position);
                const line = document.lineAt(position.line);
                const linePrefix = line.text.substring(0, position.character);

                /** @type {vscode.CompletionItem[]} */
                const items = [];

                for (const s of snippets) {
                    // Context 过滤
                    if (s.mode !== 'any' && s.mode !== mode) continue;

                    // prefix 匹配（原插件正则自带 $ 锚，直接 exec 行前缀）
                    const match = s.prefixRegex.exec(linePrefix);
                    if (!match) continue;

                    // 捕获组展开 + $$N → $N（先替换捕获组，再折叠 $$，顺序不能反）
                    const replacement = expandBody(s, match);

                    const range = new vscode.Range(
                        new vscode.Position(line.lineNumber, match.index),
                        new vscode.Position(line.lineNumber, match.index + match[0].length)
                    );

                    const item = new vscode.CompletionItem(replacement, vscode.CompletionItemKind.Reference);
                    // 关键：filterText 是实际匹配到的文本，range 是匹配的精确范围
                    item.filterText = match[0];
                    item.sortText = match[0];
                    item.range = range;
                    item.detail = s.description || 'live snippet';
                    // 含 tabstop 的用 SnippetString 插入，否则插入纯文本（与原插件一致）
                    if (/\$(?:\d|\{\d)/.test(replacement)) {
                        item.insertText = new vscode.SnippetString(replacement);
                    }

                    items.push(item);
                }

                return items;
            }
        },
        // 触发字符
        '$', '\\', '{', '}'
    );
}

/**
 * 展开 snippet body：先用匹配文本做捕获组替换，再把 $$ 折叠为 $。
 * 例：prefix "([A-Za-z}]\\)\\]])(\\d)$"，body "$1_$2"，匹配 "x2" → "x_2"。
 * @param {import('./config').NormalizedSnippet} snippet
 * @param {RegExpExecArray} match
 * @returns {string}
 */
function expandBody(snippet, match) {
    return match[0].replace(snippet.prefixRegex, snippet.body).replace(/\$\$/g, '$');
}

/**
 * 将 snippet body 中的 $$ 折叠为 $（VSCode tabstop 语法）。
 * @param {string} body
 * @returns {string}
 */
function convertBody(body) {
    return body.replace(/\$\$/g, '$');
}

module.exports = { registerSnippetProvider, expandBody, convertBody };
