/**
 * Snippet 配置管理：读取、归一化、编译 prefix 正则。
 * 默认值规则 1:1 对齐 latex-utilities 的 processSnippets()。
 */

const vscode = require('vscode');

/** 配置缓存有效期（毫秒），与原插件 MAX_CONFIG_AGE 一致 */
const MAX_CONFIG_AGE = 5000;

/** @type {{ snippets: Array<NormalizedSnippet>, raw: string, age: number } | null} */
let cache = null;

/**
 * 读取并归一化 snippets（带 5 秒缓存，避免每次击键重新解析配置）。
 * @returns {Array<NormalizedSnippet>}
 */
function getSnippets() {
    const raw = vscode.workspace.getConfiguration('latex-helper').get('snippets', []);
    const rawJson = JSON.stringify(raw);
    const now = Date.now();

    if (cache && cache.raw === rawJson && now - cache.age < MAX_CONFIG_AGE) {
        return cache.snippets;
    }

    const snippets = normalizeSnippets(raw);
    cache = { snippets, raw: rawJson, age: now };
    return snippets;
}

/**
 * 返回仅用于实时自动展开的 snippets（triggerWhenComplete === true）。
 * @returns {Array<NormalizedSnippet>}
 */
function getLiveSnippets() {
    return getSnippets().filter(s => s.triggerWhenComplete);
}

/**
 * 返回用于标准补全列表的 snippets（triggerWhenComplete !== true）。
 * SPECIAL_ACTION 条目不进入补全列表（body 不是可插入文本）。
 * @returns {Array<NormalizedSnippet>}
 */
function getCompletionSnippets() {
    return getSnippets().filter(s => !s.triggerWhenComplete && !s.specialAction);
}

/**
 * @typedef {Object} NormalizedSnippet
 * @property {string} prefix
 * @property {RegExp} prefixRegex
 * @property {string} body
 * @property {'maths'|'text'|'any'} mode
 * @property {string} description
 * @property {boolean} triggerWhenComplete
 * @property {number} priority
 * @property {boolean} noPlaceholders
 * @property {'BREAK'|'FRACTION'|'SYMPY'|null} specialAction
 */

/** latex-utilities 遗留的特殊动作（body 形如 SPECIAL_ACTION_XXX） */
const SPECIAL_ACTIONS = ['BREAK', 'FRACTION', 'SYMPY'];

/**
 * 归一化规则（对齐原插件 processSnippets）：
 * - body 无 $$N 且 noPlaceholders 未定义 → noPlaceholders = true，且 priority 默认 -0.1
 * - priority 默认 0
 * - triggerWhenComplete 默认 false
 * - mode 默认 'any'
 * @param {Array} raw
 * @returns {Array<NormalizedSnippet>}
 */
function normalizeSnippets(raw) {
    if (!Array.isArray(raw)) return [];

    /** @type {Array<NormalizedSnippet>} */
    const result = [];

    for (const s of raw) {
        if (!s || typeof s !== 'object') continue;

        const body = typeof s.body === 'string' ? s.body : '';

        // latex-utilities 特殊动作：标记类型，body 原样保留
        let specialAction = null;
        const saMatch = /^SPECIAL_ACTION_(\w+)$/.exec(body);
        if (saMatch && SPECIAL_ACTIONS.includes(saMatch[1])) {
            specialAction = saMatch[1];
        }

        const prefix = typeof s.prefix === 'string' ? s.prefix : '';
        let prefixRegex;
        try {
            prefixRegex = new RegExp(prefix);
        } catch {
            // 非法正则，跳过
            continue;
        }

        // noPlaceholders / priority 的默认值规则与原插件一致
        let noPlaceholders = s.noPlaceholders;
        let priority = typeof s.priority === 'number' ? s.priority : undefined;
        if (!/\$\$(?:\d|\{\d)/.test(body) && noPlaceholders === undefined) {
            noPlaceholders = true;
            if (priority === undefined) priority = -0.1;
        }
        if (priority === undefined) priority = 0;
        if (noPlaceholders === undefined) noPlaceholders = false;

        const triggerWhenComplete = s.triggerWhenComplete === true;

        let mode = s.mode;
        if (mode === undefined || mode === null) {
            mode = 'any';
        } else if (!/^(maths|text|any)$/.test(mode)) {
            mode = 'any';
        }

        const description = typeof s.description === 'string' ? s.description : '';

        result.push({
            prefix,
            prefixRegex,
            body,
            mode,
            description,
            triggerWhenComplete,
            priority,
            noPlaceholders,
            specialAction
        });
    }

    // 高优先级在前
    result.sort((a, b) => b.priority - a.priority);
    return result;
}

module.exports = { getSnippets, getLiveSnippets, getCompletionSnippets, normalizeSnippets };
