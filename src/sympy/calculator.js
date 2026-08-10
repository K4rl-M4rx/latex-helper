/**
 * 选中表达式 + 快捷键 的 SymPy 计算器（移植 orangex4.latex-sympy-calculator 的核心交互）。
 *
 * 与原插件的差异：
 * - 不用 Flask 常驻服务：每次调用 spawn 一次 python 进程
 * - 变量表存在 workspaceState（latex-helper.sympyVars），每次执行时在脚本开头重放赋值
 * - LaTeX 解析优先 latex2sympy2，缺失时回退 sympy parse_expr
 *   （仅能处理 x^2+2x 这类"近 python 语法"，\frac 等命令必须装 latex2sympy2）
 * - 所有用户输入经 JSON.stringify 注入脚本，杜绝 shell/脚本注入
 */

const vscode = require('vscode');
const { execFile } = require('child_process');
const { getPythonPath } = require('../utils/python');

/** python 进程超时（ms） */
const EXEC_TIMEOUT = 15000;
/** workspaceState 中变量表的 key */
const VARS_STATE_KEY = 'latex-helper.sympyVars';
/** 变量名必须是合法 python 标识符（重放进脚本，必须严格校验） */
const VAR_NAME_RE = /^[A-Za-z_]\w*$/;

/**
 * python 端 LaTeX → sympy 解析函数源码。
 * latex2sympy2 可用时走完整 LaTeX 语法；否则回退 parse_expr
 * （convert_xor 处理 ^，implicit_multiplication 处理 2x）。
 */
const PARSE_FN_SRC =
    'def __parse(s):\n' +
    '    try:\n' +
    '        import io, contextlib\n' +
    // antlr 4.9.3 与 latex2sympy2 生成代码（4.7.2）的版本警告用 print 发到 stdout，
    // import（ATN 反序列化）和实例化两个阶段都会刷屏，会污染求值结果，整体重定向掉
    '        with contextlib.redirect_stdout(io.StringIO()):\n' +
    '            from latex2sympy2 import latex2sympy\n' +
    '            return latex2sympy(s)\n' +
    '    except ImportError:\n' +
    '        from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,\n' +
    '            implicit_multiplication_application, convert_xor)\n' +
    '        return parse_expr(s, transformations=standard_transformations\n' +
    '            + (convert_xor, implicit_multiplication_application))\n';

/**
 * 脚本前导：符号预定义（与 SPECIAL_ACTION_SYMPY 一致）+ __parse + 变量重放。
 * @param {Map<string, string>} vars 变量名 → LaTeX 表达式
 * @returns {string}
 */
function buildPrelude(vars) {
    let src = 'from sympy import *\n' +
        "a, b, c, x, y, z, t = symbols('a b c x y z t')\n" +
        "k, m, n = symbols('k m n', integer=True)\n" +
        "f, g, h = symbols('f g h', cls=Function)\n" +
        PARSE_FN_SRC;
    for (const [name, latex] of vars) {
        src += name + ' = __parse(' + JSON.stringify(latex) + ')\n';
    }
    return src;
}

/**
 * evaluate 族脚本：expr 解析后应用一元操作，输出 LaTeX。
 * @param {string} op factor | expand | numerical | 其他（恒等）
 * @param {string} latexExpr
 * @param {Map<string, string>} vars
 * @returns {string}
 */
function buildEvalScript(op, latexExpr, vars) {
    let apply = '__expr';
    if (op === 'factor') apply = 'factor(__expr)';
    else if (op === 'expand') apply = 'expand(__expr)';
    else if (op === 'numerical') apply = 'N(__expr, 15)';
    return buildPrelude(vars) +
        '__expr = __parse(' + JSON.stringify(latexExpr) + ')\n' +
        // latex2sympy2 把 \frac{d}{dx}、\int 解析为未求值的 Derivative/Integral，
        // evaluate 语义要求算出结果；doit 对普通表达式是恒等，安全
        "__expr = __expr.doit() if hasattr(__expr, 'doit') else __expr\n" +
        'print(latex(' + apply + "), end='')";
}

/**
 * solve 脚本：选区含 = 时按方程求解，否则求零点。
 * @param {string} lhsLatex
 * @param {string | null} rhsLatex 无等号时传 null
 * @param {Map<string, string>} vars
 * @returns {string}
 */
function buildSolveScript(lhsLatex, rhsLatex, vars) {
    let src = buildPrelude(vars) +
        '__lhs = __parse(' + JSON.stringify(lhsLatex) + ')\n';
    if (rhsLatex !== null) {
        src += '__rhs = __parse(' + JSON.stringify(rhsLatex) + ')\n' +
            'print(latex(solve(Eq(__lhs, __rhs))), end=\'\')';
    } else {
        src += 'print(latex(solve(__lhs)), end=\'\')';
    }
    return src;
}

