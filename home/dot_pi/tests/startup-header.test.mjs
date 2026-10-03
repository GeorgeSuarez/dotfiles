import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import startupHeader, {
  buildHeaderLines,
  buildMcpEntriesFromTools,
  displayCwd,
  displayPath,
  formatMcpDisplay,
  formatMcpEntries,
  formatMcpEntriesDisplay,
  formatNameList,
  groupMcpToolsByNamespace,
  mcpNamespaceForServer,
  readMcpConfigServerNames,
  resolveMcpServerDisplayName,
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

function mcpTool(serverNs, tool, exposure = "deferred") {
  return {
    name: `${serverNs}__${tool}`,
    namespace: { name: serverNs },
    exposure,
  };
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

describe("startup header live MCP", () => {
  test("formatMcpDisplay preserves server-name order instead of count order", () => {
    const servers = {
      maestro: { tools: new Array(10) },
      executor: { tools: new Array(9) },
      "chrome-devtools": { tools: new Array(32) },
    };
    // Name-sorted entries: chrome-devtools, executor, maestro.
    expect(formatMcpEntries(servers)).toEqual([
      "(32) chrome-devtools",
      "(9) executor",
      "(10) maestro",
    ]);
    // Must NOT re-sort by "(n)" prefix (old bug produced maestro first).
    expect(formatMcpDisplay(servers)).toBe(
      "(3) (32) chrome-devtools, (9) executor, (10) maestro",
    );
  });

  test("formatMcpEntriesDisplay preserves order, truncates, and handles empty", () => {
    expect(formatMcpEntriesDisplay([])).toBe("none");
    expect(formatMcpEntriesDisplay(["(8) executor"])).toBe("(1) (8) executor");
    expect(
      formatMcpEntriesDisplay(["(32) chrome-devtools", "(9) executor", "(10) maestro"]),
    ).toBe("(3) (32) chrome-devtools, (9) executor, (10) maestro");
    const many = Array.from({ length: 12 }, (_, i) => `(1) server-${String(i).padStart(2, "0")}`);
    const out = formatMcpEntriesDisplay(many);
    expect(out.startsWith("(12) ")).toBe(true);
    expect(out).toContain("+4 more");
    expect(out.includes("server-11")).toBe(false);
    // Order preserved: first visible entry stays first.
    expect(out.includes("(1) server-00")).toBe(true);
  });

  test("mcpNamespaceForServer mirrors pi dash handling", () => {
    expect(mcpNamespaceForServer("executor")).toBe("mcp__executor");
    expect(mcpNamespaceForServer("chrome-devtools")).toBe("mcp__chrome_devtools");
  });

  test("groupMcpToolsByNamespace counts live tools, skips hidden and non-MCP", () => {
    const tools = [
      mcpTool("mcp__executor", "search"),
      mcpTool("mcp__executor", "invoke"),
      mcpTool("mcp__executor", "old", "hidden"),
      { name: "read", exposure: "direct" },
      mcpTool("mcp__chrome_devtools", "click"),
      undefined,
      null,
    ];
    expect([...groupMcpToolsByNamespace(tools).entries()]).toEqual([
      ["mcp__executor", 2],
      ["mcp__chrome_devtools", 1],
    ]);
    expect(groupMcpToolsByNamespace(undefined).size).toBe(0);
    expect(groupMcpToolsByNamespace([]).size).toBe(0);
  });

  test("groupMcpToolsByNamespace falls back to mcp__ tool names", () => {
    const tools = [{ name: "mcp__executor__search", exposure: "deferred" }];
    expect([...groupMcpToolsByNamespace(tools).entries()]).toEqual([["mcp__executor", 1]]);
  });

  test("resolveMcpServerDisplayName preserves dashes from known names", () => {
    expect(resolveMcpServerDisplayName("mcp__chrome_devtools", ["chrome-devtools"])).toBe(
      "chrome-devtools",
    );
    expect(resolveMcpServerDisplayName("mcp__chrome_devtools", ["executor"])).toBe(
      "chrome_devtools",
    );
    expect(resolveMcpServerDisplayName("mcp__executor", [])).toBe("executor");
  });

  test("buildMcpEntriesFromTools sorts by display name with live counts", () => {
    const tools = [
      ...["b2", "b1"].map((t) => mcpTool("mcp__zebra", t)),
      mcpTool("mcp__executor", "search"),
    ];
    expect(buildMcpEntriesFromTools(tools, ["zebra", "executor"])).toEqual([
      "(1) executor",
      "(2) zebra",
    ]);
    expect(buildMcpEntriesFromTools([], [])).toEqual([]);
    // Dash-preserving: namespace mcp__chrome_devtools + known chrome-devtools.
    expect(
      buildMcpEntriesFromTools([mcpTool("mcp__chrome_devtools", "click")], ["chrome-devtools"]),
    ).toEqual(["(1) chrome-devtools"]);
  });

  test("readMcpConfigServerNames reads only keys from global and project configs", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-header-mcp-agent-"));
    writeFileSync(
      join(agentDir, "mcp.json"),
      JSON.stringify({ mcpServers: { executor: { url: "https://example.com" } } }),
    );
    const cwd = mkdtempSync(join(tmpdir(), "pi-header-mcp-proj-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { "my-tool": { command: "x" } } }),
    );
    expect(readMcpConfigServerNames(agentDir, cwd).sort()).toEqual(["executor", "my-tool"]);
    const empty = mkdtempSync(join(tmpdir(), "pi-header-mcp-empty-"));
    expect(readMcpConfigServerNames(join(empty, "agent"), join(empty, "proj"))).toEqual([]);
  });

  test("header uses live tools, not stale cache entries", async () => {
    let factory;
    const handlers = {};
    const cwd = mkdtempSync(join(tmpdir(), "pi-header-live-cwd-"));
    const ctx = { mode: "tui", cwd, model: undefined, ui: { setHeader: (f) => (factory = f) } };
    const liveTools = [
      "integrations",
      "search",
      "invoke",
      "skills",
      "create-artifact",
      "edit-artifact",
      "list-artifacts",
      "show-artifact",
    ].map((t) => mcpTool("mcp__executor", t));
    liveTools.push({ name: "read", exposure: "direct" });
    const pi = {
      on: (e, h) => (handlers[e] = h),
      getAllTools: () => liveTools,
      getMcpServers: () => [{ name: "executor" }],
      getCommands: () => [],
    };
    await startupHeader(pi);
    await handlers.session_start({}, ctx);
    const tui = { requestRender() {} };
    const lines = factory(tui, theme)
      .render(120)
      .map((l) => stripTerminalSequences(l));
    const text = lines.join("\n");
    expect(text).toContain("(1) (8) executor");
    expect(text.includes("maestro")).toBe(false);
    expect(text.includes("chrome-devtools")).toBe(false);
  });

  test("turn_start refreshes MCP without clearing agents", async () => {
    let factory;
    const handlers = {};
    const cwd = mkdtempSync(join(tmpdir(), "pi-header-turn-cwd-"));
    const ctx = { mode: "tui", cwd, model: undefined, ui: { setHeader: (f) => (factory = f) } };
    let liveTools = [{ name: "read", exposure: "direct" }];
    const pi = {
      on: (e, h) => (handlers[e] = h),
      getAllTools: () => liveTools,
      getMcpServers: () => [],
      getCommands: () => [],
    };
    await startupHeader(pi);
    await handlers.session_start({}, ctx);
    await handlers.before_agent_start(
      { systemPromptOptions: { cwd, contextFiles: [{ path: join(cwd, "AGENTS.md") }] } },
      ctx,
    );
    const tui = { requestRender() {} };
    let text = factory(tui, theme).render(120).map((l) => stripTerminalSequences(l)).join("\n");
    expect(text).toContain("MCP(s): none");
    expect(text).toContain("AGENTS.md");

    // MCP connects in the background: new namespaced tools appear.
    liveTools = [{ name: "read", exposure: "direct" }, mcpTool("mcp__executor", "search")];
    await handlers.turn_start({}, { cwd, model: undefined });
    text = factory(tui, theme).render(120).map((l) => stripTerminalSequences(l)).join("\n");
    expect(text).toContain("(1) (1) executor");
    // Authoritative agents display from before_agent_start is preserved.
    expect(text).toContain("AGENTS.md");
  });
});
