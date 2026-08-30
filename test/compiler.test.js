/**
 * compiler 纯函数（ensureSvgSize）的单元测试（不依赖 VSCode 运行时与 latex，用桩替代）。
 * 运行：node test/compiler.test.js
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

const {
    ensureSvgSize,
    namespaceSvgIds,
    svgHash,
    ensureQtyCompatibility,
    sanitizePreambleForDviPreview,
    normalizeQtyBlankLines,
    sanitizeFormulaBody,
    preambleUsesPackage,
    buildStandaloneDoc
} = require('../src/formula/compiler');

let passed = 0;
let failed = 0;

function check(name, cond) {
    if (cond) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}`);
    }
}

console.log('== ensureSvgSize ==');

// dvisvgm 3.x 只输出 viewBox：补 pt 尺寸
const noSize = `<svg version='1.1' xmlns='http://www.w3.org/2000/svg' viewBox='.229141 -18.376583 326.798215 31.780822'><path d='M0 0'/></svg>`;
const sized = ensureSvgSize(noSize);
check('缺尺寸时补 width pt', sized.includes("width='326.798215pt'"));
check('缺尺寸时补 height pt', sized.includes("height='31.780822pt'"));
check('viewBox 保留', sized.includes("viewBox='.229141 -18.376583 326.798215 31.780822'"));

// 已有 width：原样返回
const withSize = '<svg width="10pt" height="5pt" viewBox="0 0 10 5"></svg>';
check('已有尺寸时原样返回', ensureSvgSize(withSize) === withSize);

// 无 viewBox：原样返回
const noViewBox = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
check('无 viewBox 时原样返回', ensureSvgSize(noViewBox) === noViewBox);

// viewBox 用双引号 + 多空格分隔
const dq = '<svg viewBox="0  -1   100   50"></svg>';
check('双引号 viewBox 也补尺寸', ensureSvgSize(dq).includes("width='100pt'") && ensureSvgSize(dq).includes("height='50pt'"));

// 空输入不炸
check('空字符串原样返回', ensureSvgSize('') === '');

console.log('== namespaceSvgIds ==');

// dvisvgm --no-fonts 实际结构：defs id + xlink:href 引用
const raw = `<svg viewBox='0 0 10 10'><defs><path id='g0-101' d='M0 0'/></defs><use xlink:href='#g0-101' x='1'/></svg>`;
const ns = namespaceSvgIds(raw, 'gtest-');
check('defs id 加前缀', ns.includes("id='gtest-g0-101'"));
check('xlink:href 引用同步加前缀', ns.includes("xlink:href='#gtest-g0-101'"));
check('xlink:href 不被二次加前缀', !ns.includes('gtest-gtest-'));

// 双引号与 url(#...) 形式
const dqNs = namespaceSvgIds('<svg><clipPath id="c1"/><rect clip-path="url(#c1)"/><a href="#c1"/></svg>', 'p-');
check('双引号 id 加前缀', dqNs.includes('id="p-c1"'));
check('url(#...) 引用加前缀', dqNs.includes('url(#p-c1)'));
check('SVG2 href 引用加前缀', dqNs.includes('href="#p-c1"'));

// svgHash：同内容同前缀、不同内容不同前缀、以字母开头
check('svgHash 确定性', svgHash('abc') === svgHash('abc'));
check('svgHash 区分内容', svgHash('abc') !== svgHash('abd'));
check('svgHash 以字母开头（合法 XML id）', /^[a-z]/.test(svgHash('abc')));

// 空输入不炸
check('namespace 空字符串原样返回', namespaceSvgIds('', 'p-') === '');

console.log('== ensureQtyCompatibility ==');

const physSiunitx = [
    '\\usepackage{amsmath}',
    '\\usepackage{physics}',
    '\\usepackage{siunitx}'
].join('\n');
check('合并 usepackage 识别 physics', preambleUsesPackage('\\usepackage{amsmath,physics}', 'physics'));
check('合并 usepackage 识别 siunitx', preambleUsesPackage('\\usepackage{amsmath,siunitx}', 'siunitx'));
// 改为无条件注入：\input 加载宏包时静态扫描会漏，必须靠 \\IfPackageLoadedTF
check('空 preamble 也注入运行时 fix', ensureQtyCompatibility('').includes('\\IfPackageLoadedTF{physics}'));
check('仅 siunitx 也注入（块内自检，无 physics 时为 no-op）',
    ensureQtyCompatibility('\\usepackage{siunitx}').includes('\\RenewCommandCopy\\qty\\SI'));
check('physics+siunitx 注入 IfPackageLoadedTF',
    ensureQtyCompatibility(physSiunitx).includes('\\IfPackageLoadedTF{siunitx}'));
check('已有 RenewCommandCopy 不重复注入',
    ensureQtyCompatibility(physSiunitx + '\n\\AtBeginDocument{\\RenewCommandCopy\\qty\\SI}\n')
        .split('RenewCommandCopy').length === 2);

console.log('== sanitizeFormulaBody ==');
const withBlank = '\\qty{5}\n\n{\\metre}';
check('去掉空行', sanitizeFormulaBody(withBlank) === '\\qty{5}\n{\\metre}');
check('去掉仅空白行（physics \\qty 内常见）',
    sanitizeFormulaBody('\\qty{a \\\\\n\t\t   \n b}') === '\\qty{a \\\\\n b}');
check('无空行时原样', sanitizeFormulaBody('\\qty{5}{\\metre}') === '\\qty{5}{\\metre}');
check('normalizeQtyBlankLines 同 sanitize', normalizeQtyBlankLines(withBlank) === sanitizeFormulaBody(withBlank));

console.log('== buildStandaloneDoc qty fix ==');
const doc = buildStandaloneDoc(
    '\\documentclass{article}\n\\input{pkgs.tex}\n',
    [{ label: 'eq:1', body: '\\begin{equation}\\label{eq:1}\\qty{5}\n\t  \n{\\metre}\\end{equation}' }]
);
check('standalone 含运行时 IfPackageLoadedTF（覆盖 \\input）', doc.includes('\\IfPackageLoadedTF{physics}'));
check('standalone 去掉空白行', doc.includes('\\qty{5}\n{\\metre}') && !/\\qty\{5\}\n[ \t]*\n\{/.test(doc));

console.log('== sanitizePreambleForDviPreview (ctex/macold) ==');
check('ctex UTF8 → fandol',
    sanitizePreambleForDviPreview('\\usepackage[UTF8]{ctex}') ===
    '\\usepackage[UTF8,fontset=fandol]{ctex}');
check('ctex fontset=mac → fandol',
    sanitizePreambleForDviPreview('\\usepackage[UTF8,fontset=mac]{ctex}') ===
    '\\usepackage[UTF8,fontset=fandol]{ctex}');
check('剥离 xeCJK',
    sanitizePreambleForDviPreview('\\usepackage{xeCJK}\n\\usepackage{amsmath}').includes('stripped xeCJK') &&
    !sanitizePreambleForDviPreview('\\usepackage{xeCJK}\n').includes('\\usepackage{xeCJK}'));
check('剥离 setCJKmainfont',
    !sanitizePreambleForDviPreview('\\setCJKmainfont{Songti SC}\n').includes('setCJKmainfont'));
const ctexDoc = buildStandaloneDoc(
    '\\documentclass{ctexart}\n\\usepackage[UTF8]{ctex}\n\\usepackage{amsmath}\n',
    [{ label: 'e1', body: '\\begin{equation}\\label{e1}a=b\\end{equation}' }]
);
check('standalone 含 fandol 不含裸 ctex UTF8',
    ctexDoc.includes('fontset=fandol') && !/\\usepackage\[UTF8\]\{ctex\}/.test(ctexDoc));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
