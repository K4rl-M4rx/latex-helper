/**
 * LaTeX 数学表达式 → Wolfram 表达式转换器。
 *
 * 目的：wolfram 后端允许用户按 LaTeX 语法输入表达式
 * （\frac、\sqrt、\sin、\int、\frac{d}{dx} 等），转换后再交给
 * wolframscript 求值，而不是强迫用户手写 Wolfram 语法。
 *
 * 实现为分层正则 pipeline + 递归：
 * 1. normalize      去掉 \left\right、间距命令
 * 2. 结构命令       \int \sum \prod \lim \frac{d}{dx}（先提取，避免其上下标被误处理）
 * 3. 分数/根号     \frac{a}{b}、\sqrt{...}
 * 4. 函数命令      \sin x → Sin[x]（含 \sin^2 x → Sin[x]^2、\log_{2} x → Log[2, x]）
 * 5. 符号          希腊字母、\pi \infty \le \ge \neq \cdot \times \to 等
 * 6. 下标          x_1 → Subscript[x, 1]
 * 7. 幂花括号      x^{2} → x^(2)
 * 8. 隐式乘法      2x、xy、(x+1)(x-1) → 插入 *（仅无空格粘连处；Wolfram 原生支持空格乘法）
 * 9. 等号          = → ==
 *
 * 已知限制：矩阵/align 环境不处理、未知命令原样保留（交给 Wolfram 报错）。
 */

/** 常见数学函数命令 → Wolfram 函数名 */
const FUNCTION_MAP = {
    sin: 'Sin', cos: 'Cos', tan: 'Tan',
    sec: 'Sec', csc: 'Csc', cot: 'Cot',
    arcsin: 'ArcSin', arccos: 'ArcCos', arctan: 'ArcTan',
    sinh: 'Sinh', cosh: 'Cosh', tanh: 'Tanh',
    ln: 'Log', log: 'Log', exp: 'Exp',
    abs: 'Abs', floor: 'Floor', ceil: 'Ceiling',
    min: 'Min', max: 'Max', gcd: 'GCD', lcm: 'LCM',
    det: 'Det', tr: 'Tr', dim: 'Dimensions'
};

/** 希腊字母命令 → Unicode 符号（Wolfram 接受 Unicode 希腊字母作符号） */
const GREEK_MAP = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', omicron: 'ο', rho: 'ρ', sigma: 'σ', tau: 'τ',
    upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    varepsilon: 'ε', vartheta: 'ϑ', varphi: 'φ', varrho: 'ϱ', varsigma: 'ς',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
};

/** 函数命令的正则片段（匹配 \sin 等） */
const FN_RE = '(?:' + Object.keys(FUNCTION_MAP).join('|') + ')';

/**
 * 函数参数：单个"项"（不含运算符）。连续项如 `2x`、`\sin x` 会被整体匹配。
 * - \frac{a}{b} / \cmd{...} / \cmd / 括号组 / 数字 / 变量（含 ^ 幂与 _ 下标）
 */
const TERM_RE = '(?:' +
    '\\\\frac\\{[^{}]*\\}\\{[^{}]*\\}' +
    '|\\\\[A-Za-z]+' +
    '|\\{?[A-Za-z0-9]' +
    '(?:\\^\\{[^{}]*\\}|\\^[A-Za-z0-9])?' +
    '(?:_\\{[^{}]*\\}|_[A-Za-z0-9])?' +
    '\\}?' +
    '|\\([^()]*\\)' +
    ')';

/** 转换器生成的多字符标识符（函数名/常量名），隐式乘法前需保护，避免被拆散 */
const PROTECTED_WORDS = [
    'Integrate', 'Sum', 'Product', 'Limit', 'Subscript', 'Sqrt',
    'ArcSin', 'ArcCos', 'ArcTan', 'Ceiling', 'Dimensions', 'Infinity',
    'Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot', 'Sinh', 'Cosh', 'Tanh',
    'Log', 'Exp', 'Abs', 'Floor', 'Min', 'Max', 'GCD', 'LCM', 'Det', 'Tr', 'Pi'
];

/**
 * 归一化：去掉 \left \right 与间距命令，压缩空白。
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
    return s
        .replace(/\\left|\\right/g, '')
        .replace(/\\(?:,|;|:|!| |quad|qquad)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 若整个字符串是一个括号组（无嵌套），剥掉最外层括号：`(x+1)` → `x+1` */
function unwrapParens(arg) {
    const t = arg.trim();
    return /^\([^()]*\)$/.test(t) ? t.slice(1, -1) : t;
}

/**
 * 结构命令：\int \sum \prod \lim \frac{d}{dx}（参数递归转换）。
 * 必须先于函数/下标处理，因为它们的 _ ^ 是参数而非下标/幂。
 * @param {string} s
 * @returns {string}
 */
