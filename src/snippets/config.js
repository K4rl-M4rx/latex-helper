/**
 * Snippet 配置管理：读取扩展自有 snippet 配置。
 */

const vscode = require('vscode');

/**
 * 获取当前已配置的 snippets。
 * @returns {Array<{prefix: string, body: string, mode: string, description: string}>}
 */
function getSnippets() {
    const config = vscode.workspace.getConfiguration('latex-helper');
    return config.get('snippets', []);
}

module.exports = { getSnippets };
