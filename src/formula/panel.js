/**
 * WebviewView Provider：侧边栏控件（搜索 + 按钮）。
 * browser.js 使用 getBrowserHtml() 在 Tab 中展示完整公式列表。
 */

const vscode = require('vscode');

class FormulaPanelProvider {
    constructor(context) {
        this.context = context;
        /** @type {vscode.WebviewView | null} */
        this.view = null;
        /** @type {Array | null} */
        this._formulas = null;
        /** @type {(() => void) | null} */
        this._onClearCache = null;
    }

    resolveWebviewView(webviewView, _resolveContext, _token) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = getPanelHtml(webviewView.webview.cspSource);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'openBrowser':
                        vscode.commands.executeCommand('latex-helper.showFormulaBrowser');
                        break;
                    case 'clearCache':
                        if (this._onClearCache) {
                            this._onClearCache();
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        // 如果有缓存的公式数据，立即更新计数
        if (this._formulas) {
            this._sendUpdate(this._formulas);
        }
    }

    update(formulas) {
        this._formulas = formulas;
        this._sendUpdate(formulas);
    }

    clear() {
        this._formulas = null;
        if (this.view) {
            this.view.webview.postMessage({ type: 'clear' });
        }
    }

    /** @param {Array} formulas */
    _sendUpdate(formulas) {
        if (!this.view) return;
        const refCount = formulas.filter(f => f.referenced).length;
        this.view.webview.postMessage({
            type: 'updateCount',
            total: formulas.length,
            referenced: refCount
        });
    }
}

/**
 * 侧边栏 Panel HTML — 仅控件，不显示公式。
 * @param {string} cspSource
 * @returns {string}
 */
function getPanelHtml(cspSource) {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 12px 8px;
        }
        .count-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding: 8px 10px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
        }
        .count-row .num { font-weight: bold; color: var(--vscode-textLink-foreground); }
        button {
            width: 100%;
            padding: 8px 12px;
            border: none;
            border-radius: 2px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: inherit;
            font-size: 13px;
            cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .hint {
            margin-top: 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="count-row">
        <span>Formulas: <span class="num" id="total-count">-</span></span>
        <span>Referenced: <span class="num" id="ref-count">-</span></span>
    </div>
    <button id="open-btn">Open Formula Browser</button>
    <button id="clear-cache-btn" style="margin-top:6px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);">Clear Cache</button>
    <div class="hint">
        Click the button above to browse all labeled formulas in a separate tab with search, copy, and drag support.
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('open-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openBrowser' });
        });
        document.getElementById('clear-cache-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'clearCache' });
        });
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'updateCount') {
                document.getElementById('total-count').textContent = msg.total;
                document.getElementById('ref-count').textContent = msg.referenced;
            }
        });
    </script>
