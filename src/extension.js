/**
 * LaTeX Helper 扩展入口。
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseDocument, deduplicateFormulas } = require('./formula/parser');
const { compileFormulas } = require('./formula/compiler');
const { getCacheDir, writeCache, clearCache: clearCacheDir } = require('./formula/cache');
const { FormulaPanelProvider } = require('./formula/panel');
const { FormulaBrowser } = require('./formula/browser');
const { GroupModeTreeProvider } = require('./tree/group-mode');
const { importSnippets } = require('./snippets/importer');
const { registerSnippetProvider } = require('./snippets/provider');
const { LiveSnippetWatcher } = require('./snippets/live-watcher');

/** @type {FormulaPanelProvider} */
let panelProvider;

/** @type {FormulaBrowser} */
let formulaBrowser;

/** @type {string | null} */
let currentPreambleHash = null;

/** @type {Array} */
let currentFormulas = []; // eslint-disable-line no-unused-vars

/** @type {string} 当前文档 preamble（定理预览懒编译用） */
let currentPreamble = '';

/** @type {Array} 当前文档的定理类环境条目（定理预览懒编译用） */
let currentTheorems = [];

/** @type {boolean} */
let onlyRef = true;

/** @type {string} */
let groupMode = 'section';

/** @type {string} */
let cacheDir = '';

/** @type {vscode.TextDocument | null} */
let activeLatexDoc = null;

/** @type {boolean} 刷新串行化：同一时间只允许一个 refreshFormulas 在运行 */
let isRefreshing = false;

/** @type {vscode.TextDocument | null} 刷新进行中排队等待的最新文档 */
let queuedRefreshDoc = null;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // 初始化缓存目录
    cacheDir = getCacheDir(context);

    // 注册公式面板 WebviewView Provider（侧边栏）
    panelProvider = new FormulaPanelProvider(context);
    panelProvider._onClearCache = () => {
        clearCacheDir(cacheDir);
        currentPreambleHash = null;
        panelProvider.clear();
        formulaBrowser.clear();
        vscode.window.showInformationMessage('LaTeX Helper: cache cleared');
    };
    panelProvider._onToggleOnlyRef = (value) => {
        onlyRef = value;
        currentPreambleHash = null;
        if (activeLatexDoc) {
            requestRefresh(activeLatexDoc);
        }
    };
    panelProvider._onToggleShowRecent = (value) => {
        // 持久化 + 通知浏览器 WebView 由 FormulaBrowser 内部完成
        formulaBrowser._setShowRecent(value);
    };
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('latex-helper.formulaPanel', panelProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // 原生 TreeView：分类方式选择（展开状态由 VS Code 记忆，不会自动收回）
    const groupModeProvider = new GroupModeTreeProvider();
    groupModeProvider.setMode(groupMode);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('latex-helper.groupModeTree', groupModeProvider)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('latex-helper.setGroupMode', (mode) => {
            if (typeof mode !== 'string' || mode === groupMode) return;
            groupMode = mode;
            groupModeProvider.setMode(mode);
            formulaBrowser.sendMessage({ type: 'groupMode', value: mode });
        })
    );

    // 公式浏览器（独立 Tab）
    formulaBrowser = new FormulaBrowser(context);
    formulaBrowser._onRefresh = async () => {
        const doc = await resolveRefreshDocument();
        if (doc) {
            requestRefresh(doc);
        } else {
            formulaBrowser.sendMessage({ type: 'refreshStatus', refreshing: false, message: 'No document' });
            vscode.window.showWarningMessage('LaTeX Helper: no active LaTeX document to refresh');
        }
    };
    // 定理卡片展开时的懒编译：复用公式编译管道，单条环境 → SVG
    // 已知限制：预览中定理编号从 1 起排，与原文档编号不一致（standalone 独立编译）
    formulaBrowser._onCompileTheorem = async (label) => {
        const thm = currentTheorems.find(t => t.label === label);
        if (!thm || !currentPreamble) {
            formulaBrowser.sendMessage({ type: 'theoremSvg', label, svg: '', error: 'theorem not found (document not parsed yet)' });
            return;
        }
        try {
            const compiled = await compileFormulas(currentPreamble, [{ label: thm.label, body: thm.body }]);
            formulaBrowser.sendMessage({ type: 'theoremSvg', label, svg: compiled[0]?.svg || '' });
        } catch (err) {
            formulaBrowser.sendMessage({ type: 'theoremSvg', label, svg: '', error: err.message });
        }
    };

    // 注册 snippet 补全 Provider
    context.subscriptions.push(registerSnippetProvider(context));

    // 实时 snippet 展开监听
    const liveWatcher = new LiveSnippetWatcher();
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            liveWatcher.watcher(event);
        })
    );

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

    // 监听编辑器切换，追踪当前 LaTeX 文档
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'latex') {
                activeLatexDoc = editor.document;
                requestRefresh(editor.document);
            }
        })
    );

    // 保存当前追踪的 LaTeX 文档时自动刷新，保证浏览器内容不落后于磁盘
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId === 'latex' && activeLatexDoc &&
                doc.uri.toString() === activeLatexDoc.uri.toString()) {
                requestRefresh(doc);
            }
        })
    );

    // 启动时追踪
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'latex') {
        activeLatexDoc = activeEditor.document;
        requestRefresh(activeEditor.document);
    }

    // 首次启动时尝试导入 snippets
    importSnippets(context);
}

