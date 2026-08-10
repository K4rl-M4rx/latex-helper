/**
 * LiveSnippetWatcher 触发逻辑测试：
 * - 纯删除（如 \norm{} 删括号剩 \norm）不得触发展开
 * - 正常输入（含反斜杠场景，如 \norm 输完）仍应触发
 * 运行：node test/live-watcher.test.js
 */
/* eslint-disable no-console */

const Module = require('module');

// ---- 假 vscode ----
class Position {
    constructor(line, character) { this.line = line; this.character = character; }
    isBefore(other) {
        return this.line < other.line ||
            (this.line === other.line && this.character < other.character);
    }
    translate(lineDelta, charDelta) {
        return new Position(this.line + (lineDelta || 0), this.character + (charDelta || 0));
    }
}
class Range {
    constructor(a, b, c, d) {
        this.start = a instanceof Position ? a : new Position(a, b);
        this.end = c !== undefined ? new Position(c, d) : (b instanceof Position ? b : this.start);
    }
    get isSingleLine() { return this.start.line === this.end.line; }
    isEqual(other) {
        return this.start.line === other.start.line && this.start.character === other.start.character &&
            this.end.line === other.end.line && this.end.character === other.end.character;
    }
}
class Selection extends Range {
    constructor(anchor, active) { super(anchor, active); this.anchor = anchor; this.active = active || anchor; }
}
class SnippetString {
    constructor(value) { this.value = value; }
}

const RM_SNIPPET = {
    prefix: '(\\\\?[A-Za-z]*)rm$',
    body: '\\mathrm{$1}$$0',
    mode: 'maths',
    description: 'mathrm',
    triggerWhenComplete: true
};

/** 各场景可替换的 snippet 配置（live-watcher 每次从配置读取） */
let testSnippets = [RM_SNIPPET];

/** 可切换的 casBackend（测试 fn[arg] 带参走 wolfram 分支） */
let testCasBackend = 'sympy';

const vscodeStub = {
    Position, Range, Selection, SnippetString,
    workspace: {
        getConfiguration: () => ({
            get: (key, defaultValue) => {
                // snippets 返回可替换的测试配置，其余按默认值（测试不真正求值）
                if (key === 'snippets') return testSnippets;
                if (key === 'casBackend') return testCasBackend;
                return defaultValue;
            }
        })
    },
    window: { activeTextEditor: null },
    languages: {}
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return 'vscode-stub';
    return origResolve.call(this, request, ...args);
};
Module._cache['vscode-stub'] = { exports: vscodeStub };

/** 场景 4-8 共用的 SYMPY prefix：仅 ∴c 命令触发（含 fn[arg] 带参分支，无 ∴d 分支） */
const SYMPY_C_PREFIX =
    '∴ ?(.+?) ?(?:(collect \\w+|expand|factor|simplify|fullsimplify|together|apart|cancel|trigreduce|trigexpand|powerexpand|numerical|solve|evaluate)|([A-Za-z]+)\\[([^\\]]*)\\]) ?∴ ?c$';
const SYMPY_SNIPPET = {
    prefix: SYMPY_C_PREFIX,
    body: 'SPECIAL_ACTION_SYMPY',
    mode: 'maths',
    description: 'sympy block',
    triggerWhenComplete: true,
    priority: 3
};

// ---- stub execFile：SYMPY 求值不真跑 python/wolfram ----
// live-watcher 在 require 时解构 child_process.execFile，先 patch 再加载模块
const childProcess = require('child_process');
let execFileCalls = [];
childProcess.execFile = (execPath, args, _opts, _cb) => {
    execFileCalls.push({ path: execPath, args });
};

const { LiveSnippetWatcher } = require('../src/snippets/live-watcher');

// ---- 假 editor/document ----
function makeEditor(lines) {
    const doc = {
        languageId: 'latex',
        lines,
        lineAt(i) {
            if (typeof i === 'object') i = i.line;
            return { text: lines[i], lineNumber: i };
        },
        get lineCount() { return lines.length; }
    };
    const editor = {
        document: doc,
        selection: new Selection(new Position(0, 0)),
        edits: [],
        insertedSnippets: [],
        async edit(fn) {
            const builder = {
                replace: (range, text) => {
                    editor.edits.push({ kind: 'replace', range, text });
                    const line = lines[range.start.line];
                    lines[range.start.line] = line.substring(0, range.start.character) +
                        text + line.substring(range.end.character);
                },
                delete: (range) => {
                    editor.edits.push({ kind: 'delete', range });
                    const line = lines[range.start.line];
                    lines[range.start.line] = line.substring(0, range.start.character) +
                        line.substring(range.end.character);
                }
            };
            fn(builder);
            return true;
        },
        async insertSnippet(snippet) {
            editor.insertedSnippets.push(snippet.value);
            return true;
        }
    };
    return editor;
}

function changeEvent(doc, changes) {
    return { document: doc, contentChanges: changes };
}

