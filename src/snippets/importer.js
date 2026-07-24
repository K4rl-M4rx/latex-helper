/**
 * Snippet 导入器：从旧 settings.json 一次性导入 snippets。
 */

const vscode = require('vscode');
const fs = require('fs');

/**
 * 尝试从旧配置导入 snippets。
 * 仅当 latex-helper.snippets 为空时执行。
 * @param {vscode.ExtensionContext} context
 * @returns {Promise<void>}
 */
async function importSnippets(_context) {
    const config = vscode.workspace.getConfiguration('latex-helper');
    const currentSnippets = config.get('snippets', []);

    if (currentSnippets.length > 0) {
        vscode.window.showInformationMessage(
            `latex-helper snippets already has ${currentSnippets.length} entries. Import skipped.`
        );
        return;
    }

    try {
        // 读取全局 settings.json
        const settingsPath = getSettingsPath();
        if (!fs.existsSync(settingsPath)) {
            vscode.window.showInformationMessage('No VSCode settings.json found. Import skipped.');
            return;
        }

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const oldSnippets = extractSnippets(raw);

        if (!oldSnippets || oldSnippets.length === 0) {
            vscode.window.showInformationMessage(
                'No latex-utilities.liveReformat.snippets found in settings.json. Import skipped.'
            );
            return;
        }

        // 过滤 + 转换
        let skipped = 0;
        const newSnippets = [];
        for (const s of oldSnippets) {
            if (s.body && s.body.includes('SPECIAL_ACTION')) {
                skipped++;
                continue;
            }
            newSnippets.push({
                prefix: s.prefix || '',
                body: s.body || '',
                mode: s.mode || 'maths',
                description: s.description || ''
            });
        }

        await config.update('snippets', newSnippets, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(
            `Imported ${newSnippets.length} snippets from latex-utilities` +
            (skipped > 0 ? ` (${skipped} SPECIAL_ACTION entries skipped — TODO)` : '')
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to import snippets: ${err.message}`);
    }
}

/**
 * 获取 VSCode user settings.json 的路径。
 * @returns {string}
 */
function getSettingsPath() {
    const os = require('os');
    const path = require('path');
    const home = os.homedir();

    // macOS
    const codeUser = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    if (fs.existsSync(codeUser)) return codeUser;

    // VSCode Insiders
    const codeInsiders = path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json');
    if (fs.existsSync(codeInsiders)) return codeInsiders;

    return codeUser; // 返回默认路径（即使不存在）
}

/**
 * 从 settings.json 文本中提取 latex-utilities.liveReformat.snippets 数组。
 * 处理 JSONC（注释 + 尾部逗号）。
 * @param {string} text
 * @returns {Array|null}
 */
function extractSnippets(text) {
    // 去掉 // 注释
    let cleaned = text.replace(/\/\/[^\n]*/g, '');
    // 去掉尾部逗号
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    // 去掉块注释
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

    try {
        const data = JSON.parse(cleaned);
        return data['latex-utilities.liveReformat.snippets'] || null;
    } catch {
        // JSON 解析失败时，尝试直接正则提取
        // 这种情况比较极端，先返回 null
        return null;
    }
}

module.exports = { importSnippets, extractSnippets };
