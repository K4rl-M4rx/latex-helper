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

        // 转换（保留 triggerWhenComplete / priority / noPlaceholders，
        // 否则 getLiveSnippets() 为空，实时自动展开完全不工作）
        // SPECIAL_ACTION 条目（FRACTION / BREAK / SYMPY）同样导入，
        // 由 live-watcher 按动作类型处理
        const newSnippets = [];
        for (const s of oldSnippets) {
            const entry = {
                prefix: s.prefix || '',
                body: s.body || '',
                mode: s.mode || 'any',
                description: s.description || ''
            };
            if (s.triggerWhenComplete !== undefined) entry.triggerWhenComplete = s.triggerWhenComplete;
            if (s.priority !== undefined) entry.priority = s.priority;
            if (s.noPlaceholders !== undefined) entry.noPlaceholders = s.noPlaceholders;
            newSnippets.push(entry);
        }

        await config.update('snippets', newSnippets, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(
            `Imported ${newSnippets.length} snippets from latex-utilities`
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
 * 安全地去掉 JSONC 中的注释，保留字符串内部内容。
 * @param {string} text
 * @returns {string}
 */
function stripJsoncComments(text) {
    let result = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];

        // 字符串
        if (ch === '"') {
            result += ch;
            i++;
            while (i < text.length) {
                const c = text[i];
                result += c;
                if (c === '\\' && i + 1 < text.length) {
                    result += text[i + 1];
                    i += 2;
                    continue;
                }
                if (c === '"') {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        // 块注释
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i += 2;
            continue;
        }

        // 行注释
        if (ch === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            continue;
        }

        result += ch;
        i++;
    }
    return result;
}

/**
 * 从 settings.json 文本中提取 latex-utilities.liveReformat.snippets 数组。
 * 处理 JSONC（注释 + 尾部逗号）。
 * @param {string} text
 * @returns {Array|null}
 */
function extractSnippets(text) {
    // 安全去掉注释（不破坏字符串内的 // 或 /*）
    let cleaned = stripJsoncComments(text);
    // 去掉尾部逗号
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

    try {
        const data = JSON.parse(cleaned);
        return data['latex-utilities.liveReformat.snippets'] || null;
    } catch {
        return null;
    }
}

module.exports = { importSnippets, extractSnippets };
