/**
 * LaTeX Helper 扩展入口。
 */

const vscode = require('vscode');
const { parseDocument, deduplicateFormulas, computeHash } = require('./formula/parser');
const { compileFormulas, checkTool } = require('./formula/compiler');
const { needsRecompile, getCacheDir, writeCache, readAllFromCache, computeHash: cacheHash, clearCache: clearCacheDir } = require('./formula/cache');
const { FormulaPanelProvider } = require('./formula/panel');
const { FormulaBrowser } = require('./formula/browser');
const { importSnippets } = require('./snippets/importer');
const { registerSnippetProvider } = require('./snippets/provider');

/** @type {FormulaPanelProvider} */
let panelProvider;

/** @type {FormulaBrowser} */
let formulaBrowser;

/** @type {string | null} */
let currentPreambleHash = null;

/** @type {Array} */
let currentFormulas = [];

/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null;

/** @type {string} */
let cacheDir = '';

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('LaTeX Helper activated');

    // 初始化缓存目录
    cacheDir = getCacheDir(context);

    // 注册公式面板 WebviewView Provider（侧边栏）
    panelProvider = new FormulaPanelProvider(context);
    panelProvider._onClearCache = () => {
        clearCacheDir(cacheDir);
        currentPreambleHash = null;
        panelProvider.clear();
        formulaBrowser.clear();
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'latex') {
            refreshFormulas(editor.document);
        }
        vscode.window.showInformationMessage('LaTeX Helper: cache cleared');
    };
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('latex-helper.formulaPanel', panelProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // 公式浏览器（独立 Tab）
    formulaBrowser = new FormulaBrowser(context);

    // 注册 snippet 补全 Provider
    context.subscriptions.push(registerSnippetProvider(context));

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('latex-helper.showFormulaPanel', () => {
            vscode.commands.executeCommand('latex-helper.formulaPanel.focus');
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('latex-helper.importSnippets', async () => {
            await importSnippets(context);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('latex-helper.showFormulaBrowser', () => {
            formulaBrowser.show();
        })
    );

    // 监听编辑器切换
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'latex') {
                refreshFormulas(editor.document);
            }
        })
    );

    // 监听文档变更
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document
                && editor.document.languageId === 'latex') {
                // Debounce
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    refreshFormulas(editor.document);
                }, 500);
            }
        })
    );

    // 启动时如果已有 LaTeX 文件打开，立即刷新
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'latex') {
        refreshFormulas(activeEditor.document);
    }

    // 首次启动时尝试导入 snippets
    importSnippets(context);
}

/**
 * 刷新公式面板。
 * @param {vscode.TextDocument} document
 */
async function refreshFormulas(document) {
    try {
        const text = document.getText();
        const parsed = parseDocument(text);

        // 检测是否需要重新编译
        const preambleChanged = parsed.preambleHash !== currentPreambleHash;
        const allHashes = parsed.formulas.map(f => ({ label: f.label, bodyHash: f.bodyHash }));
        const needCompile = preambleChanged
            || parsed.formulas.length === 0
            || needsRecompile(parsed.preambleHash, allHashes, cacheDir);

        if (needCompile && parsed.formulas.length > 0) {
            // 去重：多个 label 可能共享同一 body（如 align 环境）
            const { unique: uniqueFormulas, labelToBodyIndex } = deduplicateFormulas(parsed.formulas);
            const compiled = await compileFormulas(parsed.preamble, uniqueFormulas);

            // 写入缓存（所有 label 条目）
            const cacheResults = parsed.formulas.map(f => ({
                label: f.label,
                bodyHash: f.bodyHash,
                svg: compiled[labelToBodyIndex.get(f.label)]?.svg || ''
            }));
            writeCache(parsed.preambleHash, cacheDir, cacheResults);

            // 组装面板数据
            const panelData = parsed.formulas.map(f => ({
                label: f.label,
                svg: compiled[labelToBodyIndex.get(f.label)]?.svg || '',
                body: f.body,
                line: f.line,
                referenced: f.referenced,
                envType: f.envType
            }));
            panelProvider.update(panelData);
            formulaBrowser.update(panelData);
        } else if (!needCompile && parsed.formulas.length > 0) {
            // 全部命中缓存
            const cached = readAllFromCache(allHashes, cacheDir);
            const panelData = parsed.formulas.map((f, i) => ({
                label: f.label,
                svg: cached[i]?.svg || '',
                body: f.body,
                line: f.line,
                referenced: f.referenced,
                envType: f.envType
            }));
            panelProvider.update(panelData);
            formulaBrowser.update(panelData);
        } else {
            panelProvider.clear();
            formulaBrowser.clear();
        }

        currentPreambleHash = parsed.preambleHash;
        currentFormulas = parsed.formulas;
    } catch (err) {
        console.error('LaTeX Helper: formula refresh failed', err);
        vscode.window.showErrorMessage(`LaTeX Helper: ${err.message}`);
    }
}

function deactivate() {
    if (debounceTimer) clearTimeout(debounceTimer);
}

module.exports = { activate, deactivate };
