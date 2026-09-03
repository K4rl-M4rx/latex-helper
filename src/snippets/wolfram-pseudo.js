/**
 * Wolfram 伪代码编译：∴ Function[args] ∴c 块用。
 * - 函数名不区分大小写：一律 toLowerCase 后查规范名表（见 FN_ALIASES）
 * - 支持嵌套 Fun1[Fun2[…]] 与多参数；顶层分界符可配（默认 ,）
 * - Prefix `@` 复合：Simplify @ Expand @ expr → Simplify[Expand[expr]]（右结合；
 *   与 wolframArgSeparator=@ 互斥，分参优先）
 * - 叶子：LaTeX → tex2wolfram；裸函数名走同一张表（simplify → Simplify，不改写变量 x）
 *
 * 为何必须有词表、而不能「任意单词小写后自动对齐 Wolfram」：
 * Wolfram 符号是 CamelCase（ReplaceAll、FullSimplify），从小写 replaceall 无法唯一还原
 * 中间大写位置；正确做法正是「小写键 → 规范拼写」字典。完整 System`* 有数千个，
 * 此处维护 CAS 常用子集；未命中时只能做弱回退（首字母大写），多驼峰名会错。
 */

const { tex2wolfram } = require('./tex2wolfram');

/**
 * 小写键 → 规范 Wolfram 符号（大小写不敏感识别的唯一可靠来源）。
 * 含多驼峰名（replaceall → ReplaceAll）与单节名（sin → Sin）。
 */
const FN_ALIASES = {
    // 化简 / 展开
    simplify: 'Simplify',
    fullsimplify: 'FullSimplify',
    expand: 'Expand',
    expandall: 'ExpandAll',
    factor: 'Factor',
    factorlist: 'FactorList',
    together: 'Together',
    apart: 'Apart',
    cancel: 'Cancel',
    complexexpand: 'ComplexExpand',
    trigreduce: 'TrigReduce',
    trigexpand: 'TrigExpand',
    trigtoexp: 'TrigToExp',
    exptotrig: 'ExpToTrig',
    powerexpand: 'PowerExpand',
    powersimplify: 'PowerExpand',
    // 替换（代入请用 ReplaceAll；Replace 默认只匹配整式）
    replace: 'Replace',
    replaceall: 'ReplaceAll',
    replacerepeated: 'ReplaceRepeated',
    // 求解 / 微积分
    solve: 'Solve',
    nsolve: 'NSolve',
    reduce: 'Reduce',
    findroot: 'FindRoot',
    dsolve: 'DSolve',
    integrate: 'Integrate',
    nintegrate: 'NIntegrate',
    sum: 'Sum',
    nsum: 'NSum',
    product: 'Product',
    limit: 'Limit',
    series: 'Series',
    d: 'D',
    dt: 'Dt',
    // 矩阵 / 线性
    det: 'Det',
    tr: 'Tr',
    transpose: 'Transpose',
    inverse: 'Inverse',
    rowreduce: 'RowReduce',
    nullspace: 'NullSpace',
    eigenvalues: 'Eigenvalues',
    eigenvectors: 'Eigenvectors',
    eigensystem: 'Eigensystem',
    matrixrank: 'MatrixRank',
    matrixpower: 'MatrixPower',
    identitymatrix: 'IdentityMatrix',
    // 收集 / 多项式
    collect: 'Collect',
    coefficient: 'Coefficient',
    coefficientlist: 'CoefficientList',
    exponent: 'Exponent',
    variables: 'Variables',
    polynomialgcd: 'PolynomialGCD',
    polynomiallcm: 'PolynomialLCM',
    // 初等
    abs: 'Abs',
    sqrt: 'Sqrt',
    log: 'Log',
    ln: 'Log',
    exp: 'Exp',
    sin: 'Sin',
    cos: 'Cos',
    tan: 'Tan',
    cot: 'Cot',
    sec: 'Sec',
    csc: 'Csc',
    arcsin: 'ArcSin',
    arccos: 'ArcCos',
    arctan: 'ArcTan',
    sinh: 'Sinh',
    cosh: 'Cosh',
    tanh: 'Tanh',
    // 其它常用
    numerical: 'N',
    n: 'N',
    evaluate: 'Evaluate',
    identity: 'Identity',
    complex: 'Complex',
    conjugate: 'Conjugate',
    re: 'Re',
    im: 'Im',
    arg: 'Arg',
    floor: 'Floor',
    ceiling: 'Ceiling',
    round: 'Round',
    min: 'Min',
    max: 'Max',
    total: 'Total',
    mean: 'Mean',
    cross: 'Cross',
    dot: 'Dot',
    norm: 'Norm',
    normalize: 'Normalize',
    assume: 'Assuming',
    assuming: 'Assuming',
    refine: 'Refine',
    possiblezeroq: 'PossibleZeroQ',
    element: 'Element',
    not: 'Not',
    and: 'And',
    or: 'Or'
};

