/**
 * cache 目录管理的单元测试（纯 fs，不依赖 VSCode 运行时）。
 * 运行：node test/cache.test.js
 */
/* eslint-disable no-console */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getProjectCacheDir } = require('../src/formula/cache');

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

console.log('== getProjectCacheDir ==');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-helper-cache-test-'));
try {
    const dir = getProjectCacheDir(root);
    check('返回 temp/latex-helper-cache 路径', dir === path.join(root, 'temp', 'latex-helper-cache'));
    check('目录已创建', fs.existsSync(dir));
    check('父目录 temp 自动创建', fs.existsSync(path.join(root, 'temp')));

    const gitignore = path.join(dir, '.gitignore');
    check('自忽略 .gitignore 已写入', fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf-8') === '*\n');

    // 幂等：重复调用不覆盖已有 .gitignore
    fs.writeFileSync(gitignore, '# custom\n', 'utf-8');
    getProjectCacheDir(root);
    check('重复调用保留已有 .gitignore', fs.readFileSync(gitignore, 'utf-8') === '# custom\n');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
