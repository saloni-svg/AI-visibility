import { aiOverview } from "./aiOverview";
import { gemini } from "./gemini";
import { openai } from "./openai";
import { perplexity } from "./perplexity";
import type { Provider, ProviderName } from "./types";

export const providers: Provider[] = [openai, aiOverview, gemini, perplexity];

export const providerByName = Object.fromEntries(providers.map((p) => [p.name, p])) as Record<ProviderName, Provider>;

// A provider runs only when all its keys are in .env.
export const isReady = (p: Provider) => p.requiredEnv.every((name) => !!process.env[name]);

export type { Citation, Provider, ProviderName } from "./types";
