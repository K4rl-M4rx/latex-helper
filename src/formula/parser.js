/**
 * TeX 文档解析：提取 preamble、公式环境、定理类环境、label、引用关系。
 */

const crypto = require('crypto');
const {
    extractPreamble, findFormulaEnvironments, findEnvironments,
    extractNewtheoremNames, THEOREM_ENVIRONMENTS,
    extractLabels, findReferences, findSections
} = require('../utils/tex');

/**
 * @param {string} text - .tex 文件全文
 * @returns {{
 *   preamble: string,
 *   preambleHash: string,
 *   formulas: Array<{
 *     label: string,
 *     body: string,
 *     bodyHash: string,
 *     envType: string,
 *     line: number,
 *     referenced: boolean
 *   }>,
 *   theorems: Array<{
 *     label: string,
 *     body: string,
 *     envType: string,
 *     note: string,
 *     preview: string,
 *     line: number,
 *     referenced: boolean,
 *     section: string,
 *     subsection: string
 *   }>
 * }}
 */
function parseDocument(text) {
    const preamble = extractPreamble(text);
    const preambleHash = computeHash(preamble);

    const envs = findFormulaEnvironments(text);
    const refs = findReferences(text);
    const sections = findSections(text);

    /** @type {Array} */
    const formulas = [];

    for (const env of envs) {
        const labels = extractLabels(env.body);
        if (labels.length === 0) continue; // 跳过无 label 的公式

        const bodyHash = computeHash(env.body);
        const { section, subsection } = locateSection(sections, env.startLine);

        for (const label of labels) {
            formulas.push({
                label,
                body: env.body,
                bodyHash,
                envType: env.env,
                line: env.startLine,
                referenced: refs.has(label),
                section,
                subsection
            });
        }
    }

    // 定理类环境：内置名 + preamble 中 \newtheorem 声明的自定义名
    const theoremEnvNames = [...THEOREM_ENVIRONMENTS, ...extractNewtheoremNames(preamble)];
    const theoremEnvs = findEnvironments(text, theoremEnvNames);

    /** @type {Array} */
    const theorems = [];

    for (const env of theoremEnvs) {
        // 只取定理自身的 \label：剥掉内层环境块（如 lemma 里的 equation），
        // 否则每个内部公式的 label 都会冗余生成一张定理卡片
        const labels = extractLabels(stripInnerEnvironments(env.body));
        if (labels.length === 0) continue; // 只收录带 label 的环境

        const { section, subsection } = locateSection(sections, env.startLine);
        const note = extractEnvNote(env.body);
        const preview = makePreview(env.body);

        for (const label of labels) {
            theorems.push({
                label,
                body: env.body,
                bodyHash: computeHash(env.body),
                envType: env.env,
                note,
                preview,
                line: env.startLine,
                referenced: refs.has(label),
                section,
                subsection
            });
        }
    }

    return { preamble, preambleHash, formulas, theorems };
}

/**
 * 找某个环境行号之前最近的 section / subsection。
 * @param {Array<{title: string, level: number, line: number}>} sections
 * @param {number} envLine
 * @returns {{section: string, subsection: string}}
 */
function locateSection(sections, envLine) {
    let section = '';
    let subsection = '';
    for (const sec of sections) {
        if (sec.line <= envLine) {
            if (sec.level === 1) { section = sec.title; subsection = ''; }
            else if (sec.level === 2) { subsection = sec.title; }
            else if (sec.level === 3) { /* subsubsection 暂不计入 subsection */ }
        } else {
            break;
        }
    }
    return { section, subsection };
}

/**
 * 提取环境 begin 行的 optional argument：\begin{theorem}[Title] → "Title"。
 * @param {string} body
 * @returns {string}
 */
function extractEnvNote(body) {
    const match = /^\\begin\{[^}]+\}\[([^\]]*)\]/.exec(body);
    return match ? match[1].trim() : '';
}

/**
 * 剥掉环境 body 中的内层环境块（先去掉最外层 \begin/\end 包装，再反复剥内层），
 * 用于只提取环境自身的 \label —— 内层环境（如定理里的 equation）的 label 不属于宿主环境。
 * @param {string} body
 * @returns {string}
 */
function stripInnerEnvironments(body) {
    let inner = body
        .replace(/^\\begin\{[^}]+\}(\[[^\]]*\])?/, '')
        .replace(/\\end\{[^}]+\}\s*$/, '');
    // 非贪婪匹配每次剥掉一对最内层 \begin...\end，循环直到没有环境块
    const re = /\\begin\{[^}]+\}(\[[^\]]*\])?[\s\S]*?\\end\{[^}]+\}/;
    while (re.test(inner)) {
        inner = inner.replace(re, '');
    }
    return inner;
}

/**
 * 生成正文预览：去掉 begin/end 标签、\label、命令与括号，压缩空白后截断。
 * @param {string} body
 * @param {number} [maxLen]
 * @returns {string}
 */
function makePreview(body, maxLen = 100) {
    const text = body
        .replace(/\\begin\{[^}]+\}(\[[^\]]*\])?/, '')
        .replace(/\\end\{[^}]+\}/, '')
        .replace(/\\label\{[^}]*\}/g, '')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/[{}$&_^]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/**
 * 从公式列表中去除 body 重复的条目，返回去重后的编译输入。
 * @param {Array<{label: string, body: string, bodyHash: string}>} formulas
 * @returns {{ unique: Array<{label: string, body: string}>, labelToBodyIndex: Map<string, number> }}
 */
function deduplicateFormulas(formulas) {
    const seen = new Map(); // bodyHash → index
    const unique = [];
    const labelToBodyIndex = new Map();

    for (const f of formulas) {
        if (seen.has(f.bodyHash)) {
            labelToBodyIndex.set(f.label, seen.get(f.bodyHash));
        } else {
            const idx = unique.length;
            seen.set(f.bodyHash, idx);
            unique.push({ label: f.label, body: f.body });
            labelToBodyIndex.set(f.label, idx);
        }
    }

    return { unique, labelToBodyIndex };
}

/**
 * @param {string} content
 * @returns {string}
 */
function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

module.exports = { parseDocument, deduplicateFormulas, computeHash };
