/**
 * tex2wolfram（LaTeX → Wolfram 表达式转换器）测试。
 * 运行：node test/tex2wolfram.test.js
 */
/* eslint-disable no-console */

const { tex2wolfram } = require('../src/snippets/tex2wolfram');

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
    if (actual === expected) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}\n       实际: ${JSON.stringify(actual)}\n       期望: ${JSON.stringify(expected)}`);
    }
}

console.log('== tex2wolfram：LaTeX → Wolfram 表达式 ==');

// 结构命令
check('\\frac{d}{dx}(x^3+x^2+1)',
    tex2wolfram('\\frac{d}{dx}(x^3+x^2+1)'), 'D[x^3+x^2+1, x]');
check('\\frac{d}{dx} \\left(\\sin x\\right)',
    tex2wolfram('\\frac{d}{dx}\\left(\\sin x\\right)'), 'D[Sin[x], x]');
check('\\frac{dy}{dx} 莱布尼茨记号',
    tex2wolfram('\\frac{dy}{dx}'), 'D[y, x]');
check('\\int x^2 dx 不定积分',
    tex2wolfram('\\int x^2 dx'), 'Integrate[x^2, x]');
check('\\int_{0}^{1} x^2 dx 定积分',
    tex2wolfram('\\int_{0}^{1} x^2 dx'), 'Integrate[x^2, {x, 0, 1}]');
check('\\sum_{i=1}^{n} i^2',
    tex2wolfram('\\sum_{i=1}^{n} i^2'), 'Sum[i^2, {i, 1, n}]');
check('\\prod_{i=1}^{3} i',
    tex2wolfram('\\prod_{i=1}^{3} i'), 'Product[i, {i, 1, 3}]');
check('\\lim_{x \\to 0} \\frac{\\sin x}{x}',
    tex2wolfram('\\lim_{x \\to 0} \\frac{\\sin x}{x}'), 'Limit[(Sin[x])/(x), x -> 0]');
check('嵌套：\\frac{d}{dx} \\int \\sin x dx',
    tex2wolfram('\\frac{d}{dx} \\int \\sin x dx'), 'D[Integrate[Sin[x], x], x]');

// 分数与根号
check('\\frac{1}{x}+\\frac{1}{x+1}',
    tex2wolfram('\\frac{1}{x}+\\frac{1}{x+1}'), '(1)/(x)+(1)/(x+1)');
check('\\sqrt{x^2+1}',
    tex2wolfram('\\sqrt{x^2+1}'), 'Sqrt[x^2+1]');
check('\\sqrt[3]{x}',
    tex2wolfram('\\sqrt[3]{x}'), '(x)^(1/3)');

// 函数命令
check('\\sin^2 x + \\cos^2 x',
    tex2wolfram('\\sin^2 x + \\cos^2 x'), 'Sin[x]^2 + Cos[x]^2');
check('\\sin(x+1)',
    tex2wolfram('\\sin(x+1)'), 'Sin[x+1]');
check('\\sin x \\cos y（空格乘法）',
    tex2wolfram('\\sin x \\cos y'), 'Sin[x] Cos[y]');
check('\\ln x + \\lg y',
    tex2wolfram('\\ln x + \\lg y'), 'Log[x] + Log[10, y]');
check('\\log_{2} x',
    tex2wolfram('\\log_{2} x'), 'Log[2, x]');
check('\\sqrt 内嵌函数',
    tex2wolfram('\\sqrt{\\sin x}'), 'Sqrt[Sin[x]]');

// 符号与常量
check('\\pi', tex2wolfram('\\pi'), 'Pi');
check('\\infty', tex2wolfram('\\infty'), 'Infinity');
check('\\alpha + \\beta', tex2wolfram('\\alpha + \\beta'), 'α + β');
check('\\le 与 \\ge', tex2wolfram('x \\le 1 \\ge y'), 'x <= 1 >= y');
check('\\neq', tex2wolfram('x \\neq y'), 'x != y');
check('\\cdot 与 \\times', tex2wolfram('x \\cdot y \\times z'), 'x * y * z');

// 下标与幂
check('x_1', tex2wolfram('x_1'), 'Subscript[x, 1]');
check('x_{i+1}', tex2wolfram('x_{i+1}'), 'Subscript[x, i+1]');
check('x^{2} 幂花括号', tex2wolfram('x^{2}'), 'x^(2)');

// 矩阵与行列式
check('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}',
    tex2wolfram('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}'), 'Det[{{a,b},{c,d}}]');
check('\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
    tex2wolfram('\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'), 'Det[{{a,b},{c,d}}]');
check('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix} 矩阵列表',
    tex2wolfram('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'), '{{1,2},{3,4}}');
check('\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}',
    tex2wolfram('\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}'), '{{a,b},{c,d}}');
check('\\det A 符号矩阵', tex2wolfram('\\det A'), 'Det[A]');
check('vmatrix 单元格含分数',
    tex2wolfram('\\begin{vmatrix}\\frac{1}{2}&0\\\\0&2\\end{vmatrix}'),
    'Det[{{(1)/(2),0},{0,2}}]');
check('vmatrix 带下标',
    tex2wolfram('\\begin{vmatrix}s_{1}&s_{2}\\\\s_{3}&s_{4}\\end{vmatrix}'),
    'Det[{{Subscript[s, 1],Subscript[s, 2]},{Subscript[s, 3],Subscript[s, 4]}}]');

// 隐式乘法
check('2x', tex2wolfram('2x'), '2*x');
check('xy', tex2wolfram('xy'), 'x*y');
check('(x+1)(x-1)', tex2wolfram('(x+1)(x-1)'), '(x+1)*(x-1)');
check('x(y+1)', tex2wolfram('x(y+1)'), 'x*(y+1)');
check('\\frac{1}{2}x^2', tex2wolfram('\\frac{1}{2}x^2'), '(1)/(2)*x^2');
check('e^x 保留', tex2wolfram('e^x'), 'e^x');
check('2\\pi 常量不拆散', tex2wolfram('2\\pi'), '2Pi');
// 字母紧贴下标变量 / 函数：保护关键字前须先插 *，否则 Subscript/Sin 被拆字母
check('fs_{2}^{2} 不拆 Subscript',
    tex2wolfram('fs_{2}^{2}'), 'f*Subscript[s, 2]^(2)');
check('x\\sin y 字母紧贴 Sin',
    tex2wolfram('x\\sin y'), 'x*Sin[y]');
check('用户 simplify 回归：fs_i 与隐式乘法',
    tex2wolfram('f(2-f)s_{1}^{2}s_{2}^{2} - (f-1+(2-f)s_{1}^{2})(-f+fs_{2}^{2})'),
    'f*(2-f)*Subscript[s, 1]^(2)*Subscript[s, 2]^(2) - (f-1+(2-f)*Subscript[s, 1]^(2))*(-f+f*Subscript[s, 2]^(2))');

// 等号
check('x^2=4 → ==', tex2wolfram('x^2=4'), 'x^2==4');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
