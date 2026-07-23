# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地 VSCode 扩展，提供自定义 LaTeX 辅助功能。不作为公开扩展发布，仅供个人使用。

## 技术栈

- 纯 JavaScript（CommonJS），不使用 TypeScript
- VSCode Extension API (`vscode` 模块)
- 目标 VSCode 版本 ≥ 1.85.0

## 开发和调试

- 在 VSCode 中按 `F5` 启动扩展开发主机（Extension Development Host），加载当前扩展进行调试
- 扩展入口为 [src/extension.js](src/extension.js)，`activate()` 函数在扩展激活时被调用
- 所有用户可见的命令、菜单项、快捷键等通过 [package.json](package.json) 的 `contributes` 字段注册
- 不允许硬编码 `package.json` 中的内容到 `extension.js` 中，如命令 ID、配置项等

## 代码架构

- `src/extension.js` — 扩展入口，`activate(context)` 中完成所有注册逻辑
- 按功能拆分为独立模块，放在 `src/` 下，由 `extension.js` 引入
- `package.json` 的 `activationEvents` 按需填写，避免启动时即激活（目前为空，仅在命令触发或事件匹配时激活）

## 项目约定

- 用户自行决定何时通过 `F5` 测试扩展，不在 CLI 中执行 `code` 命令
- 由于扩展仅在本地使用，不需要考虑跨平台兼容性问题（macOS only）
- 所有对 `package.json` 的修改（特别是 `contributes.commands`、`activationEvents`）必须在修改 `extension.js` 之前完成，确保注册一致
