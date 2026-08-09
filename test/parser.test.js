/**
 * parser（公式 + 定理类环境解析）的单元测试（不依赖 VSCode 运行时，用桩替代）。
 * 运行：node test/parser.test.js
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

const { parseDocument, stripComments } = require('../src/formula/parser');

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

const tex = [
    '\\documentclass{article}',
    '\\newtheorem{prop}{Proposition}',
    '\\newtheorem*{notation*}{Notation}',
    '\\begin{document}',
    '\\section{Intro}',
    '\\subsection{Setup}',
    '\\begin{theorem}[Fundamental]\\label{thm:fund}',
    'Every $x_0$ is a \\emph{bar}.',
    '\\end{theorem}',
    '\\begin{prop}\\label{prop:x}',
    'X holds.',
    '\\end{prop}',
    '\\begin{lemma}',
    'No label here.',
    '\\end{lemma}',
    'See \\ref{thm:fund} and \\eqref{eq:a}.',
    '\\begin{equation}\\label{eq:a}',
    'a=b',
    '\\end{equation}',
    '\\begin{align*}\\label{eq:star}',
    'c=d',
    '\\end{align*}',
    '\\begin{lemma}\\label{lem:inner}',
    'Inner text.',
    '\\begin{equation}\\label{eq:inner}',
    'x=y',
    '\\end{equation}',
    '\\end{lemma}',
    '\\end{document}'
].join('\n');

const parsed = parseDocument(tex);
const thmByLabel = Object.fromEntries(parsed.theorems.map(t => [t.label, t]));
const formulasByLabel = Object.fromEntries(parsed.formulas.map(f => [f.label, f]));

console.log('== 定理类环境解析 ==');

check('内置环境被收录', 'thm:fund' in thmByLabel, true);
check('\\newtheorem 自定义环境被收录', 'prop:x' in thmByLabel, true);
check('无 label 环境被跳过（lemma 仅剩 lem:inner 一条）', parsed.theorems.filter(t => t.envType === 'lemma').length, 1);
check('optional argument 提取', thmByLabel['thm:fund'].note, 'Fundamental');
check('被 \\ref 引用', thmByLabel['thm:fund'].referenced, true);
check('未被引用', thmByLabel['prop:x'].referenced, false);
check('所属 section', thmByLabel['thm:fund'].section, 'Intro');
check('所属 subsection', thmByLabel['thm:fund'].subsection, 'Setup');
check('预览去掉命令与括号', thmByLabel['thm:fund'].preview, 'Every x0 is a bar.');
check('环境类型记录', thmByLabel['prop:x'].envType, 'prop');
check('定理条目带 body（Cmd+拖拽用）', thmByLabel['prop:x'].body.includes('\\end{prop}'), true);
check('含内嵌公式时只收录定理自身 label', 'lem:inner' in thmByLabel, true);
check('内嵌公式的 label 不生成冗余定理卡片', 'eq:inner' in thmByLabel, false);
check('内嵌公式仍正常收录为公式卡片', 'eq:inner' in formulasByLabel, true);

console.log('== 公式环境解析（回归 + starred 修复）==');

check('equation 收录', 'eq:a' in formulasByLabel, true);
check('equation 被 \\eqref 引用', formulasByLabel['eq:a'].referenced, true);
check('starred 环境 align* 收录（* 转义修复）', 'eq:star' in formulasByLabel, true);
check('align* 环境类型', formulasByLabel['eq:star'] ? formulasByLabel['eq:star'].envType : null, 'align*');

console.log('== 注释剥离（% 注释的内容不参与解析与编译）==');

const texCommented = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\section{Real}',
    '% \\section{Ghost}',
    '\\begin{equation}\\label{eq:real}',
    'a=b',
    '\\end{equation}',
    '% \\begin{lemma}\\label{lem:commented}',
    '% Commented out.',
    '% \\end{lemma}',
    '\\begin{lemma}\\label{lem:active}',
    'Active. % trailing comment with \\ref{eq:real}',
    '\\end{lemma}',
    '% See \\ref{eq:real} here',
    'Escaped percent 50\\% off.',
    '\\end{document}'
].join('\n');

const parsedC = parseDocument(texCommented);
const thmC = Object.fromEntries(parsedC.theorems.map(t => [t.label, t]));
const fmC = Object.fromEntries(parsedC.formulas.map(f => [f.label, f]));

check('注释掉的引理不被收录', 'lem:commented' in thmC, false);
check('未注释的引理正常收录', 'lem:active' in thmC, true);
check('注释里的 \\ref 不算引用', fmC['eq:real'].referenced, false);
check('注释掉的 \\section 不产生幽灵分组', fmC['eq:real'].section, 'Real');
check('行尾注释后内容仍解析（引理收录且 section 正确）', thmC['lem:active'].section, 'Real');
check('注释剥离后行号与原文一致', thmC['lem:active'].line, 11);
check('转义 \\% 不被当作注释', stripComments('50\\% off. % gone'), '50\\% off.       ');
check('\\\\ 后的 % 仍是注释', stripComments('x \\\\ % gone'), 'x \\\\       ');
check('剥离保持等长（行号列号不变）', stripComments('a % bc').length, 'a % bc'.length);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
