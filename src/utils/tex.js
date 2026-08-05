/**
 * TeX 共享工具函数。
 */

/**
 * 已知的公式环境名列表（含 starred 版本）。
 */
const MATH_ENVIRONMENTS = [
    'equation', 'equation*',
    'align', 'align*', 'alignat', 'alignat*',
    'gather', 'gather*',
    'multline', 'multline*',
    'flalign', 'flalign*',
    'eqnarray', 'eqnarray*',
    'array', 'array*',
    'subequations',
    'split'  // split 通常嵌套，但单独出现时也应处理
];

/**
 * 内置的定理类环境名列表（starred 变体由 \newtheorem 解析与正则一并覆盖）。
 */
const THEOREM_ENVIRONMENTS = [
    'theorem', 'lemma', 'proposition', 'corollary', 'definition',
    'remark', 'example', 'claim', 'conjecture', 'notation', 'assumption'
];

/**
 * 从 preamble 中解析 \newtheorem{env}... 与 \newtheorem*{env}... 声明的自定义环境名。
 * @param {string} preamble
 * @returns {string[]}
 */
function extractNewtheoremNames(preamble) {
    const names = [];
    const re = /\\newtheorem\*?\{([^}]+)\}/g;
    let match;
    while ((match = re.exec(preamble)) !== null) {
        names.push(match[1]);
    }
    return names;
}

/**
 * 提取 preamble（\documentclass → \begin{document} 之间）。
 * @param {string} text
 * @returns {string}
 */
function extractPreamble(text) {
    const docStart = text.search(/\\documentclass\b/);
    if (docStart === -1) return getDefaultPreamble();

    const beginDoc = text.indexOf('\\begin{document}', docStart);
    if (beginDoc === -1) return text.substring(docStart);

    return text.substring(docStart, beginDoc);
}

/**
 * 默认最小 preamble。
 * @returns {string}
 */
function getDefaultPreamble() {
    return [
        '\\documentclass{article}',
        '\\usepackage{amsmath,amssymb,amsfonts}',
        '\\usepackage{mathtools}'
    ].join('\n');
}

/**
 * 查找指定环境名集合的所有环境块（允许嵌套）。
 * @param {string} text
 * @param {string[]} envNames
 * @returns {Array<{env: string, body: string, startLine: number, endLine: number}>}
 */
function findEnvironments(text, envNames) {
    const results = [];

    // 构建环境名正则（* 需转义）
    const escaped = envNames.map(n => n.replace(/\*/g, '\\*'));
    const envPattern = escaped.join('|');

    // 匹配 \begin{env}...\end{env}（允许嵌套）
    const beginRe = new RegExp(`\\\\begin\\{(${envPattern})\\}`, 'g');

    let match;
    while ((match = beginRe.exec(text)) !== null) {
        const envName = match[1];
        const beginPos = match.index;
        const afterBegin = beginPos + match[0].length;

        // 用栈匹配对应的 \end{env}
        let depth = 1;
        let endPos = -1;

        const innerBeginRe = new RegExp(`\\\\begin\\{(${envPattern})\\}|\\\\end\\{${envName.replace(/\*/g, '\\*')}\\}`, 'g');
        innerBeginRe.lastIndex = afterBegin;

        let innerMatch;
        while ((innerMatch = innerBeginRe.exec(text)) !== null) {
            if (innerMatch[0].startsWith('\\begin')) {
                depth++;
            } else {
                depth--;
                if (depth === 0) {
                    endPos = innerMatch.index + innerMatch[0].length;
                    break;
                }
            }
        }

        if (endPos === -1) continue; // 未闭合，跳过

        const body = text.substring(beginPos, endPos);
        const startLine = text.substring(0, beginPos).split('\n').length;
        const endLine = text.substring(0, endPos).split('\n').length;

        results.push({ env: envName, body, startLine, endLine });
    }

    return results;
}

/**
 * 查找所有公式环境块。
 * @param {string} text
 * @returns {Array<{env: string, body: string, startLine: number, endLine: number}>}
 */
function findFormulaEnvironments(text) {
    return findEnvironments(text, MATH_ENVIRONMENTS);
}

/**
 * 从公式 body 中提取所有 \label{...}。
 * @param {string} body
 * @returns {string[]}
 */
function extractLabels(body) {
    const labels = [];
    const re = /\\label\{([^}]+)\}/g;
    let match;
    while ((match = re.exec(body)) !== null) {
        labels.push(match[1]);
    }
    return labels;
}

