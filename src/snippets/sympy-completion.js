/**
 * ∴ 块补全：Wolfram 伪代码形态 ∴ Fun[args] ∴c（仅 wolfram；python 后端已弃用）。
 * - `∴ ` 后 → 建议 Fun[$1] 模板与常用 LaTeX 叶子
 * - 已在写伪代码时 → 建议常用函数名
 */

const vscode = require('vscode');
const { getModeAtPosition } = require('../utils/tex');

/** 常用 Wolfram 函数模板（插入 Fun[$1]） */
const FUNCTIONS = [
    { label: 'Simplify[$1]', detail: '化简', insertSnippet: 'Simplify[$1]' },
    { label: 'FullSimplify[$1]', detail: '完全化简', insertSnippet: 'FullSimplify[$1]' },
    { label: 'Expand[$1]', detail: '展开', insertSnippet: 'Expand[$1]' },
    { label: 'Factor[$1]', detail: '因式分解', insertSnippet: 'Factor[$1]' },
    { label: 'Together[$1]', detail: '通分', insertSnippet: 'Together[$1]' },
    { label: 'Apart[$1]', detail: '部分分式', insertSnippet: 'Apart[$1]' },
    { label: 'Cancel[$1]', detail: '约分', insertSnippet: 'Cancel[$1]' },
    { label: 'Det[$1]', detail: '行列式', insertSnippet: 'Det[$1]' },
    { label: 'Collect[$1, $2]', detail: '按变量收集', insertSnippet: 'Collect[$1, $2]' },
    { label: 'Solve[$1, $2]', detail: '解方程', insertSnippet: 'Solve[$1, $2]' },
    { label: 'D[$1, $2]', detail: '求导', insertSnippet: 'D[$1, $2]' },
    { label: 'Integrate[$1, $2]', detail: '积分', insertSnippet: 'Integrate[$1, $2]' },
    { label: 'Limit[$1, $2]', detail: '极限', insertSnippet: 'Limit[$1, $2]' },
    { label: 'N[$1]', detail: '数值', insertSnippet: 'N[$1]' }
];

/** ∴ 后空白时的结构建议（伪代码外壳 + 常用叶子） */
const STRUCTURES = [
    { label: 'Simplify[$1]', insertSnippet: 'Simplify[$1]' },
    { label: 'Det[$1]', insertSnippet: 'Det[$1]' },
    { label: 'Expand[$1]', insertSnippet: 'Expand[$1]' },
    { label: 'Factor[$1]', insertSnippet: 'Factor[$1]' },
    { label: 'Simplify[Det[$1]]', insertSnippet: 'Simplify[Det[$1]]' },
    { label: 'Simplify @ Det[$1]', insertSnippet: 'Simplify @ Det[$1]' },
    { label: 'Simplify @ Expand @ $1', insertSnippet: 'Simplify @ Expand @ $1' },
    { label: 'ReplaceAll[$1, $2]', insertSnippet: 'ReplaceAll[$1, $2]' },
    { label: 'Det[{{$1,$2},{$3,$4}}]', insertSnippet: 'Det[{{$1,$2},{$3,$4}}]' },
    { label: 'Det[\\begin{pmatrix}...\\end{pmatrix}]', insertSnippet: 'Det[\\begin{pmatrix}$1&$2\\\\$3&$4\\end{pmatrix}]' },
    { label: '\\frac{$1}{$2}', insertSnippet: '\\frac{$1}{$2}' }
];

/** @deprecated 旧命令词列表已移除；保留空数组以免破坏旧测试导入 */
const COMMANDS = [];

/**
 * @param {string} linePrefix
 * @returns {'structure' | 'command' | null}
 */
function classifyPrefix(linePrefix) {
    const m = /∴\s*([^∴]*)$/.exec(linePrefix);
    if (!m) return null;
    const after = m[1];
    if (/^\s*$/.test(after)) return 'structure';
    // 已有伪代码内容：继续建议 Fun[…] 模板
    return 'command';
}

/**
 * @param {Array<{label: string, detail?: string, insertSnippet?: string}>} defs
 * @returns {vscode.CompletionItem[]}
 */
function toItems(defs) {
    return defs.map((def) => {
        const item = new vscode.CompletionItem(def.label, vscode.CompletionItemKind.Function);
        item.detail = def.detail || '';
        item.insertText = new vscode.SnippetString(def.insertSnippet || def.label);
        return item;
    });
}

/**
 * @returns {vscode.Disposable}
 */
function registerSympyBlockCompletion() {
    return vscode.languages.registerCompletionItemProvider(
        'latex',
        {
            provideCompletionItems(document, position) {
                const mode = getModeAtPosition(document, position);
                if (mode !== 'maths' && mode !== 'any') return [];

                const line = document.lineAt(position.line);
                const linePrefix = line.text.substring(0, position.character);
                const kind = classifyPrefix(linePrefix);
                if (kind === 'structure') return toItems(STRUCTURES);
                if (kind === 'command') return toItems(FUNCTIONS);
                return [];
            }
        },
        '∴', ' ', '\\', '['
    );
}

module.exports = { registerSympyBlockCompletion, classifyPrefix, COMMANDS, FUNCTIONS, STRUCTURES };
