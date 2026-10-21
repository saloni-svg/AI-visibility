"use server";

import { revalidatePath } from "next/cache";
import { clearCache } from "@/lib/cache";
import { getOrStartRun, stepRun } from "@/lib/analyze";
import { currentUser } from "@/lib/auth";
import { ensureBasicBrand, ensureBrand, findBrand, setCountries } from "@/lib/brands";
import { auditStep, startAudit } from "@/lib/audit/crawl";
import { saveCompetitors, setTopicMonitoring } from "@/lib/competitors";
import { cleanDomain } from "@/lib/domain";
import { generateInsights } from "@/lib/insights";
import { setDraftStatus, startAgent, stepAgent } from "@/lib/agent/run";
import { clearOpenFixes, fixForGroup, missingQuestions, planFixes, setFixStatus, type FixGroup } from "@/lib/rag/fixes";
import { discoverPages, indexStatus, indexStep } from "@/lib/rag/index";
import { isIndexed, searchSite, type SiteMatch } from "@/lib/rag/search";
import { addKeywords, positionStep, removeKeyword, setTrackingLocation, startPositionRun, suggestKeywords } from "@/lib/positions";
import { searchLocations } from "@/lib/dataforseo";
import { connectListing, disconnect, draftReply, fetchStep, findListings, startFetch, type Listing } from "@/lib/reviews";
import { isCountry } from "@/lib/countries";
import { buildReport } from "@/lib/keyword-research";
import { buildPromptReport, getPromptReport, isMatch, isPlatformFilter } from "@/lib/prompt-research";
import { addPrompts as ptAddPrompts, checkDetail, createCampaign, deleteCampaign, removePrompt as ptRemovePrompt, runStep, startRun, suggestPrompts, updateCampaign, type CampaignInput } from "@/lib/prompt-tracking";
import { buildExplanation, loadExplanation } from "@/lib/change-explainer";
import { capturePages } from "@/lib/snapshots";
import { ensureTopics, ensureVolumes } from "@/lib/topics";
import { ensureLocation } from "@/lib/location-detect";

type Fail = { error: string };
const fail = (err: unknown): Fail => ({ error: (err as Error)?.message ?? String(err) });

async function signedIn() {
  if (!(await currentUser())) throw new Error("Your session ended. Log in again.");
}

async function brandFor(input: string) {
  const domain = cleanDomain(input);
  const brand = domain ? await findBrand(domain) : null;
  if (!brand) throw new Error("Analyze this domain first.");
  return brand;
}

// Analyze button, step 1: set up the brand, its topics and AI volume (first
// time only), then pick a run or reuse recent results.
export async function startAnalysis(
  input: string,
  force: boolean,
): Promise<Fail | { domain: string; ready: true } | { domain: string; runId: string }> {
  try {
    await signedIn();
    const domain = cleanDomain(input);
    if (!domain) return { error: "Enter a valid domain, like example.com." };
    const brand = await ensureBrand(domain);
    await ensureTopics(brand.id);
    // AI volume is looked up in the background: it never holds up the check.
    void ensureVolumes(brand.id, brand.countries).catch((err) => console.error(`AI volume lookup failed: ${err.message}`));
    // Find the business's city from its website (once), for local position tracking.
    void ensureLocation(brand.id, domain).catch((err) => console.error(`Location detection failed: ${err.message}`));
    const result = await getOrStartRun(brand, force);
    return { domain, ...result };
  } catch (err) {
    return fail(err);
  }
}

