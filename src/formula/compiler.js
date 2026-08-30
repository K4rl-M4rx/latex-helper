/**
 * LaTeX 编译管道：standalone 文档 → latex (DVI) → dvisvgm --no-fonts → SVG。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const vscode = require('vscode');

/**
 * 给 SVG 内所有 id 与引用加唯一前缀。
 * dvisvgm --no-fonts 的字形以 <defs><path id='g0-101'> + <use xlink:href='#g0-101'>
 * 组织；实测不同 DVI 产出的同名 id 指向不同字形（字体编号随加载顺序漂移），
 * 而内嵌 SVG 的 id 在宿主文档内全局解析——不隔离时一个 SVG 会引用到另一个
 * SVG 的 defs，字符显示成错误的字形。前缀取内容哈希，同内容同前缀、缓存稳定。
 * @param {string} svg
 * @param {string} prefix 须以字母开头（合法 XML id）
 * @returns {string}
 */
function namespaceSvgIds(svg, prefix) {
    if (!svg) return svg;
    return svg
        .replace(/id='([^']+)'/g, (m, id) => `id='${prefix}${id}'`)
        .replace(/id="([^"]+)"/g, (m, id) => `id="${prefix}${id}"`)
        .replace(/((?:xlink:)?href='#[^']*')/g, m => m.replace(/#/, `#${prefix}`))
        .replace(/((?:xlink:)?href="#[^"]*")/g, m => m.replace(/#/, `#${prefix}`))
        .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${prefix}${id})`);
}

/**
 * SVG 内容短哈希（用于 id 前缀）。
 * @param {string} content
 * @returns {string}
 */
function svgHash(content) {
    return 'g' + crypto.createHash('sha256').update(content).digest('hex').substring(0, 12) + '-';
}

/**
 * 检测可执行文件是否在 PATH 中。
 * @param {string} name
 * @returns {boolean}
 */
function checkTool(name) {
    try {
        const result = require('child_process').spawnSync(name, ['--version'], { timeout: 5000 });
        return result.status === 0;
    } catch {
        return false;
    }
}

/**
 * preamble 是否加载了指定宏包（支持 \usepackage{a,b} 合并写法）。
 * @param {string} preamble
 * @param {string} packageName
 * @returns {boolean}
 */
function preambleUsesPackage(preamble, packageName) {
    const re = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)\}/g;
    let match;
    while ((match = re.exec(preamble)) !== null) {
        const names = match[1].split(',').map(s => s.trim());
        if (names.includes(packageName)) return true;
    }
    return false;
}

/**
 * 运行时修复：不依赖字符串扫描 \usepackage。
 * 宏包常通过 \input{...} 间接加载，静态检测会漏掉，导致仍走 physics 的 \@quantity，
 * 并在 \qty{数}<空行>{单位} 时报 Paragraph ended before \@quantity was complete。
 * \IfPackageLoadedTF 在 \begin{document} 时判断，\input 已展开。
 */
const QTY_SIUNITX_FIX = [
    '% latex-helper: physics+siunitx \\qty 冲突修复（siunitx 官方写法）',
    '\\AtBeginDocument{%',
    '  \\IfPackageLoadedTF{physics}{%',
    '    \\IfPackageLoadedTF{siunitx}{%',
    '      \\RenewCommandCopy\\qty\\SI',
    '    }{}%',
    '  }{}%',
    '}'
].join('\n');

/**
 * 注入 physics/siunitx 的 \\qty 运行时兼容修复。
 * 无条件注入（块内自带包检测）；若 preamble 已含同类 RenewCommandCopy 则跳过。
 * @param {string} preamble
 * @returns {string}
 */
function ensureQtyCompatibility(preamble) {
    if (/\\RenewCommandCopy\s*\\qty\s*\\SI/.test(preamble) ||
        /\\let\s*\\qty\s*\\SI/.test(preamble)) {
        return preamble;
    }
    return preamble.trimEnd() + '\n' + QTY_SIUNITX_FIX + '\n';
}

/**
 * 为 DVI/pdfTeX 预览清洗 preamble。
 * 主文档常用 xelatex + ctex（mac 上自动选 mac/macold），但公式预览管道是
 * latex→dvisvgm，macold 在 pdfTeX 下不可用。强制 fontset=fandol（TeX Live 自带）；
 * 去掉仅 XeTeX/LuaTeX 可用的中文字体命令与 xeCJK。
 * @param {string} preamble
 * @returns {string}
 */
function sanitizePreambleForDviPreview(preamble) {
    let s = preamble;
    // \usepackage[UTF8]{ctex} / \usepackage[fontset=mac]{ctex} → fandol
    s = s.replace(
        /\\usepackage(?:\[[^\]]*\])?\{ctex\}/g,
        '\\usepackage[UTF8,fontset=fandol]{ctex}'
    );
    // \usepackage{xeCJK} 等在 DVI 下不可用
    s = s.replace(
        /\\usepackage(?:\[[^\]]*\])?\{xeCJK\*?\}\s*/g,
        '% latex-helper: stripped xeCJK (DVI preview)\n'
    );
    // \setCJKmainfont{...} / \setCJKsansfont{...} / \setCJKmonofont{...}
    s = s.replace(
        /\\setCJK(?:main|sans|mono|family)font(?:\[[^\]]*\])?\{[^}]*\}\s*/g,
        '% latex-helper: stripped setCJKfont (DVI preview)\n'
    );
    return s;
}

/**
 * 去掉公式 body 中的「纯空白行」。
 * TeX 把空行（含仅含空格/制表符的行）当成 \\par；equation/align 内非法，
 * 且 physics 的 \\qty{...}/\\@quantity 参数不容 \\par，会报
 * Paragraph ended before \\@quantity was complete。
 * 论文里常见写法：\\qty 参数中间夹了只含空格/制表符的空行。
 * @param {string} body
 * @returns {string}
 */
function sanitizeFormulaBody(body) {
    return body
        .split('\n')
        .filter(line => line.trim() !== '')
        .join('\n');
}

/** @deprecated 保留别名；请用 sanitizeFormulaBody */
function normalizeQtyBlankLines(body) {
    return sanitizeFormulaBody(body);
}

/**
 * 构建 standalone LaTeX 文档内容。
 * @param {string} preamble
 * @param {Array<{label: string, body: string}>} formulas
 * @returns {string}
 */
function buildStandaloneDoc(preamble, formulas) {
    const formulaBlocks = formulas.map(f =>
        `\\begin{minipage}{0.95\\textwidth}\n${sanitizeFormulaBody(f.body)}\n\\end{minipage}`
    ).join('\n');

    // 剥掉用户 preamble 中的 \documentclass 行，用 standalone 替代；
    // 再清洗 ctex/CJK，最后注入 qty 兼容 fix
    const cleanedPreamble = ensureQtyCompatibility(
        sanitizePreambleForDviPreview(
            preamble.replace(/\\documentclass(?:\[.*?\]|\*)?\{[^}]*\}\s*\n?/g, '')
        )
    );

    return [
        '\\documentclass[multi={minipage},border=2pt,preview]{standalone}',
        cleanedPreamble,
        '\\begin{document}',
        formulaBlocks,
        '\\end{document}'
    ].join('\n');
}

/**
 * 在临时目录中运行 latex（DVI 模式）。
 * @param {string} texContent
 * @param {string} workDir
 * @param {number} [pageCount] 页数（环境条数），超时随页数放大
 * @returns {Promise<string>} DVI 文件路径
 */
function runLatex(texContent, workDir, pageCount = 1) {
    return new Promise((resolve, reject) => {
        const config = vscode.workspace.getConfiguration('latex-helper');
        const latexPath = config.get('latexPath', 'latex');
        const texFile = path.join(workDir, 'formulas.tex');
        const dviFile = path.join(workDir, 'formulas.dvi');

        fs.writeFileSync(texFile, texContent, 'utf-8');

        const proc = spawn(latexPath, [
            '-interaction=nonstopmode',
            '-halt-on-error',
            '-output-directory', workDir,
            texFile
        ], { cwd: workDir });

        let stdout = '';
        let stderr = '';

        // 单页 30s 起步，批量编译（尤其定理）页数多时按比例放宽
        const timeoutMs = Math.max(30000, pageCount * 3000);
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`latex compilation timed out (${timeoutMs / 1000}s, ${pageCount} pages)`));
        }, timeoutMs);

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Failed to start ${latexPath}: ${err.message}`));
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                const logLines = stdout.split('\n');
                const errorLines = logLines.filter(l => l.startsWith('!')).slice(-20);
                reject(new Error(
                    `latex exited with code ${code}\n${errorLines.join('\n')}\n${stderr.slice(-500)}`
                ));
                return;
            }
            resolve(dviFile);
        });
    });
}

