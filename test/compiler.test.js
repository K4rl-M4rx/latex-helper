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

const { ensureSvgSize, namespaceSvgIds, svgHash } = require('../src/formula/compiler');

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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
