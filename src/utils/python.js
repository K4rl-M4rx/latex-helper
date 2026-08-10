/**
 * python 解释器路径解析（live-watcher 与 sympy calculator 共用）。
 * pipx/venv 装的 sympy 不在系统 python3 的 site-packages 里，路径必须可配置；
 * execFile 不走 shell，~ 不会展开，这里手动展开。
 */

const vscode = require('vscode');
const os = require('os');

/**
 * 读取 latex-helper.sympyPythonPath 配置并展开开头的 ~/。
 * @returns {string}
 */
function getPythonPath() {
    let pythonPath = vscode.workspace.getConfiguration('latex-helper').get('sympyPythonPath', 'python3');
    if (pythonPath.startsWith('~/')) {
        pythonPath = os.homedir() + pythonPath.slice(1);
    }
    return pythonPath;
}

module.exports = { getPythonPath };
