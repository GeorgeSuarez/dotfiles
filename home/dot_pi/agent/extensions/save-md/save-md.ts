import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("\n\n");
}

export default function saveMarkdownExtension(pi: ExtensionAPI) {
  pi.registerCommand("save-md", {
    description: "Save the latest Assistant response as Markdown (usage: /save-md name)",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const branch = ctx.sessionManager.getBranch();
      // Structural type taken from the entry itself: the message carries the
      // @earendil-works/pi-ai copy pinned by pi-agent-core, not the workspace's
      // top-level one, so annotating with the imported AssistantMessage clashes.
      let assistantMessage: { content: unknown } | undefined;
      for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];
        if (entry?.type === "message" && entry.message.role === "assistant") {
          assistantMessage = entry.message;
          break;
        }
      }

      if (!assistantMessage) {
        ctx.ui.notify("No assistant response to save", "warning");
        return;
      }

      const name = args.trim();
      if (!name) {
        ctx.ui.notify("Usage: /save-md name", "warning");
        return;
      }

      const markdown = textContent(assistantMessage.content);
      if (!markdown.trim()) {
        ctx.ui.notify("The latest assistant response has no Markdown text", "warning");
        return;
      }

      const fileName = name.endsWith(".md") ? name : `${name}.md`;
      const path = resolve(ctx.cwd, fileName);

      try {
        await writeFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          ctx.ui.notify(`File already exists: ${path}`, "error");
          return;
        }
        throw error;
      }

      const message = `Saved Markdown to ${path}`;
      pi.sendMessage(
        {
          customType: "save-md",
          content: message,
          display: true,
        },
        { deliverAs: "nextTurn" },
      );
      ctx.ui.notify(message, "info");
    },
  });
}
