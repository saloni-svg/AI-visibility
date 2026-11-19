"use server";

import { revalidatePath } from "next/cache";
import { clearCache } from "@/lib/cache";
import { getOrStartRun, stepRun } from "@/lib/analyze";
import { authClient, currentUser } from "@/lib/auth";
import { createUser, currentProfile, getProfile, removeUser, resetUserPassword, setUserRole, updateProfile, type ProfileFields, type Role } from "@/lib/users";
import { logAction, logFailure, PAGE_NAMES, writeLog } from "@/lib/activity";
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
import { chooseLocation, disconnectGoogleBusiness, listLocations, postReply, type GbpLocation } from "@/lib/google-business";
import { isCountry } from "@/lib/countries";
import { buildReport } from "@/lib/keyword-research";
import { buildPromptReport, getPromptReport, isMatch, isPlatformFilter } from "@/lib/prompt-research";
import { addPrompts as ptAddPrompts, checkDetail, createCampaign, deleteCampaign, removePrompt as ptRemovePrompt, runStep, startRun, suggestPrompts, updateCampaign, type CampaignInput } from "@/lib/prompt-tracking";
import { buildExplanation, loadExplanation } from "@/lib/change-explainer";
import { capturePages } from "@/lib/snapshots";
import { ensureTopics, ensureVolumes } from "@/lib/topics";
import { ensureLocation } from "@/lib/location-detect";
import { createShareToken, SHARE_KINDS, type ShareKind } from "@/lib/share";
import { setSeoActionStatus, setSeoSources, startSeoAgent, stepSeoAgent, type Sources as SeoSources } from "@/lib/seo-agent";
import { windsorAccounts, type WindsorAccount } from "@/lib/windsor";

type Fail = { error: string };
// Every action's errors come back here: the message for the page, and the log row marked failed.
const fail = (err: unknown): Fail => {
  void logFailure(err);
  return { error: (err as Error)?.message ?? String(err) };
};