</body>
</html>`;
}

/**
 * 浏览器 Tab HTML — 完整功能：搜索 + 公式列表 + 拖放。
 * @param {string} cspSource
 * @returns {string}
 */
function getBrowserHtml(cspSource) {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data: blob:; font-src data:">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 12px;
        }
        .search-bar {
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
            z-index: 10;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .search-bar input {
            flex: 1;
            padding: 5px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: inherit;
            font-size: inherit;
        }
        .search-bar input:focus { outline: 1px solid var(--vscode-focusBorder); }
        .mode-btn {
            padding: 5px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            white-space: nowrap;
        }
        .mode-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
        .formula-list { display: flex; flex-direction: column; gap: 10px; }
        .formula-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .formula-item:hover { background: var(--vscode-list-hoverBackground); }
        .formula-item.hidden { display: none; }
        .formula-item .svg-wrap {
            text-align: center;
            margin-bottom: 6px;
            overflow-x: auto;
            background-color: #ffffff;
            border: 1px solid #d0d0d0;
            border-radius: 4px;
            padding: 10px;
            color: #000000;
        }
        .formula-item .svg-wrap svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
        .formula-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--vscode-descriptionForeground); }
        .formula-meta .label { font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
        .formula-meta .line { opacity: 0.6; }
        .unref-toggle { font-size: 11px; color: var(--vscode-textLink-foreground); cursor: pointer; margin-bottom: 10px; user-select: none; }
        .empty-state { text-align: center; color: var(--vscode-descriptionForeground); padding: 48px 8px; }
        .count-info { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    </style>
</head>
<body>
    <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search formulas..." />
        <button class="mode-btn active" data-mode="both">Both</button>
        <button class="mode-btn" data-mode="label">Label</button>
        <button class="mode-btn" data-mode="content">Content</button>
    </div>
    <div class="unref-toggle" id="unref-toggle"></div>
    <div class="count-info" id="count-info"></div>
    <div class="formula-list" id="formula-list"></div>
    <div class="empty-state" id="empty-state">No labeled formulas found</div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        vscode.postMessage({ type: 'ready' });
        let currentFormulas = [];
        let searchMode = 'both';
        let showUnreferenced = true;

        const searchInput = document.getElementById('search-input');
        const formulaList = document.getElementById('formula-list');
        const emptyState = document.getElementById('empty-state');
        const unrefToggle = document.getElementById('unref-toggle');
        const countInfo = document.getElementById('count-info');

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                searchMode = btn.dataset.mode;
                filterFormulas();
            });
        });
        searchInput.addEventListener('input', filterFormulas);

        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.type) {
                case 'updateFormulas':
                    currentFormulas = msg.formulas || [];
                    render();
                    break;
                case 'clear':
                    currentFormulas = [];
                    render();
                    break;
            }
        });

        function render() {
            if (currentFormulas.length === 0) {
                emptyState.style.display = 'block';
                formulaList.innerHTML = '';
                unrefToggle.style.display = 'none';
                countInfo.style.display = 'none';
                return;
            }
            emptyState.style.display = 'none';
            const refCount = currentFormulas.filter(f => f.referenced).length;
            const unrefCount = currentFormulas.length - refCount;
            countInfo.textContent = currentFormulas.length + ' formulas (' + refCount + ' referenced, ' + unrefCount + ' unreferenced)';
            countInfo.style.display = 'block';
            if (unrefCount > 0) {
                unrefToggle.style.display = 'block';
                unrefToggle.textContent = showUnreferenced ? '▼ Unreferenced (' + unrefCount + ')' : '▶ Unreferenced (' + unrefCount + ')';
            } else { unrefToggle.style.display = 'none'; }
            filterFormulas();
        }
        unrefToggle.addEventListener('click', () => { showUnreferenced = !showUnreferenced; render(); });

        function filterFormulas() {
            const query = searchInput.value.toLowerCase().trim();
            formulaList.innerHTML = '';
            let visible = 0;
            currentFormulas.forEach(f => {
                if (!f.referenced && !showUnreferenced) return;
                const matchesSearch = query === '' || matchFormula(f, query);
                if (query !== '' && !f.referenced) return;
                const el = createFormulaElement(f, query !== '' && !matchesSearch);
                formulaList.appendChild(el);
                if (query === '' || matchesSearch) visible++;
            });
            if (visible === 0 && query !== '') {
                formulaList.innerHTML = '<div class="empty-state">No matching formulas</div>';
            }
        }

        function matchFormula(f, query) {
            switch (searchMode) {
                case 'label': return f.label.toLowerCase().includes(query);
                case 'content': return stripTex(f.body).toLowerCase().includes(query);
                default: return f.label.toLowerCase().includes(query) || stripTex(f.body).toLowerCase().includes(query);
            }
        }
        function stripTex(body) {
            return body.replace(/\\\\\\w+/g,'').replace(/\\\\begin\\{[^}]*\\}/g,'').replace(/\\\\end\\{[^}]*\\}/g,'').replace(/\\\\label\\{[^}]*\\}/g,'').replace(/[{}&_^$]/g,'').replace(/\\\\[a-zA-Z]+/g,'').replace(/\\s+/g,' ').trim();
        }
        function createFormulaElement(f, hidden) {
            const div = document.createElement('div');
            div.className = 'formula-item' + (f.referenced ? '' : ' unreferenced') + (hidden ? ' hidden' : '');
            div.draggable = true;
            div.title = 'Click to copy label, drag to insert';
            let svgHtml = '';
            if (f.svg && f.svg.length > 50) {
                svgHtml = '<div class="svg-wrap">' + injectWhiteBackground(f.svg) + '</div>';
            } else if (f.svg) {
                svgHtml = '<div class="svg-wrap" style="color:red;padding:8px;">SVG too short</div>';
            } else {
                svgHtml = '<div class="svg-wrap" style="color:var(--vscode-descriptionForeground);padding:12px;">No SVG data</div>';
            }
            div.innerHTML = svgHtml + '<div class="formula-meta"><span class="label">' + escapeHtml(f.label) + '</span><span class="line">L' + f.line + ' | ' + escapeHtml(f.envType) + '</span></div>';
            div.addEventListener('click', () => { vscode.postMessage({ type: 'copyLabel', label: f.label }); });
            div.addEventListener('dblclick', () => { vscode.postMessage({ type: 'gotoLine', line: f.line }); });
            div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', f.label); e.dataTransfer.effectAllowed = 'copy'; });
            return div;
        }
        function injectWhiteBackground(svg) {
            const vbMatch = svg.match(/viewBox=["']([^"']+)["']/);
            if (!vbMatch) return svg;
            const parts = vbMatch[1].trim().split(/\\s+/);
            if (parts.length !== 4) return svg;
            const [vx,vy,vw,vh] = parts;
            // 找 <svg ...> 标签的闭合 >，而非 XML 声明的 >
            const svgTagStart = svg.indexOf('<svg');
            if (svgTagStart === -1) return svg;
            const firstClose = svg.indexOf('>', svgTagStart);
            if (firstClose === -1) return svg;
            const inset = '<rect x="'+vx+'" y="'+vy+'" width="'+vw+'" height="'+vh+'" fill="#ffffff"/>';
            svg = svg.slice(0, firstClose+1) + inset + svg.slice(firstClose+1);
            // 确保文字颜色为黑色（SVG 原生 fill 属性）
            svg = svg.replace(/<text /g, '<text fill="#000" ');
            svg = svg.replace(/<tspan /g, '<tspan fill="#000" ');
            return svg;
        }
        function escapeHtml(text) {
            const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
            return text.replace(/[&<>"']/g, c => map[c]);
        }
    </script>
</body>
</html>`;
}

/**
 * 处理来自浏览器 Tab 的消息。
 * @param {*} message
 */
function handlePanelMessage(message) {
    switch (message.type) {
        case 'copyLabel':
            vscode.env.clipboard.writeText(message.label);
            vscode.window.showInformationMessage('Copied: ' + message.label);
            break;
        case 'gotoLine':
            gotoLine(message.line);
            break;
    }
}

function gotoLine(line) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const pos = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

module.exports = { FormulaPanelProvider, getBrowserHtml, handlePanelMessage };
