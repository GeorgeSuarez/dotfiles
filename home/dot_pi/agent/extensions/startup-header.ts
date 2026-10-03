import { Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  VERSION,
  getAgentDir,
  loadProjectContextFiles,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Startup header as a table with the official Pi logo (pi.dev/logo-auto.svg)
 * in its own column and version, model, cwd, AGENTS.md, MCP servers, tools,
 * and extensions alongside it.
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

/** Cap long lists so the header stays a fixed height. Pure for testing. */
export const MAX_VISIBLE_ITEMS = 8;

/** "(n) a, b, c" or "(n) a, b +k more" when truncated. Pure for testing. */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return "none";
  const sorted = [...names].sort();
  if (sorted.length <= MAX_VISIBLE_ITEMS) return `(${sorted.length}) ${sorted.join(", ")}`;
  const visible = sorted.slice(0, MAX_VISIBLE_ITEMS);
  return `(${sorted.length}) ${visible.join(", ")} +${sorted.length - visible.length} more`;
}

/** "(n) name" per server, sorted by name, from the mcp-cache shape. Pure for testing.
 * Kept for backwards-compat imports; new code builds entries from live tools. */
export function formatMcpEntries(
  servers: Record<string, { tools?: unknown[] } | undefined> | undefined,
): string[] {
  if (!servers) return [];
  return Object.entries(servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, s]) => (Array.isArray(s?.tools) ? `(${s.tools.length}) ${name}` : name));
}

export function formatMcpDisplay(
  servers: Record<string, { tools?: unknown[] } | undefined> | undefined,
): string {
  return formatMcpEntriesDisplay(formatMcpEntries(servers));
}

/** Join pre-sorted MCP entries preserving server-name order. Pure for testing.
 * Unlike formatNameList (which re-sorts), MCP entries are already sorted by
 * server name and must stay that way: re-sorting "(n) name" strings would
 * order by count prefix instead of server name. */
export function formatMcpEntriesDisplay(entries: string[]): string {
  if (entries.length === 0) return "none";
  if (entries.length <= MAX_VISIBLE_ITEMS) return `(${entries.length}) ${entries.join(", ")}`;
  const visible = entries.slice(0, MAX_VISIBLE_ITEMS);
  return `(${entries.length}) ${visible.join(", ")} +${entries.length - visible.length} more`;
}

/** Namespace pi registers for a server's tools: `mcp__<server>` with `-` → `_`.
 * Mirrors pi's mcpNamespace without a deep import. Pure for testing. */
export function mcpNamespaceForServer(server: string): string {
  return `mcp__${server.replace(/-/g, "_")}`;
}

export interface LiveToolLike {
  name?: string;
  namespace?: { name?: string } | undefined;
  exposure?: string | undefined;
}

