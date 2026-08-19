import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const Parameters = Type.Object({
	target: Type.Optional(Type.String({ description: "Optional test file, package, or test name" })),
});
type Params = Static<typeof Parameters>;

interface PackageJson {
	scripts?: Record<string, string>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function commandFor(cwd: string, target?: string): Promise<{ command: string; args: string[]; label: string }> {
	let packageJson: PackageJson = {};
	try {
		packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as PackageJson;
	} catch {
		// A repository may use a non-JavaScript test runner.
	}

	const scripts = packageJson.scripts ?? {};
	const script = ["test", "check", "typecheck", "lint"].find((name) => scripts[name]);
	if (!script) {
		if (await exists(join(cwd, "Cargo.toml"))) return { command: "cargo", args: ["test"], label: "cargo test" };
		if (await exists(join(cwd, "go.mod"))) return { command: "go", args: ["test", "./..."], label: "go test ./..." };
		throw new Error("Could not find a test, check, typecheck, lint, Cargo.toml, or go.mod command");
	}

	const manager = (await exists(join(cwd, "pnpm-lock.yaml")))
		? "pnpm"
		: (await exists(join(cwd, "yarn.lock")))
			? "yarn"
			: (await exists(join(cwd, "bun.lockb")) || await exists(join(cwd, "bun.lock")))
				? "bun"
				: "npm";
	const args = manager === "npm" ? ["run", script] : [script];
		if (target) args.push("--", target);
	return { command: manager, args, label: `${manager} ${args.join(" ")}` };
}

function outputOf(result: { stdout: string; stderr: string }, max = 50_000): string {
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	return output.length > max ? `${output.slice(0, max)}\n\n[Output truncated]` : output || "(no output)";
}

async function run(cwd: string, target: string | undefined, pi: ExtensionAPI, signal: AbortSignal | undefined) {
	const command = await commandFor(cwd, target);
	const result = await pi.exec(command.command, command.args, { cwd, signal, timeout: 120_000 });
	return { ...command, result };
}

export default function testRunner(pi: ExtensionAPI) {
	pi.registerTool({
		name: "run_tests",
		label: "Run Tests",
		description: "Detect the repository test command, run it, and return bounded stdout/stderr with the exit status.",
		promptSnippet: "Run the repository's relevant tests or checks",
		promptGuidelines: ["Use run_tests after code changes to verify the implementation and diagnose failures."],
		parameters: Parameters,
		execute: async (_toolCallId, params: Params, signal, _onUpdate, ctx) => {
			const { command, args, label, result } = await run(ctx.cwd, params.target, pi, signal);
			return {
				content: [{ type: "text", text: `${label}\nexit code: ${result.code}\n\n${outputOf(result)}` }],
				details: { command, args, exitCode: result.code, passed: result.code === 0 },
			};
		},
	});

	pi.registerCommand("test", {
		description: "Run the detected repository test/check command",
		handler: async (args, ctx: ExtensionContext) => {
			try {
				const { label, result } = await run(ctx.cwd, args.trim() || undefined, pi, undefined);
				ctx.ui.notify(`${label}: ${result.code === 0 ? "passed" : "failed"}\n${outputOf(result, 2000)}`, result.code === 0 ? "info" : "error");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
