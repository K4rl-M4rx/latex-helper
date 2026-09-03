/**
 * Wolfram 伪代码编译测试（∴ Fun[args] ∴c）。
 * 运行：node test/wolfram-pseudo.test.js
 */
/* eslint-disable no-console */

const {
    normalizeFnName,
    compileWolframPseudo,
    buildPseudoWolframScript,
    looksLikeLatex,
    splitTopLevelArgs
} = require('../src/snippets/wolfram-pseudo');

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

console.log('== normalizeFnName ==');
check('simplify → Simplify', normalizeFnName('simplify'), 'Simplify');
check('SIMPLIFY → Simplify', normalizeFnName('SIMPLIFY'), 'Simplify');
check('Det → Det', normalizeFnName('Det'), 'Det');
check('det → Det', normalizeFnName('det'), 'Det');
check('D 保持', normalizeFnName('D'), 'D');
check('numerical → N', normalizeFnName('numerical'), 'N');
check('replaceall → ReplaceAll', normalizeFnName('replaceall'), 'ReplaceAll');
check('ReplaceAll 保持', normalizeFnName('ReplaceAll'), 'ReplaceAll');
check('fullsimplify → FullSimplify', normalizeFnName('fullsimplify'), 'FullSimplify');
check('未知名首字母大写', normalizeFnName('foobar'), 'Foobar');
check('未知名已有驼峰保持', normalizeFnName('MyFunc'), 'MyFunc');
check('replaceall 编译', compileWolframPseudo('replaceall[x, x->1]'), 'ReplaceAll[x, x->1]');

console.log('== Prefix @ 复合 ==');
check('Simplify@x', compileWolframPseudo('Simplify@x'), 'Simplify[x]');
check('simplify @ expand @ expr', compileWolframPseudo('simplify @ expand @ (x+1)^2'),
    'Simplify[Expand[(x+1)^2]]');
check('嵌套 Det', compileWolframPseudo('Simplify@Det[{{1,2},{3,4}}]'),
    'Simplify[Det[{{1,2},{3,4}}]]');
check('变量头不改写', compileWolframPseudo('f@x'), 'f[x]');
check('参数内 @ 仍复合', compileWolframPseudo('Simplify[a@b]'), 'Simplify[a[b]]');
check('分参为 @ 时不当复合', compileWolframPseudo('Collect[a @ b @ c]', { argSeparator: '@' }),
    'Collect[a, b, c]');
check('@@ 原样透传（Apply，暂不改写）', compileWolframPseudo('f@@{a, b}'), 'f@@{a, b}');

console.log('== looksLikeLatex / splitTopLevelArgs ==');
check('frac 是 latex', looksLikeLatex('\\frac{1}{x}'));
check('列表不是 latex', !looksLikeLatex('{{a,b},{c,d}}'));
check('已是 Fun[…] 不是 latex', !looksLikeLatex('Sin[x]'));
check('顶层逗号拆分', JSON.stringify(splitTopLevelArgs('a, b, c')), JSON.stringify(['a', 'b', 'c']));
check('嵌套方括号内逗号不拆', JSON.stringify(splitTopLevelArgs('Det[{{a,b},{c,d}}], x')),
    JSON.stringify(['Det[{{a,b},{c,d}}]', 'x']));
check('@ 分界', JSON.stringify(splitTopLevelArgs('a @ b @ c', '@')), JSON.stringify(['a', 'b', 'c']));
check('@ 不拆括号内', JSON.stringify(splitTopLevelArgs('F[a@b] @ c', '@')), JSON.stringify(['F[a@b]', 'c']));

console.log('== compileWolframPseudo ==');
check('大小写不敏感', compileWolframPseudo('simplify[x^2-1]'), 'Simplify[x^2-1]');
check('嵌套', compileWolframPseudo('Simplify[Det[{{a,b},{c,d}}]]'), 'Simplify[Det[{{a,b},{c,d}}]]');
check('多参数 Collect', compileWolframPseudo('Collect[x*y+x^2, x]'), 'Collect[x*y+x^2, x]');
check('Collect 第三参裸 simplify', compileWolframPseudo('Collect[x*y+x^2, x, simplify]'),
    'Collect[x*y+x^2, x, Simplify]');
check('裸变量 x 不改写', compileWolframPseudo('Collect[eq, x, Simplify]'), 'Collect[eq, x, Simplify]');
check('@ 分界 + 别名', compileWolframPseudo('Collect[x*y+x^2 @ x @ simplify]', { argSeparator: '@' }),
    'Collect[x*y+x^2, x, Simplify]');
check('Solve 单 = → ==', compileWolframPseudo('Solve[x^2=4, x]'), 'Solve[x^2==4, x]');
check('叶子 LaTeX frac', compileWolframPseudo('Together[\\frac{1}{x}+\\frac{1}{x+1}]').startsWith('Together['));
check('vmatrix → Det', compileWolframPseudo('Det[\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}]').includes('Det['));
check('空抛错', (() => { try { compileWolframPseudo(''); return false; } catch (_) { return true; } })());
check('未闭合 [ 抛错', (() => { try { compileWolframPseudo('Factor[x'); return false; } catch (_) { return true; } })());

console.log('== buildPseudoWolframScript ==');
check('包 TeXForm', buildPseudoWolframScript('Factor[x^2-1]'), 'ToString[Factor[x^2-1], TeXForm]');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
