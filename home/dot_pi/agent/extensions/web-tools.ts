import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const EXA_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_URL = "https://search.parallel.ai/mcp";
const MAX_NUM_RESULTS = 20;
const MAX_CONTEXT_CHARACTERS = 50_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;

const NO_RESULTS = "No search results found. Please try a different query.";
const SEARCH_FAILURE = (query: string) => `Unable to search the web for ${query}`;

const MAX_BYTES = 50 * 1024;
const TIMEOUT_MS = 25_000;

const WebSearchParameters = Type.Object({
  query: Type.String({ description: "Websearch query" }),
  numResults: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: MAX_NUM_RESULTS,
      description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
    }),
  ),
  livecrawl: Type.Optional(
    StringEnum(["fallback", "preferred"] as const, {
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    }),
  ),
  type: Type.Optional(
    StringEnum(["auto", "fast", "deep"] as const, {
      description:
        "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: MAX_CONTEXT_CHARACTERS,
      description: `Maximum characters for context string optimized for models (default: 10000, maximum: ${MAX_CONTEXT_CHARACTERS})`,
    }),
  ),
});

type WebSearchParameters = Static<typeof WebSearchParameters>;
type Provider = "exa" | "parallel";

type McpPayload = {
  result?: {
    content?: Array<{ text?: unknown }>;
  };
};

const WebfetchParameters = Type.Object({
  url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
  format: Type.Optional(
    StringEnum(["auto", "markdown", "text", "raw"] as const, {
      description: "Output format. Auto converts HTML pages to readable text.",
    }),
  ),
});

/** Shared bounded-stream reader: accumulates up to maxBytes, reports overflow via truncated. */
async function readBoundedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  maxBytes: number,
  abortMessage: string,
): Promise<{ data: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException(abortMessage, "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException(abortMessage, "AbortError");
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        total = maxBytes;
        truncated = true;
        await reader.cancel("response too large");
        break;
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data, truncated };
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && !["", "0", "false", "no", "off"].includes(value.toLowerCase());
}

/**
 * Keep provider selection compatible with OpenCode's environment contract.
 * Exa is the safe default because its hosted endpoint works without a key.
 */
export function selectProvider(): Provider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER;
  if (override === "exa" || override === "parallel") return override;
  if (
    truthy(process.env.OPENCODE_ENABLE_PARALLEL) ||
    truthy(process.env.OPENCODE_EXPERIMENTAL_PARALLEL)
  ) {
    return "parallel";
  }
  return "exa";
}

function exaUrl(): string {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return EXA_URL;
  const url = new URL(EXA_URL);
  url.searchParams.set("exaApiKey", apiKey);
  return url.toString();
}

function modelName(ctx: ExtensionContext): string | undefined {
  const model = ctx.model;
  if (!model) return undefined;
  return model.id.slice(0, 100);
}

function requestBody(
  provider: Provider,
  params: WebSearchParameters,
  ctx: ExtensionContext,
): string {
  const args =
    provider === "exa"
      ? {
          query: params.query,
          type: params.type ?? "auto",
          numResults: params.numResults ?? 8,
          livecrawl: params.livecrawl ?? "fallback",
          ...(params.contextMaxCharacters === undefined
            ? {}
            : { contextMaxCharacters: params.contextMaxCharacters }),
        }
      : {
          objective: params.query,
          search_queries: [params.query],
          session_id: ctx.sessionManager.getSessionId(),
          ...(modelName(ctx) ? { model_name: modelName(ctx) } : {}),
        };

  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: provider === "exa" ? "web_search_exa" : "web_search",
      arguments: args,
    },
  });
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Search response exceeded the maximum size");
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Search response exceeded the maximum size");
    }
    return text;
  }

  const { data, truncated } = await readBoundedStream(
    response.body.getReader(),
    signal,
    MAX_RESPONSE_BYTES,
    "The search request was aborted",
  );
  if (truncated) {
    throw new Error("Search response exceeded the maximum size");
  }
  return new TextDecoder().decode(data);
}

