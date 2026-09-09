/**
 * pi-choose-plan —— 方案选择扩展（简洁版）
 *
 * 两条路径：
 *   1. before_agent_start 注入软性提示规则（choose_plan 可选：完整回复后再调用，选项仅方案名称）
 *   2. registerTool 注册 choose_plan 工具（内置白色 ABC 编号选择框）
 *
 * 方案 A（回显）：选中后把完整方案列表（编号+标签+描述）写进聊天记录，
 *   选完仍可见可引用，改主意直接说“换成 B/C”即可，不用重问 LLM。
 * 额外选项：列表末尾的“都不选”选中后以 terminate 优雅结束本轮会话（不再调用 ctx.abort()）。
 *
 * 选择框特性：
 *   - 选项文字统一白色，仅选中项用 accent 箭头标记
 *   - 编号按 ABC / 123 顺序，与模型返回一致
 *   - 描述/标签完整显示，不截断
 *
 * 使用：复制本文件到 ~/.pi/agent/extensions/ 或 .pi/extensions/
 *      或 pi -e ./pi-choose-plan.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// Advisory rule (English to match system prompt & save tokens)
// 软性提示：choose_plan 是可选工具，仅在确实有帮助时才调用；且须在完整输出消息之后再调用，
// 选项只填方案名称（label），不填描述——不改变模型原本的文本输出。
const RULE = `[Rule] choose_plan is an optional tool — call it only when it genuinely helps, 
i.e. after finishing your full reply, a real user decision still remains. Never let it 
interrupt or replace your text output: write your complete answer first, then call choose_plan 
at the end, passing plans as names only (labels), no descriptions. Labels must be plan names 
without any numbering prefix — no letters, digits, or 一二三 at the start; the picker adds letters.`;

const ChoosePlanParams = Type.Object({
	question: Type.String({ description: "Prompt/" }),
	plans: Type.Array(
		Type.Object({
			label: Type.String({ description: "Plan name" }),
			description: Type.Optional(Type.String({ description: "Short desc" })),
		}),
		{ description: "Plans" },
	),
});

interface PlanDetails {
	question: string;
	plans: string[];
	answer: string | null;
	index?: number;
	/** 用户明确选了“都不选”（拒绝了全部方案）。 */
	rejected?: boolean;
}

// ---------------------------------------------------------------------------
// 白色选项选择框：ABC / 123 编号，描述截断。
// ---------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface PlanOption {
	/** 编号前缀，如 "A" / "1"（展示时补 "."）。 */
	num: string;
	label: string;
	/** 可选的完整描述（不截断）。 */
	desc?: string;
	/** 特殊项（如“都不选”），渲染为 muted 样式。 */
	special?: boolean;
}

/**
 * 可键盘导航的白色编号选择器。
 * 用 ctx.ui.custom() 挂载：组件获得焦点后 handleInput 接收按键。
 */
class PlanSelector extends Container {
	private sel = 0;
	private list: Container;
	private theme: any;
	private items: PlanOption[];
	private onSelect: (index: number) => void;
	private onCancel: () => void;

	constructor(
		title: string,
		items: PlanOption[],
		theme: any,
		onSelect: (index: number) => void,
		onCancel: () => void,
	) {
		super();
		this.items = items;
		this.theme = theme;
		this.onSelect = onSelect;
		this.onCancel = onCancel;

		this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		this.addChild(new Spacer(1));
		this.list = new Container();
		this.addChild(this.list);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("muted", "↑↓ / jk navigate  ·  Enter select  ·  Esc cancel"), 1, 0),
		);
		this.refreshList();
	}

	/** 由 pi-tui 的渲染树驱动；必须返回行数组，绝不能返回 undefined（父级 Container.render 读 .length 会崩溃）。 */
	render(width: number): string[] {
		this.refreshList();
		return super.render(width);
	}

	/** 依当前选中项重建列表，本身不返回渲染结果。 */
	private refreshList() {
		this.list.clear();
		for (let i = 0; i < this.items.length; i++) {
			const it = this.items[i];
			const marker = i === this.sel ? this.theme.fg("accent", "→ ") : "  ";
			const num = it.num ? `${it.num}. ` : `${i + 1}. `;
			// “都不选”等特殊项用 muted 样式，与普通方案区分
			const line = `${num}${it.label}`;
			const colored = it.special
				? this.theme.fg("muted", line)
				: this.theme.fg("text", line);
			const desc = it.desc ? this.theme.fg("muted", `  ${it.desc}`) : "";
			this.list.addChild(new Text(marker + colored + desc, 1, 0));
		}
	}

	handleInput(keyData: string) {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.sel = Math.max(0, this.sel - 1);
			this.refreshList();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.sel = Math.min(this.items.length - 1, this.sel + 1);
			this.refreshList();
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			this.onSelect(this.sel);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancel();
		}
	}

	dispose() { }
}

