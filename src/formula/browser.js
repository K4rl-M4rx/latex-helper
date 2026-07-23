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
                        formulas: this._pendingFormulas
                    });
                }
                // 重放缓存的 pending 消息
                for (const msg of this._pendingMessages) {
                    this.panel.webview.postMessage(msg);
                }
                this._pendingMessages = [];
                readySent = true;
            } else if (message.type === 'refreshFormulas') {
                if (this._onRefresh) {
                    this._onRefresh();
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
     * 推送公式数据（如果 Tab 已打开）。
     * @param {Array} formulas
     */
    update(formulas) {
        this._pendingFormulas = formulas;
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'updateFormulas',
                formulas
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
