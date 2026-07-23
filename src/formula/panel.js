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
        /** @type {((onlyRef: boolean) => void) | null} */
        this._onToggleOnlyRef = null;
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
                    case 'toggleOnlyRef':
                        if (this._onToggleOnlyRef) {
                            this._onToggleOnlyRef(message.value);
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
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 10px;
            font-size: 12px;
            cursor: pointer;
        }
        .checkbox-row input { cursor: pointer; }
    </style>
</head>
<body>
    <div class="count-row">
        <span>Formulas: <span class="num" id="total-count">-</span></span>
        <span>Referenced: <span class="num" id="ref-count">-</span></span>
    </div>
    <button id="open-btn">Open Formula Browser</button>
    <button id="clear-cache-btn" style="margin-top:6px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);">Clear Cache</button>
    <label class="checkbox-row">
        <input type="checkbox" id="only-ref-check" checked />
        Only referenced formulas
    </label>
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
        document.getElementById('only-ref-check').addEventListener('change', (e) => {
            vscode.postMessage({ type: 'toggleOnlyRef', value: e.target.checked });
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
        .formula-meta .line .sec-info { opacity: 0.5; font-style: italic; }
        .unref-toggle { font-size: 11px; color: var(--vscode-textLink-foreground); cursor: pointer; margin-bottom: 10px; user-select: none; display: flex; align-items: center; gap: 4px; }
        .section-group { margin-bottom: 6px; }
        .section-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            background: var(--vscode-sideBarSectionHeader-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            user-select: none;
        }
        .section-header:hover { background: var(--vscode-list-hoverBackground); }
        .section-header .arrow, .unref-toggle .arrow {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            flex-shrink: 0;
            color: var(--vscode-icon-foreground, var(--vscode-foreground));
            transition: transform 0.12s ease-in-out;
        }
        .section-header .arrow svg, .unref-toggle .arrow svg { width: 16px; height: 16px; display: block; }
        .section-header .arrow.expanded, .unref-toggle .arrow.expanded { transform: rotate(90deg); }
        .section-header .section-title { flex: 1; }
        .section-header.subsection-header { font-weight: 400; font-size: 11px; background: transparent; border: none; }
        .section-header .section-count { font-weight: normal; color: var(--vscode-descriptionForeground); font-size: 11px; }
        .section-body { padding-top: 4px; display: flex; flex-direction: column; gap: 6px; }
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
        <button id="refresh-btn" style="padding:5px 12px;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;border-radius:2px;font-size:11px;white-space:nowrap;">Refresh</button>
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
        let groupMode = 'section';
        // 最近使用的公式 label（最多 5 个，最新在前），由扩展端持久化并推送
        let recentLabels = [];
        const collapsedGroups = {};
        // 切换分类方式后，所有分组默认收缩；用户手动点击后以其选择为准
        let defaultCollapsed = false;
        // VS Code 树视图同款 chevron（参考 LaTeX Workshop 大纲箭头）：收起朝右，展开旋转 90° 朝下
        const CHEVRON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        function arrowHtml(collapsed) {
            return '<span class="arrow' + (collapsed ? '' : ' expanded') + '">' + CHEVRON_SVG + '</span>';
        }

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
        document.getElementById('refresh-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshFormulas' });
        });
        searchInput.addEventListener('input', filterFormulas);

        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.type) {
                case 'updateFormulas':
                    currentFormulas = msg.formulas || [];
                    render();
                    break;
                case 'recentFormulas':
                    recentLabels = msg.labels || [];
                    render();
                    break;
                case 'clear':
                    currentFormulas = [];
                    render();
                    break;
                case 'refreshStatus':
                    const btn = document.getElementById('refresh-btn');
                    if (msg.refreshing) {
                        btn.textContent = msg.message || 'Compiling...';
                        btn.disabled = true;
                        btn.style.opacity = '0.6';
                    } else {
                        btn.textContent = 'Refresh';
                        btn.disabled = false;
                        btn.style.opacity = '1';
                        setTimeout(() => { btn.textContent = 'Refresh'; }, 1500);
                    }
                    break;
                case 'groupMode': {
                    const newGroupMode = msg.value === 'subsection' ? 'subsection' : 'section';
                    if (newGroupMode !== groupMode) {
                        groupMode = newGroupMode;
                        // 仅在分类方式真正变化时重置：全部分组默认收缩
                        // （每次刷新后 extension 会重发相同值，不能因此清掉用户手动的展开/收缩）
                        for (const k of Object.keys(collapsedGroups)) delete collapsedGroups[k];
                        defaultCollapsed = true;
                    }
                    render();
                    break;
                }
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
            countInfo.textContent = currentFormulas.length + ' formulas (' + refCount + ' referenced, ' + unrefCount + ' unreferenced) | group: ' + groupMode;
            countInfo.style.display = 'block';
            if (unrefCount > 0) {
                unrefToggle.style.display = 'block';
                unrefToggle.innerHTML = arrowHtml(!showUnreferenced) + '<span>Unreferenced (' + unrefCount + ')</span>';
            } else { unrefToggle.style.display = 'none'; }
            filterFormulas();
        }
        unrefToggle.addEventListener('click', () => { showUnreferenced = !showUnreferenced; render(); });

        function filterFormulas() {
            const query = searchInput.value.toLowerCase().trim();
            formulaList.innerHTML = '';
            appendRecentGroup(query);
            if (groupMode === 'subsection') {
                groupBySubsection(query);
            } else {
                groupBySectionOnly(query);
            }
        }

        // 最近使用分组：固定在列表顶部，公式仍同时保留在原有分类中
        function appendRecentGroup(query) {
            if (!recentLabels || recentLabels.length === 0) return;
            const items = [];
            for (const label of recentLabels) {
                const f = currentFormulas.find(x => x.label === label);
                if (!f) continue;
                if (query !== '' && !matchFormula(f, query)) continue;
                items.push(f);
            }
            if (items.length === 0) return;
            formulaList.appendChild(makeCollapsible('Recently Used', items, 'recent'));
        }

        function groupBySectionOnly(query) {
            const order = buildGroupMap(query, f => f.section || 'Uncategorized');
            if (order.length === 0) { formulaList.innerHTML = '<div class="empty-state">No matching formulas</div>'; return; }
            order.forEach(([title, formulas]) => {
                formulaList.appendChild(makeCollapsible(title, formulas, 'section'));
            });
        }

        function groupBySubsection(query) {
            // 两级：section → subsection
            const secMap = {};
            const secOrder = [];
            currentFormulas.forEach(f => {
                if (!f.referenced && !showUnreferenced) return;
                if (query !== '' && !matchFormula(f, query)) return;
                const sec = f.section || 'Uncategorized';
                const sub = f.subsection || '';
                if (!secMap[sec]) { secMap[sec] = {}; secOrder.push(sec); }
                if (!secMap[sec][sub]) secMap[sec][sub] = [];
                secMap[sec][sub].push(f);
            });
            if (secOrder.length === 0) { formulaList.innerHTML = '<div class="empty-state">No matching formulas</div>'; return; }

            secOrder.forEach(sec => {
                const subMap = secMap[sec];
                const subKeys = Object.keys(subMap);
                let total = 0; subKeys.forEach(k => { total += subMap[k].length; });

                const secDiv = document.createElement('div');
                secDiv.className = 'section-group';

                const secKey = 'section:' + sec;
                const secCollapsed = (secKey in collapsedGroups) ? collapsedGroups[secKey] : defaultCollapsed;
                const secHeader = document.createElement('div');
                secHeader.className = 'section-header';
                secHeader.innerHTML = arrowHtml(secCollapsed) +
                    '<span class="section-title">' + escapeHtml(sec) + '</span>' +
                    '<span class="section-count">(' + total + ')</span>';
                secHeader.addEventListener('click', () => {
                    const cur = (secKey in collapsedGroups) ? collapsedGroups[secKey] : defaultCollapsed;
                    collapsedGroups[secKey] = !cur;
                    const body = secHeader.nextElementSibling;
                    const arrowEl = secHeader.querySelector('.arrow');
                    if (body) body.style.display = collapsedGroups[secKey] ? 'none' : '';
                    if (arrowEl) arrowEl.classList.toggle('expanded', !collapsedGroups[secKey]);
                });
                secDiv.appendChild(secHeader);

                const secBody = document.createElement('div');
                secBody.className = 'section-body';
                if (secCollapsed) secBody.style.display = 'none';

                subKeys.forEach(sub => {
                    if (sub === '') {
                        subMap[sub].forEach(f => { secBody.appendChild(createFormulaElement(f, false)); });
                    } else {
                        secBody.appendChild(makeCollapsible(sub, subMap[sub], 'subsection'));
                    }
                });
                secDiv.appendChild(secBody);
                formulaList.appendChild(secDiv);
            });
        }

        function buildGroupMap(query, keyFn) {
            const map = {};
            const order = [];
            currentFormulas.forEach(f => {
                if (!f.referenced && !showUnreferenced) return;
                if (query !== '' && !matchFormula(f, query)) return;
                const key = keyFn(f);
                if (!map[key]) { map[key] = []; order.push(key); }
                map[key].push(f);
            });
            return order.map(k => [k, map[k]]);
        }

        function makeCollapsible(title, formulas, level) {
            const key = level + ':' + title;
            const div = document.createElement('div');
            div.className = 'section-group';

            const header = document.createElement('div');
            header.className = 'section-header' + (level === 'subsection' ? ' subsection-header' : '');
            if (level === 'subsection') header.style.paddingLeft = '28px';
            const collapsed = (key in collapsedGroups) ? collapsedGroups[key] : defaultCollapsed;
            const count = Array.isArray(formulas) ? formulas.length : 0;
            header.innerHTML = arrowHtml(collapsed) +
                '<span class="section-title">' + escapeHtml(title) + '</span>' +
                '<span class="section-count">(' + count + ')</span>';
            header.addEventListener('click', () => {
                const cur = (key in collapsedGroups) ? collapsedGroups[key] : defaultCollapsed;
                collapsedGroups[key] = !cur;
                const body = header.nextElementSibling;
                const arrowEl = header.querySelector('.arrow');
                if (body) body.style.display = collapsedGroups[key] ? 'none' : '';
                if (arrowEl) arrowEl.classList.toggle('expanded', !collapsedGroups[key]);
            });
            div.appendChild(header);

            const body = document.createElement('div');
            body.className = 'section-body';
            if (collapsed) body.style.display = 'none';
            if (Array.isArray(formulas)) {
                formulas.forEach(f => { body.appendChild(createFormulaElement(f, false)); });
            }
            div.appendChild(body);
            return div;
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
            const sectionInfo = (f.section ? '§' + f.section : '') + (f.subsection ? ' › ' + f.subsection : '');
            div.innerHTML = svgHtml + '<div class="formula-meta"><span class="label">' + escapeHtml(f.label) + '</span><span class="line">L' + f.line + ' | ' + escapeHtml(f.envType) + (sectionInfo ? ' | <span class="sec-info">' + escapeHtml(sectionInfo) + '</span>' : '') + '</span></div>';
            div.addEventListener('click', () => { vscode.postMessage({ type: 'copyLabel', label: f.label }); vscode.postMessage({ type: 'formulaUsed', label: f.label }); });
            div.addEventListener('dblclick', () => { vscode.postMessage({ type: 'gotoLine', line: f.line }); });
            div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', f.label); e.dataTransfer.effectAllowed = 'copy'; vscode.postMessage({ type: 'formulaUsed', label: f.label }); });
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
