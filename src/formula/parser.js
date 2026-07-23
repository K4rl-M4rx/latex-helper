/**
 * TeX 文档解析：提取 preamble、公式环境、label、引用关系。
 */

const crypto = require('crypto');
const { extractPreamble, findFormulaEnvironments, extractLabels, findReferences, findSections } = require('../utils/tex');

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

        // 找最近的 section 和 subsection
        let section = '';
        let subsection = '';
        for (const sec of sections) {
            if (sec.line <= env.startLine) {
                if (sec.level === 1) { section = sec.title; subsection = ''; }
                else if (sec.level === 2) { subsection = sec.title; }
                else if (sec.level === 3) { /* subsubsection 暂不计入 subsection */ }
            } else {
                break;
            }
        }

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

    return { preamble, preambleHash, formulas };
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
