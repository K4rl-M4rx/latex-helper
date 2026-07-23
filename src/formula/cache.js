/**
 * 缓存管理：公式渲染结果的持久化缓存。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function getCacheDir(context) {
    const dir = path.join(context.globalStoragePath, 'cache');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * @param {string} content
 * @returns {string}
 */
function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * 检查是否需要重新编译。
 * @param {string} preambleHash
 * @param {Array<{label: string, bodyHash: string}>} formulas
 * @param {string} cacheDir
 * @returns {boolean}
 */
function needsRecompile(preambleHash, formulas, cacheDir) {
    const indexPath = path.join(cacheDir, 'index.json');
    if (!fs.existsSync(indexPath)) return true;

    try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        if (index.preambleHash !== preambleHash) return true;
        if (index.count !== formulas.length) return true;

        for (const f of formulas) {
            const entry = index.formulas[f.label];
            if (!entry || entry.hash !== f.bodyHash) return true;
            const svgPath = path.join(cacheDir, `${f.bodyHash}.svg`);
            if (!fs.existsSync(svgPath)) return true;
        }
        return false;
    } catch {
        return true;
    }
}

/**
 * 将编译结果写入缓存。
 * @param {string} preambleHash
 * @param {string} cacheDir
 * @param {Array<{label: string, bodyHash: string, svg: string}>} results
 */
function writeCache(preambleHash, cacheDir, results) {
    const formulas = {};
    for (const r of results) {
        const svgPath = path.join(cacheDir, `${r.bodyHash}.svg`);
        fs.writeFileSync(svgPath, r.svg, 'utf-8');
        formulas[r.label] = { hash: r.bodyHash };
    }

    const index = {
        preambleHash,
        count: results.length,
        formulas,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 从缓存读取所有 SVG。
 * @param {Array<{label: string, bodyHash: string}>} formulas
 * @param {string} cacheDir
 * @returns {Array<{label: string, svg: string}>}
 */
function readAllFromCache(formulas, cacheDir) {
    return formulas.map(f => {
        const svgPath = path.join(cacheDir, `${f.bodyHash}.svg`);
        let svg = '';
        try {
            svg = fs.readFileSync(svgPath, 'utf-8');
        } catch { /* ignore */ }
        return { label: f.label, svg };
    });
}

module.exports = { getCacheDir, computeHash, needsRecompile, writeCache, readAllFromCache };
