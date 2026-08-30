/**
 * ∴ 块补全 provider 测试：上下文分类 + 建议内容。
 * 运行：node test/sympy-completion.test.js
 */
/* eslint-disable no-console */

const Module = require('module');

class SnippetString {
    constructor(value) { this.value = value; }
}
class CompletionItem {
    constructor(label, kind) { this.label = label; this.kind = kind; }
}
const vscodeStub = {
    CompletionItem,
    CompletionItemKind: { Function: 2 },
    SnippetString,
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
function check(name, actual, expected) {
    const ok = arguments.length === 2 ? Boolean(actual) : actual === expected;
    if (ok) {
        passed++;
        console.log('  ✓ ' + name);
    } else {
        failed++;
        console.log('  ✗ ' + name);
        console.log('    expected:', expected);
        console.log('    actual  :', actual);
    }
}

console.log('== classifyPrefix：∴ 块上下文分类 ==');
check('∴ 刚输入 → structure', classifyPrefix('\\text{ } ∴') === 'structure');
check('∴ 后空格 → structure', classifyPrefix('∴ ') === 'structure');
check('∴ 函数名前缀 → command', classifyPrefix('∴ Sim') === 'command');
check('∴ Simplify → command', classifyPrefix('∴ Simplify') === 'command');
check('∴ Fun[…] 后 → command', classifyPrefix('∴ Factor[x^2-1]') === 'command');
check('无 ∴ → null', classifyPrefix('Factor[x]') === null);
check('∴ 在行中间空白 → structure', classifyPrefix('\\[ ∴ ') === 'structure');

console.log('== 建议内容 ==');
check('旧命令词已清空', COMMANDS.length === 0);
check('FUNCTIONS 含 Simplify', FUNCTIONS.some(f => f.label.startsWith('Simplify')));
check('FUNCTIONS 含 Det', FUNCTIONS.some(f => f.label.startsWith('Det')));
check('FUNCTIONS insertSnippet 无 ∴ 后缀', FUNCTIONS.every(f => !(f.insertSnippet || '').includes('∴')));
check('STRUCTURES 含嵌套模板', STRUCTURES.some(s => s.label.includes('Simplify[Det')));
check('STRUCTURES insertSnippet 用 Fun[$1]',
    STRUCTURES.some(s => (s.insertSnippet || '').includes('Simplify[$1]')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
