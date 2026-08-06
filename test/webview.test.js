/**
 * Webview 内嵌脚本的回归测试：提取 getBrowserHtml() 生成的 <script> 内容，
 * 用 new Function 做语法验证，并检查关键转义结果。
 * 背景：template literal 中注释里的 `\ref` 被解释为 \r（回车），
 * 曾导致整个浏览器 webview 脚本语法错误、公式显示完全失效。
 * 运行：node test/webview.test.js
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

const { getBrowserHtml } = require('../src/formula/panel');

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

console.log('== webview 内嵌脚本语法 ==');

const html = getBrowserHtml('csp');
const scripts = [...html.matchAll(/<script nonce="[^"]*">([\s\S]*?)<\/script>/g)];
check('script 标签数量', scripts.length, 1);

let syntaxError = null;
try {
    // new Function 只做解析不执行，等价于 node --check
    new Function(scripts[0][1]); // eslint-disable-line no-new-func
} catch (e) {
    syntaxError = e.message;
}
check('内嵌脚本语法合法', syntaxError, null);

console.log('== 关键转义结果 ==');

// 拖拽插入的 \ref{ 在生成 HTML 中必须是双反斜杠（webview JS 字符串字面量）
check('拖拽 \\\\ref 转义', html.includes("'\\\\ref{'"), true);
// 不得出现裸回车（\r 转义事故的特征）
check('脚本无裸回车', scripts[0][1].includes('\r'), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