function payloadText(payload: string): string | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;
  const data = JSON.parse(trimmed) as McpPayload;
  return data.result?.content?.find((item) => typeof item.text === "string" && item.text.length > 0)
    ?.text as string | undefined;
}

/** Parse the plain JSON and SSE response forms returned by hosted MCP servers. */
export function parseSearchResponse(body: string): string | undefined {
  const trimmed = body.trim();
  const direct = trimmed ? payloadText(trimmed) : undefined;
  if (direct) return direct;

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const text = payloadText(line.slice(6));
    if (text) return text;
  }
  return undefined;
}

async function fetchSearch(
  provider: Provider,
  params: WebSearchParameters,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortParent, { once: true });

  try {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (provider === "parallel") {
      headers["User-Agent"] = "pi-websearch/1";
      if (process.env.PARALLEL_API_KEY) {
        headers.Authorization = `Bearer ${process.env.PARALLEL_API_KEY}`;
      }
    }

    const response = await fetch(provider === "exa" ? exaUrl() : PARALLEL_URL, {
      method: "POST",
      headers,
      body: requestBody(provider, params, ctx),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Search request failed with HTTP ${response.status}`);
    return parseSearchResponse(await readBody(response, controller.signal));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortParent);
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html
    .replace(/<(script|style|noscript|template|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h1[^>]*>/gi, "\n# ")
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|article|section|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [title ? `# ${decodeEntities(title.trim())}` : "", text].filter(Boolean).join("\n\n");
}

async function readBounded(
  response: Response,
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const raw = await response.text();
    const bytes = new TextEncoder().encode(raw);
    return {
      text: new TextDecoder().decode(bytes.slice(0, MAX_BYTES)),
      truncated: bytes.byteLength > MAX_BYTES,
    };
  }
  const { data, truncated } = await readBoundedStream(
    response.body.getReader(),
    signal,
    MAX_BYTES,
    "Fetch aborted",
  );
  return { text: new TextDecoder().decode(data), truncated };
}

function validateUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  return url;
}

export default function web(pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: `Search the web using a hosted search provider. Use this for current information beyond your knowledge cutoff. The current year is ${new Date().getFullYear()}; include it when searching for recent events or data.`,
    promptSnippet: "Search the web for current information",
    promptGuidelines: [
      "Use websearch for current or external information beyond the local workspace.",
      "Use the returned source context as evidence and preserve source URLs when citing findings.",
    ],
    parameters: WebSearchParameters,
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const query = params.query.trim();
      if (!query) throw new Error("Websearch query cannot be empty");

      const normalized = { ...params, query };
      const provider = selectProvider();
      try {
        const result = await fetchSearch(provider, normalized, ctx, signal);
        return {
          content: [{ type: "text", text: result ?? NO_RESULTS }],
          details: { provider, query },
        };
      } catch {
        return {
          content: [{ type: "text", text: SEARCH_FAILURE(query) }],
          details: { provider, query, error: true },
        };
      }
    },
  });
  pi.registerTool({
    name: "webfetch",
    label: "Web Fetch",
    description:
      "Fetch a web page or API response and return bounded, readable content with its source URL.",
    promptSnippet: "Fetch and read a specific web page or API URL",
    promptGuidelines: [
      "Use webfetch after websearch when you need authoritative content from a specific URL.",
      "Preserve the fetched source URL when citing webfetch results.",
    ],
    parameters: WebfetchParameters,
    execute: async (_toolCallId, params, signal) => {
      const url = validateUrl(params.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "text/markdown, text/html, application/json, text/plain;q=0.9, */*;q=0.1",
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fetched = await readBounded(response, controller.signal);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const format = params.format ?? "auto";
        const text =
          format === "raw" ||
          format === "text" ||
          (format === "auto" && !contentType.includes("html"))
            ? fetched.text
            : htmlToText(fetched.text);
        return {
          content: [
            {
              type: "text",
              text: `Source: ${url}${fetched.truncated ? " (response truncated)" : ""}\n\n${text}`,
            },
          ],
          details: { url: url.toString(), contentType, truncated: fetched.truncated },
        };
      } catch (error) {
        throw new Error(
          `Unable to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
