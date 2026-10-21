import { listCampaigns, runStep, startRun } from "../lib/prompt-tracking";

// Checks every prompt tracking campaign once. Run it daily (cron) for a daily history:
// npm run track:prompts            all campaigns
// npm run track:prompts -- <id>    one campaign
const only = process.argv[2];
const campaigns = (await listCampaigns()).filter((c) => !only || c.id === only);
for (const c of campaigns) {
  try {
    const { runId, total } = await startRun(c.id);
    console.log(`${c.domain} (${c.country}): ${total} answers to check`);
    for (;;) {
      const s = await runStep(runId);
      process.stdout.write(`\r  ${s.done}/${s.total}`);
      if (s.status !== "running") break;
    }
    console.log(" done");
  } catch (e) {
    console.error(`${c.domain}: ${(e as Error).message}`);
  }
}
