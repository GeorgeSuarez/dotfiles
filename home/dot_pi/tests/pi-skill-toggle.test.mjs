import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { DefaultSkillTogglePlanner } from "../agent/extensions/pi-skill-toggle/src/apply/planner.ts";
import { AtomicSkillChangeWriter } from "../agent/extensions/pi-skill-toggle/src/apply/writer.ts";
import { DefaultSkillLocator } from "../agent/extensions/pi-skill-toggle/src/discovery/skill-locator.ts";
import { SimpleFrontmatterCodec } from "../agent/extensions/pi-skill-toggle/src/frontmatter/parser.ts";
import { MinimalFrontmatterPatcher } from "../agent/extensions/pi-skill-toggle/src/frontmatter/patcher.ts";
import {
  deriveSkillMetadata,
  getDuplicateFrontmatterKeys,
  getDisableModelInvocation,
  hasDuplicateDisableModelInvocation,
} from "../agent/extensions/pi-skill-toggle/src/frontmatter/validation.ts";
import { classifyInvocationMode, formatSourceKind } from "../agent/extensions/pi-skill-toggle/src/inventory/classifier.ts";
import {
  filterSkills,
  modeLabel,
  toggleMode,
} from "../agent/extensions/pi-skill-toggle/src/ui/view-model.ts";

const codec = new SimpleFrontmatterCodec();
const patcher = new MinimalFrontmatterPatcher();

/** A skill body with one `disable-model-invocation` key. */
function manualOnlySkill() {
  return [
    "---",
    "name: handoff",
    "description: Compact the conversation.",
    "disable-model-invocation: true",
    "argument-hint: What next?",
    "---",
    "",
    "# Handoff",
    "",
  ].join("\n");
}

/** A skill body with the duplicated key Pi rejects. */
function duplicatedKeySkill() {
  return [
    "---",
    "name: handoff",
    "description: Compact the conversation.",
    "disable-model-invocation: true",
    "argument-hint: What next?",
    "disable-model-invocation: true",
    "---",
    "",
    "# Handoff",
    "",
  ].join("\n");
}

function countDisableKeys(raw) {
  return (raw.match(/^disable-model-invocation\s*:/gm) ?? []).length;
}

class MemoryFileSystem {
  constructor(files = new Map()) {
    this.files = new Map(files);
  }

  async readFile(path) {
    const value = this.files.get(path);

    if (value === undefined) throw new Error(`missing file: ${path}`);

    return value;
  }

  async writeFileAtomic(path, content) {
    this.files.set(path, content);
  }

  async access(path) {
    return this.files.has(path);
  }

  async readdir() {
    return [];
  }

  async realpath(path) {
    return path;
  }

  async stat() {
    return { isDirectory: false, isFile: true, mode: 0o644 };
  }
}

describe("frontmatter validation", () => {
  test("reports duplicate top-level frontmatter keys", () => {
    const doc = codec.parse(duplicatedKeySkill());

    expect(getDuplicateFrontmatterKeys(doc)).toEqual(["disable-model-invocation"]);
    expect(hasDuplicateDisableModelInvocation(doc)).toBe(true);
    expect(deriveSkillMetadata("/skills/handoff/SKILL.md", doc).diagnostics).toEqual([
      { severity: "warning", message: "Duplicate frontmatter key: disable-model-invocation" },
    ]);
  });

  test("treats a missing description as an error so the skill is read-only", () => {
    const doc = codec.parse("---\nname: nameless\n---\n\n# Body\n");
    const diagnostics = deriveSkillMetadata("/skills/nameless/SKILL.md", doc).diagnostics;

    expect(diagnostics).toContainEqual({
      severity: "error",
      message: "Missing required description; Pi will not load this skill",
    });
  });

  test("warns when the name does not match the parent directory", () => {
    const doc = codec.parse("---\nname: other\ndescription: Fine.\n---\n");
    const metadata = deriveSkillMetadata("/skills/handoff/SKILL.md", doc);

    expect(metadata.name).toBe("other");
    expect(metadata.diagnostics).toContainEqual({
      severity: "warning",
      message: "Name does not match parent directory (handoff)",
    });
  });

  test("warns when there is no frontmatter at all", () => {
    const doc = codec.parse("# Plain markdown\n");
    const metadata = deriveSkillMetadata("/skills/plain/plain.md", doc);

    expect(metadata.diagnostics).toContainEqual({ severity: "warning", message: "Missing YAML front matter" });
  });

  test("reads only the boolean true as disabling model invocation", () => {
    expect(getDisableModelInvocation(codec.parse(manualOnlySkill()))).toBe(true);
    expect(getDisableModelInvocation(codec.parse("---\ndisable-model-invocation: false\n---\n"))).toBe(false);
    expect(getDisableModelInvocation(codec.parse('---\ndisable-model-invocation: "true"\n---\n'))).toBe(false);
    expect(classifyInvocationMode(codec.parse(manualOnlySkill()))).toBe("manual-only");
    expect(classifyInvocationMode(codec.parse("---\nname: x\n---\n"))).toBe("agent-invocable");
  });
});