/**
 * @param {string} name
 * @returns {string}
 */
function normalizeFnName(name) {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    // 核心：任意大小写 → 小写键查表 → 规范 CamelCase
    const mapped = FN_ALIASES[raw.toLowerCase()];
    if (mapped) return mapped;
    // 已是全大写短名（如 D、N、GCD）保持
    if (/^[A-Z0-9]+$/.test(raw) && raw.length <= 4) return raw;
    // 用户已写成内部含大写的 CamelCase（如 MyFunc）且不在表内：原样信任
    if (/[A-Z]/.test(raw.slice(1))) return raw;
    // 弱回退：仅首字母大写（对 FullSimplify / ReplaceAll 这类会错，故应扩表）
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
    return splitTopLevelBy(s, normalizeArgSeparator(separator), { asArgs: true });
}

/**
 * 顶层按分隔符切开（方括号/花括号/圆括号内不拆）。
 * @param {string} s
 * @param {string} sep
 * @param {{ asArgs?: boolean, singleAt?: boolean }} [opts]
 *   asArgs：空段丢弃（参数列表）；singleAt：仅拆单独的 Prefix `@`，跳过 @@ / @@@ / /@ 
 * @returns {string[]}
 */
function splitTopLevelBy(s, sep, opts) {
    const asArgs = Boolean(opts && opts.asArgs);
    const singleAt = Boolean(opts && opts.singleAt);
    const parts = [];
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
            if (singleAt) {
                const prev = i > 0 ? s[i - 1] : '';
                const next = i + sep.length < s.length ? s[i + sep.length] : '';
                // 跳过 @@、@@@、/@、//@（Apply / Map 族，暂不实现）
                if (prev === '@' || next === '@' || prev === '/') {
                    continue;
                }
            }
            parts.push(s.slice(start, i).trim());
            start = i + sep.length;
            i += sep.length - 1;
        }
    }
    parts.push(s.slice(start).trim());
    return asArgs ? parts.filter(a => a.length > 0) : parts;
}

/**
 * 顶层 Prefix `@` 分段：f @ g @ x → ['f','g','x']（右结合编成 f[g[x]]）。
 * 与参数分界符 `@` 互斥：argSeparator 为 `@` 时不启用。
 * @param {string} s
 * @returns {string[] | null} 无 Prefix `@` 时返回 null
 */
function splitPrefixAt(s) {
    const parts = splitTopLevelBy(s, '@', { singleAt: true });
    if (parts.length < 2) return null;
    if (parts.some(p => !p)) {
        throw new Error('empty operand around @ (@@ / @@@ not supported yet)');
    }
    return parts;
}

/**
 * Prefix 复合：head @ arg → head[arg]（head 已是调用则 head[arg]）。
 * @param {string} headCompiled
 * @param {string} argCompiled
 * @returns {string}
 */
function applyPrefix(headCompiled, argCompiled) {
    const h = headCompiled.trim();
    // 纯函数名 / 符号：在别名表内才规范大小写，避免 f@x → F[x]
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(h)) {
        const fn = Object.prototype.hasOwnProperty.call(FN_ALIASES, h.toLowerCase())
            ? FN_ALIASES[h.toLowerCase()]
            : h;
        return fn + '[' + argCompiled + ']';
    }
    // 已是 Fun[...] 或其它表达式：Wolfram 允许 expr[arg]
    return h + '[' + argCompiled + ']';
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

    // Prefix `@`：Simplify @ Expand @ expr → Simplify[Expand[expr]]（右结合）
    // 若用户把参数分界符设成 `@`，则让位给分参，不再当复合算子
    if (argSeparator !== '@') {
        const atParts = splitPrefixAt(s);
        if (atParts) {
            let acc = compileWolframPseudo(atParts[atParts.length - 1], options);
            for (let i = atParts.length - 2; i >= 0; i--) {
                const head = compileWolframPseudo(atParts[i], options);
                acc = applyPrefix(head, acc);
            }
            return acc;
        }
    }

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
    splitTopLevelBy,
    splitPrefixAt,
    applyPrefix,
    compileWolframPseudo,
    buildPseudoWolframScript
};