// Analyze button, step 2 (repeated): ask the next batch of questions.
export async function stepAnalysis(runId: string): Promise<Fail | { status: string; done: number; total: number }> {
  try {
    await signedIn();
    return await stepRun(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function updateCompetitors(input: string, competitors: string[]): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await saveCompetitors(brand.id, competitors);
    clearCache(brand.domain ?? undefined);
    revalidatePath("/competitors");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// Saves the countries to check from. The caller then runs Analyze, which
// collects answers for any country without recent results.
export async function updateCountries(input: string, countries: string[]): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await setCountries(brand.id, countries);
    clearCache(brand.domain ?? undefined);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function refreshInsights(input: string, runId: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await generateInsights(brand.id, runId);
    clearCache(brand.domain ?? undefined);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// "Monitor all prompts" on a topic: resume (or pause) its questions in future checks.
export async function toggleTopicMonitoring(input: string, topic: string, active: boolean): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await setTopicMonitoring(brand.id, topic, active);
    clearCache(brand.domain ?? undefined);
    revalidatePath("/competitors");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Content agent ----
export async function startContentAgent(input: string, focus: string): Promise<Fail | { runId: string }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    if (!brand.domain) throw new Error("This brand has no domain.");
    const runId = await startAgent({ id: brand.id, name: brand.name, domain: brand.domain }, focus.trim().slice(0, 300));
    return { runId };
  } catch (err) {
    return fail(err);
  }
}

export async function stepContentAgent(runId: string): Promise<Fail | { status: string; log: { at: string; kind: string; text: string }[] }> {
  try {
    await signedIn();
    return await stepAgent(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function updateDraft(input: string, draftId: string, status: "draft" | "done" | "dismissed"): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await setDraftStatus(brand.id, draftId, status);
    revalidatePath("/agent");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Site index (RAG) and exact page fixes ----
export async function startSiteIndex(input: string): Promise<Fail | { total: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { total: await discoverPages(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}

export async function siteIndexStep(input: string): Promise<Fail | Awaited<ReturnType<typeof indexStatus>>> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return await indexStep(brand.id);
  } catch (err) {
    return fail(err);
  }
}

// Plans which section each missing question should be fixed in (grouped by section).
export async function startPageFixes(input: string): Promise<Fail | { groups: FixGroup[]; questions: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    if (!(await isIndexed(brand.id))) return { error: "Index your site first." };
    const questions = await missingQuestions(brand.domain!);
    await clearOpenFixes(brand.id);
    return { groups: questions.length ? await planFixes(brand.id, questions) : [], questions: questions.length };
  } catch (err) {
    return fail(err);
  }
}

// Writes the one combined edit for one section.
export async function pageFixForGroup(input: string, group: FixGroup): Promise<Fail | { saved: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return await fixForGroup({ id: brand.id, name: brand.name }, group);
  } catch (err) {
    return fail(err);
  }
}

export async function searchMySite(input: string, query: string): Promise<Fail | { matches: SiteMatch[] }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    if (!query.trim()) return { matches: [] };
    return { matches: await searchSite(brand.id, query.trim().slice(0, 300), 5) };
  } catch (err) {
    return fail(err);
  }
}

export async function updatePageFix(input: string, id: string, status: "todo" | "done" | "dismissed"): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await setFixStatus(brand.id, id, status);
    revalidatePath("/fixes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Position tracking ----
export async function addTrackedKeywords(input: string, country: string, keywords: string[]): Promise<Fail | { added: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { added: await addKeywords(brand.id, country, keywords) };
  } catch (err) {
    return fail(err);
  }
}

export async function removeTrackedKeyword(input: string, keywordId: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await removeKeyword(brand.id, keywordId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function suggestTrackedKeywords(input: string, country: string): Promise<Fail | { keywords: string[] }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { keywords: await suggestKeywords(brand.id, brand.domain!, country) };
  } catch (err) {
    return fail(err);
  }
}

export async function startPositionCheck(input: string, country: string, options: { maps: boolean; ai: boolean } = { maps: true, ai: true }): Promise<Fail | { runId: string; total: number; imported?: number; added?: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return await startPositionRun(brand.id, country, { maps: !!options.maps, ai: !!options.ai });
  } catch (err) {
    return fail(err);
  }
}

export async function positionCheckStep(runId: string): Promise<Fail | { status: string; done: number; total: number }> {
  try {
    await signedIn();
    return await positionStep(runId);
  } catch (err) {
    return fail(err);
  }
}

// ---- Site audit ----
export async function createAuditProject(input: string): Promise<Fail | { domain: string }> {
  try {
    await signedIn();
    const domain = cleanDomain(input);
    if (!domain) return { error: "Enter a valid domain, like example.com." };
    await ensureBasicBrand(domain);
    return { domain };
  } catch (err) {
    return fail(err);
  }
}