describe("MinimalFrontmatterPatcher", () => {
  test("does not add a second disable-model-invocation key when a skill is already manual-only", () => {
    const raw = manualOnlySkill();
    const patch = patcher.patchInvocationMode(codec.parse(raw), "manual-only");

    expect(patch.newText).toBe(raw);
    expect(countDisableKeys(patch.newText)).toBe(1);
  });

  test("collapses duplicated disable-model-invocation keys when setting manual-only", () => {
    const patch = patcher.patchInvocationMode(codec.parse(duplicatedKeySkill()), "manual-only");

    expect(countDisableKeys(patch.newText)).toBe(1);
    expect(getDuplicateFrontmatterKeys(codec.parse(patch.newText))).toEqual([]);
    expect(patch.newText).toContain("disable-model-invocation: true\nargument-hint: What next?\n---");
  });

  test("removes all disable-model-invocation keys when setting agent-invocable", () => {
    const patch = patcher.patchInvocationMode(codec.parse(duplicatedKeySkill()), "agent-invocable");

    expect(countDisableKeys(patch.newText)).toBe(0);
    expect(getDuplicateFrontmatterKeys(codec.parse(patch.newText))).toEqual([]);
    expect(patch.newText).toContain("argument-hint: What next?\n---");
  });

  test("adds frontmatter when an agent-invocable file has none", () => {
    const patch = patcher.patchInvocationMode(codec.parse("# Plain\n"), "manual-only");

    expect(patch.newText.startsWith("---\ndisable-model-invocation: true\n---\n")).toBe(true);
    expect(getDisableModelInvocation(codec.parse(patch.newText))).toBe(true);
  });

  test("preserves CRLF line endings", () => {
    const raw = ["---", "name: crlf", "description: Windows skill.", "---", "", "Body."].join("\r\n");
    const patch = patcher.patchInvocationMode(codec.parse(raw), "manual-only");

    expect(patch.newText.includes("disable-model-invocation: true\r\n")).toBe(true);
    expect(patch.newText.includes("\n") && !patch.newText.includes("\r\n")).toBe(false);
  });

  test("keeps comments and key order intact", () => {
    const raw = ["---", "# keep me", "name: handoff", "description: Compact.", "---", "", "Body."].join("\n");
    const patch = patcher.patchInvocationMode(codec.parse(raw), "manual-only");

    expect(patch.newText.includes("# keep me")).toBe(true);
    expect(patch.newText.indexOf("# keep me")).toBeLessThan(patch.newText.indexOf("disable-model-invocation"));
  });
});