/**
 * 从 aux 文件中提取所有 \newlabel{name} 标签名（当前未使用，保留给多文件项目）。
 * @param {vscode.TextDocument} document
 * @param {string} auxPathConfig
 * @returns {Set<string>}
 */
function readAuxLabels(document, auxPathConfig) { // eslint-disable-line no-unused-vars
    const labels = new Set();
    const texDir = path.dirname(document.uri.fsPath);
    const baseName = path.basename(document.uri.fsPath, '.tex');
    const searchDirs = [texDir];

    // 添加配置的 auxPath（相对于工作区根目录）
    if (auxPathConfig) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        if (workspaceRoot) {
            const auxDir = auxPathConfig.startsWith('./') || auxPathConfig.startsWith('../')
                ? path.join(workspaceRoot, auxPathConfig)
                : auxPathConfig;
            searchDirs.push(auxDir);
        }
    }

    for (const dir of searchDirs) {
        const auxFile = path.join(dir, baseName + '.aux');
        try {
            if (!fs.existsSync(auxFile)) continue;
            const content = fs.readFileSync(auxFile, 'utf-8');
            // 解析 \newlabel{name}{...}
            const re = /\\newlabel\{([^}]+)\}/g;
            let match;
            while ((match = re.exec(content)) !== null) {
                labels.add(match[1]);
            }
        } catch { /* ignore missing/malformed aux */ }
    }
    return labels;
}

/**
 * 解析刷新应使用的文档。
 * 优先取当前活动的 LaTeX 编辑器；否则回退到最近追踪的文档；
 * 若该文档已关闭，从磁盘重新打开以获取最新内容。
 * @returns {Promise<vscode.TextDocument | null>}
 */
async function resolveRefreshDocument() {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'latex') {
        activeLatexDoc = editor.document;
        return editor.document;
    }
    if (activeLatexDoc) {
        if (!activeLatexDoc.isClosed) {
            return activeLatexDoc;
        }
        // 文档已关闭：TextDocument 内容是关闭时的快照，必须从磁盘重开
        try {
            const doc = await vscode.workspace.openTextDocument(activeLatexDoc.uri);
            activeLatexDoc = doc;
            return doc;
        } catch {
            activeLatexDoc = null;
        }
    }
    return null;
}

/**
 * 串行化刷新请求。
 * 编译是耗时异步操作，并发刷新会导致先发起的旧结果覆盖新结果。
 * 刷新进行中再收到请求时，只保留最新文档，结束后补跑一次。
 * @param {vscode.TextDocument} document
 */
function requestRefresh(document) {
    if (isRefreshing) {
        queuedRefreshDoc = document;
        return;
    }
    isRefreshing = true;
    refreshFormulas(document)
        .catch(() => { /* refreshFormulas 内部已处理并提示错误 */ })
        .finally(() => {
            isRefreshing = false;
            if (queuedRefreshDoc) {
                const next = queuedRefreshDoc;
                queuedRefreshDoc = null;
                requestRefresh(next);
            }
        });
}

/**
 * 批量编译定理预览 SVG：按 bodyHash 去重并复用公式的增量缓存目录，新结果写回缓存。
 * 折叠的定理卡片用该 SVG 裁剪出一行编译预览，点击展开显示完整内容。
 * @param {string} preamble
 * @param {Array<{label: string, body: string, bodyHash: string}>} theorems
 * @param {boolean} preambleChanged
 * @returns {Promise<Array<{label: string, svg: string}>>}
 */
async function compileTheoremPreviews(preamble, theorems, preambleChanged) {
    // 按 bodyHash 去重：内容相同的定理只编译一次
    const svgByHash = new Map();
    const toCompile = [];
    for (const t of theorems) {
        if (svgByHash.has(t.bodyHash)) continue;
        let svg = '';
        const svgPath = path.join(cacheDir, t.bodyHash + '.svg');
        if (!preambleChanged && fs.existsSync(svgPath)) {
            try { svg = fs.readFileSync(svgPath, 'utf-8'); } catch { svg = ''; }
        }
        svgByHash.set(t.bodyHash, svg);
        if (!svg) toCompile.push({ label: t.bodyHash, body: t.body });
    }
    if (toCompile.length > 0) {
        const compiled = await compileFormulas(preamble, toCompile);
        for (let i = 0; i < toCompile.length; i++) {
            const hash = toCompile[i].label;
            const svg = compiled[i] ? compiled[i].svg : '';
            svgByHash.set(hash, svg);
            if (svg) {
                try { fs.writeFileSync(path.join(cacheDir, hash + '.svg'), svg, 'utf-8'); } catch { /* 缓存写失败不影响显示 */ }
            }
        }
    }
    return theorems.map(t => ({ label: t.label, svg: svgByHash.get(t.bodyHash) || '' }));
}