function convertStructure(s) {
    // \frac{d}{dx} f → D[f, x]；\frac{\partial}{\partial x} 同
    s = s.replace(/\\frac\{(?:d|\\partial)\}\{(?:d|\\partial)([A-Za-z])\}\s*([\s\S]*)/g,
        (m, v, rest) => 'D[' + tex2wolfram(unwrapParens(rest.trim())) + ', ' + v + ']');
    // \frac{d y}{d x} → D[y, x]（莱布尼茨记号）
    s = s.replace(/\\frac\{(?:d|\\partial)([A-Za-z])\}\{(?:d|\\partial)([A-Za-z])\}/g,
        (m, f, v) => 'D[' + f + ', ' + v + ']');
    // \int_{lo}^{hi} body dx → Integrate[body, {var, lo, hi}]；\int body dx → Integrate[body, var]
    s = s.replace(/\\int(?:_\{([^{}]*)\})?(?:\^\{([^{}]*)\})?\s*([\s\S]*?)\s*\\?d([A-Za-z])(?=[^A-Za-z]|$)/g,
        (m, lo, hi, body, v) => {
            body = tex2wolfram(unwrapParens(body.trim()));
            if (lo !== undefined && hi !== undefined) {
                return 'Integrate[' + body + ', {' + v + ', ' + lo + ', ' + hi + '}]';
            }
            return 'Integrate[' + body + ', ' + v + ']';
        });
    // \sum_{var=lo}^{hi} body → Sum[body, {var, lo, hi}]（\prod 同）
    s = s.replace(/\\(sum|prod)_\{([^}]*)=([^}]*)\}(?:\^\{([^}]*)\})?\s*([\s\S]*)/g,
        (m, kind, v, lo, hi, body) =>
            (kind === 'sum' ? 'Sum' : 'Product') + '[' + tex2wolfram(body.trim()) +
            ', {' + v + ', ' + lo + ', ' + tex2wolfram(hi || '') + '}]');
    // \lim_{var \to val} body → Limit[body, var -> val]
    s = s.replace(/\\lim_\{([^}]*)\}\s*([\s\S]*)/g, (m, arg, body) => {
        const am = /([A-Za-z]+)\s*\\?(?:to|rightarrow|longrightarrow)\s*([\s\S]*)/.exec(arg);
        if (!am) return m;
        return 'Limit[' + tex2wolfram(body.trim()) + ', ' + am[1] + ' -> ' + tex2wolfram(am[2].trim()) + ']';
    });
    return s;
}

/**
 * \frac{a}{b} → (a)/(b)；\sqrt{a} → Sqrt[a]；\sqrt[n]{a} → (a)^(1/n)。
 * @param {string} s
 * @returns {string}
 */
function convertFracSqrt(s) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
        (m, a, b) => '(' + tex2wolfram(a) + ')/(' + tex2wolfram(b) + ')');
    s = s.replace(/\\sqrt(?:\[([^\]]*)\])?\{([^{}]*)\}/g, (m, n, a) => {
        a = tex2wolfram(a);
        return n ? '(' + a + ')^(1/' + n + ')' : 'Sqrt[' + a + ']';
    });
    return s;
}

/**
 * 函数命令：\sin x → Sin[x]；\sin^2 x → Sin[x]^2；\log_{2} x → Log[2, x]。
 * 注意：含变量拼接的正则必须用 new RegExp 字符串构造（正则字面量内拼接
 * 会把 ' + TERM_RE + ' 当字面文本匹配，导致函数命令永不生效）。
 * @param {string} s
 * @returns {string}
 */
function convertFunctions(s) {
    // \log/\ln 带显式底数：\log_{2} x → Log[2, x]（先于一般 \log 处理）
    s = s.replace(new RegExp('\\\\' + '(log|ln)_\\{([^}]*)\\}\\s*(' + TERM_RE + '+)', 'g'),
        (m, cmd, base, arg) => FUNCTION_MAP[cmd] + '[' + base + ', ' + tex2wolfram(unwrapParens(arg)) + ']');
    // \lg x → Log[10, x]
    s = s.replace(new RegExp('\\\\lg\\s*(' + TERM_RE + '+)', 'g'),
        (m, arg) => 'Log[10, ' + tex2wolfram(unwrapParens(arg)) + ']');
    // 一般函数：\sin^2 x → Sin[x]^2；\sin x → Sin[x]
    s = s.replace(new RegExp('\\\\(' + FN_RE + ')(\\^(?:\\{([^}]*)\\}|([A-Za-z0-9])))?\\s*(' + TERM_RE + '+)', 'g'),
        (m, cmd, pow, powBraced, powChar, arg) => {
            const fn = FUNCTION_MAP[cmd];
            let out = fn + '[' + tex2wolfram(unwrapParens(arg)) + ']';
            if (pow) {
                const p = powBraced !== undefined ? powBraced : powChar;
                out = out + '^' + (powBraced !== undefined ? '(' + p + ')' : p);
            }
            return out;
        });
    return s;
}

