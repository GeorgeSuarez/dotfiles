# OpenCode web search: implementation research

**Research snapshot:** OpenCode repository `anomalyco/opencode` at commit [`8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e`](https://github.com/anomalyco/opencode/commit/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e) (`dev`). The repository currently has no notes/Markdown convention; this report therefore uses `research/opencode-web-search.md`.

## Executive summary

OpenCode exposes an LLM tool named `websearch`. Its normal implementation is a local tool that POSTs a JSON-RPC MCP `tools/call` request to a hosted search backend, then returns the first textual item from `result.content`. The documented backend is Exa at `https://mcp.exa.ai/mcp`; the current source also supports a Parallel backend at `https://search.parallel.ai/mcp`. The tool returns provider-produced text, not a normalized array of `{title, url, snippet}` results. [`packages/opencode/src/tool/websearch.ts#L99-L143`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L99-L143) [`packages/core/src/tool/websearch.ts#L99-L123`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L99-L123)

The smallest compatible Pi implementation is one global extension, `agent/extensions/websearch.ts`, registering a `websearch` custom tool and making the same Exa MCP request. It needs no new dependency or settings change: this repository already depends on TypeBox and Pi's extension API, and Pi auto-discovers files in the global agent `extensions/` directory. Add Parallel selection, API-key handling, approval policy, and richer rendering only after the Exa-compatible path is tested. [`package.json#L4-L15`](../package.json#L4-L15) [Pi extension loader `loader.js#L543-L562`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js#L543-L562)

## What OpenCode currently implements

### Tool identity and availability

- The public tool name is `websearch`; it is registered as a built-in tool and filtered into the model's tool list only for the OpenCode and OpenCode Go providers, or when the Exa/Parallel runtime flags are enabled. [`packages/opencode/src/tool/registry.ts#L58-L65`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/registry.ts#L58-L65) [`packages/opencode/src/tool/registry.ts#L291-L303`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/registry.ts#L291-L303)
- The official docs describe the same availability rule as OpenCode/OpenCode Go or `OPENCODE_ENABLE_EXA` truthy, and show `permission.websearch: "allow"`. The docs describe Exa as requiring no API key and distinguish `websearch` (discovery) from `webfetch` (retrieval). [`packages/web/src/content/docs/tools.mdx#L255-L285`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/web/src/content/docs/tools.mdx#L255-L285)
- The current source has two layers: the package-level tool in `packages/opencode` and the V2 core tool in `packages/core`. Both use the same tool name and hosted MCP protocol, but the V2 implementation adds bounded input/output handling. [`packages/opencode/src/tool/registry.ts#L101-L110`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/registry.ts#L101-L110) [`packages/core/src/tool/websearch.ts#L18-L25`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L18-L25)

### Input shape

The package-level tool accepts a required `query` and optional `numResults`, `livecrawl`, `type`, and `contextMaxCharacters`. The defaults sent to Exa are `numResults: 8`, `livecrawl: "fallback"`, and `type: "auto"`; `contextMaxCharacters` is forwarded only when supplied. [`packages/opencode/src/tool/websearch.ts#L8-L26`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L8-L26) [`packages/opencode/src/tool/websearch.ts#L99-L123`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L99-L123)

The V2 schema preserves those controls but validates `numResults` as positive and at most 20, and `contextMaxCharacters` as positive and at most 50,000. [`packages/core/src/tool/websearch.ts#L28-L57`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L28-L57) The V2 tests explicitly cover rejection of zero, over-maximum result counts, and over-maximum context length. [`packages/core/test/tool-websearch.test.ts#L23-L29`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L23-L29)

### Provider selection and endpoints

The current provider set is `exa | parallel`. Selection is:

1. `OPENCODE_WEBSEARCH_PROVIDER=exa|parallel`, when valid;
2. otherwise Parallel when its enable flag is true;
3. otherwise Exa when its enable flag is true;
4. otherwise a stable per-session choice based on a checksum of the session ID.

The V2 implementation uses the same ordering, with an explicit provider override at the service boundary. [`packages/opencode/src/tool/websearch.ts#L29-L47`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L29-L47) [`packages/core/src/tool/websearch.ts#L59-L97`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L59-L97)

The source-level environment contract is:

- `OPENCODE_WEBSEARCH_PROVIDER` selects a provider;
- `OPENCODE_EXPERIMENTAL`, `OPENCODE_ENABLE_EXA`, or `OPENCODE_EXPERIMENTAL_EXA` enables Exa;
- `OPENCODE_ENABLE_PARALLEL` or `OPENCODE_EXPERIMENTAL_PARALLEL` enables Parallel;
- `EXA_API_KEY` is optional and is placed in the Exa URL as the `exaApiKey` query parameter;
- `PARALLEL_API_KEY` is optional and is sent as a bearer credential.

[`packages/core/src/tool/websearch.ts#L72-L86`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L72-L86) [`packages/core/src/tool/websearch.ts#L145-L150`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L145-L150)

### Exact API calls

For Exa, OpenCode POSTs to `https://mcp.exa.ai/mcp` (or the same URL with `?exaApiKey=...`) with `Accept: application/json, text/event-stream` and this JSON-RPC envelope:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "web_search_exa",
    "arguments": {
      "query": "...",
      "type": "auto",
      "numResults": 8,
      "livecrawl": "fallback"
    }
  }
}
```

The request construction and exact Exa argument names are in the source, while the tests assert the complete serialized body. [`packages/core/src/tool/websearch.ts#L125-L169`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L125-L169) [`packages/core/test/tool-websearch.test.ts#L138-L203`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L138-L203)

For Parallel, the package-level implementation calls `https://search.parallel.ai/mcp`, tool `web_search`, and sends `objective`, one-element `search_queries`, `session_id`, and the model name when available. It sends `User-Agent: opencode/<InstallationVersion>` and an optional bearer credential. [`packages/opencode/src/tool/mcp-websearch.ts#L1-L15`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/mcp-websearch.ts#L1-L15) [`packages/opencode/src/tool/websearch.ts#L53-L97`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L53-L97) The V2 path intentionally omits `model_name` because its invocation context does not safely expose the model yet. [`packages/core/src/tool/websearch.ts#L228-L243`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L228-L243)

### Response shape and parsing

OpenCode expects an MCP JSON-RPC response shaped like:

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "provider-produced search context" }
    ]
  }
}
```

It accepts either a plain JSON response or newline-delimited SSE frames beginning with `data: `. It chooses the first `content` element whose `text` is truthy and returns that text. Non-JSON SSE frames such as `[DONE]` are ignored. [`packages/core/src/tool/websearch.ts#L99-L123`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L99-L123) [`packages/core/test/tool-websearch.test.ts#L50-L62`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L50-L62)

