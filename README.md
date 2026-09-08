# pi-choose-plan

方案选择扩展（简洁版）。当 agent 面对多个可行方案时，不再用纯文本罗列，而是弹出可键盘导航的编号选择框让用户拍板，选完把完整方案回显到聊天记录，便于随时引用和切换。

交互与 Pi 的模型选择器一致：方向键 / jk 上下移动、回车确认、Esc 取消。

---

## 功能 / 特性

- 注入强约束规则：只要存在多个合理可行的路径（不依赖提示词里是否出现“方案/plan”等词），就调用 `choose_plan` 让用户选择，而不是列成文本或擅自猜测。
- 注册 `choose_plan` 工具：弹出一个白色编号选择框（ABC / 123 编号），选项文字统一白色，仅选中项用 accent 箭头标记。
- 描述完整显示、不截断；编号顺序与模型返回一致。
- 方案 A（回显）：选中后把完整方案列表（编号 + 标签 + 描述）写进聊天记录，选完仍可见、可引用，改主意直接说“换成 B/C”即可，不用重问 LLM。
- 额外选项：“都不选”选中后以 `terminate` 优雅结束本轮会话（不再调用 `ctx.abort()`，避免 "This operation was aborted" 报错）。

---

## 工作原理

两条路径：

1. `before_agent_start`：向系统提示注入精简强约束规则。规则按**语义场景**触发而非关键词匹配，起到兜底作用——即便用户没说“方案”这类词，只要客观上有多条合理路径 / 决策岔口 / 即将用文本罗列备选，也会触发：

   ```
   [Rule] Use choose_plan whenever more than one reasonable way to proceed exists — NOT
   only when options are called "plans"/"方案". Signals: multiple viable approaches/reads
   of the request, an unclear best path, or about to list alternatives as text -> call
   choose_plan instead. When in doubt, prefer choose_plan over guessing.
   ```

2. `registerTool`：注册 `choose_plan` 工具（内置白色 ABC 编号选择框）

- 非 TUI 或空方案时，工具直接返回无法选择的提示，不影响正常流程。
- 用户取消 / 选“都不选”时，以 `terminate` 优雅结束本轮会话，避免 `abort` 报错。

---

## 安装 / Installation

### 方式一：安装到单个项目（推荐先这样试用）

把 `pi-choose-plan.ts` 复制到目标项目的：

```
你的项目/.pi/extensions/        （没有这个目录就自己建）
```

然后在 pi 里执行 `/reload`（或重启 pi）即可。

注意：项目级扩展要求**项目已被信任**：首次在项目目录启动 pi 时会询问 "Trust project?"，选择信任后才会加载 `.pi/extensions/`。

### 方式二：全局安装（所有项目生效）

把 `pi-choose-plan.ts` 复制到：

```
~/.pi/agent/extensions/          # Windows: C:\Users\你的用户名\.pi\agent\extensions\
```

重启 pi 或 `/reload` 后，所有项目都会自动加载，且不依赖项目信任。

### 方式三：快速试用（仅本次运行，不落盘）

```bash
pi -e C:/完整路径/pi-choose-plan.ts
# 或
pi -e C:/完整路径/.pi/extensions/pi-choose-plan.ts
```

注意：`-e` 建议用**绝对路径**（相对路径在部分启动方式下解析不到）。适用于临时体验，不推荐长期使用。

### 方式四：团队分享（git 仓库 + pi 包）

仓库已包含 pi 包清单（`package.json` 的 `pi.extensions` 字段，指向 `pi-choose-plan.ts`）。推送到 git 仓库后，同事在任何项目里：

```bash
pi install git:https://github.com/oahcz-7891/pi-choose-plan.git
pi list          # 确认安装 / verify installation
```

`pi install` 安装的是 pi 包（全局生效，不依赖项目信任）；若只是单项目试用，仍可用前面的方式一 / 方式三。

---

## 使用说明

当存在多个合理可行的路径时，agent 会调用 `choose_plan`，弹出一个带编号的选择框：

- 触发不依赖提示词里是否出现“方案/plan”等词：只要请求存在多种可行解读/做法、最优路径不明确，或模型原本想用文本罗列备选，都会优先调用 `choose_plan` 让用户拍板。

- 用 `↑` / `↓` 或 `j` / `k` 移动，`Enter` 确认，`Esc` 取消。
- 选项编号为 A、B、C…… 与模型返回的方案一一对应。
- 列表末尾有一项“都不选”（None of the above），选中即以 `terminate` 结束本轮会话。
- 选中后完整方案列表会回显到聊天记录，之后可以说“换成 B”来切换，无需重问。

---

## 配色预览

TUI 里只能用纯色。`choose-plan-preview.html` 提供了多种配色样式的观感参考（蓝色、黄色、渐变蓝紫、亮青、暖橙、薄荷绿、玫红、金色等），供挑选最终主题色。

---

## 文件说明

- `pi-choose-plan.ts`：扩展主文件。
- `choose-plan-preview.html`：选择框配色预览。
- `package.json`：pi 包清单，用于 `pi install git:...` 团队分享安装。