/**
 * 符号与常量：希腊字母、\pi \infty \le \ge \neq \cdot \times \div \to \pm \dots。
 * @param {string} s
 * @returns {string}
 */
function convertSymbols(s) {
    s = s.replace(/\\(pi|infty)/g, (m, name) => (name === 'pi' ? 'Pi' : 'Infinity'));
    s = s.replace(/\\(le|leq)/g, '<=');
    s = s.replace(/\\(ge|geq)/g, '>=');
    s = s.replace(/\\(neq|ne)/g, '!=');
    s = s.replace(/\\(approx|simeq|sim)/g, '≈');
    s = s.replace(/\\(cdot|times)/g, '*');
    s = s.replace(/\\div/g, '/');
    s = s.replace(/\\pm/g, '±');
    s = s.replace(/\\(to|rightarrow|longrightarrow|mapsto)/g, '->');
    s = s.replace(/\\(dots|ldots|cdots)/g, '...');
    // 希腊字母
    s = s.replace(/\\([A-Za-z]+)\b/g, (m, name) => GREEK_MAP[name] !== undefined ? GREEK_MAP[name] : m);
    return s;
}

/**
 * 下标：x_1 → Subscript[x, 1]；x_{i+1} → Subscript[x, i+1]。
 * @param {string} s
 * @returns {string}
 */
function convertSubscripts(s) {
    return s.replace(/([A-Za-z])(?:_\{([^{}]*)\}|_([A-Za-z0-9]))/g,
        (m, base, braced, ch) => 'Subscript[' + base + ', ' + (braced !== undefined ? braced : ch) + ']');
}

/**
 * 幂花括号：x^{2} → x^(2)（Wolfram 的 {} 是 List，不能当分组）。
 * @param {string} s
 * @returns {string}
 */
function convertBracePowers(s) {
    return s.replace(/\^\{([^{}]*)\}/g, '^($1)');
}

/**
 * 隐式乘法（仅无空格粘连处；Wolfram 原生支持空格乘法）：
 * 2x → 2*x、xy → x*y、(x+1)(x-1) → (x+1)*(x-1)、x(y+1) → x*(y+1)、]x → ]*x
 * 先保护转换器生成的关键字（Sin/Integrate/Pi 等），避免被拆散。
 * @param {string} s
 * @returns {string}
 */
function insertImplicitMul(s) {
    // 保护函数名/常量名：替换为单个非字母占位（\uE000..\uE001），乘法规则不会拆它们
    const placeholders = new Map();
    let id = 0;
    s = s.replace(new RegExp('(?<=[^A-Za-z]|^)(?:' + PROTECTED_WORDS.join('|') + ')(?=[^A-Za-z0-9]|$)', 'g'),
        (word) => {
            const ph = '\uE000' + (id++) + '\uE001';
            placeholders.set(ph, word);
            return ph;
        });
    let prev;
    do {
        prev = s;
        s = s
            .replace(/([0-9])([A-Za-z(])/g, '$1*$2')            // 2x、2(
            .replace(/([A-Za-z])(\()/g, '$1*$2')                // x(
            .replace(/([A-Za-z0-9)])([A-Za-z])/g, '$1*$2')      // xy、x2?、]x、(x+1)y
            .replace(/(\))([0-9(])/g, '$1*$2');                 // )(、)2
    } while (s !== prev);
    // 恢复关键字
    for (const [ph, word] of placeholders) s = s.split(ph).join(word);
    return s;
}

/**
 * 等号：裸 = → ==（\le \ge \neq 已在上层转成 <= >= !=，不会误伤）。
 * @param {string} s
 * @returns {string}
 */
function convertEquals(s) {
    return s.replace(/([^<>=!])=(?!=)/g, '$1==');
}

/**
 * LaTeX 数学表达式 → Wolfram 表达式。
 * @param {string} latex
 * @returns {string}
 */
function tex2wolfram(latex) {
    let s = normalize(String(latex));
    if (!s) return '';
    s = convertStructure(s);
    s = convertFracSqrt(s);
    s = convertFunctions(s);
    s = convertSymbols(s);
    s = convertSubscripts(s);
    s = convertBracePowers(s);
    s = insertImplicitMul(s);
    s = convertEquals(s);
    return s;
}

module.exports = { tex2wolfram };
