/**
 * Wolfram 伪代码编译：∴ Function[args] ∴c 块用。
 * - 函数名不区分大小写，映射到合法 Wolfram 符号
 * - 支持嵌套 Fun1[Fun2[…]] 与多参数；顶层分界符可配（默认 ,）
 * - 叶子：LaTeX → tex2wolfram；裸函数名走别名表（simplify → Simplify，不改写变量 x）
 */

const { tex2wolfram } = require('./tex2wolfram');

/**
 * 常用别名 → 规范 Wolfram 名（键一律小写）。
 * 未列出的调用名：首字母大写（fooBar → FooBar；D → D）。
 */
const FN_ALIASES = {
    simplify: 'Simplify',
    fullsimplify: 'FullSimplify',
    expand: 'Expand',
    factor: 'Factor',
    together: 'Together',
    apart: 'Apart',
    cancel: 'Cancel',
    trigreduce: 'TrigReduce',
    trigexpand: 'TrigExpand',
    powerexpand: 'PowerExpand',
    numerical: 'N',
    n: 'N',
    solve: 'Solve',
    collect: 'Collect',
    det: 'Det',
    tr: 'Tr',
    integrate: 'Integrate',
    sum: 'Sum',
    product: 'Product',
    limit: 'Limit',
    d: 'D',
    abs: 'Abs',
    sqrt: 'Sqrt',
    log: 'Log',
    ln: 'Log',
    exp: 'Exp',
    sin: 'Sin',
    cos: 'Cos',
    tan: 'Tan',
    evaluate: 'Evaluate',
    identity: 'Identity'
};

/**
 * @param {string} name
 * @returns {string}
 */
function normalizeFnName(name) {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    const mapped = FN_ALIASES[raw.toLowerCase()];
    if (mapped) return mapped;
    // 已是全大写短名（如 D、N、GCD）保持；否则首字母大写
    if (/^[A-Z0-9]+$/.test(raw) && raw.length <= 4) return raw;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * 裸符号参数：仅别名表归一（Collect[..., simplify] → Simplify），不改写变量名 x。
 * @param {string} name
 * @returns {string}
 */
function normalizeBareSymbol(name) {
    const raw = String(name || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return raw;
    return FN_ALIASES[raw.toLowerCase()] || raw;
}

/**
 * @param {unknown} sep
 * @returns {string}
 */
function normalizeArgSeparator(sep) {
    const s = String(sep == null ? ',' : sep);
    return s.length > 0 ? s : ',';
}

/**
 * 叶子是否应按 LaTeX 交给 tex2wolfram。
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeLatex(s) {
    const t = s.trim();
    if (!t) return false;
    // 已是 Wolfram 列表 / 明显函数调用 → 不转
    if (/^\{\{/.test(t) || /^[A-Za-z][A-Za-z0-9]*\s*\[/.test(t)) return false;
    return /\\|[_\^]|\\begin\b|\\frac\b|\\sqrt\b|\\det\b/.test(t) ||
        /[A-Za-z]_\{?[0-9A-Za-z]/.test(t) || // s_1 / s_{1}
        /\^\{?[0-9]/.test(t);
}

/**
 * 顶层按分界符拆参数（方括号/花括号/圆括号深度内不拆）。
 * @param {string} s
 * @param {string} [separator=',']
 * @returns {string[]}
 */
function splitTopLevelArgs(s, separator) {
    const sep = normalizeArgSeparator(separator);
    const args = [];
    let depthSq = 0;
    let depthCurly = 0;
    let depthParen = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '[') depthSq++;
        else if (ch === ']') depthSq = Math.max(0, depthSq - 1);
        else if (ch === '{') depthCurly++;
        else if (ch === '}') depthCurly = Math.max(0, depthCurly - 1);
        else if (ch === '(') depthParen++;
        else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
        else if (
            depthSq === 0 && depthCurly === 0 && depthParen === 0 &&
            s.startsWith(sep, i)
        ) {
            args.push(s.slice(start, i).trim());
            start = i + sep.length;
            i += sep.length - 1;
        }
    }
    args.push(s.slice(start).trim());
    return args.filter(a => a.length > 0);
}

/**
 * 找到与 position 处 `[` 配对的 `]`；找不到返回 -1。
 * @param {string} s
 * @param {number} openIdx
 * @returns {number}
 */
function findMatchingBracket(s, openIdx) {
    if (s[openIdx] !== '[') return -1;
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        if (s[i] === '[') depth++;
        else if (s[i] === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * @typedef {{ argSeparator?: string }} WolframPseudoOptions
 */

/**
 * 将伪代码编译为 Wolfram 表达式字符串。
 * @param {string} input
 * @param {WolframPseudoOptions} [options]
 * @returns {string}
 * @throws {Error} 括号不配平等
 */
function compileWolframPseudo(input, options) {
    const s = String(input || '').trim();
    if (!s) throw new Error('empty wolfram pseudo expression');
    const argSeparator = normalizeArgSeparator(options && options.argSeparator);

    const nameMatch = /^([A-Za-z][A-Za-z0-9]*)\s*\[/.exec(s);
    if (nameMatch) {
        const nameEnd = nameMatch[0].length - 1; // `[` 的下标
        const close = findMatchingBracket(s, nameEnd);
        if (close === -1) throw new Error('unmatched [ in ' + nameMatch[1]);
        const trailing = s.slice(close + 1).trim();
        if (trailing) {
            throw new Error('trailing junk after ' + nameMatch[1] + '[...]');
        }
        const fn = normalizeFnName(nameMatch[1]);
        const inner = s.slice(nameEnd + 1, close);
        const args = splitTopLevelArgs(inner, argSeparator)
            .map(a => compileWolframPseudo(a, options));
        // 输出始终用 Wolfram 逗号
        return fn + '[' + args.join(', ') + ']';
    }

    // 叶子
    if (looksLikeLatex(s)) return tex2wolfram(s);
    const bare = normalizeBareSymbol(s);
    if (bare !== s) return bare;
    // 裸 = → ==（Wolfram 方程）；已有 == / != / <= / >= 不碰
    return s.replace(/([^<>=!])=(?!=)/g, '$1==');
}

/**
 * 生成 wolframscript -code 参数。
 * @param {string} pseudoBody ∴ 与 ∴c 之间的伪代码
 * @param {WolframPseudoOptions} [options]
 * @returns {string}
 */
function buildPseudoWolframScript(pseudoBody, options) {
    const expr = compileWolframPseudo(pseudoBody, options);
    return 'ToString[' + expr + ', TeXForm]';
}

module.exports = {
    FN_ALIASES,
    normalizeFnName,
    normalizeBareSymbol,
    normalizeArgSeparator,
    looksLikeLatex,
    splitTopLevelArgs,
    compileWolframPseudo,
    buildPseudoWolframScript
};
