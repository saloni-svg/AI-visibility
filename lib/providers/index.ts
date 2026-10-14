import { gemini } from "./gemini";
import { openai } from "./openai";
import { perplexity } from "./perplexity";
import type { Provider, ProviderName } from "./types";

export const providers: Provider[] = [openai, gemini, perplexity];

export const providerByName = Object.fromEntries(providers.map((p) => [p.name, p])) as Record<
  ProviderName,
  Provider
>;

export type { Citation, Provider, ProviderName } from "./types";
