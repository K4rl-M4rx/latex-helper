/**
 * snippet 复刻逻辑的单元测试（不依赖 VSCode 运行时，用桩替代）。
 * 运行：node test/snippets.test.js
 */
/* eslint-disable no-console */

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return 'vscode-stub';
    return origResolve.call(this, request, ...args);
};
Module._cache['vscode-stub'] = {
    exports: {
        workspace: { getConfiguration: () => ({ get: () => [] }) },
        window: {},
        languages: {}
    }
};

const { getModeAtPosition } = require('../src/utils/tex');
const { expandBody } = require('../src/snippets/provider');
const { normalizeSnippets } = require('../src/snippets/config');
const { computeFraction, buildSympyCommand, buildSympyScript } = require('../src/snippets/live-watcher');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
    if (actual === expected) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// ---- 假 document / position ----
function doc(lines) {
    return {
        lineAt(i) {
            if (typeof i === 'object') i = i.line;
            return { text: lines[i] };
        },
        get lineCount() { return lines.length; }
    };
}
function pos(line, character) {
    return { line, character };
}

console.log('== getModeAtPosition（对齐原插件语义）==');

// 1. \( 内 → maths
check('\\( 内', getModeAtPosition(doc(['some text \\( x^2 ']), pos(0, 16)), 'maths');
// 2. \) 之后 → text
check('\\) 后', getModeAtPosition(doc(['some \\( x \\) more ']), pos(0, 20)), 'text');
// 3. equation 环境内 → maths
check('equation 内', getModeAtPosition(
    doc(['text', '\\begin{equation}', '  E = mc^2 ', '\\end{equation}', 'after']),
    pos(2, 11)), 'maths');
// 4. \end{equation} 之后 → text
check('equation 后', getModeAtPosition(
    doc(['\\begin{equation}', 'x', '\\end{equation}', 'after text ']),
    pos(3, 10)), 'text');
// 5. starred 环境 align* 内 → maths
check('align* 内', getModeAtPosition(
    doc(['\\begin{align*}', 'a &= b ']),
    pos(1, 7)), 'maths');
// 6. \text{...} 内部 → text
check('\\text{} 内', getModeAtPosition(
    doc(['\\[ a + \\text{some words } + b \\]']),
    pos(0, 20)), 'text');
// 7. \text{} 闭合后回到 maths
check('\\text{} 后', getModeAtPosition(
    doc(['\\[ a + \\text{some} + b \\]']),
    pos(0, 22)), 'maths');
// 8. $...$ 不被识别为数学模式（原插件语义）
check('$...$ 算 text（原插件语义）', getModeAtPosition(
    doc(['inline $x^2$ math ']),
    pos(0, 10)), 'text');
// 9. 注释里 → text
check('注释里', getModeAtPosition(
    doc(['\\[ x \\] % \\[ comment ']),
    pos(0, 20)), 'text');
// 10. \section 之后 → text
check('\\section 后', getModeAtPosition(
    doc(['\\section{Intro}', 'body text ']),
    pos(1, 10)), 'text');
// 11. 跨行：环境起点在上方几行
check('跨行环境', getModeAtPosition(
    doc(['p1', '\\begin{align}', 'l1', 'l2', 'cursor here ']),
    pos(4, 12)), 'maths');
// 12. 未闭合 \( → maths
check('未闭合 \\(', getModeAtPosition(
    doc(['text \\( unfinished ']),
    pos(0, 18)), 'maths');

console.log('== expandBody（捕获组 + $$ → $ 折叠）==');

function mkSnippet(prefix, body) {
    return { prefix, prefixRegex: new RegExp(prefix), body };
}

// auto subscript: "x2" → "x_2"
{
    const s = mkSnippet('([A-Za-z}\\)\\]])(\\d)$', '$1_$2');
    const match = s.prefixRegex.exec('x2');
    check('auto subscript', expandBody(s, match), 'x_2');
}
// auto escape subscript: "x_12" → "x_{12}"
{
    const s = mkSnippet('([A-Za-z}\\)\\]]) ?_(\\d\\d)$', '$1_{$2}');
    const match = s.prefixRegex.exec('x_12');
    check('escape subscript', expandBody(s, match), 'x_{12}');
}
// placeholder body: "ff" → "\frac{$1}{$2}$0"
{
    const s = mkSnippet('ff$', '\\frac{$$1}{$$2}$$0');
    const match = s.prefixRegex.exec('ff');
    check('placeholders', expandBody(s, match), '\\frac{$1}{$2}$0');
}
// 简单无捕获替换: "L1" → "L^1"
{
    const s = mkSnippet('L1$', 'L^1');
    const match = s.prefixRegex.exec('L1');
    check('plain replace', expandBody(s, match), 'L^1');
}