/**
 * eval-at 脚本：expr|_{var = value} → expr.subs(var, value)。
 * @param {string} exprLatex
 * @param {string} varName
 * @param {string} valueLatex
 * @param {Map<string, string>} vars
 * @returns {string}
 */
function buildEvalAtScript(exprLatex, varName, valueLatex, vars) {
    return buildPrelude(vars) +
        '__expr = __parse(' + JSON.stringify(exprLatex) + ')\n' +
        '__val = __parse(' + JSON.stringify(valueLatex) + ')\n' +
        '__res = __expr.subs(Symbol(' + JSON.stringify(varName) + '), __val)\n' +
        "__res = __res.doit() if hasattr(__res, 'doit') else __res\n" +
        'print(latex(__res), end=\'\')';
}

/**
 * 解析 eval-at 选区文本：`expr|_{var = value}`（外层括号可有可无）。
 * 取最后一个 |_{ ，允许 expr 内部出现 }（如 \frac{...}{...}）。
 * @param {string} text
 * @returns {{ expr: string, varName: string, value: string } | null}
 */
function parseEvalAt(text) {
    const m = /(.*)\|_\{\s*([A-Za-z_]\w*)\s*=\s*(.+)\}\s*$/s.exec(text);
    if (!m) return null;
    let expr = m[1].trim();
    // 去掉成对的外层括号：(x+2)|_{...} → x+2
    if (expr.startsWith('(') && expr.endsWith(')')) {
        expr = expr.slice(1, -1);
    }
    return { expr, varName: m[2], value: m[3].trim() };
}

/** @param {string} name */
function isValidVarName(name) {
    return VAR_NAME_RE.test(name);
}

