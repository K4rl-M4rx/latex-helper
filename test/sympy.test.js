/**
 * sympy calculator 纯函数的单元测试（不依赖 VSCode 运行时，用桩替代）。
 * 运行：node test/sympy.test.js
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
        workspace: { getConfiguration: () => ({ get: () => 'python3' }) },
        window: {},
        commands: {}
    }
};

const {
    buildPrelude,
    buildEvalScript,
    buildSolveScript,
    buildEvalAtScript,
    buildCollectScript,
    parseEvalAt,
    parseCollect,
    isValidVarName
} = require('../src/sympy/calculator');

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

function ok(name, cond) {
    check(name, Boolean(cond), true);
}

function eqObj(name, actual, expected) {
    check(name, JSON.stringify(actual), JSON.stringify(expected));
}

console.log('sympy calculator');

// ---- isValidVarName ----
ok('isValidVarName: a', isValidVarName('a'));
ok('isValidVarName: alpha_1', isValidVarName('alpha_1'));
ok('isValidVarName: 1x 拒绝', !isValidVarName('1x'));
ok('isValidVarName: 含空格拒绝', !isValidVarName('a b'));
ok('isValidVarName: 注入拒绝', !isValidVarName('x\nimport os'));
ok('isValidVarName: 空串拒绝', !isValidVarName(''));

// ---- parseEvalAt ----
eqObj('parseEvalAt: 基本形式',
    parseEvalAt('x+2|_{x = y+1}'),
    { expr: 'x+2', varName: 'x', value: 'y+1' });
eqObj('parseEvalAt: 外层括号剥离',
    parseEvalAt('(x+2)|_{x=3}'),
    { expr: 'x+2', varName: 'x', value: '3' });
eqObj('parseEvalAt: expr 内含花括号（取最后一个 |_{）',
    parseEvalAt('\\frac{x}{y}|_{x = 1}'),
    { expr: '\\frac{x}{y}', varName: 'x', value: '1' });
eqObj('parseEvalAt: 无 |_{ 返回 null', parseEvalAt('x+2'), null);
eqObj('parseEvalAt: 非法变量名返回 null', parseEvalAt('x+2|_{1 = 3}'), null);

// ---- buildPrelude ----
{
    const prelude = buildPrelude(new Map());
    ok('prelude: 预定义符号', prelude.includes("a, b, c, x, y, z, t = symbols('a b c x y z t')"));
    ok('prelude: 含 __parse 定义', prelude.includes('def __parse(s):'));
    ok('prelude: latex2sympy2 优先', prelude.includes('from latex2sympy2 import latex2sympy'));
    ok('prelude: 解析期吞掉 antlr stdout 警告', prelude.includes('contextlib.redirect_stdout'));
    ok('prelude: 回退 parse_expr', prelude.includes('parse_expr'));
}
{
    const prelude = buildPrelude(new Map([['u', 'x^2+1'], ['v', '\\frac{1}{2}']]));
    ok('prelude: 变量重放 u', prelude.includes('u = __parse("x^2+1")'));
    ok('prelude: 变量重放 v（JSON 转义反斜杠）', prelude.includes('v = __parse("\\\\frac{1}{2}")'));
}

// ---- buildEvalScript ----
{
    const vars = new Map();
    const identity = buildEvalScript('identity', 'x+1', vars);
    ok('eval: identity 直接 latex(__expr)', identity.includes('print(latex(__expr), end=\'\')'));
    ok('eval: 恒等也过 doit（\\frac{d}{dx} 求值）', identity.includes("__expr.doit() if hasattr(__expr, 'doit')"));
    ok('eval: factor 包裹', buildEvalScript('factor', 'x^2+2x+1', vars).includes('latex(factor(__expr))'));
    ok('eval: expand 包裹', buildEvalScript('expand', '(x+1)^2', vars).includes('latex(expand(__expr))'));
    ok('eval: numerical N(...,15)', buildEvalScript('numerical', '\\pi', vars).includes('latex(N(__expr, 15))'));
    ok('eval: 表达式 JSON 注入', buildEvalScript('identity', 'x+1', vars).includes('__expr = __parse("x+1")'));
}

// ---- buildSolveScript ----
{
    const vars = new Map();
    const eq = buildSolveScript('x+1', '0', vars);
    ok('solve: 方程走 Eq', eq.includes('solve(Eq(__lhs, __rhs))'));
    ok('solve: 右端注入', eq.includes('__rhs = __parse("0")'));
    const roots = buildSolveScript('x^2-1', null, vars);
    ok('solve: 无等号求零点', roots.includes('print(latex(solve(__lhs)), end=\'\')'));
    ok('solve: 无等号不含 __rhs', !roots.includes('__rhs'));
}

// ---- buildEvalAtScript ----
{
    const s = buildEvalAtScript('x+2', 'x', '3', new Map());
    ok('evalAt: subs 调用', s.includes("__expr.subs(Symbol(\"x\"), __val)"));
    ok('evalAt: 值注入', s.includes('__val = __parse("3")'));
}

// ---- parseCollect / buildCollectScript ----
{
    eqObj('parseCollect: 无 collect → 默认按 x', parseCollect('x*y+x^2+z'), { expr: 'x*y+x^2+z', varName: 'x' });
    eqObj('parseCollect: 指定变量', parseCollect('x*y+x^2+z collect y'), { expr: 'x*y+x^2+z', varName: 'y' });
    eqObj('parseCollect: 含空格 trim', parseCollect('  x+1  collect  z  '), { expr: 'x+1', varName: 'z' });
    eqObj('parseCollect: expr 含 collect 词取最后一个', parseCollect('collect+1 collect y'), { expr: 'collect+1', varName: 'y' });
}
{
    const s = buildCollectScript('x*y+x^2', 'y', new Map());
    ok('collect: 调 collect 函数', s.includes('collect(__expr, Symbol('));
    ok('collect: 变量注入', s.includes('Symbol("y")'));
    ok('collect: 表达式注入', s.includes('__expr = __parse("x*y+x^2")'));
    ok('collect: 输出 latex', s.includes("print(latex(collect(__expr, Symbol("));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
