import { plannerStatus } from "@/lib/keyword-planner";

// One line saying where search volume and CPC come from, with a button to connect Google Ads
// (Keyword Planner) when it isn't connected yet. `next` = the page to come back to.
export default async function KeywordPlannerStatus({ next, error, justConnected }: { next: string; error?: string | null; justConnected?: boolean }) {
  const s = await plannerStatus();
  return (
    <div className="kp-status">
      {s.connected ? (
        <p className="note">
          <span className="pill pill-strong">Keyword Planner</span> Search volume and CPC come from Google Keyword Planner{s.email ? ` (${s.email})` : ""}.
          {justConnected && " Connected: figures update the next time each keyword is loaded."}
        </p>
      ) : (
        <p className="note">
          <span className="pill pill-strong">Keyword Planner</span> Search volume and average CPC come only from Google Keyword Planner, which isn&apos;t connected, so they&apos;re blank.{" "}
          {s.configured && <a className="btn-secondary btn-small" href={`/google/connect?kind=ads&next=${encodeURIComponent(next)}`}>Connect Google Ads</a>}
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
