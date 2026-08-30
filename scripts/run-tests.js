#!/usr/bin/env node
/**
 * 全量单元测试：依次运行 test/*.test.js，任一失败则非 0 退出。
 * 用法：npm test  或  node scripts/run-tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');
const files = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .sort();

if (files.length === 0) {
    console.error('No test/*.test.js found');
    process.exit(1);
}

let failed = 0;
for (const file of files) {
    const rel = path.join('test', file);
    console.log('======== ' + rel + ' ========');
    const result = spawnSync(process.execPath, [path.join(testDir, file)], {
        cwd: root,
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        failed = result.status || 1;
        console.error('\nFAILED: ' + rel);
        process.exit(failed);
    }
}

console.log('\nAll ' + files.length + ' test files passed.');
process.exit(0);
