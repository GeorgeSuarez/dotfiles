import { Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { ExtensionAPI, Skill, Theme } from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  VERSION,
  getAgentDir,
  loadProjectContextFiles,
  loadSkills,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Startup header as a table with the official Pi logo (pi.dev/logo-auto.svg)
 * in its own column and version, AGENTS.md, MCP servers, tools, and skills
 * alongside it.
 * Pair with `quietStartup: true`, which hides the built-in header plus the
 * [Context]/[Skills]/[Prompts]/[Extensions]/[Themes] lists.
 * `pi --verbose` still forces full output.
 */

// Official Pi mark: blocky "P" + "i" bar, traced from the SVG geometry.
// 4x4 stroke-unit grid (1 unit = ~117px in the 800x800 viewBox):
//   top bar / bowl / mid connector / stems. Each unit renders as 4 cells
// wide; each row is doubled so terminal cells stay roughly square.
function getPiLogoRows(): string[] {
  const B = "█".repeat(4);
  const S = " ".repeat(4);
  const rows = [B + B + B, B + S + B, B + B + S + B, B + S + S + B];
  return rows.flatMap((row) => [row, row]);
}

/** "name (n tools)" per server, from the mcp-cache shape. Pure for testing. */
export function formatMcpEntries(
  servers: Record<string, { tools?: unknown[] } | undefined> | undefined,
): string[] {
  if (!servers) return [];
  return Object.entries(servers).map(([name, s]) =>
    Array.isArray(s?.tools) ? `(${s.tools.length}) ${name}` : name,
  );
}

// ponytail: cache-only snapshot, no live MCP status; re-read per render if the header ever becomes reactive.
function readMcpEntries(): string[] {
  try {
    const raw = readFileSync(join(getAgentDir(), "mcp-cache.json"), "utf8");
    const cache = JSON.parse(raw) as {
      servers?: Record<string, { tools?: unknown[] }>;
    };
    return formatMcpEntries(cache.servers);
  } catch {
    return [];
  }
}

/**
 * Disk scan via pi's own loader: user dir (<agentDir>/skills) plus project
 * dir (<cwd>/.pi/skills). The catalogue isn't built until the first turn,
 * so this gives the header a real count at startup.
 * ponytail: misses package/git skills (ponytail, plannotator); before_agent_start
 * replaces this with pi's authoritative catalogue after the first turn.
 */
export function scanSkills(cwd: string, agentDir = getAgentDir()): Skill[] {
  try {
    return loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true }).skills;
  } catch {
    return [];
  }
}

/**
 * Disk scan via pi's own loader: global file (<agentDir>) plus ancestors of
 * cwd, first of AGENTS.override.md / AGENTS.md / CLAUDE.md per dir. The
 * context files aren't known until the first turn, so this gives the header
 * a real answer at startup.
 * ponytail: misses the git-worktree shadow rule's nuance and any host
 * overrides; before_agent_start replaces this with pi's authoritative
 * contextFiles after the first turn.
 */
export function scanAgentsFiles(
  cwd: string,
  agentDir = getAgentDir(),
): Array<{ path: string; content: string }> {
  try {
    return loadProjectContextFiles({ cwd, agentDir });
  } catch {
    return [];
  }
}

function isExtensionDir(dir: string): boolean {
  if (existsSync(join(dir, "index.ts")) || existsSync(join(dir, "index.js"))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      pi?: { extensions?: unknown };
    };
    return Array.isArray(pkg?.pi?.extensions) && pkg.pi.extensions.length > 0;
  } catch {
    return false;
  }
}

function scanExtensionPaths(cwd: string, agentDir = getAgentDir()): string[] {
  const found: string[] = [];
  for (const dir of [join(agentDir, "extensions"), join(cwd, CONFIG_DIR_NAME, "extensions")]) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))
      ) {
        found.push(full);
      } else if ((entry.isDirectory() || entry.isSymbolicLink()) && isExtensionDir(full)) {
        found.push(full);
      }
    }
  }
}

