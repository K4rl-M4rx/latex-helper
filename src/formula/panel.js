/**
 * WebviewView Provider：侧边栏公式面板 UI。
 * 负责 WebView 生命周期管理、消息路由。
 */

const vscode = require('vscode');

class FormulaPanelProvider {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        /** @type {vscode.WebviewView | null} */
        this.view = null;
    }

    /**
     * @param {vscode.WebviewView} webviewView
     * @param {vscode.WebviewViewResolveContext} _resolveContext
     * @param {vscode.CancellationToken} _token
     */
    resolveWebviewView(webviewView, _resolveContext, _token) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * 更新面板中的公式列表。
     * @param {Array<{label: string, svg: string, line: number, referenced: boolean, envType: string}>} formulas
     */
    update(formulas) {
        if (this.view) {
            this.view.webview.postMessage({
                type: 'updateFormulas',
                formulas
            });
            this.view.show?.(true);
        }
    }

    /**
     * 清空面板。
     */
    clear() {
        if (this.view) {
            this.view.webview.postMessage({ type: 'clear' });
        }
    }

    /** @param {*} message */
    _handleMessage(message) {
        switch (message.type) {
            case 'copyLabel':
                vscode.env.clipboard.writeText(message.label);
                vscode.window.showInformationMessage(`Copied: ${message.label}`);
                break;
            case 'gotoLine':
                this._gotoLine(message.line);
                break;
        }
    }

    /**
     * @param {number} line
     */
    _gotoLine(line) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
    }

    /**
     * @param {vscode.Webview} webview
     * @returns {string}
     */
    _getHtml(webview) {
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src data:">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 8px;
        }
        .search-bar {
            display: flex;
            gap: 4px;
            margin-bottom: 8px;
            position: sticky;
            top: 0;
            background: var(--vscode-sideBar-background);
            z-index: 10;
        }
        .search-bar input {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: inherit;
            font-size: inherit;
        }
        .search-bar input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .mode-btn {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            white-space: nowrap;
        }
        .mode-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        .formula-list { display: flex; flex-direction: column; gap: 8px; }
        .formula-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 8px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .formula-item:hover { background: var(--vscode-list-hoverBackground); }
        .formula-item.unreferenced { opacity: 0.45; }
        .formula-item.hidden { display: none; }
        .formula-item .svg-wrap {
            text-align: center;
            margin-bottom: 4px;
            overflow-x: auto;
            background-color: #ffffff;
            border: 1px solid #d0d0d0;
            border-radius: 4px;
            padding: 8px;
        }
        .formula-item .svg-wrap svg {
            display: block;
            max-width: 100%;
            height: auto;
            margin: 0 auto;
        }
        .formula-meta {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .formula-meta .label { font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
        .formula-meta .line { opacity: 0.6; }
        .unref-toggle {
            font-size: 11px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            margin-bottom: 8px;
            user-select: none;
        }
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            padding: 24px 8px;
        }
    </style>
</head>
<body>
    <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search formulas..." />
        <button class="mode-btn active" data-mode="both" id="mode-both">Both</button>
        <button class="mode-btn" data-mode="label" id="mode-label">Label</button>
        <button class="mode-btn" data-mode="content" id="mode-content">Content</button>
    </div>
    <div class="unref-toggle" id="unref-toggle"></div>
    <div class="formula-list" id="formula-list"></div>
    <div class="empty-state" id="empty-state">No labeled formulas found</div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let currentFormulas = [];
        let searchMode = 'both';
        let showUnreferenced = true;

        const searchInput = document.getElementById('search-input');
        const formulaList = document.getElementById('formula-list');
        const emptyState = document.getElementById('empty-state');
        const unrefToggle = document.getElementById('unref-toggle');

        // Search mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                searchMode = btn.dataset.mode;
                filterFormulas();
            });
        });

        searchInput.addEventListener('input', filterFormulas);

        // Handle messages from extension
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
                return;
            }
            emptyState.style.display = 'none';

            const refCount = currentFormulas.filter(f => f.referenced).length;
            const unrefCount = currentFormulas.length - refCount;
            if (unrefCount > 0) {
                unrefToggle.style.display = 'block';
                unrefToggle.textContent = showUnreferenced
                    ? '▼ Unreferenced formulas (' + unrefCount + ')'
                    : '▶ Unreferenced formulas (' + unrefCount + ')';
            } else {
                unrefToggle.style.display = 'none';
            }

            filterFormulas();
        }

        unrefToggle.addEventListener('click', () => {
            showUnreferenced = !showUnreferenced;
            render();
        });

        function filterFormulas() {
            const query = searchInput.value.toLowerCase().trim();

            formulaList.innerHTML = '';

            let visible = 0;
            currentFormulas.forEach(f => {
                if (!f.referenced && !showUnreferenced) return;

                const matchesSearch = query === '' || matchFormula(f, query);
                if (query !== '' && !f.referenced) {
                    // Unreferenced formulas excluded from search
                    if (matchesSearch) {
                        // Still hidden from search results
                    }
                    return;
                }

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
                case 'both':
                default:
                    return f.label.toLowerCase().includes(query)
                        || stripTex(f.body).toLowerCase().includes(query);
            }
        }

        function stripTex(body) {
            return body.replace(/\\\\\w+/g, '')
                .replace(/\\begin\{[^}]*\}/g, '')
                .replace(/\\end\{[^}]*\}/g, '')
                .replace(/\\label\{[^}]*\}/g, '')
                .replace(/[{}&_^$]/g, '')
                .replace(/\\[a-zA-Z]+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function createFormulaElement(f, hidden) {
            const div = document.createElement('div');
            div.className = 'formula-item' +
                (f.referenced ? '' : ' unreferenced') +
                (hidden ? ' hidden' : '');
            div.draggable = true;
            div.title = 'Click to copy label, drag to insert';

            // dvisvgm --no-fonts 生成的是自包含路径化 SVG
            // 保留原始 width/height，只在内部注入白色背景 rect
            let svgWrapHtml = '';
            if (f.svg && f.svg.length > 50) {
                const fixedSvg = injectWhiteBackground(f.svg);
                svgWrapHtml = '<div class="svg-wrap">' + fixedSvg + '</div>';
            } else if (f.svg) {
                svgWrapHtml = '<div class="svg-wrap" style="color:red;padding:8px;">SVG too short</div>';
            } else {
                svgWrapHtml = '<div class="svg-wrap" style="color:var(--vscode-descriptionForeground);padding:12px;">No SVG data</div>';
            }

            div.innerHTML = svgWrapHtml +
                '<div class="formula-meta">' +
                    '<span class="label">' + escapeHtml(f.label) + '</span>' +
                    '<span class="line">L' + f.line + ' | ' + escapeHtml(f.envType) + '</span>' +
                '</div>';

            div.addEventListener('click', () => {
                vscode.postMessage({ type: 'copyLabel', label: f.label });
            });

            div.addEventListener('dblclick', () => {
                vscode.postMessage({ type: 'gotoLine', line: f.line });
            });

            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', f.label);
                e.dataTransfer.effectAllowed = 'copy';
            });

            return div;
        }

        /**
         * 在 SVG 内部第一个子元素前插入白色背景 rect。
         */
        function injectWhiteBackground(svg) {
            const vbMatch = svg.match(/viewBox=["']([^"']+)["']/);
            if (!vbMatch) return svg;

            const parts = vbMatch[1].trim().split(/\s+/);
            if (parts.length !== 4) return svg;

            const [vx, vy, vw, vh] = parts;
            const rect = '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="#ffffff"/>';

            const firstClose = svg.indexOf('>');
            if (firstClose === -1) return svg;
            return svg.slice(0, firstClose + 1) + rect + svg.slice(firstClose + 1);
        }

        function escapeHtml(text) {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return text.replace(/[&<>"']/g, c => map[c]);
        }
    </script>
</body>
</html>`;
    }
}

/** @returns {string} */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

module.exports = { FormulaPanelProvider };