console.log('== normalizeSnippets（默认值规则对齐原插件）==');
{
    const out = normalizeSnippets([
        { prefix: 'a$', body: 'A' },                                  // 无占位符 → noPlaceholders, priority -0.1
        { prefix: 'b$', body: 'B$$1' },                               // 有占位符 → priority 0
        { prefix: 'c$', body: 'C', priority: 5 },                     // 显式 priority 保留
        { prefix: 'd$', body: 'D', noPlaceholders: false },           // 显式 noPlaceholders 保留
        { prefix: 'e$', body: 'E', mode: 'maths', triggerWhenComplete: true },
        { prefix: 'f$', body: 'SPECIAL_ACTION_BREAK', triggerWhenComplete: true },
        { prefix: 'g$', body: 'SPECIAL_ACTION_FRACTION', triggerWhenComplete: true },
        { prefix: 'h$', body: 'SPECIAL_ACTION_SYMPY', triggerWhenComplete: true },
        { prefix: 'i$', body: 'SPECIAL_ACTION_UNKNOWN' }              // 未知动作仍被过滤
    ]);
    const by = Object.fromEntries(out.map(s => [s.prefix, s]));
    check('无占位符 → noPlaceholders', by['a$'].noPlaceholders, true);
    check('无占位符 → priority -0.1', by['a$'].priority, -0.1);
    check('有占位符 → priority 0', by['b$'].priority, 0);
    check('有占位符 → noPlaceholders false', by['b$'].noPlaceholders, false);
    check('显式 priority 保留', by['c$'].priority, 5);
    check('显式 noPlaceholders 保留', by['d$'].noPlaceholders, false);
    check('mode 缺省 → any', by['a$'].mode, 'any');
    check('triggerWhenComplete 保留', by['e$'].triggerWhenComplete, true);
    check('SPECIAL_ACTION_BREAK 保留并标记', by['f$'] ? by['f$'].specialAction : null, 'break');
    check('SPECIAL_ACTION_FRACTION 保留并标记', by['g$'] ? by['g$'].specialAction : null, 'fraction');
    check('SPECIAL_ACTION_SYMPY 保留并标记', by['h$'] ? by['h$'].specialAction : null, 'sympy');
    check('未知 SPECIAL_ACTION 被过滤', out.some(s => s.prefix === 'i$'), false);
    check('普通条目 specialAction 为 undefined', by['a$'].specialAction, undefined);
    // 排序：priority 5 在最前
    check('按 priority 排序（首位）', out[0].prefix, 'c$');
}

console.log('== buildSympyCommand / buildSympyScript（SPECIAL_ACTION_SYMPY）==');
{
    check('多项式 ^ → **', buildSympyCommand('x^2+2*x+1'), 'x**2+2*x+1');
    check('\\sqrt{x} → sqrt(x)', buildSympyCommand('\\sqrt{x}'), 'sqrt(x)');
    check('\\command 吃掉一个空格', buildSympyCommand('\\int x'), 'intx');
    check('仅首个 ^ 被替换（与原插件一致）', buildSympyCommand('x^2^3'), 'x**2^3');
    check('仅首对 {} 被替换（与原插件一致）', buildSympyCommand('{a}{b}'), '(a){b}');
    const script = buildSympyScript('x**2+2*x+1');
    check('脚本含 latex() 求值', script.includes('eval("latex(x**2+2*x+1)")'), true);
    check('脚本预定义符号', script.includes("symbols('a b c x y z t')"), true);
    check('命令内引号被 JSON 转义', buildSympyScript('a"b').includes('\\"'), true);
}

console.log('== computeFraction（SPECIAL_ACTION_FRACTION，对齐原插件 getFraction）==');
{
    const FRAC_PREFIX = '([)\\]}])/$';
    const fracMatch = (text) => new RegExp(FRAC_PREFIX).exec(text);

    // 基本：(x+1)/ → \frac{x+1}{$1} ，范围覆盖整段 (x+1)/
    let m = fracMatch('(x+1)/');
    let r = computeFraction('(x+1)/', m);
    check('(x+1)/ 替换文本', r.replacement, '\\frac{x+1}{$1} ');
    check('(x+1)/ 范围起点（开括号）', r.start, 0);
    check('(x+1)/ 范围终点（含 /）', r.end, 6);

    // 嵌套同种括号：(a(b+c))/
    m = fracMatch('(a(b+c))/');
    r = computeFraction('(a(b+c))/', m);
    check('嵌套括号配对到最外层', r.replacement, '\\frac{a(b+c)}{$1} ');

    // 方括号：[a+b]/
    m = fracMatch('[a+b]/');
    r = computeFraction('[a+b]/', m);
    check('方括号 [a+b]/', r.replacement, '\\frac{a+b}{$1} ');

    // 花括号吞掉前面的 \command：\hat{x}/ → \frac{\hat{x}{$1} 
    //（末尾 } 正好闭合 \hat 组，与原插件 trick 一致）
    m = fracMatch('\\hat{x}/');
    r = computeFraction('\\hat{x}/', m);
    check('\\hat{x}/ 吞掉 \\command', r.replacement, '\\frac{\\hat{x}{$1} ');
    check('\\hat{x}/ 范围起点（\\ 处）', r.start, 0);

    // 花括号无 command：{x}/
    m = fracMatch('{x}/');
    r = computeFraction('{x}/', m);
    check('{x}/ 无 command', r.replacement, '\\frac{x}{$1} ');

    // 找不到配对开括号：no-op（空范围 + 空替换）
    m = fracMatch('x+1)/');
    r = computeFraction('x+1)/', m);
    check('无配对开括号 → 空替换', r.replacement, '');
    check('无配对开括号 → 空范围（/ 之后）', r.start === r.end && r.end === 5, true);

    // 前文有内容时范围只覆盖括号段：y=(x+1)/
    m = fracMatch('y=(x+1)/');
    r = computeFraction('y=(x+1)/', m);
    check('y=(x+1)/ 只替换括号段', [r.start, r.end, r.replacement].join('|'), '2|8|\\frac{x+1}{$1} ');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