/**
 * 确保 SVG 根元素带显式 width/height（pt）。
 * dvisvgm 3.x 部分场景只输出 viewBox，浏览器按默认 300px 渲染，
 * 导致折叠一行预览的缩放行为不确定。补上 viewBox 对应的物理尺寸。
 * @param {string} svg
 * @returns {string}
 */
function ensureSvgSize(svg) {
    if (!svg || /<svg[^>]*\swidth=/.test(svg)) return svg;
    const vb = svg.match(/<svg[^>]*\sviewBox=['"]([^'"]+)['"]/);
    if (!vb) return svg;
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return svg;
    return svg.replace(/<svg /, `<svg width='${parts[2]}pt' height='${parts[3]}pt' `);
}

/**
 * 将 DVI 逐页转为 SVG（使用 dvisvgm --no-fonts）。
 * @param {string} dviPath
 * @param {string} outputDir
 * @param {number} pageCount
 * @returns {Promise<string[]>} 每页一个 SVG 字符串
 */
function convertToSVG(dviPath, outputDir, pageCount) {
    return new Promise((resolve, reject) => {
        const config = vscode.workspace.getConfiguration('latex-helper');
        const dvisvgmPath = config.get('dvisvgmPath', 'dvisvgm');

        // 一次调用处理所有页：--page=1-N，用 %p 占位符输出到独立文件。
        // --no-fonts：文字转矢量路径。内嵌 woff2 字体子集会在多个 SVG 内嵌到同一
        // 页面时因同名 @font-face 互相覆盖，重渲染后字符错成 Unicode 替代字形。
        const svgPattern = path.join(outputDir, 'page-%p.svg');
        const proc = spawn(dvisvgmPath, [
            '--no-fonts',
            '--zoom=-1',
            '--exact',
            '--page=1-' + pageCount,
            '--output=' + svgPattern,
            dviPath
        ], { timeout: Math.max(60000, pageCount * 5000) });

        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('error', (err) => {
            reject(new Error(
                `Failed to start ${dvisvgmPath}: ${err.message}. ` +
                'Install dvisvgm (usually bundled with TeX Live).'
            ));
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(
                    `dvisvgm exited with code ${code}\n${stderr.slice(-500)}`
                ));
                return;
            }
            // dvisvgm 在页数较多时会自动补零（page-001.svg），不能假定固定格式。
            // 通过列出目录解析实际文件名，按页码排序读取。
            const pageFiles = fs.readdirSync(outputDir)
                .filter(f => /^page-\d+\.svg$/.test(f))
                .sort((a, b) => {
                    const na = parseInt(a.match(/page-(\d+)\.svg$/)[1], 10);
                    const nb = parseInt(b.match(/page-(\d+)\.svg$/)[1], 10);
                    return na - nb;
                });
            const svgs = pageFiles.map(f => {
                try {
                    const raw = fs.readFileSync(path.join(outputDir, f), 'utf-8');
                    return ensureSvgSize(namespaceSvgIds(raw, svgHash(raw)));
                } catch {
                    return '';
                }
            });
            resolve(svgs);
        });
    });
}

