import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import startupHeader, {
  TOKYO_NIGHT,
  buildHeaderLines,
  displayPath,
  formatMcpEntries,
  scanAgentsFiles,
  scanSkills,
} from "../agent/extensions/startup-header.ts";
import { VERSION } from "@earendil-works/pi-coding-agent";

const theme = { fg: (_c, s) => s, bold: (s) => s };
const loaded = {
  mcps: "(10) maestro",
  tools: "(3) bash, read, write",
  skills: "(1) tdd",
  agents: "~/.pi/AGENTS.md",
};

function captureHeader() {
  let factory;
  const handlers = {};
  const cwd = mkdtempSync(join(tmpdir(), "pi-header-cwd-"));
  const ctx = {
    mode: "tui",
    cwd,
    ui: { setHeader: (f) => (factory = f) },
  };
  const pi = {
    on: (e, h) => (handlers[e] = h),
    getAllTools: () => [{ name: "write" }, { name: "read" }, { name: "bash" }],
  };
  return { pi, ctx, handlers, getFactory: () => factory };
}

describe("startup header table", () => {
  test("renders logo, version, mcps, tools, skills within width", async () => {
    const { pi, ctx, handlers, getFactory } = captureHeader();
    await startupHeader(pi);
    await handlers.session_start({}, ctx);
    await handlers.before_agent_start(
      { systemPromptOptions: { skills: [{ name: "tdd" }] } },
      ctx,
    );
    const lines = getFactory()({}, theme).render(80).map((l) => stripTerminalSequences(l));
    expect(lines[0]).toMatch(/^┏.*┳.*┓$/);
    expect(lines.at(-1)).toMatch(/^┗.*┻.*┛$/);
    expect(lines.some((l) => l.includes("█") && l.includes(VERSION))).toBe(true);
    expect(lines.some((l) => l.includes("MCP(s): (10) maestro"))).toBe(true);
    expect(lines.some((l) => l.includes("Tools: (3) bash, read, write"))).toBe(true);
    expect(lines.some((l) => l.includes("Skill(s): (1) tdd"))).toBe(true);
    expect(lines.some((l) => l.includes("Context:"))).toBe(true);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80);
  });

  test("paints tokyo night colors for each section", () => {
    const lines = buildHeaderLines(theme, 80, loaded).join("\n");
    const code = (hex) =>
      `38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}`;
    for (const key of ["blue", "green", "cyan", "yellow", "purple", "text", "border"]) {
      expect(lines.includes(code(TOKYO_NIGHT[key]))).toBe(true);
    }
  });

  test("scanSkills reads user and project skill dirs", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-header-agent-"));
    mkdirSync(join(agentDir, "skills", "global-skill"), { recursive: true });
    writeFileSync(
      join(agentDir, "skills", "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: g\n---\n",
    );
    const cwd = mkdtempSync(join(tmpdir(), "pi-header-proj-"));
    mkdirSync(join(cwd, ".pi", "skills", "proj-skill"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "skills", "proj-skill", "SKILL.md"),
      "---\nname: proj-skill\ndescription: p\n---\n",
    );
    const names = scanSkills(cwd, agentDir).map((s) => s.name).sort();
    expect(names).toEqual(["global-skill", "proj-skill"]);
    expect(scanSkills(join(cwd, "nope"), join(cwd, "nope"))).toEqual([]);
  });

  test("dividers span the text column only, logo column stays solid", () => {
    const lines = buildHeaderLines(theme, 80, loaded).map((l) => stripTerminalSequences(l));
    const dividers = lines.filter((l) => l.includes("┣"));
    expect(dividers.length).toBe(4);
    for (const d of dividers) {
      expect(d).toMatch(/┣━+┫$/);
      expect(d.includes("█")).toBe(true);
    }
  });

  test("narrows without exceeding width", () => {
    const lines = buildHeaderLines(theme, 40, loaded).map((l) => stripTerminalSequences(l));
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(40);
    expect(lines.some((l) => l.includes("maestro"))).toBe(true);
  });

  test("formats mcp cache servers with tool counts", () => {
    expect(formatMcpEntries({ maestro: { tools: [{}, {}] }, empty: {} })).toEqual([
      "(2) maestro",
      "empty",
    ]);
    expect(formatMcpEntries(undefined)).toEqual([]);
    expect(buildHeaderLines(theme, 80, { mcps: "none", tools: "", skills: "", agents: "none" }).join("\n")).toContain(
      "MCP(s): none",
    );
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
});
