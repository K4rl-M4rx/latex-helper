/**
 * ∴ 块补全 provider（方案 A）：
 * - 输入 `∴ `（表达式未写）→ 建议常用表达式结构模板（\frac{d}{dx}、\int、\lim、\sum 等，带 tabstop）
 * - 表达式写完（`∴ <expr> ` 尾部空格，或正在输命令词）→ 建议 14 个命令词 + 常用带参 Wolfram 函数
 * 块通常由 `lm` snippet（`∴ $1 ∴`）插入，收尾 ∴ 已存在；命令词插入后直接在收尾 ∴ 后输 `c` 触发。
 */

const vscode = require('vscode');
const { getModeAtPosition } = require('../utils/tex');

/** 无参命令词（插入 `<cmd> ∴`） */
const COMMANDS = [
    { label: 'evaluate', detail: '求值（恒等化简，支持 \\frac{d}{dx}、\\int 等）' },
    { label: 'expand', detail: '展开' },
    { label: 'factor', detail: '因式分解' },
    { label: 'simplify', detail: '化简' },
    { label: 'fullsimplify', detail: '完全化简（Wolfram FullSimplify）' },
    { label: 'together', detail: '通分合并' },
    { label: 'apart', detail: '部分分式分解' },
    { label: 'cancel', detail: '约分' },
    { label: 'trigreduce', detail: '三角降幂（Wolfram TrigReduce）' },
    { label: 'trigexpand', detail: '三角展开（Wolfram TrigExpand）' },
    { label: 'powerexpand', detail: '幂展开（Wolfram PowerExpand）' },
    { label: 'numerical', detail: '数值计算（15 位）' },
    { label: 'solve', detail: '解方程（支持 x^2=4）' },
    { label: 'collect', detail: '按变量收集，如 collect x', insertSnippet: 'collect $1' }
];

/** 带参 Wolfram 函数（fn[arg] 形式，expr 自动作为第一参数） */
const FUNCTIONS = [
    { label: 'D[x]', detail: '求导：D[expr, x]（如 ∴ (x+1)^3 D[x] ∴c）', insertSnippet: 'D[$1]' },
    { label: 'Solve[x]', detail: '解方程：Solve[expr, var]（如 ∴ x^2=4 Solve[x] ∴c）', insertSnippet: 'Solve[$1]' },
    { label: 'Limit[x->a]', detail: '极限：Limit[expr, x->a]', insertSnippet: 'Limit[$1]' },
    { label: 'Integrate[{x,a,b}]', detail: '积分：Integrate[expr, {x,a,b}] 或 Integrate[x]', insertSnippet: 'Integrate[$1]' },
    { label: 'Collect[x]', detail: '收集：Collect[expr, var]（如 ∴ x*y+x^2 Collect[x] ∴c）', insertSnippet: 'Collect[$1]' },
    { label: 'Simplify[]', detail: '化简：Simplify[expr]', insertSnippet: 'Simplify[$1]' },
    { label: 'Together[]', detail: '通分：Together[expr]', insertSnippet: 'Together[$1]' },
    { label: 'Factor[]', detail: '因式分解：Factor[expr]', insertSnippet: 'Factor[$1]' }
];

/** 常用表达式结构模板（∴ 后、表达式未写时建议） */
const STRUCTURES = [
    { label: '\\frac{d}{dx}($0)', insertSnippet: '\\frac{d}{dx}($0)' },
    { label: '\\int $0 dx', insertSnippet: '\\int $0 dx' },
    { label: '\\int_{$1}^{$2} $0 dx', insertSnippet: '\\int_{$1}^{$2} $0 dx' },
    { label: '\\lim_{$1 \\to $2} $0', insertSnippet: '\\lim_{$1 \\to $2} $0' },
    { label: '\\sum_{$1=$2}^{$3} $0', insertSnippet: '\\sum_{$1=$2}^{$3} $0' },
    { label: '\\sqrt{$0}', insertSnippet: '\\sqrt{$0}' },
    { label: '\\frac{$1}{$2}', insertSnippet: '\\frac{$1}{$2}' },
    { label: '\\begin{vmatrix}...\\end{vmatrix}', insertSnippet: '\\begin{vmatrix}$1&$2\\\\$3&$4\\end{vmatrix}' },
    { label: '\\det\\begin{pmatrix}...\\end{pmatrix}', insertSnippet: '\\det\\begin{pmatrix}$1&$2\\\\$3&$4\\end{pmatrix}' }
];

/**
 * 判断光标前的行前缀处于 ∴ 块的哪个上下文（纯函数，便于单测）。
 * - 'structure'：刚输入 `∴ `，表达式未写 → 建议结构模板
 * - 'command'  ：表达式已写完（尾部空格或正在输命令词）→ 建议命令词/带参函数
 * - null       ：不在 ∴ 块上下文（不打扰）
 * @param {string} linePrefix 光标前的行文本
 * @returns {'structure' | 'command' | null}
 */
function classifyPrefix(linePrefix) {
    const m = /∴\s*([^∴]*)$/.exec(linePrefix);
    if (!m) return null;
    const after = m[1];
    if (/^\s*$/.test(after)) return 'structure';            // ∴ 后只有空白
    if (/\s+\w*$/.test(after) || /\s$/.test(after)) return 'command'; // 表达式后有空位
    return null;
}

/**
 * 组装补全项（命令词/带参函数；收尾 ∴ 由 lm snippet 提供，插入文本不带 ∴）。
 * @param {Array<{label: string, detail: string, insertSnippet?: string}>} defs
 * @returns {vscode.CompletionItem[]}
 */
function toItems(defs) {
    return defs.map((def) => {
        const item = new vscode.CompletionItem(def.label, vscode.CompletionItemKind.Function);
        item.detail = def.detail;
        item.insertText = new vscode.SnippetString(def.insertSnippet || def.label);
        return item;
    });
}

/**
 * 注册 ∴ 块补全 provider。
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
                if (kind === 'command') return toItems(COMMANDS.concat(FUNCTIONS));
                return [];
            }
        },
        '∴', ' ', '\\'
    );
}

module.exports = { registerSympyBlockCompletion, classifyPrefix, COMMANDS, FUNCTIONS, STRUCTURES };