/** Group live tools by MCP namespace. Skips non-MCP and hidden (withdrawn) tools. Pure for testing. */
export function groupMcpToolsByNamespace(
  tools: Array<LiveToolLike | undefined | null> | undefined | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tools ?? []) {
    if (!t) continue;
    if (t.exposure === "hidden") continue;
    const ns = t.namespace?.name;
    if (typeof ns === "string" && ns.startsWith("mcp__")) {
      counts.set(ns, (counts.get(ns) ?? 0) + 1);
      continue;
    }
    // Defensive fallback: derive namespace from mcp__<server>__<tool> names
    // when namespace metadata is missing (should not happen for MCP tools).
    if (typeof t.name === "string" && t.name.startsWith("mcp__")) {
      const rest = t.name.slice("mcp__".length);
      const sep = rest.indexOf("__");
      if (sep > 0) {
        const fallbackNs = `mcp__${rest.slice(0, sep)}`;
        counts.set(fallbackNs, (counts.get(fallbackNs) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Map a namespace back to its original server name to preserve dashes. Pure for testing. */
export function resolveMcpServerDisplayName(namespace: string, knownNames: string[] = []): string {
  for (const n of knownNames) {
    if (mcpNamespaceForServer(n) === namespace) return n;
  }
  return namespace.startsWith("mcp__") ? namespace.slice("mcp__".length) : namespace;
}

/** Build "(n) name" entries sorted by display name from live tools. Pure for testing. */
export function buildMcpEntriesFromTools(
  tools: Array<LiveToolLike | undefined | null> | undefined | null,
  knownNames: string[] = [],
): string[] {
  const counts = groupMcpToolsByNamespace(tools);
  return [...counts.entries()]
    .map(([ns, count]) => ({ name: resolveMcpServerDisplayName(ns, knownNames), count }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, count }) => `(${count}) ${name}`);
}

/** Read only server names (keys) from global + project mcp.json. Never reads values/credentials. */
export function readMcpConfigServerNames(agentDir: string, cwd: string): string[] {
  const names: string[] = [];
  const files = [join(agentDir, "mcp.json")];
  // Project config only affects display-name recovery (inclusion is driven by
  // live tools), so reading it without a trust check is safe: no values loaded.
  if (cwd) files.push(join(cwd, CONFIG_DIR_NAME, "mcp.json"));
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        names.push(...Object.keys(parsed.mcpServers));
      }
    } catch {
      // missing/unparsable config contributes no names
    }
  }
  return names;
}

// Live MCP entries from pi.getAllTools() + original-name mapping.
// Inclusion is driven by actually-registered tools, so stale cache entries
// (e.g. removed servers) can never appear.
function readLiveMcpEntries(
  pi: Pick<ExtensionAPI, "getAllTools" | "getMcpServers">,
  agentDir: string,
  cwd: string,
): string[] {
  let tools: LiveToolLike[] = [];
  try {
    tools = (pi.getAllTools?.() ?? []) as LiveToolLike[];
  } catch {
    tools = [];
  }
  let known: string[] = [];
  try {
    known.push(...((pi.getMcpServers?.() ?? []).map((s) => s.name) as string[]));
  } catch {
    // older pi without getMcpServers; config names below still apply
  }
  try {
    known.push(...readMcpConfigServerNames(agentDir, cwd));
  } catch {
    // ignore config read errors; fallback display uses namespace suffix
  }
  return buildMcpEntriesFromTools(tools, [...new Set(known)]);
}

/**
 * Disk scan via pi's own loader: global file (<agentDir>) plus ancestors of
 * cwd, first of AGENTS.override.md / AGENTS.md / CLAUDE.md per dir. The
 * context files aren't known until the first turn, so this gives the header
 * a real answer at startup.
 * before_agent_start replaces this with pi's authoritative contextFiles
 * after the first turn.
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
  const dirs = cwd
    ? [join(agentDir, "extensions"), join(cwd, CONFIG_DIR_NAME, "extensions")]
    : [join(agentDir, "extensions")];
  for (const dir of dirs) {
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
  return found;
}

export function extensionDisplayName(extPath: string): string {
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

/** Shorten cwd itself: ~/ when under home, otherwise full. */
export function displayCwd(cwd: string): string {
  const home = homedir();
  if (!cwd) return "none";
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

export interface LoadedInfo {
  model: string;
  cwdDir: string;
  mcps: string;
  tools: string;
  agents: string;
  extensions: string;
}

/**
 * @deprecated Fixed palette kept for backwards-compat imports only.
 * The header now follows the active pi theme via `theme.fg`/`theme.bold`.
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

function buildTable(theme: Theme, width: number, loaded: LoadedInfo): string[] {
  const logoRows = getPiLogoRows();
  const logoWidth = Math.max(...logoRows.map((r) => r.length));
  const valueWidth = Math.max(width - logoWidth - 7, 8);
  const border = (s: string) => theme.fg("borderMuted", s);
  // Left-aligned: the P stem runs down grid column 0 in every row, so any
  // left padding on the shorter rows would jog the stem and break the P.
  const fitLogo = (s: string) => theme.fg("text", truncateToWidth(s, logoWidth).padEnd(logoWidth));
  const dim = (s: string) => theme.fg("dim", s);
  const entries: Array<{ text: string; color: (s: string) => string }> = [
    { text: `Version: ${VERSION}`, color: (s) => theme.bold(theme.fg("accent", s)) },
    { text: `Model: ${loaded.model}`, color: (s) => theme.fg("mdHeading", s) },
    { text: `Cwd: ${loaded.cwdDir}`, color: (s) => theme.fg("syntaxFunction", s) },
    {
      text: `Context: ${loaded.agents}`,
      color: (s) => (loaded.agents === "none" ? dim(s) : theme.fg("customMessageLabel", s)),
    },
    {
      text: `MCP(s): ${loaded.mcps}`,
      color: (s) => (loaded.mcps === "none" ? dim(s) : theme.fg("success", s)),
    },
    {
      text: `Tool(s): ${loaded.tools}`,
      color: (s) => (loaded.tools === "none" ? dim(s) : theme.fg("mdCode", s)),
    },
    {
      text: `Extension(s): ${loaded.extensions}`,
      color: (s) => (loaded.extensions === "none" ? dim(s) : theme.fg("syntaxString", s)),
    },
  ];
  const sep = (l: string, m: string, r: string) =>
    border(`${l}${"━".repeat(logoWidth + 2)}${m}${"━".repeat(valueWidth + 2)}${r}`);
  const row = (logoCell: string, chunk: string, color: (s: string) => string) =>
    `${border("┃ ")}${fitLogo(logoCell)}${border(" ┃ ")}${color(chunk.padEnd(valueWidth))}${border(" ┃")}`;
  const divider = (logoCell: string) =>
    `${border("┃ ")}${fitLogo(logoCell)}${border(" ┣")}${border("━".repeat(valueWidth + 2))}${border("┫")}`;

  // Center the Pi logo block with the table height
  const chunksPerEntry = entries.map((entry) => wrapTextWithAnsi(entry.text, valueWidth));
  type RowSpec = { chunk: string; color: (s: string) => string } | { divider: true };
  const rowSpecs: RowSpec[] = [];
  entries.forEach((entry, k) => {
    // Lists are pre-truncated via formatNameList, so this wrap only kicks in
    // on narrow terminals.
    for (const chunk of chunksPerEntry[k] ?? []) {
      rowSpecs.push({ chunk, color: entry.color });
    }
    if (k < entries.length - 1) rowSpecs.push({ divider: true });
  });
  const totalRows = Math.max(rowSpecs.length, logoRows.length);
  const logoStart = Math.floor(Math.max(0, totalRows - logoRows.length) / 2);
  const paddedLogo = Array.from({ length: totalRows }, (_, i) => logoRows[i - logoStart] ?? "");
  while (rowSpecs.length < totalRows) {
    rowSpecs.push({ chunk: "", color: (s) => s });
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
  let loaded: LoadedInfo = {
    model: "no-model",
    cwdDir: "none",
    mcps: "none",
    tools: "none",
    agents: "none",
    extensions: "none",
  };
  let requestRender: (() => void) | undefined;
  let lastCwd = "";
  let lastAgentDir = getAgentDir();

  function currentMcpDisplay(): string {
    // Recomputed live on every render so async MCP connections appear
    // without waiting for the next snapshot event.
    try {
      const entries = readLiveMcpEntries(pi, lastAgentDir, lastCwd);
      return formatMcpEntriesDisplay(entries);
    } catch {
      return loaded.mcps;
    }
  }

  function snapshot(agentsPaths: string[] | undefined, cwd: string, modelLabel: string): void {
    lastCwd = cwd || "";
    try {
      lastAgentDir = getAgentDir();
    } catch {
      // keep previous agentDir when pi has no agent dir (tests)
    }
    const entries = readLiveMcpEntries(pi, lastAgentDir, lastCwd);
    let toolNames: string[] = [];
    try {
      toolNames = (pi.getAllTools?.() ?? []).map((t) => t.name);
    } catch {
      toolNames = [];
    }
    const extPaths = new Set<string>(scanExtensionPaths(cwd));
    try {
      for (const t of pi.getAllTools?.() ?? []) {
        const p = (t as { sourceInfo?: { path?: string } })?.sourceInfo?.path;
        if (p && !p.startsWith("<builtin") && !p.startsWith("<sdk")) extPaths.add(p);
      }
    } catch {
      // ignore tool source errors; disk scan already populated extPaths
    }
    try {
      for (const c of pi.getCommands?.() ?? []) {
        if (c.source === "extension" && c.sourceInfo?.path) extPaths.add(c.sourceInfo.path);
      }
    } catch {
      // ignore command source errors
    }
    const extNames = Array.from(new Set([...extPaths].map(extensionDisplayName))).sort();
    const agentsDisplay =
      agentsPaths === undefined
        ? loaded.agents
        : agentsPaths.length === 0
          ? "none"
          : agentsPaths.map((p) => displayPath(p, cwd)).join(", ");
    loaded = {
      model: modelLabel || "no-model",
      cwdDir: displayCwd(cwd),
      mcps: formatMcpEntriesDisplay(entries),
      tools: formatNameList(toolNames),
      extensions: formatNameList(extNames),
      agents: agentsDisplay,
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
    snapshot(scanAgentsFiles(ctx.cwd).map((f) => f.path), ctx.cwd, modelLabel);
    ctx.ui.setHeader((tui, _theme) => {
      requestRender = () => tui.requestRender();
      return {
        render: (width: number) =>
          buildHeaderLines(_theme, width, { ...loaded, mcps: currentMcpDisplay() }),
        invalidate() {},
      };
    });
  });

  function refreshFromSystemPrompt(
    contextFiles: Array<{ path: string }> | undefined,
    cwd: string,
    modelLabel: string,
  ): void {
    snapshot((contextFiles ?? []).map((f) => f.path), cwd, modelLabel);
    requestRender?.();
  }

  // MCP tools register asynchronously; refresh once the system prompt is built.
  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = event.systemPromptOptions?.cwd || ctx?.cwd || "";
    const modelLabel = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : loaded.model;
    refreshFromSystemPrompt(event.systemPromptOptions?.contextFiles, cwd, modelLabel);
  });

  // MCP connections finish in the background after startup; refresh on the
  // first turns so the header converges to the live tool set.
  pi.on("turn_start", async (_event, ctx) => {
    if (!lastCwd && !ctx?.cwd) return;
    const cwd = ctx?.cwd || lastCwd;
    const modelLabel = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : loaded.model;
    // turn_start carries no contextFiles: pass undefined to keep the
    // authoritative agents display from before_agent_start.
    snapshot(undefined, cwd, modelLabel);
    requestRender?.();
  });

  pi.on("model_select", async (event, _ctx) => {
    loaded = {
      ...loaded,
      model: event.model ? `${event.model.provider}/${event.model.id}` : loaded.model,
    };
    requestRender?.();
  });
}
