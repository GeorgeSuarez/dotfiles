import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ModelPayload {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
}

function modelConfig(model: ModelPayload) {
	return {
		id: model.id,
		name: model.name ?? model.id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.context_window ?? 128_000,
		maxTokens: model.max_tokens ?? 16_384,
	};
}

function configuredModels(): ReturnType<typeof modelConfig>[] {
	const values = (process.env.PI_LOCAL_MODELS ?? "auto")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return values.map((id) => modelConfig({ id }));
}

export default function localProvider(pi: ExtensionAPI) {
	const baseUrl = process.env.PI_LOCAL_PROVIDER_URL;
	if (!baseUrl) return;

	const providerName = process.env.PI_LOCAL_PROVIDER_NAME ?? "local-openai";
	const apiKey = process.env.PI_LOCAL_PROVIDER_API_KEY ?? "local";
	const initialModels = configuredModels();

	pi.registerProvider(providerName, {
		name: `Local (${providerName})`,
		baseUrl: baseUrl.replace(/\/$/, ""),
		api: "openai-completions",
		apiKey,
		authHeader: apiKey !== "local",
		models: initialModels,
		refreshModels: async ({ signal }) => {
			const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { signal });
			if (!response.ok) throw new Error(`Local provider model discovery failed: HTTP ${response.status}`);
			const payload = (await response.json()) as { data?: ModelPayload[] };
			return payload.data?.filter((model) => model.id).map(modelConfig) ?? initialModels;
		},
	});

	pi.registerCommand("providers", {
		description: "Show configured local provider and model discovery settings",
		handler: async (_args, ctx: ExtensionContext) => {
			ctx.ui.notify(
				[`Provider: ${providerName}`, `Endpoint: ${baseUrl}`, `Models: ${initialModels.map((model) => model.id).join(", ")}`, "Use /model refresh or the model selector to discover live models."].join("\n"),
				"info",
			);
		},
	});

	pi.on("model_select", (event, ctx) => {
		if (event.model.provider === providerName) {
			ctx.ui.setStatus("local-provider", ctx.ui.theme.fg("muted", `local:${event.model.id}`));
		}
	});
}
