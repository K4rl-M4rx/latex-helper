/**
 * Snippet 配置管理：读取、归一化、编译 prefix 正则。
 * 默认值规则 1:1 对齐 latex-utilities 的 processSnippets()。
 */

const vscode = require('vscode');

/** 配置缓存有效期（毫秒），与原插件 MAX_CONFIG_AGE 一致 */
const MAX_CONFIG_AGE = 5000;

/** latex-utilities SPECIAL_ACTION body → 动作类型标记 */
const SPECIAL_ACTIONS = {
    SPECIAL_ACTION_FRACTION: 'fraction',
    SPECIAL_ACTION_BREAK: 'break',
    SPECIAL_ACTION_SYMPY: 'sympy'
};

/**
 * 转义正则元字符（用于把字面触发词编译进正则）。
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析 SPECIAL_ACTION_SYMPY 的 prefix，期望形态：open ?(.+?) ?close ?$
 * （open/close 为字面触发词，中间一个捕获组承载表达式）。
 * 提取模板交互所需的开头词（行尾输入它 → 插入 "open $1" 模板）与
 * 收尾词（输入它 → 完整块匹配 → 求值）。无法提取（如无捕获组的
 * 简单正则）返回 null，回退"即输即算"旧行为。
 *
 * 注意：prefix 是正则源文本，" ?" 在源文本里是"空格+问号"两个字符
 * （编译后为"可选空格"量词），解析时必须按字面匹配（\?），
 * 触发词用 \S+? 提取以避免吞掉两侧的可选空格。
 * @param {string} prefix
 * @returns {{ open: string, close: string } | null}
 */
function parseSympyPrefix(prefix) {
    // 捕获组前/后的可选空格量词可能是 " ?"（空格+问号）或 " "（单空格），
    // 用 \?? 兼容两者；触发词用 \S+? 提取避免吞掉空格。
    // close 必须是字面词（无 $ ? ( ) 等正则构造），否则视为不可解析回退旧行为
    const m = /^(\S+?)(?: \??(?:\(\.\+\?\)|\(\.\*?\?\)))(?: \??)?(\S+?)(?: \??)?\$?$/.exec(prefix);
    if (!m || !m[1] || !m[2]) return null;
    const close = m[2];
    if (!/^[A-Za-z0-9\\]+$/.test(close)) return null;
    return { open: m[1], close };
}

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
 * SPECIAL_ACTION 条目不进入补全列表（不显示字面 SPECIAL_ACTION_* 文本）。
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
 * @property {'fraction'|'break'|'sympy'|undefined} specialAction SPECIAL_ACTION 动作类型
 * @property {string|null} sympyOpen SYMPY 模板交互的开头触发词（parseSympyPrefix 提取，失败为 null）
 * @property {RegExp|null} sympyOpenRegex 行尾匹配开头词的正则（"open ?$"）
 */

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

        // latex-utilities 特殊动作：FRACTION / BREAK / SYMPY 均已实现（见 live-watcher），
        // 保留并标记动作类型；原插件之外的未知 SPECIAL_ACTION_* 仍跳过
        const specialAction = SPECIAL_ACTIONS[body];
        if (!specialAction && body.startsWith('SPECIAL_ACTION')) continue;

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

        // SYMPY 模板交互：prefix 形如 "open ?(.+?) ?close ?$" 时提取触发词，
        // live-watcher 据此在行尾输入 open 时插入 "open $1" 模板（tabstop 输表达式），
        // 输入 close 后完整块匹配再求值；提取失败保持旧"即输即算"行为
        let sympyOpen = null;
        let sympyOpenRegex = null;
        if (specialAction === 'sympy') {
            const parsed = parseSympyPrefix(prefix);
            if (parsed) {
                sympyOpen = parsed.open;
                sympyOpenRegex = new RegExp(escapeRegex(parsed.open) + ' ?$');
            }
        }

        result.push({
            prefix,
            prefixRegex,
            body,
            mode,
            description,
            triggerWhenComplete,
            priority,
            noPlaceholders,
            specialAction,
            sympyOpen,
            sympyOpenRegex
        });
    }

    // 高优先级在前
    result.sort((a, b) => b.priority - a.priority);
    return result;
}

module.exports = {
    getSnippets,
    getLiveSnippets,
    getCompletionSnippets,
    normalizeSnippets,
    parseSympyPrefix
};
