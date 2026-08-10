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

const vscodeStub = {
    Position, Range, Selection, SnippetString,
    workspace: {
        getConfiguration: () => ({ get: () => testSnippets })
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

    // 场景 4：SYMPY 模板触发——行尾输入开头词 sympy → 插入 "sympy $1" 模板
    //（tabstop 光标停在表达式处；用户输完表达式再输入收尾 sympy 才求值）
    {
        testSnippets = [{
            prefix: 'sympy ?(.+?) ?sympy ?$',
            body: 'SPECIAL_ACTION_SYMPY',
            mode: 'maths',
            description: 'sympy',
            triggerWhenComplete: true,
            priority: 3
        }];
        const editor = makeEditor(['\\( x + sympy']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 12, 0, 12), // 输入了最后一个 y
            text: 'y'
        }]));
        check('SYMPY 模板：删除开头词范围',
            editor.edits.length === 1 && editor.edits[0].kind === 'delete');
        check('SYMPY 模板：插入 "sympy $1"',
            editor.insertedSnippets.length === 1 && editor.insertedSnippets[0] === 'sympy $1');
    }

    // 场景 5：SYMPY 模板不误触发——开头词后面已有表达式（行尾不是开头词）
    {
        testSnippets = [{
            prefix: 'sympy ?(.+?) ?sympy ?$',
            body: 'SPECIAL_ACTION_SYMPY',
            mode: 'maths',
            description: 'sympy',
            triggerWhenComplete: true,
            priority: 3
        }];
        const editor = makeEditor(['\\( sympy x^2']);
        vscodeStub.window.activeTextEditor = editor;
        const watcher = new LiveSnippetWatcher();
        await watcher.watcher(changeEvent(editor.document, [{
            range: new Range(0, 12, 0, 12), // 输入表达式最后一个字符 2
            text: '2'
        }]));
        check('SYMPY 非完整块：不产生编辑', editor.edits.length === 0);
        check('SYMPY 非完整块：不插入模板', editor.insertedSnippets.length === 0);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
