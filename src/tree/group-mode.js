/**
 * 原生 TreeView：分类方式选择。
 * 根节点 "Group by" 可展开/收起（展开状态由 VS Code 原生记忆，不会自动收回），
 * 子节点为各分类方式，点击即切换，当前方式带 ✓ 图标。
 */

const vscode = require('vscode');

const GROUP_MODES = [
    { id: 'section', label: 'Section' },
    { id: 'subsection', label: 'Subsection' },
    { id: 'type', label: 'Type' }
];

class GroupModeTreeProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._emitter.event;
        /** @type {string} 当前分类方式 */
        this.mode = 'section';
    }

    /**
     * 更新当前分类方式并刷新树（移动 ✓ 标记）。
     * @param {string} mode
     */
    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this._emitter.fire();
    }

    /**
     * @param {{kind: string, id?: string, label?: string}} element
     * @returns {vscode.TreeItem}
     */
    getTreeItem(element) {
        if (element.kind === 'root') {
            const item = new vscode.TreeItem('Group by', vscode.TreeItemCollapsibleState.Expanded);
            const current = GROUP_MODES.find(m => m.id === this.mode);
            item.description = current ? current.label : '';
            item.iconPath = new vscode.ThemeIcon('list-tree');
            return item;
        }
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.command = {
            command: 'latex-helper.setGroupMode',
            title: 'Set Group Mode',
            arguments: [element.id]
        };
        if (element.id === this.mode) {
            item.iconPath = new vscode.ThemeIcon('check');
        }
        return item;
    }

    /**
     * @param {{kind: string} | undefined} element
     */
    getChildren(element) {
        if (!element) {
            return [{ kind: 'root' }];
        }
        if (element.kind === 'root') {
            return GROUP_MODES.map(m => ({ kind: 'option', id: m.id, label: m.label }));
        }
        return [];
    }
}

module.exports = { GroupModeTreeProvider };
