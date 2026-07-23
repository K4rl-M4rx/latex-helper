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

        // 等待 WebView 脚本加载完成（发送 'ready' 消息）后再推送数据
        const readyListener = this.panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'ready') {
                readyListener.dispose();
                if (this._pendingFormulas) {
                    this.panel.webview.postMessage({
                        type: 'updateFormulas',
                        formulas: this._pendingFormulas
                    });
                }
            } else {
                handlePanelMessage(message);
            }
        });

        this.context.subscriptions.push(readyListener);

        this.panel.onDidDispose(() => {
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
}

module.exports = { FormulaBrowser };