describe("DefaultSkillTogglePlanner", () => {
  function skillRecord(filePath, mode) {
    return {
      id: filePath,
      name: "handoff",
      description: "Compact the conversation.",
      filePath,
      baseDir: "/skills/handoff",
      source: { kind: "user", root: "/skills" },
      editable: true,
      mode,
      diagnostics: [],
    };
  }

  test("plans a normalization change for duplicated keys even if the mode is unchanged", async () => {
    const filePath = "/skills/handoff/SKILL.md";

    const planner = new DefaultSkillTogglePlanner(
      new MemoryFileSystem(new Map([[filePath, duplicatedKeySkill()]])),
      codec,
      patcher,
    );

    const record = skillRecord(filePath, "manual-only");

    const changes = await planner.plan([record], [{ skill: record, desiredMode: "manual-only" }]);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.from).toBe("manual-only");
    expect(changes[0]?.to).toBe("manual-only");
    expect(countDisableKeys(changes[0]?.patch.newText)).toBe(1);
  });

  test("produces no change when the mode already matches", async () => {
    const filePath = "/skills/handoff/SKILL.md";

    const planner = new DefaultSkillTogglePlanner(
      new MemoryFileSystem(new Map([[filePath, manualOnlySkill()]])),
      codec,
      patcher,
    );

    const record = skillRecord(filePath, "manual-only");

    expect(await planner.plan([record], [{ skill: record, desiredMode: "manual-only" }])).toEqual([]);
  });

  test("skips read-only skills", async () => {
    const filePath = "/skills/handoff/SKILL.md";

    const planner = new DefaultSkillTogglePlanner(
      new MemoryFileSystem(new Map([[filePath, manualOnlySkill()]])),
      codec,
      patcher,
    );

    const record = { ...skillRecord(filePath, "manual-only"), editable: false };

    expect(await planner.plan([record], [{ skill: record, desiredMode: "agent-invocable" }])).toEqual([]);
  });

  test("skips skills without frontmatter instead of inventing any", async () => {
    const filePath = "/skills/plain/SKILL.md";

    const planner = new DefaultSkillTogglePlanner(
      new MemoryFileSystem(new Map([[filePath, "# Plain\n"]])),
      codec,
      patcher,
    );

    const record = skillRecord(filePath, "agent-invocable");

    expect(await planner.plan([record], [{ skill: record, desiredMode: "manual-only" }])).toEqual([]);
  });
});