/**
 * 编译临时目录的父目录：优先用工作区根目录下的 temp/（方便排查编译产物），
 * 无工作区或创建失败时回退到系统临时目录。
 * @returns {string}
 */
function getTempBaseDir() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (folder) {
        const base = path.join(folder, 'temp');
        try {
            fs.mkdirSync(base, { recursive: true });
            return base;
        } catch { /* 回退到系统临时目录 */ }
    }
    return os.tmpdir();
}

/**
 * 编译失败时把 formulas.tex / .log 拷到固定目录（用户主目录），
 * 不依赖当前工作区路径——工作区 temp/ 常被找错或根本没有工作区。
 * @param {string} workDir
 * @returns {string|null} 保留目录路径；失败则 null
 */
function preserveFailedCompile(workDir) {
    try {
        const dest = path.join(os.homedir(), '.latex-helper-last-fail');
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        let copied = 0;
        for (const name of ['formulas.tex', 'formulas.log']) {
            const src = path.join(workDir, name);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(dest, name));
                copied++;
            }
        }
        // 顺带写一份到工作区 temp/（若有），方便在项目里搜
        try {
            const wsBase = getTempBaseDir();
            if (wsBase !== os.tmpdir()) {
                const wsDest = path.join(wsBase, 'latex-helper-last-fail');
                fs.rmSync(wsDest, { recursive: true, force: true });
                fs.cpSync(dest, wsDest, { recursive: true });
            }
        } catch { /* 工作区副本可选 */ }
        return copied > 0 ? dest : null;
    } catch {
        return null;
    }
}

/**
 * 编译公式列表为 SVG。
 * @param {string} preamble
 * @param {Array<{label: string, body: string}>} formulas
 * @returns {Promise<Array<{label: string, svg: string}>>}
 */
async function compileFormulas(preamble, formulas) {
    if (formulas.length === 0) return [];

    const workDir = fs.mkdtempSync(path.join(getTempBaseDir(), 'latex-helper-'));
    try {
        const texContent = buildStandaloneDoc(preamble, formulas);
        const dviPath = await runLatex(texContent, workDir, formulas.length);
        const svgs = await convertToSVG(dviPath, workDir, formulas.length);

        return formulas.map((f, i) => ({
            label: f.label,
            svg: svgs[i] || ''
        }));
    } catch (err) {
        const failDir = preserveFailedCompile(workDir);
        if (failDir) {
            err.message = `${err.message}\n(see ${failDir}/formulas.tex)`;
        }
        throw err;
    } finally {
        // 清理临时文件
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        } catch { /* ignore */ }
    }
}

module.exports = {
    checkTool,
    buildStandaloneDoc,
    compileFormulas,
    ensureQtyCompatibility,
    sanitizePreambleForDviPreview,
    normalizeQtyBlankLines,
    sanitizeFormulaBody,
    ensureSvgSize,
    namespaceSvgIds,
    preambleUsesPackage,
    svgHash
};