/**
 * 从公式 body 中提取第一个 \label{...}（用于向后兼容）。
 * @param {string} body
 * @returns {string|null}
 */
function extractLabel(body) {
    const labels = extractLabels(body);
    return labels.length > 0 ? labels[0] : null;
}

/**
 * 查找文档中所有 \ref{...} 和 \eqref{...} 的引用名。
 * @param {string} text
 * @returns {Set<string>}
 */
function findReferences(text) {
    const refs = new Set();
    const re = /\\(?:eq)?ref\{([^}]+)\}/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        refs.add(match[1]);
    }
    return refs;
}

/**
 * 模式检测用的环境表（1:1 对齐 latex-utilities typeFinder）。
 * 注意：原插件不识别 $...$ / $$...$$，只识别 \( \[ 与数学环境。
 * @type {Object<string, {mode: 'maths'|'text', type: 'start'|'end', pair: string|null}>}
 */
const TYPE_ENVS = {
    '\\(': { mode: 'maths', type: 'start', pair: '\\)' },
    '\\[': { mode: 'maths', type: 'start', pair: '\\]' },
    '\\begin{equation}': { mode: 'maths', type: 'start', pair: '\\end{equation}' },
    '\\begin{displaymath}': { mode: 'maths', type: 'start', pair: '\\end{displaymath}' },
    '\\begin{align}': { mode: 'maths', type: 'start', pair: '\\end{align}' },
    '\\begin{gather}': { mode: 'maths', type: 'start', pair: '\\end{gather}' },
    '\\begin{flalign}': { mode: 'maths', type: 'start', pair: '\\end{flalign}' },
    '\\begin{multline}': { mode: 'maths', type: 'start', pair: '\\end{multline}' },
    '\\begin{alignat}': { mode: 'maths', type: 'start', pair: '\\end{alignat}' },
    '\\begin{split}': { mode: 'maths', type: 'start', pair: '\\end{split}' },
    '\\text': { mode: 'text', type: 'start', pair: null },
    '\\begin{document}': { mode: 'text', type: 'start', pair: null },
    '\\chapter': { mode: 'text', type: 'start', pair: null },
    '\\section': { mode: 'text', type: 'start', pair: null },
    '\\subsection': { mode: 'text', type: 'start', pair: null },
    '\\subsubsection': { mode: 'text', type: 'start', pair: null },
    '\\paragraph': { mode: 'text', type: 'start', pair: null },
    '\\subparagraph': { mode: 'text', type: 'start', pair: null }
};

/** @type {RegExp | null} */
let ALL_ENV_REGEX = null;

/**
 * 构建环境 token 正则（对齐原插件 constructEnvRegexs）：
 * 为 \begin{X} 生成 starred 变体与 \end 配对项，统一进一张表。
 * @returns {RegExp}
 */
function buildEnvRegex() {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokens = [];
    const beginNames = [];
    const endNames = [];
    const beginRe = /\\begin\{(\w+)\}/;

    for (const key of Object.keys(TYPE_ENVS)) {
        const env = TYPE_ENVS[key];
        if (env.type === 'end') continue;
        const m = key.match(beginRe);
        if (m) {
            beginNames.push(m[1]);
            TYPE_ENVS[`\\begin{${m[1]}*}`] = { mode: env.mode, type: 'start', pair: `\\end{${m[1]}*}` };
            if (env.pair !== null) {
                endNames.push(m[1]);
                TYPE_ENVS[`\\end{${m[1]}*}`] = { mode: env.mode, type: 'end', pair: `\\begin{${m[1]}*}` };
            }
        } else {
            tokens.push(esc(key));
            if (env.pair !== null) tokens.push(esc(env.pair));
        }
        if (env.pair !== null) {
            TYPE_ENVS[env.pair] = { mode: env.mode, type: 'end', pair: key };
        }
    }
    tokens.push(`\\\\begin{(?:${beginNames.join('|')})\\*?}`);
    tokens.push(`\\\\end{(?:${endNames.join('|')})\\*?}`);
    return new RegExp(`(?:^|[^\\\\])(${tokens.join('|')})`, 'g');
}

/**
 * 去掉行内注释：截断到第一个未被反斜杠转义的 % 。
 * @param {string} text
 * @returns {string}
 */
function stripComment(text) {
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '%') {
            let backslashes = 0;
            let j = i - 1;
            while (j >= 0 && text[j] === '\\') { backslashes++; j--; }
            if (backslashes % 2 === 0) return text.substring(0, i);
        }
    }
    return text;
}