// Every action starts here: checks the login and writes the activity or query log row.
async function signedIn(action: string, detail: unknown) {
  const user = await currentUser();
  if (!user) throw new Error("Your session ended. Log in again.");
  await logAction({ id: user.id, email: user.email ?? null }, action, detail);
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
    await signedIn("startAnalysis", { input, force });
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
    await signedIn("stepAnalysis", { runId });
    return await stepRun(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function updateCompetitors(input: string, competitors: string[]): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updateCompetitors", { input, competitors });
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
    await signedIn("updateCountries", { input, countries });
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
    await signedIn("refreshInsights", { input, runId });
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
    await signedIn("toggleTopicMonitoring", { input, topic, active });
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
    await signedIn("startContentAgent", { input, focus });
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
    await signedIn("stepContentAgent", { runId });
    return await stepAgent(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function updateDraft(input: string, draftId: string, status: "draft" | "done" | "dismissed"): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updateDraft", { input, draftId, status });
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
    await signedIn("startSiteIndex", { input });
    const brand = await brandFor(input);
    return { total: await discoverPages(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}

export async function siteIndexStep(input: string): Promise<Fail | Awaited<ReturnType<typeof indexStatus>>> {
  try {
    await signedIn("siteIndexStep", { input });
    const brand = await brandFor(input);
    return await indexStep(brand.id);
  } catch (err) {
    return fail(err);
  }
}

// Plans which section each missing question should be fixed in (grouped by section).
export async function startPageFixes(input: string): Promise<Fail | { groups: FixGroup[]; questions: number }> {
  try {
    await signedIn("startPageFixes", { input });
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
    await signedIn("pageFixForGroup", { input, group });
    const brand = await brandFor(input);
    return await fixForGroup({ id: brand.id, name: brand.name }, group);
  } catch (err) {
    return fail(err);
  }
}

export async function searchMySite(input: string, query: string): Promise<Fail | { matches: SiteMatch[] }> {
  try {
    await signedIn("searchMySite", { input, query });
    const brand = await brandFor(input);
    if (!query.trim()) return { matches: [] };
    return { matches: await searchSite(brand.id, query.trim().slice(0, 300), 5) };
  } catch (err) {
    return fail(err);
  }
}

export async function updatePageFix(input: string, id: string, status: "todo" | "done" | "dismissed"): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updatePageFix", { input, id, status });
    const brand = await brandFor(input);
    await setFixStatus(brand.id, id, status);
    revalidatePath("/fixes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Position tracking ----
export async function addTrackedKeywords(input: string, country: string, keywords: string[], project?: string | null): Promise<Fail | { added: number }> {
  try {
    await signedIn("addTrackedKeywords", { input, country, keywords, project });
    const brand = await brandFor(input);
    return { added: await addKeywords(brand.id, country, keywords, project) };
  } catch (err) {
    return fail(err);
  }
}

export async function removeTrackedKeyword(input: string, keywordId: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("removeTrackedKeyword", { input, keywordId });
    const brand = await brandFor(input);
    await removeKeyword(brand.id, keywordId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function suggestTrackedKeywords(input: string, country: string): Promise<Fail | { keywords: string[] }> {
  try {
    await signedIn("suggestTrackedKeywords", { input, country });
    const brand = await brandFor(input);
    return { keywords: await suggestKeywords(brand.id, brand.domain!, country) };
  } catch (err) {
    return fail(err);
  }
}

export async function startPositionCheck(input: string, country: string, options: { maps: boolean; ai: boolean } = { maps: true, ai: true }, project?: string | null): Promise<Fail | { runId: string; total: number; imported?: number; added?: number }> {
  try {
    await signedIn("startPositionCheck", { input, country, options, project });
    const brand = await brandFor(input);
    return await startPositionRun(brand.id, country, { maps: !!options.maps, ai: !!options.ai }, project);
  } catch (err) {
    return fail(err);
  }
}

export async function positionCheckStep(runId: string): Promise<Fail | { status: string; done: number; total: number }> {
  try {
    await signedIn("positionCheckStep", { runId });
    return await positionStep(runId);
  } catch (err) {
    return fail(err);
  }
}

// ---- Site audit ----
export async function createAuditProject(input: string): Promise<Fail | { domain: string }> {
  try {
    await signedIn("createAuditProject", { input });
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
    await signedIn("startSiteAudit", { input });
    const brand = await brandFor(input);
    return { runId: await startAudit(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}

export async function siteAuditStep(runId: string): Promise<Fail | { status: string; done: number; total: number; limit: number }> {
  try {
    await signedIn("siteAuditStep", { runId });
    return await auditStep(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function findTrackingLocations(input: string, country: string, query: string): Promise<Fail | { locations: { code: number; name: string; type: string }[] }> {
  try {
    await signedIn("findTrackingLocations", { input, country, query });
    await brandFor(input);
    if (!isCountry(country)) return { error: "Unknown country." };
    return { locations: await searchLocations(country, query) };
  } catch (err) {
    return fail(err);
  }
}

export async function saveTrackingLocation(input: string, country: string, location: { code: number; name: string } | null): Promise<Fail | { ok: true }> {
  try {
    await signedIn("saveTrackingLocation", { input, country, location });
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
    await signedIn("redetectLocation", { input });
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
    await signedIn("findGoogleListings", { input, query });
    const brand = await brandFor(input);
    return { listings: await findListings(brand.id, query) };
  } catch (err) {
    return fail(err);
  }
}

export async function connectGoogleListing(input: string, listing: Listing): Promise<Fail | { ok: true }> {
  try {
    await signedIn("connectGoogleListing", { input, listing });
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
    await signedIn("refreshReviews", { input });
    const brand = await brandFor(input);
    await startFetch(brand.id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reviewsStep(input: string): Promise<Fail | { status: string; saved?: number; error?: string }> {
  try {
    await signedIn("reviewsStep", { input });
    const brand = await brandFor(input);
    return await fetchStep(brand.id);
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectGoogle(input: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("disconnectGoogle", { input });
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
    await signedIn("draftReviewReply", { input, reviewId });
    const brand = await brandFor(input);
    return { reply: await draftReply(brand.id, reviewId) };
  } catch (err) {
    return fail(err);
  }
}

// Google Business Profile (posting replies)
export async function googleBusinessLocations(input: string): Promise<Fail | { locations: GbpLocation[] }> {
  try {
    await signedIn("googleBusinessLocations", { input });
    const brand = await brandFor(input);
    return { locations: await listLocations(brand.id) };
  } catch (err) {
    return fail(err);
  }
}

export async function chooseGoogleBusinessLocation(input: string, location: GbpLocation): Promise<Fail | { ok: true }> {
  try {
    await signedIn("chooseGoogleBusinessLocation", { input, location });
    const brand = await brandFor(input);
    await chooseLocation(brand.id, location);
    revalidatePath("/reviews");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectGoogleBusinessProfile(input: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("disconnectGoogleBusinessProfile", { input });
    const brand = await brandFor(input);
    await disconnectGoogleBusiness(brand.id);
    revalidatePath("/reviews");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function postReviewReply(input: string, reviewId: string, text: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("postReviewReply", { input, reviewId, text });
    const brand = await brandFor(input);
    await postReply(brand.id, reviewId, text);
    revalidatePath("/reviews");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Keyword research ----
export async function researchKeyword(keyword: string, country: string, device: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("researchKeyword", { keyword, country, device });
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
    await signedIn("researchPrompts", { topic, country, platform, match });
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
    await signedIn("createTrackingCampaign", { input, prompts });
    return { id: await createCampaign(input, prompts) };
  } catch (err) {
    return fail(err);
  }
}

export async function updateTrackingCampaign(id: string, input: CampaignInput, add: PromptLine[], remove: string[]): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updateTrackingCampaign", { id, input, add, remove });
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
    await signedIn("removeTrackingPrompt", { campaignId, promptId });
    await ptRemovePrompt(campaignId, promptId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteTrackingCampaign(id: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("deleteTrackingCampaign", { id });
    await deleteCampaign(id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function startTrackingRun(campaignId: string): Promise<Fail | { runId: string; total: number; done: number }> {
  try {
    await signedIn("startTrackingRun", { campaignId });
    return await startRun(campaignId);
  } catch (err) {
    return fail(err);
  }
}

export async function trackingRunStep(runId: string): Promise<Fail | { status: string; done: number; total: number }> {
  try {
    await signedIn("trackingRunStep", { runId });
    return await runStep(runId);
  } catch (err) {
    return fail(err);
  }
}

export async function trackingCheckDetail(checkId: string): Promise<Fail | { detail: Awaited<ReturnType<typeof checkDetail>> }> {
  try {
    await signedIn("trackingCheckDetail", { checkId });
    return { detail: await checkDetail(checkId) };
  } catch (err) {
    return fail(err);
  }
}

export async function suggestTrackingPrompts(domain: string, brandName: string, country: string, existing: string[]): Promise<Fail | { prompts: string[] }> {
  try {
    await signedIn("suggestTrackingPrompts", { domain, brandName, country, existing });
    return { prompts: await suggestPrompts(domain, brandName, country, existing) };
  } catch (err) {
    return fail(err);
  }
}

// Top prompts from a saved Prompt Research report (the closest topics first, then AI volume).
export async function importResearchPrompts(topic: string, country: string, platform: string, match: string): Promise<Fail | { prompts: string[] }> {
  try {
    await signedIn("importResearchPrompts", { topic, country, platform, match });
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
    await signedIn("searchTrackingCities", { country, query });
    if (!isCountry(country)) return { locations: [] };
    return { locations: await searchLocations(country, query) };
  } catch (err) {
    return fail(err);
  }
}

// ---- Visibility change explainer ----
export async function explainChanges(input: string, runId: string, prevId: string, withRetest = false): Promise<Fail | { ok: true }> {
  try {
    await signedIn("explainChanges", { input, runId, prevId, withRetest });
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
    await signedIn("snapshotWebsiteNow", { input });
    const brand = await brandFor(input);
    return { pages: await capturePages(brand.id, brand.domain!) };
  } catch (err) {
    return fail(err);
  }
}

// A read-only link to one report that opens without logging in (see lib/share.ts).
export async function createReportLink(kind: ShareKind, input: string, query: Record<string, string | undefined>): Promise<Fail | { path: string; expires: string }> {
  try {
    await signedIn("createReportLink", { kind, input, query });
    if (!SHARE_KINDS.includes(kind)) throw new Error("This page can't be shared.");
    const domain = cleanDomain(input);
    if (!domain) throw new Error("Choose a domain first.");
    const { token, expires } = createShareToken(kind, domain, query);
    return { path: `/share/${token}`, expires };
  } catch (err) {
    return fail(err);
  }
}

// ---- SEO agent (lib/seo-agent.ts) ----

export async function startSeoPlan(input: string, focus: string): Promise<Fail | { planId: string }> {
  try {
    await signedIn("startSeoPlan", { input, focus });
    const brand = await brandFor(input);
    return { planId: await startSeoAgent(brand.id, focus.trim().slice(0, 300)) };
  } catch (err) {
    return fail(err);
  }
}

export async function stepSeoPlan(planId: string): Promise<Fail | { status: string; stage: number; log: { at: string; kind: string; text: string }[] }> {
  try {
    await signedIn("stepSeoPlan", { planId });
    return await stepSeoAgent(planId);
  } catch (err) {
    return fail(err);
  }
}

export async function updateSeoAction(input: string, planId: string, actionId: string, status: "todo" | "done" | "dismissed"): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updateSeoAction", { input, planId, actionId, status });
    const brand = await brandFor(input);
    await setSeoActionStatus(brand.id, planId, actionId, status);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// Accounts connected in Windsor.ai, to choose the Search Console and GA4 accounts for a domain.
export async function listWindsorAccounts(): Promise<Fail | { gsc: WindsorAccount[]; ga4: WindsorAccount[] }> {
  try {
    await signedIn("listWindsorAccounts", {});
    const [gsc, ga4] = await Promise.all([
      windsorAccounts("searchconsole").catch(() => [] as WindsorAccount[]),
      windsorAccounts("googleanalytics4").catch(() => [] as WindsorAccount[]),
    ]);
    if (!gsc.length && !ga4.length) await windsorAccounts("searchconsole"); // surface the real error
    return { gsc, ga4 };
  } catch (err) {
    return fail(err);
  }
}

export async function saveSeoSources(input: string, sources: SeoSources): Promise<Fail | { ok: true }> {
  try {
    await signedIn("saveSeoSources", { input, sources });
    const brand = await brandFor(input);
    await setSeoSources(brand.id, sources);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---- Profile and users (lib/users.ts). Email can't be changed by anyone. ----

async function me() {
  const p = await currentProfile();
  if (!p) throw new Error("Run supabase/migrations/0015_users_and_logs.sql first.");
  return p;
}

export async function saveProfile(userId: string, fields: ProfileFields): Promise<Fail | { ok: true }> {
  try {
    await signedIn("updateProfile", { userId, ...fields });
    await updateProfile(await me(), userId, fields);
    revalidatePath("/profile");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function changeMyPassword(password: string): Promise<Fail | { ok: true }> {
  try {
    await signedIn("changePassword", {});
    if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
    const { error } = await (await authClient()).auth.updateUser({ password });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addUser(input: { email: string; role: Role; full_name?: string; job_title?: string }): Promise<Fail | { email: string; password: string }> {
  try {
    await signedIn("createUser", { email: input.email, role: input.role, name: input.full_name });
    const r = await createUser(await me(), input);
    revalidatePath("/profile");
    return { email: r.email, password: r.password };
  } catch (err) {
    return fail(err);
  }
}

export async function changeUserRole(userId: string, role: Role): Promise<Fail | { ok: true }> {
  try {
    const target = await getProfile(userId).catch(() => null);
    await signedIn("setUserRole", { user: target?.email ?? userId, role });
    await setUserRole(await me(), userId, role);
    revalidatePath("/profile");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteUser(userId: string): Promise<Fail | { ok: true }> {
  try {
    const target = await getProfile(userId).catch(() => null);
    await signedIn("removeUser", { user: target?.email ?? userId });
    await removeUser(await me(), userId);
    revalidatePath("/profile");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function newUserPassword(userId: string): Promise<Fail | { email: string; password: string }> {
  try {
    const target = await getProfile(userId).catch(() => null);
    await signedIn("resetUserPassword", { user: target?.email ?? userId });
    return await resetUserPassword(await me(), userId);
  } catch (err) {
    return fail(err);
  }
}

// A page visit, for the activity log ("Opened Position tracking · digitalryze.com").
export async function logPageView(path: string, query: Record<string, string>): Promise<void> {
  try {
    const user = await currentUser();
    if (!user) return;
    const name = PAGE_NAMES[path] ?? (path.startsWith("/audit") ? "Site audit" : null);
    if (!name) return;
    const keep = ["domain", "keyword", "topic", "country", "tab", "user"];
    const detail = Object.fromEntries(Object.entries(query).filter(([k, v]) => keep.includes(k) && v).map(([k, v]) => [k, String(v).slice(0, 120)]));
    await writeLog({ id: user.id, email: user.email ?? null }, "openPage", detail, { label: `Opened ${name}` });
  } catch {
    // never breaks the page
  }
}
