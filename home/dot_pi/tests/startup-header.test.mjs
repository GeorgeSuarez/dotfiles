import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import startupHeader, {
  buildHeaderLines,
  displayCwd,
  displayPath,
  formatMcpEntries,
  formatNameList,
  scanAgentsFiles,
} from "../agent/extensions/startup-header.ts";
import { VERSION } from "@earendil-works/pi-coding-agent";

const theme = { fg: (_c, s) => s, bold: (s) => s };
const loaded = {
  model: "opencode-go/muse-spark",
  cwdDir: "~/proj",
  mcps: "(1) maestro",
  tools: "(3) bash, read, write",
  agents: "~/.pi/AGENTS.md",
  extensions: "(1) startup-header",
};

function captureHeader() {
  let factory;
  const handlers = {};
  const cwd = mkdtempSync(join(tmpdir(), "pi-header-cwd-"));
  const ctx = {
    mode: "tui",
    cwd,
    model: undefined,
    ui: { setHeader: (f) => (factory = f) },
  };
  const pi = {
    on: (e, h) => (handlers[e] = h),
    getAllTools: () => [{ name: "write" }, { name: "read" }, { name: "bash" }],
    getCommands: () => [],
  };
  return { pi, ctx, handlers, getFactory: () => factory };
}

describe("startup header table", () => {
  test("renders logo, version, model, mcps, tools within width", async () => {
    const { pi, ctx, handlers, getFactory } = captureHeader();
    await startupHeader(pi);
    await handlers.session_start({}, ctx);
    await handlers.before_agent_start(
      { systemPromptOptions: { cwd: ctx.cwd } },
      ctx,
    );
    const lines = getFactory()( { requestRender() {} }, theme).render(80).map((l) => stripTerminalSequences(l));
    expect(lines[0]).toMatch(/^┏.*┳.*┓$/);
    expect(lines.at(-1)).toMatch(/^┗.*┻.*┛$/);
    expect(lines.some((l) => l.includes("█"))).toBe(true);
    expect(lines.some((l) => l.includes(VERSION))).toBe(true);
    expect(lines.some((l) => l.includes("Model:"))).toBe(true);
    expect(lines.some((l) => l.includes("Cwd:"))).toBe(true);
    expect(lines.some((l) => l.includes("Skill(s):"))).toBe(false);
    expect(lines.some((l) => l.includes("Context:"))).toBe(true);
    expect(lines.some((l) => l.includes("Extension(s):"))).toBe(true);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80);
  });

  test("narrows without exceeding width", () => {
    const lines = buildHeaderLines(theme, 40, loaded).map((l) => stripTerminalSequences(l));
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(40);
    expect(lines.some((l) => l.includes("maestro"))).toBe(true);
  });

  test("formats mcp cache servers sorted with tool counts", () => {
    expect(formatMcpEntries({ zebra: { tools: [{}] }, maestro: { tools: [{}, {}] }, empty: {} })).toEqual([
      "empty",
      "(2) maestro",
      "(1) zebra",
    ]);
    expect(formatMcpEntries(undefined)).toEqual([]);
    expect(
      buildHeaderLines(theme, 80, { ...loaded, mcps: "none", tools: "none" })
        .join("\n"),
    ).toContain("MCP(s): none");
  });

  test("formatNameList truncates long lists", () => {
    expect(formatNameList([])).toBe("none");
    expect(formatNameList(["b", "a"])).toBe("(2) a, b");
    const many = Array.from({ length: 12 }, (_, i) => `tool-${String(i).padStart(2, "0")}`);
    const out = formatNameList(many);
    expect(out.startsWith("(12) ")).toBe(true);
    expect(out).toContain("+4 more");
    expect(out.includes("tool-11")).toBe(false);
  });

  test("scanAgentsFiles reads agentDir and ancestor AGENTS.md", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-header-agent-"));
    writeFileSync(join(agentDir, "AGENTS.md"), "global rules\n");
    const cwd = mkdtempSync(join(tmpdir(), "pi-header-proj-"));
    const sub = join(cwd, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "project rules\n");
    const paths = scanAgentsFiles(sub, agentDir).map((f) => f.path);
    expect(paths).toEqual([join(agentDir, "AGENTS.md"), join(cwd, "AGENTS.md")]);
    const empty = mkdtempSync(join(tmpdir(), "pi-header-empty-"));
    expect(scanAgentsFiles(empty, join(empty, "agent"))).toEqual([]);
  });

  test("displayPath shortens under-cwd and home paths", () => {
    expect(displayPath(join("/proj", "AGENTS.md"), "/proj")).toBe("AGENTS.md");
    expect(displayPath(join("/proj", "sub", "x.md"), "/proj")).toBe(join("sub", "x.md"));
    expect(displayPath(join(process.env.HOME, "AGENTS.md"), "/tmp")).toBe("~/AGENTS.md");
    expect(displayPath("/etc/AGENTS.md", "/tmp")).toBe("/etc/AGENTS.md");
  });

  test("displayCwd shortens home and guards empty", () => {
    expect(displayCwd("")).toBe("none");
    expect(displayCwd(join(process.env.HOME, "proj"))).toBe("~/proj");
    expect(displayCwd("/tmp/x")).toBe("/tmp/x");
  });
});
