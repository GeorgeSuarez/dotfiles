import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface FallbackTarget {
	provider: string;
	model: string;
}

function targets(): FallbackTarget[] {
	return (process.env.PI_PROVIDER_FALLBACKS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => {
			const slash = value.indexOf("/");
			return slash < 0 ? { provider: value, model: "" } : { provider: value.slice(0, slash), model: value.slice(slash + 1) };
		});
}

export default function providerFallback(pi: ExtensionAPI) {
	pi.registerCommand("fallback", {
		description: "Switch to the next configured model fallback",
		handler: async (_args, ctx: ExtensionContext) => {
			const configured = targets();
			if (configured.length === 0) {
				ctx.ui.notify("Set PI_PROVIDER_FALLBACKS=provider/model,provider/model to configure fallbacks", "warning");
				return;
			}
			for (const target of configured) {
				if (!target.model) continue;
				const model = ctx.modelRegistry.find(target.provider, target.model);
				if (model && await pi.setModel(model)) {
					ctx.ui.notify(`Switched to fallback ${target.provider}/${model.id}`, "info");
					return;
				}
			}
			ctx.ui.notify("No configured fallback model is available", "error");
		},
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (event.status >= 500 || event.status === 429) {
			ctx.ui.notify(`Provider returned HTTP ${event.status}. Run /fallback to switch models.`, "warning");
		}
	});
}