export async function startSiteAudit(input: string): Promise<Fail | { runId: string }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { runId: await startAudit(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}

export async function siteAuditStep(runId: string): Promise<Fail | { status: string; done: number; total: number; limit: number }> {
  try {
    await signedIn();
    return await auditStep(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function findTrackingLocations(input: string, country: string, query: string): Promise<Fail | { locations: { code: number; name: string; type: string }[] }> {
  try {
    await signedIn();
    await brandFor(input);
    if (!isCountry(country)) return { error: "Unknown country." };
    return { locations: await searchLocations(country, query) };
  } catch (err) {
    return fail(err);
  }
}

export async function saveTrackingLocation(input: string, country: string, location: { code: number; name: string } | null): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await setTrackingLocation(brand.id, country, location);
    revalidatePath("/positions");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function redetectLocation(input: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await ensureLocation(brand.id, brand.domain!, true);
    revalidatePath("/positions");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Review management ----
export async function findGoogleListings(input: string, query?: string): Promise<Fail | { listings: Listing[] }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { listings: await findListings(brand.id, query) };
  } catch (err) {
    return fail(err);
  }
}

export async function connectGoogleListing(input: string, listing: Listing): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await connectListing(brand.id, listing);
    await startFetch(brand.id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function refreshReviews(input: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await startFetch(brand.id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reviewsStep(input: string): Promise<Fail | { status: string; saved?: number; error?: string }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return await fetchStep(brand.id);
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectGoogle(input: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    await disconnect(brand.id);
    revalidatePath("/reviews");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function draftReviewReply(input: string, reviewId: string): Promise<Fail | { reply: string }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { reply: await draftReply(brand.id, reviewId) };
  } catch (err) {
    return fail(err);
  }
}

// ---- Keyword research ----
export async function researchKeyword(keyword: string, country: string, device: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    if (!keyword.trim()) return { error: "Enter a keyword." };
    if (!isCountry(country)) return { error: "Pick a country." };
    await buildReport(keyword, country, device === "mobile" ? "mobile" : "desktop");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Prompt research ----
export async function researchPrompts(topic: string, country: string, platform: string, match: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    if (!topic.trim()) return { error: "Enter a topic." };
    if (!isCountry(country)) return { error: "Pick a country." };
    await buildPromptReport(topic, country, isPlatformFilter(platform) ? platform : "all", isMatch(match) ? match : "broad");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Prompt tracking ----
type PromptLine = { prompt: string; tags: string[] };

export async function createTrackingCampaign(input: CampaignInput, prompts: PromptLine[]): Promise<Fail | { id: string }> {
  try {
    await signedIn();
    return { id: await createCampaign(input, prompts) };
  } catch (err) {
    return fail(err);
  }
}

export async function updateTrackingCampaign(id: string, input: CampaignInput, add: PromptLine[], remove: string[]): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    await updateCampaign(id, input);
    for (const promptId of remove) await ptRemovePrompt(id, promptId);
    if (add.length) await ptAddPrompts(id, add);
    revalidatePath(`/tracking/${id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeTrackingPrompt(campaignId: string, promptId: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    await ptRemovePrompt(campaignId, promptId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteTrackingCampaign(id: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    await deleteCampaign(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function startTrackingRun(campaignId: string): Promise<Fail | { runId: string; total: number; done: number }> {
  try {
    await signedIn();
    return await startRun(campaignId);
  } catch (err) {
    return fail(err);
  }
}

export async function trackingRunStep(runId: string): Promise<Fail | { status: string; done: number; total: number }> {
  try {
    await signedIn();
    return await runStep(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function trackingCheckDetail(checkId: string): Promise<Fail | { detail: Awaited<ReturnType<typeof checkDetail>> }> {
  try {
    await signedIn();
    return { detail: await checkDetail(checkId) };
  } catch (err) {
    return fail(err);
  }
}

export async function suggestTrackingPrompts(domain: string, brandName: string, country: string, existing: string[]): Promise<Fail | { prompts: string[] }> {
  try {
    await signedIn();
    return { prompts: await suggestPrompts(domain, brandName, country, existing) };
  } catch (err) {
    return fail(err);
  }
}

// Top prompts from a saved Prompt Research report (the closest topics first, then AI volume).
export async function importResearchPrompts(topic: string, country: string, platform: string, match: string): Promise<Fail | { prompts: string[] }> {
  try {
    await signedIn();
    if (!isCountry(country)) return { error: "Pick a country." };
    const r = await getPromptReport(topic, country, isPlatformFilter(platform) ? platform : "all", isMatch(match) ? match : "broad");
    if (!r) return { error: "That research report isn't saved any more. Run it again in Prompt research." };
    const rank = { high: 0, medium: 1, low: 2 };
    const list = [...r.prompts].sort((a, b) => rank[r.topics[a.topic]?.relevance ?? "low"] - rank[r.topics[b.topic]?.relevance ?? "low"] || b.volume - a.volume);
    return { prompts: [...new Set(list.map((p) => p.q))].slice(0, 25) };
  } catch (err) {
    return fail(err);
  }
}

export async function searchTrackingCities(country: string, query: string): Promise<Fail | { locations: { code: number; name: string; type: string }[] }> {
  try {
    await signedIn();
    if (!isCountry(country)) return { locations: [] };
    return { locations: await searchLocations(country, query) };
  } catch (err) {
    return fail(err);
  }
}

// ---- Visibility change explainer ----
export async function explainChanges(input: string, runId: string, prevId: string, withRetest = false): Promise<Fail | { ok: true }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    const previous = await loadExplanation(runId, prevId);
    await buildExplanation(brand.id, runId, prevId, withRetest, previous);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function snapshotWebsiteNow(input: string): Promise<Fail | { pages: number }> {
  try {
    await signedIn();
    const brand = await brandFor(input);
    return { pages: await capturePages(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}
