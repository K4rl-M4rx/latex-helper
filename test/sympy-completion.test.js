/**
 * ∴ 块补全 provider 测试：上下文分类 + 建议内容。
 * 运行：node test/sympy-completion.test.js
 */
/* eslint-disable no-console */

const Module = require('module');

// ---- 假 vscode ----
class CompletionItem {
    constructor(label, kind) { this.label = label; this.kind = kind; }
}
class SnippetString {
    constructor(value) { this.value = value; }
}
const vscodeStub = {
    CompletionItem, SnippetString,
    CompletionItemKind: { Function: 1 },
    languages: { registerCompletionItemProvider: () => ({ dispose() {} }) }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return 'vscode-stub';
    return origResolve.call(this, request, ...args);
};
Module._cache['vscode-stub'] = { exports: vscodeStub };

const { classifyPrefix, COMMANDS, FUNCTIONS, STRUCTURES } = require('../src/snippets/sympy-completion');

let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}`); }
}

console.log('== classifyPrefix：∴ 块上下文分类 ==');
check('∴ 刚输入 → structure', classifyPrefix('\\text{ } ∴') === 'structure');
check('∴ 后空格 → structure', classifyPrefix('∴ ') === 'structure');
check('∴ 表达式 → null', classifyPrefix('∴ x^2-1') === null);
check('∴ 表达式+尾空格 → command', classifyPrefix('∴ x^2-1 ') === 'command');
check('∴ 表达式+命令词前缀 → command', classifyPrefix('∴ x^2-1 f') === 'command');
check('∴ 完整命令词 → command', classifyPrefix('∴ x^2-1 factor ') === 'command');
check('无 ∴ → null', classifyPrefix('x^2-1 factor') === null);
check('∴ 在行中间 → command', classifyPrefix('\\[ ∴ x^2-1 ') === 'command');

console.log('== 建议内容 ==');
check('命令词 14 个', COMMANDS.length === 14);
check('命令词含 evaluate/factor/solve/collect',
    ['evaluate', 'factor', 'solve', 'collect'].every(l => COMMANDS.some(c => c.label === l)));
check('collect 带 insertSnippet（无 ∴ 后缀）', COMMANDS.find(c => c.label === 'collect').insertSnippet === 'collect $1');
check('普通命令词无 insertSnippet', COMMANDS.find(c => c.label === 'factor').insertSnippet === undefined);
check('带参函数 insertSnippet 无 ∴ 后缀', FUNCTIONS.every(f => !(f.insertSnippet || '').includes('∴')));
check('带参函数 8 个', FUNCTIONS.length === 8);
check('带参含 D/Solve/Limit/Integrate/Collect',
    ['D[x]', 'Solve[x]', 'Limit[x->a]', 'Integrate[{x,a,b}]', 'Collect[x]']
        .every(l => FUNCTIONS.some(f => f.label === l)));
check('结构模板 9 个', STRUCTURES.length === 9);
check('结构模板含导数/积分/极限/求和',
    ['\\frac{d}{dx}($0)', '\\int $0 dx', '\\lim_{$1 \\to $2} $0', '\\sum_{$1=$2}^{$3} $0']
        .every(l => STRUCTURES.some(s => s.label === l)));
check('结构模板含 vmatrix / det pmatrix',
    STRUCTURES.some(s => s.label.includes('vmatrix')) &&
    STRUCTURES.some(s => s.label.includes('det')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
