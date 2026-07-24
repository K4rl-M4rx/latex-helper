/**
 * 一次性修复脚本：把 triggerWhenComplete / priority / noPlaceholders
 * 从 latex-utilities.liveReformat.snippets 补回已导入的 latex-helper.snippets。
 * 操作前将原 settings.json 备份到工作区 .backups/。
 * 运行：node scripts/repair-snippets-flags.js
 */
/* eslint-disable no-console */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// vscode 桩，供 importer.js 使用
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return 'vscode-stub';
    return origResolve.call(this, request, ...args);
};
Module._cache['vscode-stub'] = {
    exports: {
        workspace: { getConfiguration: () => ({ get: () => [] }) },
        window: {}
    }
};

const { extractSnippets } = require('../src/snippets/importer');

const SETTINGS = path.join(os.homedir(), 'Library/Application Support/Code/User/settings.json');
const BACKUP_DIR = path.join(__dirname, '..', '.backups');

/** 在 text 中从 start（'{' 或 '['）开始配平括号，返回结束下标（闭括号位置）。字符串感知。 */
function matchBracket(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let i = start;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            i++;
            while (i < text.length) {
                if (text[i] === '\\') { i += 2; continue; }
                if (text[i] === '"') break;
                i++;
            }
            i++;
            continue;
        }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

/** 找到 "key" 对应的值的起始下标。 */
function findValueStart(text, key) {
    const ki = text.indexOf(`"${key}"`);
    if (ki === -1) return -1;
    const colon = text.indexOf(':', ki);
    let i = colon + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    return i;
}

function main() {
    const raw = fs.readFileSync(SETTINGS, 'utf-8');

    // 1. 从原 latex-utilities 配置建立 prefix+body → 标志位 映射
    const oldSnippets = extractSnippets(raw) || [];
    /** @type {Map<string, {triggerWhenComplete?, priority?, noPlaceholders?}>} */
    const flagsMap = new Map();
    for (const s of oldSnippets) {
        const flags = {};
        if (s.triggerWhenComplete !== undefined) flags.triggerWhenComplete = s.triggerWhenComplete;
        if (s.priority !== undefined) flags.priority = s.priority;
        if (s.noPlaceholders !== undefined) flags.noPlaceholders = s.noPlaceholders;
        flagsMap.set(`${s.prefix}${s.body}`, flags);
    }
    console.log(`原配置读取：${oldSnippets.length} 条，含标志位 ${flagsMap.size} 条`);

    // 2. 定位 latex-helper.snippets 数组
    const arrStart = findValueStart(raw, 'latex-helper.snippets');
    if (arrStart === -1 || raw[arrStart] !== '[') {
        console.error('未找到 latex-helper.snippets 数组');
        process.exit(1);
    }
    const arrEnd = matchBracket(raw, arrStart);

    // 3. 遍历数组内顶层对象，缺标志位的补上
    let repaired = 0;
    let alreadyOk = 0;
    let noMatch = 0;
    const edits = []; // {pos, text} 从后往前应用

    let i = arrStart + 1;
    while (i < arrEnd) {
        if (raw[i] !== '{') { i++; continue; }
        const objEnd = matchBracket(raw, i);
        const objText = raw.substring(i, objEnd + 1);

        if (objText.includes('"triggerWhenComplete"')) {
            alreadyOk++;
            i = objEnd + 1;
            continue;
        }

        let obj;
        try {
            obj = JSON.parse(objText);
        } catch {
            console.warn('对象解析失败，跳过：', objText.substring(0, 60));
            i = objEnd + 1;
            continue;
        }

        const flags = flagsMap.get(`${obj.prefix}${obj.body}`);
        if (!flags) {
            noMatch++;
            i = objEnd + 1;
            continue;
        }

        // 在对象最后一个属性后插入标志位（沿用对象内缩进风格；行间补逗号）
        const lines = objText.split('\n');
        const propIndent = lines.length > 1 ? (lines[1].match(/^\s*/) || [''])[0] : '    ';
        const entries = Object.entries(flags);
        const insertLines = entries.map(([k, v], idx) =>
            `${propIndent}"${k}": ${JSON.stringify(v)}${idx < entries.length - 1 ? ',' : ''}`
        );
        // 在最后一行（closing brace）之前插入，并给原最后属性行补逗号
        const lastPropIdx = lines.length - 2;
        lines[lastPropIdx] = lines[lastPropIdx].replace(/,?\s*$/, ',');
        lines.splice(lastPropIdx + 1, 0, ...insertLines);
        edits.push({ start: i, end: objEnd + 1, text: lines.join('\n') });

        repaired++;
        i = objEnd + 1;
    }

    console.log(`待修复 ${repaired} 条，已有标志位 ${alreadyOk} 条，原配置无对应 ${noMatch} 条`);
    if (repaired === 0) {
        console.log('无需修改。');
        return;
    }

    // 4. 备份 + 应用（从后往前，避免下标失效）
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(SETTINGS, backup);
    console.log(`已备份：${backup}`);

    let out = raw;
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) {
        out = out.substring(0, e.start) + e.text + out.substring(e.end);
    }
    fs.writeFileSync(SETTINGS, out);

    // 5. 验证：整文件 JSONC 可解析 + 标志位数量；失败则自动回滚
    const after = fs.readFileSync(SETTINGS, 'utf-8');
    try {
        let cleaned = stripJsoncComments(after).replace(/,(\s*[}\]])/g, '$1');
        const data = JSON.parse(cleaned);
        const arr = data['latex-helper.snippets'] || [];
        const twc = arr.filter(s => s.triggerWhenComplete !== undefined).length;
        console.log(`验证：${arr.length} 条，其中 ${twc} 条含 triggerWhenComplete`);
        console.log('完成。');
    } catch (err) {
        fs.copyFileSync(backup, SETTINGS);
        console.error(`验证失败（${err.message}），已从备份回滚。`);
        process.exit(1);
    }
}

/** 与 importer.js 相同的 JSONC 注释清洗。 */
function stripJsoncComments(text) {
    let result = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"') {
            result += ch;
            i++;
            while (i < text.length) {
                const c = text[i];
                result += c;
                if (c === '\\' && i + 1 < text.length) { result += text[i + 1]; i += 2; continue; }
                if (c === '"') { i++; break; }
                i++;
            }
            continue;
        }
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        result += ch;
        i++;
    }
    return result;
}

main();
