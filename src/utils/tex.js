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
 * 查找所有公式环境块。
 * @param {string} text
 * @returns {Array<{env: string, body: string, startLine: number, endLine: number}>}
 */
function findFormulaEnvironments(text) {
    const results = [];

    // 构建环境名正则
    const envNames = MATH_ENVIRONMENTS.join('|');

    // 匹配 \begin{env}...\end{env}（允许嵌套）
    const beginRe = new RegExp(`\\\\begin\\{(${envNames})\\}`, 'g');

    let match;
    while ((match = beginRe.exec(text)) !== null) {
        const envName = match[1];
        const beginPos = match.index;
        const afterBegin = beginPos + match[0].length;

        // 用栈匹配对应的 \end{env}
        const endTag = `\\end{${envName}}`;
        let depth = 1;
        let searchPos = afterBegin;
        let endPos = -1;

        const innerBeginRe = new RegExp(`\\\\begin\\{(${envNames})\\}|\\\\end\\{${envName.replace(/\*/g, '\\*')}\\}`, 'g');
        innerBeginRe.lastIndex = searchPos;

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
 * 检测光标是否在数学环境内。
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @returns {{inMath: boolean, depth: number}}
 */
function isInMathContext(document, position) {
    // 检查从行首到光标位置的文本
    const lineText = document.lineAt(position).text;
    const textBefore = lineText.substring(0, position.character);

    // 也考虑前面的行（简化处理：只检查当前行）
    // 对于跨行公式，需要检查整个文档前缀 — 这里先做轻量实现

    let inMath = false;
    let depth = 0;

    // State flags
    let inDollar = false;    // $
    let inDblDollar = false; // $$

    for (let i = 0; i < textBefore.length; i++) {
        const ch = textBefore[i];

        // 双 dollar
        if (ch === '$' && textBefore[i + 1] === '$') {
            if (!inDollar) {
                inDblDollar = !inDblDollar;
            }
            i++; // skip next $
            continue;
        }

        // 单 dollar（避开双 dollar 已处理的）
        if (ch === '$' && !inDblDollar) {
            // 转义检测
            if (i > 0 && textBefore[i - 1] === '\\') continue;
            inDollar = !inDollar;
            continue;
        }

        // \( 和 \)
        if (ch === '\\' && textBefore[i + 1] === '(') {
            if (!inDollar && !inDblDollar) depth++;
            i++;
            continue;
        }
        if (ch === '\\' && textBefore[i + 1] === ')') {
            if (!inDollar && !inDblDollar && depth > 0) depth--;
            i++;
            continue;
        }

        // \[ 和 \]
        if (ch === '\\' && textBefore[i + 1] === '[') {
            if (!inDollar && !inDblDollar) depth++;
            i++;
            continue;
        }
        if (ch === '\\' && textBefore[i + 1] === ']') {
            if (!inDollar && !inDblDollar && depth > 0) depth--;
            i++;
            continue;
        }
    }

    inMath = inDollar || inDblDollar || depth > 0;
    return { inMath, depth };
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
    findFormulaEnvironments,
    extractLabel,
    extractLabels,
    findReferences,
    findSections,
    isInMathContext
};