/**
 * 刷新公式面板。
 * @param {vscode.TextDocument} document
 */
async function refreshFormulas(document) {
    formulaBrowser.sendMessage({ type: 'refreshStatus', refreshing: true, message: 'Compiling...' });
    try {
        // 防御：已关闭文档的 getText() 是旧快照，从磁盘重开
        if (document.isClosed) {
            document = await vscode.workspace.openTextDocument(document.uri);
            activeLatexDoc = document;
        }
        const text = document.getText();
        const parsed = parseDocument(text);

        // onlyRef 时只处理被引用的公式，节省编译时间
        const formulas = onlyRef
            ? parsed.formulas.filter(f => f.referenced)
            : parsed.formulas;
        const preambleChanged = parsed.preambleHash !== currentPreambleHash;

        if (formulas.length > 0) {
            // 去重
            const { unique: uniqueFormulas, labelToBodyIndex } = deduplicateFormulas(formulas);

            // 增量编译：检查每个 bodyHash 是否有缓存，只编译缺失的
            /** @type {Array<{label: string, body: string}>} */
            const toCompile = [];
            /** @type {(string | null)[]} */
            const svgResults = new Array(uniqueFormulas.length).fill(null);

            for (let i = 0; i < uniqueFormulas.length; i++) {
                const uf = uniqueFormulas[i];
                const svgPath = path.join(cacheDir, uf.bodyHash + '.svg');
                if (!preambleChanged && fs.existsSync(svgPath)) {
                    try {
                        svgResults[i] = fs.readFileSync(svgPath, 'utf-8');
                    } catch { /* use null */ }
                }
                if (svgResults[i] === null) {
                    toCompile.push(uf);
                    svgResults[i] = '__pending__'; // 占位
                }
            }

            if (toCompile.length > 0) {
                const compiled = await compileFormulas(parsed.preamble, toCompile);
                // 将新编译的结果填回 svgResults
                const pendingIndices = [];
                for (let i = 0; i < svgResults.length; i++) {
                    if (svgResults[i] === '__pending__') {
                        pendingIndices.push(i);
                    }
                }
                for (let j = 0; j < compiled.length; j++) {
                    svgResults[pendingIndices[j]] = compiled[j]?.svg || '';
                }
            }

            // 写入缓存
            const cacheResults = formulas.map(f => ({
                label: f.label,
                bodyHash: f.bodyHash,
                svg: svgResults[labelToBodyIndex.get(f.label)] || ''
            }));
            writeCache(parsed.preambleHash, cacheDir, cacheResults);

            // 组装面板数据
            const panelData = formulas.map(f => ({
                label: f.label,
                svg: svgResults[labelToBodyIndex.get(f.label)] || '',
                body: f.body,
                line: f.line,
                referenced: f.referenced,
                envType: f.envType,
                section: f.section || '',
                subsection: f.subsection || ''
            }));
            formulaBrowser.update(panelData, parsed.theorems);
            panelProvider.update(panelData);
        } else {
            panelProvider.clear();
            // 无公式不代表无定理：清空公式列表但保留定理视图数据
            formulaBrowser.update([], parsed.theorems);
        }

        // 定理预览批量编译：与公式共用 bodyHash 增量缓存。
        // 批量失败不阻塞刷新：一行预览缺失，展开时仍可单条懒编译兜底。
        let theoremSvgs = [];
        if (parsed.theorems.length > 0 && parsed.preamble) {
            try {
                theoremSvgs = await compileTheoremPreviews(parsed.preamble, parsed.theorems, preambleChanged);
            } catch (err) {
                console.error('LaTeX Helper: theorem preview batch compile failed', err);
            }
        }
        formulaBrowser.sendMessage({ type: 'theoremSvgs', svgs: theoremSvgs });

        currentPreambleHash = parsed.preambleHash;
        currentPreamble = parsed.preamble;
        currentTheorems = parsed.theorems;
        currentFormulas = formulas;
        formulaBrowser.sendMessage({ type: 'refreshStatus', refreshing: false, message: 'Done' });
        // 注意：不要在此重发 groupMode。刷新会重建 webview 状态前的默认值
        // （公式 section / 定理 type），重发会把定理默认冲成 section；
        // 用户显式切换时 setGroupMode 命令已单独 sendMessage（关闭时排队、ready 重放）。
    } catch (err) {
        console.error('LaTeX Helper: formula refresh failed', err);
        vscode.window.showErrorMessage(`LaTeX Helper: ${err.message}`);
        formulaBrowser.sendMessage({ type: 'refreshStatus', refreshing: false, message: 'Failed' });
    }
}

function deactivate() {}

module.exports = { activate, deactivate };
