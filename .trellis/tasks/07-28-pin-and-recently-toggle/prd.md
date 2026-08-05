# PRD: 公式浏览器 Pin 功能和 Recently Used 开关

## 概述

为公式浏览器（Formula Browser）新增两个功能：
1. **Pin 置顶** — 用户可将喜欢的公式固定在列表顶部
2. **Recently Used 开关** — 用户可控制"最近使用"分组是否显示

## 需求

### R1: Pin 置顶

- 每个公式卡片上显示一个 pin 图标（图钉 📌 / 取消图钉），点击后切换置顶状态
- 浏览器 Tab 顶部工具栏（搜索栏区域）新增一个 **"📌 Pinned" 过滤按钮**
- 按下该按钮后，列表**只显示**已置顶的公式；再次按下恢复完整列表
- 过滤按钮为会话内状态（不持久化）；Pin 状态本身持久化保存（workspaceState），跨会话保留
- Pin 图标应有视觉区分：已置顶 vs 未置顶（如填充 vs 空心，或透明度变化）

### R2: Recently Used 开关

- 在侧边栏 Panel 中新增一个 checkbox / toggle："Show Recently Used"
- 默认开启（保持现有行为）
- 关闭后，浏览器中不再显示 "Recently Used" 分组
- 开关状态持久化保存（workspaceState），跨会话保留
- 最近使用的数据仍在后台记录（不影响 `_recordUsed` 逻辑），仅控制前端是否渲染

### R3: UI 一致性

- Pin 状态变化后，浏览器 UI 立即更新（无需手动刷新）
- Recently Used 开关变化后，浏览器 UI 立即更新
- 两个功能均仅在 Browser Tab（`getBrowserHtml`）中生效，侧边栏 Panel 不受影响

## 非需求

- 不改变现有的搜索/过滤逻辑
- 不改变公式数据模型（parser/compiler/cache）
- 不涉及 Pin 公式的导出/导入
- 不改变拖拽/双击/单击的行为语义

## 验收标准

1. ✅ 点击公式卡片的 pin 图标，该公式被置顶，图标变为已置顶样式
2. ✅ 再次点击已置顶公式的 pin 图标，取消置顶，图标恢复
3. ✅ 按下工具栏 "📌 Pinned" 按钮后，列表只显示已置顶公式；再次按下恢复完整列表
4. ✅ 关闭并重新打开浏览器 Tab 后，pin 状态保持不变
5. ✅ 重启 VSCode 后，pin 状态保持不变
6. ✅ 关闭 "Show Recently Used" 后，Recently Used 分组消失
7. ✅ 重新开启 "Show Recently Used" 后，分组恢复显示（含最新的使用记录）
8. ✅ 无论开关状态如何，公式使用记录仍在后台正常追踪