function extensionDisplayName(extPath: string): string {
  const parts = extPath.replace(/\\/g, "/").split("/");
  const nm = parts.lastIndexOf("node_modules");
  const after = nm >= 0 ? parts[nm + 1] : undefined;
  if (after) {
    return after.startsWith("@") ? parts.slice(nm + 1, nm + 3).join("/") : after;
  }
  const base = parts[parts.length - 1] ?? extPath;
  if (/^index\.[tj]s$/.test(base)) return parts[parts.length - 2] ?? base;
  return base.replace(/\.[tj]s$/, "");
}

/** Shorten a context path: relative when under cwd, ~/ when under home. */
export function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (rel && !rel.startsWith("..") && !rel.startsWith("/")) return rel;
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

interface LoadedInfo {
  mcps: string;
  tools: string;
  skills: string;
  agents: string;
  extensions: string;
}

/**
 * Fixed Tokyo Night (Storm) palette for the header, independent of the
 * active pi theme — the rest of the UI keeps following the pi theme.
 */
export const TOKYO_NIGHT = {
  text: "#c0caf5",
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  green: "#9ece6a",
  yellow: "#e0af68",
  purple: "#bb9af7",
  comment: "#565f89",
  border: "#3b4261",
  orange: "#ff9e64",
} as const;

function paint(hex: string): (s: string) => string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}

const tnText = paint(TOKYO_NIGHT.text);
const tnBlue = paint(TOKYO_NIGHT.blue);
const tnCyan = paint(TOKYO_NIGHT.cyan);
const tnGreen = paint(TOKYO_NIGHT.green);
const tnYellow = paint(TOKYO_NIGHT.yellow);
const tnPurple = paint(TOKYO_NIGHT.purple);
const tnComment = paint(TOKYO_NIGHT.comment);
const tnBorder = paint(TOKYO_NIGHT.border);
const tnOrange = paint(TOKYO_NIGHT.orange);
const tnBoldBlue = (s: string) => `\x1b[1m${tnBlue(s)}\x1b[22m`;

function buildTable(_theme: Theme, width: number, loaded: LoadedInfo): string[] {
  const logoRows = getPiLogoRows();
  const logoWidth = Math.max(...logoRows.map((r) => r.length));
  const valueWidth = Math.max(width - logoWidth - 7, 8);
  const border = tnBorder;
  // Left-aligned: the P stem runs down grid column 0 in every row, so any
  // left padding on the shorter rows would jog the stem and break the P.
  const fitLogo = (s: string) => tnText(truncateToWidth(s, logoWidth).padEnd(logoWidth));
  const entries: Array<{ text: string; color: (s: string) => string }> = [
    { text: `Version: ${VERSION}`, color: tnBoldBlue },
    {
      text: `Context: ${loaded.agents}`,
      color: (s) => (loaded.agents === "none" ? tnComment(s) : tnPurple(s)),
    },
    {
      text: `MCP(s): ${loaded.mcps}`,
      color: (s) => (loaded.mcps === "none" ? tnComment(s) : tnGreen(s)),
    },
    { text: `Tool(s): ${loaded.tools}`, color: tnCyan },
    { text: `Skill(s): ${loaded.skills}`, color: tnYellow },
    {
      text: `Extension(s): ${loaded.extensions}`,
      color: (s) => (loaded.extensions === "none" ? tnComment(s) : tnOrange(s)),
    },
  ];
  const sep = (l: string, m: string, r: string) =>
    border(`${l}${"━".repeat(logoWidth + 2)}${m}${"━".repeat(valueWidth + 2)}${r}`);
  let logoIndex = 0;
  const row = (logoCell: string, chunk: string, color: (s: string) => string) =>
    `${border("┃ ")}${fitLogo(logoCell)}${border(" ┃ ")}${color(chunk.padEnd(valueWidth))}${border(" ┃")}`;
  const divider = (logoCell: string) =>
    `${border("┃ ")}${fitLogo(logoCell)}${border(" ┣")}${border("━".repeat(valueWidth + 2))}${border("┫")}`;

  // Center the Pi logo block with the table height
  const chunksPerEntry = entries.map((entry) => wrapTextWithAnsi(entry.text, valueWidth));
  type RowSpec = { chunk: string; color: (s: string) => string } | { divider: true };
  const rowSpecs: RowSpec[] = [];
  entries.forEach((entry, k) => {
    // Word-wrap so long lists (tools, skills) are shown in full across rows.
    for (const chunk of chunksPerEntry[k] ?? []) {
      rowSpecs.push({ chunk, color: entry.color });
    }
    if (k < entries.length - 1) rowSpecs.push({ divider: true });
  });
  const totalRows = Math.max(rowSpecs.length, logoRows.length);
  const logoStart = Math.floor(Math.max(0, totalRows - logoRows.length) / 2);
  const paddedLogo = Array.from({ length: totalRows }, (_, i) => logoRows[i - logoStart] ?? "");
  while (rowSpecs.length < totalRows) {
    rowSpecs.push({ chunk: "", color: tnText });
  }

  const lines = [sep("┏", "┳", "┓")];
  rowSpecs.forEach((spec, i) => {
    const logoCell = paddedLogo[i] ?? "";
    if ("divider" in spec) lines.push(divider(logoCell));
    else lines.push(row(logoCell, spec.chunk, spec.color));
  });
  lines.push(sep("┗", "┻", "┛"));
  return lines.map((line) => truncateToWidth(line, width));
}

