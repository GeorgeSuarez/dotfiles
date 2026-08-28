import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

/**
 * Routes auto-compaction to a cheap model instead of the active conversation model
 * (which runs at the configured thinking level — with `max` that is the most
 * expensive call in the session). Falls back to pi's default compaction when the
 * configured model is unavailable or summarization fails.
 *
 * Configure with PI_COMPACTION_MODEL=provider/model (default opencode-go/ox-alpha-free).
 */

const SUMMARY_PROMPT = `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.`;

function findCompactionModel(ctx: ExtensionContext) {
  const value = process.env.PI_COMPACTION_MODEL ?? "opencode-go/mimo-v2.5";
  const slash = value.indexOf("/");
  if (slash <= 0) return undefined;
  return ctx.modelRegistry.find(value.slice(0, slash), value.slice(slash + 1));
}

export default function cheapCompaction(pi: ExtensionAPI) {
  let modelWarned = false;

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
    } = preparation;

    const model = findCompactionModel(ctx);
    if (!model) {
      if (!modelWarned) {
        modelWarned = true;
        ctx.ui.notify(
          `cheap-compaction: model not found (PI_COMPACTION_MODEL=${process.env.PI_COMPACTION_MODEL ?? "opencode-go/mimo-v2.5"}); using default compaction`,
          "warning",
        );
      }
      return;
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    const conversationText = serializeConversation(convertToLlm(allMessages));
    const previousContext = previousSummary
      ? `\n\nPrevious session summary for context:\n${previousSummary}`
      : "";

    try {
      const response = await ctx.modelRegistry.complete(
        model,
        {
          messages: [
            {
              role: "user",
              timestamp: Date.now(),
              content: [
                {
                  type: "text",
                  text: `${SUMMARY_PROMPT}${previousContext}\n\n<conversation>\n${conversationText}\n</conversation>`,
                },
              ],
            },
          ],
        },
        { maxTokens: 8192, signal, cacheRetention: "none", sessionId: uuidv7() },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      if (!summary.trim()) {
        if (!signal.aborted)
          ctx.ui.notify("cheap-compaction: empty summary, using default compaction", "warning");
        return;
      }

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          usage: response.usage,
        },
      };
    } catch (error) {
      if (!signal.aborted)
        ctx.ui.notify(
          `cheap-compaction failed, using default compaction: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      return;
    }
  });
}