let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}`); }
}

async function main() {
    // 场景 1：\( \norm{ 删掉 { → 剩 \( \norm，纯删除，不得触发
    {
        const editor = makeEditor(['\\( \\norm']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 7, 0, 8), // 删除了 {
            text: ''
        }]));
        check('纯删除：不产生任何编辑', editor.edits.length === 0);
        check('纯删除：不插入 snippet', editor.insertedSnippets.length === 0);
        check('纯删除：行文本不变', editor.document.lines[0] === '\\( \\norm');
    }

    // 场景 2：正常输入 m（\( \nor + m → \( \norm），应触发展开
    {
        const editor = makeEditor(['\\( \\norm']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 7, 0, 7), // 在末尾输入了 m
            text: 'm'
        }]));
        check('正常输入：删除了匹配范围', editor.edits.length === 1 && editor.edits[0].kind === 'delete');
        check('正常输入：插入 \\mathrm{\\no} snippet',
            editor.insertedSnippets.length === 1 && editor.insertedSnippets[0] === '\\mathrm{\\no}$0');
    }

    // 场景 3：替换选择（text 非空 + range 非空，如 IME 上屏覆盖）仍应触发
    {
        const editor = makeEditor(['\\( \\norm']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 7, 0, 8), // 覆盖输入最后一个字符（m 替换原字符）
            text: 'm'
        }]));
        check('覆盖输入：仍触发', editor.insertedSnippets.length === 1);
    }

    // 场景 4：SYMPY 块定界但不触发——行尾纯 ∴（无命令词、无 c）不计算
    {
        testSnippets = [SYMPY_SNIPPET];
        const editor = makeEditor(['\\( ∴ Collect[x*y+x^2, x] ∴']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 26, 0, 26), // 输入了收尾 ∴
            text: '∴'
        }]));
        check('∴ 定界（无 c）：不产生编辑', editor.edits.length === 0);
        check('∴ 定界（无 c）：不调用求值', execFileCalls.length === 0);
    }

    // 场景 5：SYMPY 块 ∴d 后缀不触发——d 触发已删除，仅 ∴c 命令触发
    {
        execFileCalls = [];
        testSnippets = [SYMPY_SNIPPET];
        const editor = makeEditor(['\\( ∴ x^2-1 ∴d']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 14, 0, 14), // 输入了触发字符 d
            text: 'd'
        }]));
        check('∴d（已删除）：不产生编辑', editor.edits.length === 0);
        check('∴d（已删除）：不调用求值', execFileCalls.length === 0);
    }

    // 场景 6：SYMPY 块收尾纯 ∴ 不触发——命令模式要求 ∴c 结尾
    {
        execFileCalls = [];
        testSnippets = [SYMPY_SNIPPET];
        const editor = makeEditor(['\\( ∴ x^2-1 expand ∴']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 18, 0, 18), // 输入了收尾 ∴（expand 在 ∴ 前）
            text: '∴'
        }]));
        check('纯 ∴ 收尾（需 ∴c）：不产生编辑', editor.edits.length === 0);
        check('纯 ∴ 收尾（需 ∴c）：不调用求值', execFileCalls.length === 0);
    }

    // 场景 7：SYMPY 块 ∴c 命令触发——行尾输入 c（`∴ x^2-1 expand ∴c`）求值
    {
        execFileCalls = [];
        testSnippets = [SYMPY_SNIPPET];
        const editor = makeEditor(['\\( ∴ x^2-1 expand ∴c']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 19, 0, 19), // 输入了触发字符 c
            text: 'c'
        }]));
        check('∴c 触发：整块替换为占位符',
            editor.edits.length === 1 && editor.edits[0].kind === 'replace' &&
            editor.edits[0].text === 'SYMPY_CALCULATING');
        check('∴c 触发：调用了求值进程', execFileCalls.length === 1 && execFileCalls[0].args[0] === '-c');
    }

    // 场景 8：fn[arg] 带参触发——`∴ expr Collect[x] ∴c` 走 wolfram 分支（expr 作为第一参数）
    {
        execFileCalls = [];
        testCasBackend = 'wolfram';
        testSnippets = [SYMPY_SNIPPET];
        const editor = makeEditor(['\\( ∴ x*y+x^2 Collect[x] ∴c']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 26, 0, 26), // 输入了触发字符 c
            text: 'c'
        }]));
        check('fn[arg] 触发：整块替换为占位符',
            editor.edits.length === 1 && editor.edits[0].kind === 'replace' &&
            editor.edits[0].text === 'SYMPY_CALCULATING');
        check('fn[arg] 触发：wolfram 分支 -code 参数为 Collect[expr, x]',
            execFileCalls.length === 1 && execFileCalls[0].path === 'wolframscript' &&
            execFileCalls[0].args[0] === '-code' &&
            execFileCalls[0].args[1].includes('Collect[x*y+x^2, x]'));
        testCasBackend = 'sympy';
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
