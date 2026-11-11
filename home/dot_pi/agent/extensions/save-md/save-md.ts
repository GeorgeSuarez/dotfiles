import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/** Join the text blocks of an assistant message; thinking and tool-call blocks are skipped. */
function textContent(content: AssistantMessage["content"]): string {
  const parts: string[] = [];

  for (const block of content) {
    if (block.type !== "text") continue;
    parts.push(block.text);
  }

  return parts.join("\n\n");
}

export default function saveMarkdownExtension(pi: ExtensionAPI) {
  pi.registerCommand("save-md", {
    description: "Save the latest Assistant response as Markdown (usage: /save-md name)",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const branch = ctx.sessionManager.getBranch();
      let assistentMessage: AssistantMessage | undefined;

      for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];

        if (entry?.type === "message" && entry.message.role === "assistant") {
          assistentMessage = entry.message;
          break;
        }
      }

      if (!assistentMessage) {
        ctx.ui.notify("No assistant response to save", "warning");

        return;
      }

      const name = args.trim();

      if (!name) {
        ctx.ui.notify("Usage: /save-md name", "warning");

        return;
      }

      const markdown = textContent(assistentMessage.content);

      if (!markdown.trim()) {
        ctx.ui.notify("The latest assistant response has no Markdown text", "warning");

        return;
      }

      const fileName = name.endsWith(".md") ? name : `${name}.md`;
      const root = resolve(ctx.cwd);
      const path = resolve(root, fileName);

      if (path !== root && !path.startsWith(`${root}${sep}`)) {
        ctx.ui.notify(`Refusing to write outside the working directory: ${path}`, "error");

        return;
      }

      try {
        await writeFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
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
