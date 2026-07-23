/**
 * CompletionItemProvider：context 感知的 LaTeX snippet 补全。
 */

const vscode = require('vscode');
const { getSnippets } = require('./config');
const { isInMathContext } = require('../utils/tex');

/**
 * 注册 snippet 补全 provider。
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.Disposable}
 */
function registerSnippetProvider(context) {
    return vscode.languages.registerCompletionItemProvider(
        'latex',
        {
            provideCompletionItems(document, position) {
                const snippets = getSnippets();
                if (snippets.length === 0) return [];

                const contextInfo = isInMathContext(document, position);
                const linePrefix = document.lineAt(position).text.substring(0, position.character);

                /** @type {vscode.CompletionItem[]} */
                const items = [];

                for (const s of snippets) {
                    // Context 过滤
                    if (s.mode === 'maths' && !contextInfo.inMath) continue;
                    if (s.mode === 'text' && contextInfo.inMath) continue;

                    // 简单的 prefix 匹配
                    if (!matchPrefix(s.prefix, linePrefix)) continue;

                    const item = new vscode.CompletionItem(s.prefix, vscode.CompletionItemKind.Snippet);
                    item.insertText = new vscode.SnippetString(convertBody(s.body));
                    item.detail = s.mode;
                    item.documentation = new vscode.MarkdownString(
                        s.description
                            ? `**${s.description}**\n\n\`${s.body}\``
                            : `\`${s.body}\``
                    );
                    // 低优先级，不抢 language server 的补全
                    item.sortText = 'z' + (s.prefix);

                    items.push(item);
                }

                return items;
            }
        },
        // 触发字符（latex-utilities 使用 $ 作为触发符）
        '$', '\\', '{', '}'
    );
}

/**
 * 简单 prefix 匹配：检查行末是否以 prefix 结尾。
 * 对于正则式 prefix，尝试当作正则匹配。
 * @param {string} prefix
 * @param {string} linePrefix
 * @returns {boolean}
 */
function matchPrefix(prefix, linePrefix) {
    // 如果 prefix 看起来像正则（含特殊字符组合），尝试正则匹配
    if (/[()\[\]|*+?^]/.test(prefix.replace(/^\^/, '').replace(/\$$/, ''))) {
        try {
            const re = new RegExp(prefix);
            return re.test(linePrefix);
        } catch {
            // regex 编译失败，fall through
        }
    }
    // 否则检查行末匹配
    return linePrefix.endsWith(prefix);
}

/**
 * 将 snippet body 转换为 VSCode SnippetString 格式。
 * 转换 $$1, $$2 → $1, $2（调整占位符语法）。
 * $$0 → $0（光标最终位置）。
 * @param {string} body
 * @returns {string}
 */
function convertBody(body) {
    // 将 $$N → $N（VSCode snippet 占位符）
    return body.replace(/\$\$(\d+)/g, '$$$1');
}

module.exports = { registerSnippetProvider, matchPrefix, convertBody };