At the package-level tool boundary, the result is `{ output, title, metadata: { provider } }`; at the V2 boundary it is `{ provider, text }`, converted to model text. Neither boundary normalizes individual search hits into a URL/title/snippet array. [`packages/opencode/src/tool/websearch.ts#L99-L143`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L99-L143) [`packages/core/src/tool/websearch.ts#L187-L205`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L187-L205)

An empty response becomes `No search results found. Please try a different query.`; malformed JSON, transport, and other execution failures take the error path instead. [`packages/core/src/tool/websearch.ts#L18-L19`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L18-L19) [`packages/core/src/tool/websearch.ts#L244-L249`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L244-L249)

### Errors, limits, and permission behavior

- The V2 implementation bounds the response body at 256 KiB, cancels an oversized stream, and times out each backend call after 25 seconds. All failures are mapped to `Unable to search the web for <query>`. [`packages/core/src/tool/websearch.ts#L18-L25`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L18-L25) [`packages/core/src/tool/websearch.ts#L171-L185`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L171-L185) [`packages/core/src/tool/websearch.ts#L244-L249`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L244-L249)
- The V2 tests verify the fixed error text and cancellation behavior for an oversized response. [`packages/core/test/tool-websearch.test.ts#L282-L315`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L282-L315)
- Before the network call, V2 asserts the `websearch` permission against the query and records provider/input metadata. The package-level tool uses the equivalent `ctx.ask` permission request with `permission: "websearch"`, query pattern, and wildcard approval. [`packages/core/src/tool/websearch.ts#L206-L217`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L206-L217) [`packages/opencode/src/tool/websearch.ts#L111-L130`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/opencode/src/tool/websearch.ts#L111-L130)
- OpenCode's docs say tools are allowed by default and can be changed to allow, deny, or ask with the `permission` field. [`packages/web/src/content/docs/tools.mdx#L6-L38`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/web/src/content/docs/tools.mdx#L6-L38)

### Built-in search versus generic MCP and provider-native search

The built-in `websearch` is not configured by adding an Exa entry under OpenCode's generic `mcp` config; its source directly calls the hosted endpoint. Generic MCP configuration is a separate facility for local/remote servers, with `type`, `url`, optional headers, enablement, OAuth, and timeout fields. [`packages/core/src/tool/websearch.ts#L152-L185`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L152-L185) [`packages/core/src/v1/config/mcp.ts#L44-L62`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/v1/config/mcp.ts#L44-L62)

OpenCode also contains provider-native OpenAI/GitHub Copilot web-search factories. Those are a different integration: their action input supports provider-side `search`, `open_page`, and `find`, while search context size, domain filters, and location are provider options. They should not be confused with the local `websearch` tool's Exa/Parallel MCP request. [`packages/core/src/github-copilot/responses/tool/web-search.ts#L1-L102`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/github-copilot/responses/tool/web-search.ts#L1-L102) [`packages/core/src/github-copilot/responses/tool/web-search-preview.ts#L1-L103`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/github-copilot/responses/tool/web-search-preview.ts#L1-L103)

## Pi repository fit

- The repository is a private ESM package with TypeBox and Pi coding-agent dependencies, but has no test or build scripts. [`package.json#L1-L15`](../package.json#L1-L15)
- `agent/settings.json` has an empty explicit `extensions` list, but the installed Pi loader separately discovers files under the global agent directory's `extensions/` path. [`agent/settings.json#L1-L10`](../agent/settings.json#L1-L10) [Pi `loader.js#L543-L562`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js#L543-L562)
- Existing extensions are simple default-exported factories. The current repository uses `agent/extensions/skill-toggler.ts`, `git-interceptor.ts`, and `protected-paths.ts`; none registers a web-search tool. [`agent/extensions/skill-toggler.ts#L28-L30`](../agent/extensions/skill-toggler.ts#L28-L30) [`agent/extensions/git-interceptor.ts#L13-L23`](../agent/extensions/git-interceptor.ts#L13-L23) [`agent/extensions/protected-paths.ts#L240-L267`](../agent/extensions/protected-paths.ts#L240-L267)
- Pi's extension API registers an LLM-callable tool with `pi.registerTool`; a definition contains `name`, `label`, `description`, a TypeBox `parameters` schema, and an async `execute` function. [`@earendil-works/pi-coding-agent` `types.d.ts#L342-L376`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L342-L376) The returned result is `{ content: [{ type: "text", text }], details }`; the Pi agent-core type defines `content` as the model-visible text/image content and `details` as arbitrary structured UI/log data. [`@earendil-works/pi-agent-core` `types.d.ts#L316-L325`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts#L316-L325) The repository already has the same minimal pattern in the official Pi example. [`@earendil-works/pi-coding-agent` `examples/extensions/hello.ts#L1-L30`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts#L1-L30)
- Pi exposes `ctx.cwd`, `ctx.hasUI`, `ctx.signal`, and the current model/session context to an extension. [`@earendil-works/pi-coding-agent` `types.d.ts#L209-L236`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L209-L236)

## Smallest compatible implementation plan

### Phase 1: Exa-compatible `websearch` tool

Create only `agent/extensions/websearch.ts`:

1. Import `Type` from the already-installed TypeBox dependency and `ExtensionAPI` from Pi.
2. Register the exact tool name `websearch`, with a required `query` and optional `numResults`, `livecrawl`, `type`, and `contextMaxCharacters` fields. For the first version, enforce the V2 limits (1–20 results and 1–50,000 context characters) in the TypeBox schema or a small runtime check. [`package.json#L9-L13`](../package.json#L9-L13) [`packages/core/src/tool/websearch.ts#L28-L57`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L28-L57)
3. Use `fetch("https://mcp.exa.ai/mcp", { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, body, signal })`, with the JSON-RPC body and Exa argument defaults shown above. Pass the tool's abort signal to fetch; cap the operation at 25 seconds and cap response accumulation at 256 KiB to match the hardened V2 behavior. [`packages/core/src/tool/websearch.ts#L152-L185`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L152-L185)
4. Parse both a direct JSON body and `data: ` SSE lines; select the first truthy `result.content[].text`. Return the OpenCode no-results fallback for an empty response and the fixed `Unable to search the web for <query>` text for network, HTTP, timeout, size, or decode failures. [`packages/core/src/tool/websearch.ts#L99-L123`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L99-L123) [`packages/core/src/tool/websearch.ts#L244-L249`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L244-L249)
5. Return `{ content: [{ type: "text", text }], details: { provider: "exa", query } }`. This is the Pi-compatible equivalent of OpenCode's text-only model output while retaining provider/query metadata outside the model content. [`@earendil-works/pi-agent-core` `types.d.ts#L316-L325`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts#L316-L325) [`packages/core/src/tool/websearch.ts#L187-L205`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L187-L205)

This phase intentionally does not add an Exa API key, generic MCP client, web-page fetcher, or provider-native search. The official OpenCode docs say the hosted Exa path needs no key, while the source confirms that a key is optional; direct HTTP is therefore smaller than implementing OpenCode's generic MCP lifecycle. [`packages/web/src/content/docs/tools.mdx#L279-L285`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/web/src/content/docs/tools.mdx#L279-L285) [`packages/core/src/tool/websearch.ts#L145-L150`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L145-L150)

### Phase 2: parity extensions, only if required

- Add `EXA_API_KEY` URL handling exactly as OpenCode does, keeping it out of `content` and `details`. [`packages/core/src/tool/websearch.ts#L145-L150`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L145-L150)
- Add Parallel support with `OPENCODE_WEBSEARCH_PROVIDER`, `OPENCODE_ENABLE_PARALLEL`, `PARALLEL_API_KEY`, the `User-Agent`, and the Parallel argument mapping. The provider-selection checksum is not necessary for a one-provider Pi tool and should be added only if deterministic rollout parity is a requirement. [`packages/core/src/tool/websearch.ts#L72-L97`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L72-L97) [`packages/core/src/tool/websearch.ts#L228-L243`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/src/tool/websearch.ts#L228-L243)
- If approval is required, use Pi's `ctx.hasUI`/`ctx.ui.confirm` before the network call, or add a `tool_call` handler for the custom `websearch` name. The current repository's destructive-command extension demonstrates the existing confirmation/blocking convention, but it currently handles built-in write/edit/bash paths rather than a search policy. [`@earendil-works/pi-coding-agent` `types.d.ts#L209-L236`](file:///Users/georgesuarezmbp/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L209-L236) [`agent/extensions/protected-paths.ts#L219-L267`](../agent/extensions/protected-paths.ts#L219-L267)

## Tests and acceptance criteria

There is no repository test script today, so add a focused test file or a standalone Bun test command rather than changing the existing package scripts without a decision. [`package.json#L1-L15`](../package.json#L1-L15)

At minimum, mock `fetch` and assert:

- the tool registers under exactly `websearch` and validates required `query`;
- the Exa request uses POST, the JSON-RPC envelope, `web_search_exa`, and the documented defaults;
- direct JSON and SSE responses produce the first text item, while `[DONE]` and empty content produce the no-results fallback;
- HTTP failure, malformed JSON, timeout, abort, and an over-256-KiB body produce the fixed user-visible error without leaking credentials;
- optional controls are forwarded and out-of-range values are rejected;
- the returned Pi shape is `content` text plus non-sensitive `details`.

These cases mirror OpenCode's own provider-selection, parser, request, credential-redaction, no-results, and oversized-response tests. [`packages/core/test/tool-websearch.test.ts#L23-L62`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L23-L62) [`packages/core/test/tool-websearch.test.ts#L138-L280`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L138-L280) [`packages/core/test/tool-websearch.test.ts#L282-L315`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/core/test/tool-websearch.test.ts#L282-L315)

## Decision

Implement Phase 1 as a single Pi extension using the Exa hosted MCP endpoint and OpenCode's text/SSE parsing and bounded-error contract. It matches the documented OpenCode behavior, works with this repository's current `opencode-go` default without relying on provider-native tool support, and avoids introducing a generic MCP client or new dependency. Add Parallel and permission configuration only when a concrete requirement justifies their extra surface area. [`agent/settings.json#L2-L8`](../agent/settings.json#L2-L8) [`packages/web/src/content/docs/tools.mdx#L255-L285`](https://github.com/anomalyco/opencode/blob/8b65fa2ef6372fde3109736a42e7f3aeb87f3a4e/packages/web/src/content/docs/tools.mdx#L255-L285)
