/**
 * LaTeX 编译管道：standalone 文档 → latex (DVI) → dvisvgm --no-fonts → SVG。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const vscode = require('vscode');

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
 * 构建 standalone LaTeX 文档内容。
 * @param {string} preamble
 * @param {Array<{label: string, body: string}>} formulas
 * @returns {string}
 */
function buildStandaloneDoc(preamble, formulas) {
    const formulaBlocks = formulas.map(f =>
        `\\begin{minipage}{0.95\\textwidth}\n${f.body}\n\\end{minipage}`
    ).join('\n');

    // 剥掉用户 preamble 中的 \documentclass 行，用 standalone 替代
    const cleanedPreamble = preamble
        .replace(/\\documentclass(?:\[.*?\]|\*)?\{[^}]*\}\s*\n?/g, '');

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
 * @returns {Promise<string>} DVI 文件路径
 */
function runLatex(texContent, workDir) {
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
        ], { cwd: workDir, timeout: 30000 });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('error', (err) => {
            reject(new Error(`Failed to start ${latexPath}: ${err.message}`));
        });

        proc.on('close', (code) => {
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

        setTimeout(() => {
            proc.kill();
            reject(new Error('latex compilation timed out (30s)'));
        }, 30000);
    });
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

        // 一次调用处理所有页：--page=1-N，用 %p 占位符输出到独立文件
        const svgPattern = path.join(outputDir, 'page-%p.svg');
        const proc = spawn(dvisvgmPath, [
            '--font-format=woff2',
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
            const svgs = [];
            for (let i = 1; i <= pageCount; i++) {
                const svgFile = path.join(outputDir, `page-${i}.svg`);
                try {
                    svgs.push(fs.readFileSync(svgFile, 'utf-8'));
                } catch {
                    svgs.push('');
                }
            }
            resolve(svgs);
        });
    });
}

/**
 * 编译公式列表为 SVG。
 * @param {string} preamble
 * @param {Array<{label: string, body: string}>} formulas
 * @returns {Promise<Array<{label: string, svg: string}>>}
 */
async function compileFormulas(preamble, formulas) {
    if (formulas.length === 0) return [];

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-helper-'));
    try {
        const texContent = buildStandaloneDoc(preamble, formulas);
        const dviPath = await runLatex(texContent, workDir);
        const svgs = await convertToSVG(dviPath, workDir, formulas.length);

        return formulas.map((f, i) => ({
            label: f.label,
            svg: svgs[i] || ''
        }));
    } finally {
        // 清理临时文件
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        } catch { /* ignore */ }
    }
}

module.exports = { checkTool, buildStandaloneDoc, compileFormulas };