class SympyCalculator {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        /** @type {Map<string, string>} 变量名 → LaTeX 表达式 */
        this.vars = new Map(Object.entries(context.workspaceState.get(VARS_STATE_KEY, {})));
    }

    /** 变量表持久化到 workspaceState（随工作区重启保留） */
    saveVars() {
        this.context.workspaceState.update(VARS_STATE_KEY, Object.fromEntries(this.vars));
    }

    /**
     * 执行 python 脚本，返回 stdout。
     * @param {string} script
     * @returns {Promise<string>}
     */
    runPython(script) {
        return new Promise((resolve, reject) => {
            execFile(getPythonPath(), ['-c', script], { timeout: EXEC_TIMEOUT }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr ? stderr.trim().split('\n').pop() : err.message));
                } else {
                    // 兜底：过滤 antlr 版本警告行（python 端已重定向，双保险）
                    const clean = stdout.split('\n')
                        .filter(l => !l.startsWith('ANTLR runtime and generated code versions disagree'))
                        .join('\n');
                    resolve(clean);
                }
            });
        });
    }

    /**
     * 取主选区文本；无选区时提示并返回 null。
     * @returns {{ editor: vscode.TextEditor, selection: vscode.Selection, text: string } | null}
     */
    getSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('LaTeX Helper: 请先选中要求值的表达式');
            return null;
        }
        return { editor, selection: editor.selection, text: editor.document.getText(editor.selection).trim() };
    }

    /**
     * evaluate 族命令：append 模式在选区后插入分隔符 + 结果；replace 模式替换选区。
     * @param {'evaluate' | 'replace' | 'factor' | 'expand' | 'numerical'} mode
     */
    async evaluateCommand(mode) {
        const sel = this.getSelection();
        if (!sel) return;
        const op = (mode === 'evaluate' || mode === 'replace') ? 'identity' : mode;
        try {
            const result = await this.runPython(buildEvalScript(op, sel.text, this.vars));
            if (!result) throw new Error('sympy returned empty output');
            await sel.editor.edit(editBuilder => {
                if (mode === 'replace') {
                    editBuilder.replace(sel.selection, result);
                } else {
                    const sep = mode === 'numerical' ? ' \\approx ' : ' = ';
                    editBuilder.insert(sel.selection.end, sep + result);
                }
            });
        } catch (err) {
            this.showError(err);
        }
    }

    /** solve 命令：选区含 = 按方程求解，否则求零点，结果追加在选区后 */
    async solveCommand() {
        const sel = this.getSelection();
        if (!sel) return;
        // 在顶层 = 处拆分（选区内首个 = 即可，方程左右两侧不含其他 = 是常规情形）
        const eqIdx = sel.text.indexOf('=');
        const lhs = eqIdx === -1 ? sel.text : sel.text.slice(0, eqIdx).trim();
        const rhs = eqIdx === -1 ? null : sel.text.slice(eqIdx + 1).trim();
        try {
            const result = await this.runPython(buildSolveScript(lhs, rhs, this.vars));
            if (!result) throw new Error('sympy returned empty output');
            await sel.editor.edit(editBuilder => {
                editBuilder.insert(sel.selection.end, ' \\Rightarrow ' + result);
            });
        } catch (err) {
            this.showError(err);
        }
    }

    /** eval-at 命令：选区形如 expr|_{x = value}，结果追加在选区后 */
    async evalAtCommand() {
        const sel = this.getSelection();
        if (!sel) return;
        const parsed = parseEvalAt(sel.text);
        if (!parsed) {
            vscode.window.showWarningMessage('LaTeX Helper: eval-at 选区应形如 expr|_{x = value}');
            return;
        }
        try {
            const result = await this.runPython(
                buildEvalAtScript(parsed.expr, parsed.varName, parsed.value, this.vars));
            if (!result) throw new Error('sympy returned empty output');
            await sel.editor.edit(editBuilder => {
                editBuilder.insert(sel.selection.end, ' = ' + result);
            });
        } catch (err) {
            this.showError(err);
        }
    }

    /** define 命令：选区形如 `name = <latex 表达式>`，存入变量表（不改动文档） */
    async defineCommand() {
        const sel = this.getSelection();
        if (!sel) return;
        const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/s.exec(sel.text);
        if (!m) {
            vscode.window.showWarningMessage('LaTeX Helper: define 选区应形如 name = 表达式');
            return;
        }
        const name = m[1];
        if (!isValidVarName(name)) {
            vscode.window.showWarningMessage('LaTeX Helper: 非法变量名 ' + name);
            return;
        }
        // 先试解析一次，表达式非法则不入库
        try {
            await this.runPython(buildPrelude(this.vars) +
                'print(latex(__parse(' + JSON.stringify(m[2].trim()) + ")), end='')");
        } catch (err) {
            this.showError(err);
            return;
        }
        this.vars.set(name, m[2].trim());
        this.saveVars();
        vscode.window.showInformationMessage('LaTeX Helper: 已定义 ' + name + ' = ' + m[2].trim());
    }

    /** show-vars 命令：列出当前变量表 */
    showVarsCommand() {
        if (this.vars.size === 0) {
            vscode.window.showInformationMessage('LaTeX Helper: 当前没有已定义的 sympy 变量');
            return;
        }
        const lines = [...this.vars.entries()].map(([k, v]) => k + ' = ' + v);
        vscode.window.showInformationMessage('SymPy 变量: ' + lines.join(';  '));
    }

    /** reset-vars 命令：清空变量表 */
    resetVarsCommand() {
        this.vars.clear();
        this.saveVars();
        vscode.window.showInformationMessage('LaTeX Helper: sympy 变量已清空');
    }

    /** @param {Error} err */
    showError(err) {
        console.error('LaTeX Helper: sympy calculator failed', err);
        vscode.window.showErrorMessage('LaTeX Helper SymPy: ' + err.message);
    }
}

/**
 * 注册全部 sympy calculator 命令。
 * @param {vscode.ExtensionContext} context
 */
function registerSympyCommands(context) {
    const calc = new SympyCalculator(context);
    const bind = (name, fn) => context.subscriptions.push(
        vscode.commands.registerCommand('latex-helper.' + name, fn));
    bind('sympyEvaluate', () => calc.evaluateCommand('evaluate'));
    bind('sympyReplace', () => calc.evaluateCommand('replace'));
    bind('sympyFactor', () => calc.evaluateCommand('factor'));
    bind('sympyExpand', () => calc.evaluateCommand('expand'));
    bind('sympyNumerical', () => calc.evaluateCommand('numerical'));
    bind('sympySolve', () => calc.solveCommand());
    bind('sympyEvalAt', () => calc.evalAtCommand());
    bind('sympyDefine', () => calc.defineCommand());
    bind('sympyShowVars', () => calc.showVarsCommand());
    bind('sympyResetVars', () => calc.resetVarsCommand());
}

module.exports = {
    SympyCalculator,
    registerSympyCommands,
    buildPrelude,
    buildEvalScript,
    buildSolveScript,
    buildEvalAtScript,
    parseEvalAt,
    isValidVarName,
    PARSE_FN_SRC,
    VARS_STATE_KEY
};
