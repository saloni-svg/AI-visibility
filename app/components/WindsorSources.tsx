"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { listWindsorAccounts, saveSeoSources } from "../(dashboard)/actions";
import type { WindsorAccount } from "@/lib/windsor";

type Src = { id: string; name: string } | null;

// Which Windsor.ai accounts (Search Console property, GA4 property) the SEO agent reads for this
// domain. Matched automatically on the first run; "Change" lists every connected account.
export default function WindsorSources({ domain, connected, gsc, ga4 }: { domain: string; connected: boolean; gsc: Src; ga4: Src }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<{ gsc: WindsorAccount[]; ga4: WindsorAccount[] } | null>(null);
  const [pick, setPick] = useState({ gsc: gsc?.id ?? "", ga4: ga4?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!connected) {
    return (
      <section className="card seo-sources no-print">
        <p className="note"><span className="pill pill-missing">Windsor.ai not connected</span> Add <code>WINDSOR_API_KEY</code> to <code>.env</code> (Windsor.ai → account settings → API key) and restart the app. Without it the plan uses only rankings, the site audit and AI visibility.</p>
      </section>
    );
  }

  async function load() {
    setOpen(true);
    if (lists) return;
    setBusy(true); setError("");
    const r = await listWindsorAccounts();
    setBusy(false);
    if ("error" in r) return setError(r.error);
    setLists(r);
  }

  async function save() {
    setBusy(true); setError("");
    const find = (l: WindsorAccount[], id: string) => { const a = l.find((x) => x.id === id); return a ? { id: a.id, name: a.name } : null; };
    const r = await saveSeoSources(domain, { gsc: find(lists?.gsc ?? [], pick.gsc), ga4: find(lists?.ga4 ?? [], pick.ga4) });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="card seo-sources no-print">
      <p className="note">
        <span className="pill pill-strong">Windsor.ai</span>
        Search Console: <b>{gsc?.name ?? "matched automatically on the first run"}</b> · GA4: <b>{ga4?.name ?? (gsc ? "none" : "matched automatically on the first run")}</b>
        <button type="button" className="btn-secondary btn-small" onClick={() => (open ? setOpen(false) : load())}>{open ? "Close" : "Change"}</button>
      </p>
      {open && (
        <div className="seo-sources-pick">
          {busy && !lists && <p className="note">Loading accounts from Windsor.ai…</p>}
          {lists && (
            <>
              <label>Search Console property
                <select value={pick.gsc} onChange={(e) => setPick({ ...pick, gsc: e.target.value })}>
                  <option value="">None</option>
                  {lists.gsc.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.volume.toLocaleString("en-IN")} clicks, 30 days)</option>)}
                </select>
              </label>
              <label>GA4 property
                <select value={pick.ga4} onChange={(e) => setPick({ ...pick, ga4: e.target.value })}>
                  <option value="">None</option>
                  {lists.ga4.map((a) => <option key={a.id} value={a.id}>{a.name}{a.hosts?.length ? ` · ${a.hosts.slice(0, 2).join(", ")}` : ""} ({a.volume.toLocaleString("en-IN")} sessions)</option>)}
                </select>
              </label>
              <button type="button" className="btn-primary btn-small" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </>
          )}
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
