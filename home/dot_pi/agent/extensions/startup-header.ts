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

/** "(n) name" per server, sorted by name, from the mcp-cache shape. Pure for testing. */
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
  return formatNameList(formatMcpEntries(servers));
}

// Cache-only snapshot, no live MCP status; re-read per snapshot.
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

  function snapshot(agentsPaths: string[], cwd: string, modelLabel: string): void {
    const entries = readMcpEntries();
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
    loaded = {
      model: modelLabel || "no-model",
      cwdDir: displayCwd(cwd),
      mcps: entries.length > 0 ? formatNameList(entries) : "none",
      tools: formatNameList(toolNames),
      extensions: formatNameList(extNames),
      agents:
        agentsPaths.length === 0 ? "none" : agentsPaths.map((p) => displayPath(p, cwd)).join(", "),
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
    snapshot(scanAgentsFiles(ctx.cwd).map((f) => f.path), ctx.cwd, modelLabel);
    ctx.ui.setHeader((tui, _theme) => {
      requestRender = () => tui.requestRender();
      return {
        render: (width: number) => buildHeaderLines(_theme, width, loaded),
        invalidate() {},
      };
    });
  });

  // MCP tools register asynchronously; refresh once the system prompt is built.
  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = event.systemPromptOptions?.cwd || ctx?.cwd || "";
    const modelLabel = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : loaded.model;
    snapshot(
      (event.systemPromptOptions?.contextFiles ?? []).map((f) => f.path),
      cwd,
      modelLabel,
    );
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