describe("AtomicSkillChangeWriter", () => {
  function change(filePath, name) {
    const record = {
      id: filePath,
      name,
      description: "",
      filePath,
      baseDir: "/skills",
      source: { kind: "user", root: "/skills" },
      editable: true,
      mode: "agent-invocable",
      diagnostics: [],
    };

    return {
      skill: record,
      filePath,
      from: "agent-invocable",
      to: "manual-only",
      patch: { oldText: "OLD", newText: "NEW" },
    };
  }

  test("writes changes whose on-disk content still matches the patch", async () => {
    const fs = new MemoryFileSystem(new Map([["/skills/a/SKILL.md", "OLD"]]));
    const result = await new AtomicSkillChangeWriter(fs).apply([change("/skills/a/SKILL.md", "a")]);

    expect(result.applied).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(await fs.readFile("/skills/a/SKILL.md")).toBe("NEW");
  });

  test("skips a file that changed while the overlay was open", async () => {
    const fs = new MemoryFileSystem(new Map([["/skills/a/SKILL.md", "EDITED-ELSEWHERE"]]));
    const result = await new AtomicSkillChangeWriter(fs).apply([change("/skills/a/SKILL.md", "a")]);

    expect(result.applied).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("file changed while dialog was open");
    expect(await fs.readFile("/skills/a/SKILL.md")).toBe("EDITED-ELSEWHERE");
  });

  test("records one error per unreachable file and keeps applying the rest", async () => {
    const fs = new MemoryFileSystem(
      new Map([
        ["/skills/a/SKILL.md", "OLD"],
        ["/skills/c/SKILL.md", "OLD"],
      ]),
    );

    const result = await new AtomicSkillChangeWriter(fs).apply([
      change("/skills/a/SKILL.md", "a"),
      change("/skills/b/SKILL.md", "b"),
      change("/skills/c/SKILL.md", "c"),
    ]);

    expect(result.applied.map((entry) => entry.skill.name)).toEqual(["a", "c"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("missing file");
  });
});

describe("DefaultSkillLocator", () => {
  // `os.homedir()` is resolved once at test-runner startup, so mutating
  // process.env.HOME mid-run has no effect under `bun test`. Build the fixture
  // paths from the real home directory instead; only PI_CODING_AGENT_DIR is
  // read live by the extension.
  const HOME = homedir();
  const USER_ROOT = `${HOME}/.pi/agent`;
  const GLOBAL_ROOT = `${HOME}/.agents/skills`;
  const DOTFILES_ROOT = `${HOME}/.dotfiles/home`;
  const ORIGINAL_PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

  beforeEach(() => {
    process.env.PI_CODING_AGENT_DIR = USER_ROOT;
  });

  afterEach(() => {
    restoreEnv("PI_CODING_AGENT_DIR", ORIGINAL_PI_CODING_AGENT_DIR);
  });

  test("finds global, user, and project skills with Pi root markdown discovery rules", async () => {
    const fs = new MemoryTreeFileSystem([
      `${USER_ROOT}/skills/user-root.md`,
      `${GLOBAL_ROOT}/ignored-global-root.md`,
      `${GLOBAL_ROOT}/global-skill/SKILL.md`,
      "/repo/.pi/skills/project-root.md",
      "/repo/.agents/skills/ignored-project-legacy-root.md",
      "/repo/.agents/skills/project-legacy-skill/SKILL.md",
    ]);

    const files = await new DefaultSkillLocator(fs).findSkillFiles("/repo");
    const byPath = new Map(files.map((file) => [file.filePath, file]));

    expect(byPath.get(`${USER_ROOT}/skills/user-root.md`)?.source.kind).toBe("user");
    expect(byPath.get(`${GLOBAL_ROOT}/global-skill/SKILL.md`)?.source.kind).toBe("global");
    expect(byPath.get("/repo/.pi/skills/project-root.md")?.source.kind).toBe("project");
    expect(byPath.get("/repo/.agents/skills/project-legacy-skill/SKILL.md")?.source.kind).toBe("project-legacy");
    expect(byPath.has(`${GLOBAL_ROOT}/ignored-global-root.md`)).toBe(false);
    expect(byPath.has("/repo/.agents/skills/ignored-project-legacy-root.md")).toBe(false);
  });

  test("deduplicates global and project skill roots that resolve to the same directory", async () => {
    const canonicalSkillRoot = `${DOTFILES_ROOT}/.agents/skills`;

    const fs = new MemoryTreeFileSystem(
      [`${GLOBAL_ROOT}/code-review/SKILL.md`, `${canonicalSkillRoot}/code-review/SKILL.md`],
      new Map([
        [GLOBAL_ROOT, canonicalSkillRoot],
        [canonicalSkillRoot, canonicalSkillRoot],
      ]),
    );

    const files = await new DefaultSkillLocator(fs).findSkillFiles(DOTFILES_ROOT);

    expect(files).toHaveLength(1);
    expect(files[0]?.source.kind).toBe("global");
  });

  test("deduplicates symlinked skill files when their parent roots are distinct", async () => {
    const globalSkillFile = `${GLOBAL_ROOT}/code-review/SKILL.md`;
    const projectSkillFile = `${DOTFILES_ROOT}/.agents/skills/code-review/SKILL.md`;

    const fs = new MemoryTreeFileSystem(
      [globalSkillFile, projectSkillFile],
      new Map([
        [globalSkillFile, projectSkillFile],
        [projectSkillFile, projectSkillFile],
      ]),
    );

    const files = await new DefaultSkillLocator(fs).findSkillFiles(DOTFILES_ROOT);

    expect(files).toHaveLength(1);
    expect(files[0]?.filePath).toBe(globalSkillFile);
    expect(files[0]?.source.kind).toBe("global");
  });

  test("ignores dot directories and node_modules", async () => {
    const fs = new MemoryTreeFileSystem([
      `${GLOBAL_ROOT}/.hidden/SKILL.md`,
      `${GLOBAL_ROOT}/node_modules/pkg/SKILL.md`,
      `${GLOBAL_ROOT}/real/SKILL.md`,
    ]);

    const files = await new DefaultSkillLocator(fs).findSkillFiles("/repo");

    expect(files.map((file) => file.filePath)).toEqual([`${GLOBAL_ROOT}/real/SKILL.md`]);
  });
});

describe("skill toggle view model", () => {
  function record(overrides) {
    return {
      id: "id",
      name: "name",
      description: "description",
      filePath: "/skills/name/SKILL.md",
      baseDir: "/skills/name",
      source: { kind: "global", root: "/skills" },
      editable: true,
      mode: "agent-invocable",
      diagnostics: [],
      ...overrides,
    };
  }

  test("toggles between the two invocation modes", () => {
    expect(toggleMode("agent-invocable")).toBe("manual-only");
    expect(toggleMode("manual-only")).toBe("agent-invocable");
    expect(modeLabel("manual-only")).toBe("Manual-only");
    expect(modeLabel("agent-invocable")).toBe("Agent-invocable");
  });

  test("returns every skill for a blank or whitespace query", () => {
    const skills = [record({ id: "a", name: "alpha" }), record({ id: "b", name: "beta" })];
    expect(filterSkills(skills, "")).toHaveLength(2);
    expect(filterSkills(skills, "   ")).toHaveLength(2);
  });

  test("matches on name, description, path, source, and mode, case-insensitively", () => {
    const skills = [
      record({ id: "a", name: "handoff", description: "Compact the conversation." }),
      record({ id: "b", name: "concise", description: "Short answers.", mode: "manual-only" }),
    ];

    expect(filterSkills(skills, "HANDOFF").map((skill) => skill.id)).toEqual(["a"]);
    expect(filterSkills(skills, "compact").map((skill) => skill.id)).toEqual(["a"]);
    expect(filterSkills(skills, "manual-only").map((skill) => skill.id)).toEqual(["b"]);
    expect(filterSkills(skills, "global").map((skill) => skill.id)).toEqual(["a", "b"]);
  });

  test("requires every token to match", () => {
    const skills = [record({ id: "a", name: "handoff", description: "Compact the conversation." })];
    expect(filterSkills(skills, "handoff compact")).toHaveLength(1);
    expect(filterSkills(skills, "handoff missing")).toHaveLength(0);
  });

  test("labels every source kind", () => {
    expect(formatSourceKind("global")).toBe("Global");
    expect(formatSourceKind("user")).toBe("User");
    expect(formatSourceKind("project")).toBe("Project");
    expect(formatSourceKind("project-legacy")).toBe("Project (.agents)");
    expect(formatSourceKind("mystery")).toBe("Unknown");
  });
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

class MemoryTreeFileSystem {
  constructor(paths, canonicalPaths = new Map()) {
    this.files = new Set();
    this.dirs = new Set(["/"]);
    this.canonicalPaths = canonicalPaths;

    for (const path of paths) this.addFile(path);
  }

  async realpath(path) {
    return this.canonicalPaths.get(path) ?? path;
  }

  async readFile(path) {
    if (!this.files.has(path)) throw new Error(`missing file: ${path}`);

    return "---\nname: test\ndescription: Test skill.\n---\n";
  }

  async writeFileAtomic() {}

  async access(path) {
    return this.files.has(path) || this.dirs.has(path);
  }

  async readdir(path) {
    if (!this.dirs.has(path)) throw new Error(`missing dir: ${path}`);
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set();

    for (const dir of this.dirs) {
      if (dir === path || !dir.startsWith(prefix)) continue;
      const [name] = dir.slice(prefix.length).split("/");

      if (name) names.add(name);
    }

    for (const file of this.files) {
      if (!file.startsWith(prefix)) continue;
      const [name] = file.slice(prefix.length).split("/");

      if (name) names.add(name);
    }

    return [...names].sort().map((name) => {
      const fullPath = path === "/" ? `/${name}` : `${path}/${name}`;

      return {
        name,
        isDirectory: this.dirs.has(fullPath),
        isFile: this.files.has(fullPath),
        isSymbolicLink: false,
      };
    });
  }

  async stat(path) {
    return { isDirectory: this.dirs.has(path), isFile: this.files.has(path), mode: 0o644 };
  }

  addFile(path) {
    this.files.add(path);
    const parts = path.split("/").filter(Boolean);
    let current = "";

    for (const part of parts.slice(0, -1)) {
      current += `/${part}`;
      this.dirs.add(current);
    }
  }
}
