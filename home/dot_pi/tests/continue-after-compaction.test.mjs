import { describe, expect, test } from "bun:test";
import continueAfterCompaction from "../agent/extensions/continue-after-compaction.ts";

/** Captures the handlers an extension registers, so events can be replayed. */
function fakeApi() {
  const handlers = new Map();
  const sent = [];

  return {
    sent,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    sendUserMessage(prompt, options) {
      sent.push({ prompt, options });
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    registered(event) {
      return handlers.get(event) ?? [];
    },
  };
}

function fakeContext(sessionFile) {
  return { sessionManager: { getSessionFile: () => sessionFile } };
}

/** Let the deferred `setTimeout(..., 0)` continuation run. */
async function flushTimer() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("continue-after-compaction", () => {
  test("registers session_compact and session_shutdown", () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    expect(pi.registered("session_compact")).toHaveLength(1);
    expect(pi.registered("session_shutdown")).toHaveLength(1);
  });

  test("steers a continuation prompt naming the session file and compaction entry", async () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    pi.emit("session_compact", { compactionEntry: { id: "cmp-42" } }, fakeContext("/sessions/abc.jsonl"));
    expect(pi.sent).toHaveLength(0);

    await flushTimer();

    expect(pi.sent).toHaveLength(1);
    const [{ prompt, options }] = pi.sent;
    expect(options).toEqual({ deliverAs: "steer" });
    expect(prompt).toContain('"/sessions/abc.jsonl"');
    expect(prompt).toContain('"cmp-42"');
    expect(prompt).toContain("parentId");
    expect(prompt).toContain("Do not launch a nested Pi process");
    expect(prompt).toContain("Immediately perform the next unfinished step");
  });

  test("reports an ephemeral session instead of a file path", async () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    pi.emit("session_compact", { compactionEntry: { id: "cmp-1" } }, fakeContext(undefined));
    await flushTimer();

    expect(pi.sent[0]?.prompt).toContain("This session is ephemeral");
    expect(pi.sent[0]?.prompt).not.toContain("session JSONL is");
  });

  test("handles a compaction entry whose id is not a string", async () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    pi.emit("session_compact", { compactionEntry: { id: 7 } }, fakeContext("/sessions/x.jsonl"));
    await flushTimer();

    expect(pi.sent[0]?.prompt).toContain("7");
  });

  test("cancels a pending continuation on session_shutdown", async () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    pi.emit("session_compact", { compactionEntry: { id: "cmp-1" } }, fakeContext("/sessions/abc.jsonl"));
    pi.emit("session_shutdown");
    await flushTimer();

    expect(pi.sent).toHaveLength(0);
  });

  test("sends one continuation per compaction", async () => {
    const pi = fakeApi();
    continueAfterCompaction(pi);

    pi.emit("session_compact", { compactionEntry: { id: "cmp-1" } }, fakeContext("/sessions/abc.jsonl"));
    pi.emit("session_compact", { compactionEntry: { id: "cmp-2" } }, fakeContext("/sessions/abc.jsonl"));
    await flushTimer();

    expect(pi.sent.map((entry) => entry.prompt.includes('"cmp-2"'))).toEqual([false, true]);
  });
});
