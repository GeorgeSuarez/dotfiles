import { describe, expect, test } from "bun:test";
import workerConfigurationGuard, {
  findWorkerConfigurationMutation,
} from "../agent/extensions/worker-configuration-guard.ts";

/** Captures the handlers an extension registers, so tool calls can be replayed. */
function fakeApi() {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registered(event) {
      return handlers.get(event) ?? [];
    },
  };
}

function fakeContext() {
  const notifications = [];
  return {
    hasUI: true,
    notifications,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };
}

/** Replay a tool call through every registered `tool_call` handler. */
function runToolCall(event, ctx = fakeContext()) {
  const pi = fakeApi();
  workerConfigurationGuard(pi);
  let result;
  for (const handler of pi.registered("tool_call")) {
    result = handler(event, ctx) ?? result;
  }
  return { result, ctx };
}

function writeEvent(path) {
  return { type: "tool_call", toolCallId: "1", toolName: "write", input: { path, content: "x" } };
}

function editEvent(path) {
  return { type: "tool_call", toolCallId: "1", toolName: "edit", input: { path, oldText: "a", newText: "b" } };
}

function bashEvent(command) {
  return { type: "tool_call", toolCallId: "1", toolName: "bash", input: { command } };
}

describe("findWorkerConfigurationMutation", () => {
  test("ignores commands that do not touch the generated file", () => {
    expect(findWorkerConfigurationMutation("wrangler types")).toBeUndefined();
    expect(findWorkerConfigurationMutation("cat worker-configuration.d.ts")).toBeUndefined();
    expect(findWorkerConfigurationMutation("grep -n wrangler worker-configuration.d.ts")).toBeUndefined();
    expect(findWorkerConfigurationMutation("ls src/")).toBeUndefined();
    expect(findWorkerConfigurationMutation("")).toBeUndefined();
  });

  test("flags output redirection into the generated file", () => {
    expect(findWorkerConfigurationMutation("wrangler types > worker-configuration.d.ts")).toBe(
      "output-redirection",
    );
    expect(findWorkerConfigurationMutation("echo x >> worker-configuration.d.ts")).toBe(
      "output-redirection",
    );
    expect(findWorkerConfigurationMutation("echo x 2>> ./worker-configuration.d.ts")).toBe(
      "output-redirection",
    );
  });

  test("flags direct mutation commands", () => {
    for (const command of [
      "rm worker-configuration.d.ts",
      "rm -f worker-configuration.d.ts",
      "tee worker-configuration.d.ts",
      "touch worker-configuration.d.ts",
      "truncate -s 0 worker-configuration.d.ts",
    ]) {
      expect(findWorkerConfigurationMutation(command)).toBe("direct-file-command");
    }
  });

  test("flags in-place edits", () => {
    expect(findWorkerConfigurationMutation("sed -i 's/a/b/' worker-configuration.d.ts")).toBe(
      "in-place-edit",
    );
    expect(findWorkerConfigurationMutation("sed -i.bak 's/a/b/' worker-configuration.d.ts")).toBe(
      "in-place-edit",
    );
    expect(findWorkerConfigurationMutation("perl --in-place -pe 's/a/b/' worker-configuration.d.ts")).toBe(
      "in-place-edit",
    );
  });

  test("only flags sed without -i when it is not also a mutation", () => {
    expect(findWorkerConfigurationMutation("sed -n '1,5p' worker-configuration.d.ts")).toBeUndefined();
  });

  test("flags copy destinations but not copy sources", () => {
    expect(findWorkerConfigurationMutation("cp /tmp/types worker-configuration.d.ts")).toBe(
      "copy-destination",
    );
    expect(findWorkerConfigurationMutation("mv worker-configuration.d.ts /tmp/")).toBeUndefined();
    expect(findWorkerConfigurationMutation("rsync -a src/ ./worker-configuration.d.ts")).toBe(
      "copy-destination",
    );
  });

  test("flags dd of=", () => {
    expect(findWorkerConfigurationMutation("dd if=/dev/zero of=worker-configuration.d.ts bs=1")).toBe(
      "direct-file-command",
    );
  });

  test("sees the mutation in a later shell segment", () => {
    expect(findWorkerConfigurationMutation("cd app && wrangler types > worker-configuration.d.ts")).toBe(
      "output-redirection",
    );
    expect(findWorkerConfigurationMutation("true; rm -f worker-configuration.d.ts")).toBe(
      "direct-file-command",
    );
    expect(findWorkerConfigurationMutation("true || rm worker-configuration.d.ts")).toBe(
      "direct-file-command",
    );
  });

  test("handles quoted paths and flags with values", () => {
    expect(findWorkerConfigurationMutation('rm -f "worker-configuration.d.ts"')).toBe(
      "direct-file-command",
    );
    expect(findWorkerConfigurationMutation("rm -rf -- worker-configuration.d.ts")).toBe(
      "direct-file-command",
    );
  });

  test("matches the filename at any depth, including @-prefixed tool paths", () => {
    expect(findWorkerConfigurationMutation("rm packages/api/worker-configuration.d.ts")).toBe(
      "direct-file-command",
    );
    expect(findWorkerConfigurationMutation("rm @src/worker-configuration.d.ts")).toBe(
      "direct-file-command",
    );
  });

  test("ignores a lookalike filename", () => {
    expect(findWorkerConfigurationMutation("rm worker-configuration.d.ts.bak")).toBeUndefined();
    expect(findWorkerConfigurationMutation("rm my-worker-configuration.d.ts")).toBeUndefined();
  });
});

describe("worker-configuration-guard tool hook", () => {
  test("blocks write and edit on the generated file", () => {
    for (const event of [writeEvent("worker-configuration.d.ts"), editEvent("worker-configuration.d.ts")]) {
      const { result, ctx } = runToolCall(event);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("wrangler types");
      expect(ctx.notifications).toHaveLength(1);
      expect(ctx.notifications[0]?.type).toBe("warning");
    }
  });

  test("blocks a nested path to the generated file", () => {
    expect(runToolCall(writeEvent("app/worker-configuration.d.ts")).result?.block).toBe(true);
  });

  test("allows unrelated write and edit calls", () => {
    expect(runToolCall(writeEvent("src/index.ts")).result).toBeUndefined();
    expect(runToolCall(editEvent("wrangler.jsonc")).result).toBeUndefined();
  });

  test("blocks mutating bash calls and allows read-only ones", () => {
    expect(runToolCall(bashEvent("rm worker-configuration.d.ts")).result?.block).toBe(true);
    expect(runToolCall(bashEvent("cat worker-configuration.d.ts")).result).toBeUndefined();
  });

  test("does not notify when there is no UI", () => {
    const ctx = { hasUI: false, notifications: [] };
    const { result } = runToolCall(bashEvent("rm worker-configuration.d.ts"), ctx);
    expect(result?.block).toBe(true);
    expect(ctx.notifications).toHaveLength(0);
  });
});