/**
 * 检测光标所在位置的上下文模式。
 * 从光标所在行【反向】逐行扫描环境 token，遇到决定性 token 即返回，
 * 通常只扫几行；支持 lastKnown 缓存（对齐原插件 getTypeAtPosition）。
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @param {{ position: import('vscode').Position, mode: string } | null} [lastKnown]
 * @returns {'maths' | 'text'}
 */
function getModeAtPosition(document, position, lastKnown) {
    if (!ALL_ENV_REGEX) ALL_ENV_REGEX = buildEnvRegex();

    let s = position.line;
    /** @type {string[]} 等待配平的 end token 栈 */
    const stack = [];
    let stopLine = 0;
    let stopChar = -1;
    if (lastKnown && lastKnown.position.isBefore(position)) {
        stopLine = lastKnown.position.line;
        stopChar = lastKnown.position.character;
    }

    do {
        let text = document.lineAt(s--).text;
        const curLine = s + 1;
        if (curLine === position.line) {
            text = text.substr(0, position.character + 1);
        }
        text = stripComment(text);
        // 光标落在注释里 → text
        if (curLine === position.line && position.character > text.length) {
            return 'text';
        }

        /** @type {RegExpExecArray[]} */
        const matches = [];
        ALL_ENV_REGEX.lastIndex = 0;
        let m;
        while ((m = ALL_ENV_REGEX.exec(text)) !== null) {
            matches.push(m);
        }

        if (matches.length === 0) {
            // 本行无 token：可以尝试用 lastKnown 结果
            if (curLine === stopLine && stopChar >= 0 && lastKnown) {
                if (stack.length > 0) {
                    const top = TYPE_ENVS[stack[stack.length - 1]];
                    if (top.type === 'end' && top.mode === lastKnown.mode) {
                        stopLine = 0;
                        continue;
                    }
                }
                return lastKnown.mode;
            }
            continue;
        }

        // 从行尾向行首处理 token
        matches.reverse();
        let depth = 0;
        for (const match of matches) {
            const name = match[1];
            const env = TYPE_ENVS[name];
            if (!env) continue;
            const tokenStart = match.index + (match[0].length - name.length);

            // \text 特判：token 右侧有大括号包着它（depth>0）→ 光标在 \text{...} 内
            for (let g = text.length - 1; g >= 0; g--) {
                if (name === '\\text' && tokenStart === g && depth > 0) {
                    return env.mode;
                }
                if (text[g] === '}') depth--;
                else if (text[g] === '{') depth++;
            }

            if (env.type === 'end') {
                if (env.pair === null) return env.mode;
                stack.push(name);
            } else {
                // 无配对的 start token → 决定模式
                if ((stack.length === 0 || stack[stack.length - 1] !== env.pair) && name !== '\\text') {
                    return env.mode;
                }
                if (stack.length > 0 && name !== '\\text') {
                    stack.pop();
                    if (lastKnown && env.mode === lastKnown.mode) continue;
                }
            }

            // 到达 lastKnown 参考点：沿用之前的结论
            if (curLine === stopLine && tokenStart < stopChar && lastKnown) {
                if (stack.length > 0) {
                    const top = TYPE_ENVS[stack[stack.length - 1]];
                    if (top.type === 'end' && top.mode === lastKnown.mode) {
                        stopLine = 0;
                        continue;
                    }
                }
                return lastKnown.mode;
            }
        }
    } while (s >= stopLine);

    return 'text';
}

/**
 * 向后兼容：返回 { inMath: boolean, depth: number }
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @returns {{inMath: boolean, depth: number}}
 */
function isInMathContext(document, position) {
    const mode = getModeAtPosition(document, position);
    return { inMath: mode === 'maths', depth: mode === 'maths' ? 1 : 0 };
}


/**
 * 查找所有节标题（\section, \subsection, \subsubsection）。
 * @param {string} text
 * @returns {Array<{title: string, level: number, line: number}>}
 */
function findSections(text) {
    const results = [];
    const re = /\\(section|subsection|subsubsection)\{([^}]*)\}/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        const levelMap = { 'section': 1, 'subsection': 2, 'subsubsection': 3 };
        results.push({
            title: match[2],
            level: levelMap[match[1]] || 1,
            line: text.substring(0, match.index).split('\n').length
        });
    }
    return results;
}

module.exports = {
    extractPreamble,
    findEnvironments,
    findFormulaEnvironments,
    extractNewtheoremNames,
    THEOREM_ENVIRONMENTS,
    extractLabel,
    extractLabels,
    findReferences,
    findSections,
    getModeAtPosition,
    isInMathContext
};