export function buildHeaderLines(theme: Theme, width: number, loaded: LoadedInfo): string[] {
  return buildTable(theme, width, loaded);
}

export default function startupHeader(pi: ExtensionAPI) {
  // ponytail: snapshot refreshed at turn start, not reactive per keystroke.
  let loaded: LoadedInfo = {
    mcps: "none",
    tools: "",
    skills: "",
    agents: "none",
    extensions: "none",
  };

  function snapshot(skills: Skill[], agentsPaths: string[], cwd: string): void {
    const entries = readMcpEntries();
    const toolNames = pi
      .getAllTools()
      .map((t) => t.name)
      .sort();
    const skillNames = skills.map((s) => s.name);
    const extPaths = new Set<string>(scanExtensionPaths(cwd));
    for (const c of pi.getCommands()) {
      if (c.source === "extension") extPaths.add(c.sourceInfo.path);
    }
    // for (const t of pi.getAllTools()) {
    //   const p = t.sourceInfo.path;
    //   if (!p.startsWith("<builtin") && !p.startsWith("<sdk")) extPaths.add(p);
    // }
    const extNames = Array.from(new Set([...extPaths].map(extensionDisplayName))).sort();
    loaded = {
      mcps: entries.length > 0 ? entries.join(", ") : "none",
      tools: `(${toolNames.length}) ${toolNames.join(", ")}`,
      skills: `(${skillNames.length}) ${skillNames.sort().join(", ")}`,
      extensions: extNames.length > 0 ? `(${extNames.length}) ${extNames.join(", ")}` : "none",
      agents:
        agentsPaths.length === 0 ? "none" : agentsPaths.map((p) => displayPath(p, cwd)).join(", "),
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    snapshot(
      scanSkills(ctx.cwd),
      scanAgentsFiles(ctx.cwd).map((f) => f.path),
      ctx.cwd,
    );
    ctx.ui.setHeader((_tui, theme) => ({
      render: (width: number) => buildHeaderLines(theme, width, loaded),
      invalidate() {},
    }));
  });

  // MCP tools register asynchronously; refresh once the system prompt is built.
  pi.on("before_agent_start", async (event) => {
    snapshot(
      event.systemPromptOptions?.skills ?? [],
      (event.systemPromptOptions?.contextFiles ?? []).map((f) => f.path),
      event.systemPromptOptions?.cwd ?? "",
    );
  });
}
