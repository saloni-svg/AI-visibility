import { writeFileSync } from "node:fs";
import { isCountry } from "../lib/countries";
import { computePromptReport, isMatch, isPlatformFilter } from "../lib/prompt-research";

// Builds a prompt research report without saving it and prints a summary.
// npm run check:prompts -- "crm software" US all broad
const [topic = "crm software", country = "US", platform = "all", match = "broad"] = process.argv.slice(2);
if (!isCountry(country) || !isPlatformFilter(platform) || !isMatch(match)) throw new Error("Usage: check:prompts -- <topic> <country> <all|google|chat_gpt> <broad|exact>");
const t0 = Date.now();
const r = await computePromptReport(topic, country, platform, match);
console.log(`${r.topic} · ${country} · ${platform} · ${((Date.now() - t0) / 1000).toFixed(1)}s · classifier=${r.classifier}`);
console.log("totals", r.totals, "analyzed", r.analyzed);
console.log("months", r.months.join(","), "\ntrend", r.trend.join(","));
console.log("intents", r.intents);
console.log("topics", r.topics.slice(0, 15).map((t) => `${t.relevance.padEnd(6)} ${String(t.volume).padStart(7)} ${String(t.prompts).padStart(4)}  ${t.name}`).join("\n"));
console.log("brands", r.brands.slice(0, 12).map((b) => `${b.name}(${b.prompts})`).join(", "));
console.log("sources", r.sources.slice(0, 10).map((s) => `${s.domain}(${s.prompts})`).join(", "));
console.log("problems", r.problems);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(r));