/** 弹出白色编号选择框，返回选中的下标；取消返回 undefined。 */
async function showPlanSelector(
	ctx: ExtensionContext,
	question: string,
	items: PlanOption[],
): Promise<number | undefined> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return undefined;
	return ctx.ui.custom<number | undefined>((tui, theme, _kb, done) => {
		return new PlanSelector(question, items, theme, done, () => done(undefined));
	});
}

export default function piChoosePlan(pi: ExtensionAPI) {
	// 第 1 步：注入强约束规则
	pi.on("before_agent_start", (event) => {
		return { systemPrompt: event.systemPrompt + "\n" + RULE };
	});

	// 第 2 步：注册工具
	pi.registerTool({
		name: "choose_plan",
		label: "Choose Plan",
		// 聊天行默认显示函数名（choose_plan），这里自定义为可读的 "choose plan"（黄色）
		renderCall(_args, theme) {
			// 橙色（RGB 255,165,0）粗体；收尾只用 \x1b[39m 重置前景，避免把工具行底色清成黑色
			return new Text(`\x1b[38;2;255;165;0m${theme.bold("Choose Plan")}\x1b[39m`, 0, 0);
		},
		description: "Offers plans to user, returns the choice. Use when multiple feasible plans exist.",
		parameters: ChoosePlanParams,
		executionMode: "sequential",

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui" || params.plans.length === 0) {
				return {
					content: [{ type: "text", text: "Cannot select (non-interactive or empty plans)." }],
					details: { question: params.question, plans: params.plans.map((p) => p.label), answer: null },
				} as PlanDetails;
			}

			// 结构化 plans → 白色 ABC 编号选项；末尾追加“都不选”特殊项
			const items: PlanOption[] = params.plans.map((p, i) => ({
				num: LETTERS[i % LETTERS.length],
				label: p.label,
				desc: p.description,
			}));
			items.push({
				num: "—",
				label: "None of the above (end this turn)",
				// desc: "终止当前会话回合",
				special: true,
			});

			const idx = await showPlanSelector(ctx, params.question, items);
			const plainPlans = params.plans.map((p) => p.label);

			if (idx === undefined) {
				return {
					content: [
						{ type: "text", text: "User cancelled; ending this turn." },
						{ type: "text", text: formatPlanList(params) },
					],
					details: { question: params.question, plans: plainPlans, answer: null, cancelled: true },
					terminate: true,
				} as PlanDetails;
			}

			// “都不选”：结束本轮会话（用 terminate 优雅收尾，替代 ctx.abort()，避免 "This operation was aborted" 报错）
			if (idx >= plainPlans.length) {
				return {
					content: [{ type: "text", text: "User rejected all plans; ending this turn." }],
					details: { question: params.question, plans: plainPlans, answer: null, rejected: true },
					terminate: true,
				} as PlanDetails;
			}

			const label = plainPlans[idx];

			// 方案 A：把完整方案列表回显到聊天记录，选完仍可见、可引用，改主意不用重问
			const chosen = `${LETTERS[idx % LETTERS.length]}. ${label}`;

			return {
				content: [
					{ type: "text", text: `User chose: ${chosen}` },
					{ type: "text", text: formatPlanList(params) },
				],
				details: { question: params.question, plans: plainPlans, answer: label, index: idx + 1 },
			} as PlanDetails;
		},
	});
}

/** 把完整方案列表（编号 + 标签 + 描述）格式化为可回显的文本，供用户随时引用/切换。 */
function formatPlanList(params: { question: string; plans: { label: string; description?: string }[] }): string {
	const lines = params.plans.map((p, i) => {
		const letter = LETTERS[i % LETTERS.length];
		const head = `${letter}. ${p.label}`;
		return p.description ? `${head} — ${p.description}` : head;
	});
	return `All options (still available — say a letter to switch):\n${lines.join("\n")}`;
}