/**
 * WebviewPanel 版公式浏览器：在编辑器区域以独立 Tab 展示公式列表。
 * 复用 panel.js 的 getPanelHtml() 和 handlePanelMessage()。
 */

const vscode = require('vscode');
const { getBrowserHtml, handlePanelMessage } = require('./panel');

class FormulaBrowser {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        /** @type {vscode.WebviewPanel | null} */
        this.panel = null;
        /** @type {Array | null} */
        this._pendingFormulas = null;
        /** @type {Array} */
        this._pendingMessages = [];
        /** @type {(() => void) | null} */
        this._onRefresh = null;
        /** @type {((label: string) => void) | null} 定理预览懒编译请求（extension.js 接线） */
        this._onCompileTheorem = null;
        /** @type {string[]} 最近使用的公式 label（最多 5 个，最新在前），持久化到 workspaceState */
        this._recentLabels = context.workspaceState.get('latex-helper.recentFormulas', []);
        /** @type {string[]} 置顶的公式 label，持久化到 workspaceState */
        this._pinnedLabels = context.workspaceState.get('latex-helper.pinnedFormulas', []);
        /** @type {boolean} 是否在浏览器中显示 Recently Used 分组，持久化到 workspaceState */
        this._showRecent = context.workspaceState.get('latex-helper.showRecentFormulas', true);
        /** @type {string | null} 用户显式选择过的分类方式；null = 使用 webview 默认（公式 section / 定理 type） */
        this._groupMode = null;
    }

    /**
     * 切换某个公式的置顶状态，并通知 WebView 更新 Pinned 分组。
     * @param {string} label
     */
    _togglePin(label) {
        if (!label || typeof label !== 'string') return;
        if (this._pinnedLabels.includes(label)) {
            this._pinnedLabels = this._pinnedLabels.filter(l => l !== label);
        } else {
            this._pinnedLabels = [label, ...this._pinnedLabels];
        }
        this.context.workspaceState.update('latex-helper.pinnedFormulas', this._pinnedLabels);
        this.sendMessage({ type: 'pinnedFormulas', labels: this._pinnedLabels });
    }

    /**
     * 设置 Recently Used 分组的显示开关，并通知 WebView。
     * 使用记录（_recordUsed）不受开关影响，仅控制前端渲染。
     * @param {boolean} value
     */
    _setShowRecent(value) {
        this._showRecent = value === true;
        this.context.workspaceState.update('latex-helper.showRecentFormulas', this._showRecent);
        this.sendMessage({ type: 'showRecentFormulas', value: this._showRecent });
    }

    /**
     * 记录一次公式使用（复制 label 或拖拽插入），并通知 WebView 更新最近使用分组。
     * @param {string} label
     */
    _recordUsed(label) {
        if (!label || typeof label !== 'string') return;
        this._recentLabels = [label, ...this._recentLabels.filter(l => l !== label)].slice(0, 5);
        this.context.workspaceState.update('latex-helper.recentFormulas', this._recentLabels);
        this.sendMessage({ type: 'recentFormulas', labels: this._recentLabels });
    }

    /**
     * 打开（或重新显示）公式浏览器 Tab。
     */
    show() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'latex-helper.formulaBrowser',
            'Formula Browser',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.context.extensionUri]
            }
        );

        this.panel.webview.html = getBrowserHtml(this.panel.webview.cspSource);

        let readySent = false;
        const msgHandler = this.panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'ready') {
                if (!readySent && this._pendingFormulas) {
                    this.panel.webview.postMessage({
                        type: 'updateFormulas',
                        formulas: this._pendingFormulas.formulas,
                        theorems: this._pendingFormulas.theorems
                    });
                }
                // 重放缓存的 pending 消息
                for (const msg of this._pendingMessages) {
                    this.panel.webview.postMessage(msg);
                }
                this._pendingMessages = [];
                // 补发最近使用列表、置顶列表与 Recently Used 开关状态
                this.panel.webview.postMessage({ type: 'recentFormulas', labels: this._recentLabels });
                this.panel.webview.postMessage({ type: 'pinnedFormulas', labels: this._pinnedLabels });
                this.panel.webview.postMessage({ type: 'showRecentFormulas', value: this._showRecent });
                // 补发用户显式选择过的分类方式（未选择过则保持 webview 默认：公式 section / 定理 type）
                if (this._groupMode) {
                    this.panel.webview.postMessage({ type: 'groupMode', value: this._groupMode });
                }
                readySent = true;
            } else if (message.type === 'refreshFormulas') {
                if (this._onRefresh) {
                    this._onRefresh();
                }
            } else if (message.type === 'formulaUsed') {
                this._recordUsed(message.label);
            } else if (message.type === 'togglePin') {
                this._togglePin(message.label);
            } else if (message.type === 'compileTheorem') {
                if (this._onCompileTheorem) {
                    this._onCompileTheorem(message.label);
                }
            } else {
                handlePanelMessage(message);
            }
        });

        this.panel.onDidDispose(() => {
            msgHandler.dispose();
            this.panel = null;
        });
    }

    /**
     * 推送公式与定理数据（如果 Tab 已打开）。
     * @param {Array} formulas
     * @param {Array} [theorems]
     */
    update(formulas, theorems = []) {
        this._pendingFormulas = { formulas, theorems };
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'updateFormulas',
                formulas,
                theorems
            });
        }
    }

    /**
     * 清空。
     */
    clear() {
        this._pendingFormulas = null;
        if (this.panel) {
            this.panel.webview.postMessage({ type: 'clear' });
        }
    }

    /**
     * 发送任意消息到浏览器 WebView。
     * 浏览器未打开时排队；同类型的状态类消息只保留最新一条，
     * 避免排队消息无限增长、重开时回放过期状态（如旧的 "Compiling..."）。
     * @param {*} message
     */
    sendMessage(message) {
        // 缓存显式选择的分类方式，供 Tab 重开 ready 时补发
        if (message && message.type === 'groupMode') {
            this._groupMode = message.value;
        }
        if (this.panel) {
            this.panel.webview.postMessage(message);
        } else {
            if (message && typeof message.type === 'string') {
                this._pendingMessages = this._pendingMessages.filter(
                    m => !(m && m.type === message.type)
                );
            }
            this._pendingMessages.push(message);
        }
    }
}

module.exports = { FormulaBrowser };
