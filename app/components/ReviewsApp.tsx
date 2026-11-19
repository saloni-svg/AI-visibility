"use client";
import { fmtDay, fmtNum } from "./format";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  chooseGoogleBusinessLocation, connectGoogleListing, disconnectGoogle, disconnectGoogleBusinessProfile, draftReviewReply, findGoogleListings,
  googleBusinessLocations, postReviewReply, refreshReviews, reviewsStep,
} from "../(dashboard)/actions";
import Icon from "./Icon";

type Listing = { cid: string | null; place_id: string | null; title: string; address: string | null; rating: number | null; reviews_count: number | null; url: string | null; domain: string | null; matchesSite: boolean };
type Source = { title: string; address: string | null; rating: number | null; reviews_count: number | null; url: string | null; status: string; error: string | null; fetched_at: string | null };
type Review = {
  id: string; author: string | null; author_url: string | null; author_image: string | null; local_guide: boolean; rating: number | null;
  text: string | null; published_at: string | null; time_ago: string | null; owner_reply: string | null; owner_reply_at: string | null;
  review_url: string | null; photos: number | null; ai_reply: string | null;
};
type GbpLoc = { account: string; location: string; title: string; address: string | null; website: string | null; placeId: string | null; mapsUri: string | null; match: boolean };
type Gbp = {
  enabled: boolean; // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set
  connection: { email: string | null; location: string | null; title: string | null; address: string | null } | null;
  notice: string | null; error: string | null; // from the sign-in redirect
};
type Filter = "all" | "5" | "4" | "3" | "2" | "1" | "unanswered" | "answered";
const PAGE = 20;

function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span className="rv-stars" style={{ fontSize: size }} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= Math.round(value) ? "on" : ""}>★</span>)}
    </span>
  );
}
// Google sends line breaks in reviews and replies as <br>.
const plain = (t: string) => t.replace(/<br\s*\/?>/gi, "\n").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const fmtDate = (iso: string | null) => fmtDay(iso);
const GoogleMark = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="none" stroke="#4285f4" strokeWidth="3" strokeDasharray="16 47" transform="rotate(-40 12 12)" />
    <circle cx="12" cy="12" r="10" fill="none" stroke="#ea4335" strokeWidth="3" strokeDasharray="16 47" transform="rotate(50 12 12)" />
    <circle cx="12" cy="12" r="10" fill="none" stroke="#fbbc05" strokeWidth="3" strokeDasharray="16 47" transform="rotate(140 12 12)" />
    <circle cx="12" cy="12" r="10" fill="none" stroke="#34a853" strokeWidth="3" strokeDasharray="16 47" transform="rotate(230 12 12)" />
  </svg>
);

// Google Business Profile: sign in once, pick the location, then replies post straight to Google.
function GbpPanel({ domain, gbp }: { domain: string; gbp: Gbp }) {
  const router = useRouter();
  const [locs, setLocs] = useState<GbpLoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(gbp.error ?? "");
  const c = gbp.connection;
  const needsPick = !!c && !c.location;

  useEffect(() => {
    if (!needsPick) return;
    googleBusinessLocations(domain).then((r) => ("error" in r ? setError(r.error) : setLocs(r.locations)));
  }, [needsPick, domain]);

  async function pick(l: GbpLoc) {
    setBusy(true);
    const r = await chooseGoogleBusinessLocation(domain, l);
    setBusy(false);
    if ("error" in r) return setError(r.error);
    router.replace(`/reviews?domain=${domain}`);
    router.refresh();
  }
  async function disconnect() {
    setBusy(true);
    await disconnectGoogleBusinessProfile(domain);
    setBusy(false);
    router.replace(`/reviews?domain=${domain}`);
    router.refresh();
  }

  return (
    <section className="card rv-gbp">
      {!c ? (
        <div className="rv-gbp-row">
          <div>
            <p className="rv-gbp-title">Post replies straight to Google</p>
            <p className="note">Sign in with the Google account that owns or manages this Business Profile. Replies then go to Google when you click <b>Reply on Google</b>.</p>
          </div>
          <a className="btn-dark btn-small" href={`/google/connect?domain=${encodeURIComponent(domain)}`} aria-disabled={!gbp.enabled}
            onClick={(e) => { if (!gbp.enabled) { e.preventDefault(); setError("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the app."); } }}>
            Connect Google Business Profile
          </a>
        </div>
      ) : needsPick ? (
        <div>
          <p className="rv-gbp-title">Which Business Profile is {domain}?</p>
          <p className="note">Signed in as {c.email ?? "your Google account"}.{locs && !locs.length ? " This account doesn't manage any Business Profile. Sign in with the account that does." : ""}</p>
          {!locs && !error && <p className="note">Loading your locations…</p>}
          {locs && locs.length > 0 && (
            <ul className="rv-gbp-list">
              {locs.map((l) => (
                <li key={l.location}>
                  <div>
                    <p className="rv-pick-name">{l.title} {l.match && <span className="pill pill-strong">Matches this listing</span>}</p>
                    <p className="note">{[l.address, l.website].filter(Boolean).join(" · ") || "No address"}</p>
                  </div>
                  <button type="button" className="btn-dark btn-small" disabled={busy} onClick={() => pick(l)}>Use this location</button>
                </li>
              ))}
            </ul>
          )}
          {/scope/i.test(error) && (
            <p className="note">Google didn&apos;t give this app permission to manage your Business Profile. Click <b>Reconnect</b> and, on Google&apos;s screen, tick <b>See, edit, create and delete your Google business listings</b>.</p>
          )}
          <button type="button" className="link-btn" onClick={disconnect} disabled={busy}>{/scope/i.test(error) ? "Reconnect" : "Use a different Google account"}</button>
        </div>
      ) : (
        <div className="rv-gbp-row">
          <p className="note rv-gbp-ok">
            <span className="pill pill-strong">Connected</span> Replies post to <b>{c.title}</b>{c.address ? ` (${c.address})` : ""} as {c.email ?? "your Google account"}.
            {gbp.notice === "chosen" && " Your Business Profile was found automatically."}
          </p>
          <button type="button" className="link-btn" onClick={disconnect} disabled={busy}>Disconnect</button>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

export default function ReviewsApp({ domain, source, reviews, gbp }: { domain: string; source: Source | null; reviews: Review[]; gbp: Gbp }) {
  const canPost = !!gbp.connection?.location;
  const [posting, setPosting] = useState<string | null>(null);
  const [postError, setPostError] = useState<Record<string, string>>({});
  const router = useRouter();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(source?.status === "fetching");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "lowest" | "highest">("newest");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(reviews.filter((r) => r.ai_reply).map((r) => [r.id, r.ai_reply!])));
  const [drafting, setDrafting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const polling = useRef(false);

  // Poll DataForSEO until the reviews are ready.
  async function poll() {
    if (polling.current) return;
    polling.current = true;
    setFetching(true);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await reviewsStep(domain);
      if ("error" in s && !("status" in s)) { setError(s.error); break; }
      if ("status" in s && s.status !== "fetching") { if (s.error) setError(s.error); break; }
    }
    polling.current = false;
    setFetching(false);
    router.refresh();
  }
  useEffect(() => { if (source?.status === "fetching") poll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function find(query?: string) {
    setError(""); setBusy("find");
    const r = await findGoogleListings(domain, query);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setListings(r.listings);
  }
  async function connect(l: Listing) {
    setError(""); setBusy("connect");
    const r = await connectGoogleListing(domain, l);
    setBusy("");
    if ("error" in r) return setError(r.error);
    setListings(null);
    router.refresh();
    poll();
  }
  async function refresh() {
    setError("");
    const r = await refreshReviews(domain);
    if ("error" in r) return setError(r.error);
    poll();
  }
  async function draft(id: string) {
    setDrafting(id);
    const r = await draftReviewReply(domain, id);
    setDrafting(null);
    if ("error" in r) return setError(r.error);
    setDrafts((d) => ({ ...d, [id]: r.reply }));
  }
  async function post(id: string) {
    setPosting(id);
    setPostError((e) => ({ ...e, [id]: "" }));
    const r = await postReviewReply(domain, id, drafts[id] ?? "");
    setPosting(null);
    if ("error" in r) { setPostError((e) => ({ ...e, [id]: r.error })); router.refresh(); return; }
    router.refresh(); // the review now shows "Your reply"
  }
  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const stats = useMemo(() => {
    const rated = reviews.filter((r) => r.rating);
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: rated.filter((r) => r.rating === n).length }));
    const answered = reviews.filter((r) => r.owner_reply).length;
    const month = reviews.filter((r) => r.published_at && Date.now() - new Date(r.published_at).getTime() < 30 * 86_400_000).length;
    return { dist, answered, month, max: Math.max(1, ...dist.map((d) => d.count)) };
  }, [reviews]);

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return reviews
      .filter((r) => filter === "all" ? true : filter === "unanswered" ? !r.owner_reply : filter === "answered" ? !!r.owner_reply : r.rating === Number(filter))
      .filter((r) => !t || `${r.author} ${r.text}`.toLowerCase().includes(t))
      .sort((a, b) => {
        const da = a.published_at ?? "", db = b.published_at ?? "";
        return sort === "newest" ? db.localeCompare(da) : sort === "oldest" ? da.localeCompare(db)
          : sort === "lowest" ? (a.rating ?? 0) - (b.rating ?? 0) : (b.rating ?? 0) - (a.rating ?? 0);
      });
  }, [reviews, filter, sort, search]);

  // ---- Not connected yet ----
  if (!source) {
    return (
      <section className="card rv-connect">
        <div className="rv-connect-head">
          <span className="rv-g"><GoogleMark /></span>
          <div>
            <h2>Connect your Google Business Profile</h2>
            <p className="note">We find {domain} on Google Maps and bring in all its reviews. You confirm the right listing first.</p>
          </div>
          {!listings && (
            <button type="button" className="btn-primary btn-link" disabled={!!busy} onClick={() => find()}>
              {busy === "find" ? "Searching Google…" : "Connect to Google"}
            </button>
          )}
        </div>
        {listings && (
          <div className="rv-pick">
            <p className="rv-pick-title">{listings.length ? "Is this your business?" : "No listing found automatically."}</p>
            <ul>
              {listings.map((l) => (
                <li key={(l.cid ?? l.place_id ?? l.title) + l.address}>
                  <div>
                    <p className="rv-pick-name">{l.title} {l.matchesSite && <span className="pill pill-strong">Matches your website</span>}</p>
                    <p className="note">{l.address ?? "No address"}{l.domain ? ` · ${l.domain}` : ""}</p>
                    {l.rating !== null && <p className="rv-pick-rating"><Stars value={l.rating} size={13} /> {l.rating} · {l.reviews_count ?? 0} reviews</p>}
                  </div>
                  <button type="button" className="btn-dark btn-small" disabled={!!busy} onClick={() => connect(l)}>
                    {busy === "connect" ? "Connecting…" : "This is my business"}
                  </button>
                </li>
              ))}
            </ul>
            <form className="rv-search" onSubmit={(e) => { e.preventDefault(); find(q); }}>
              <label htmlFor="rv-q" className="note">Not listed? Search by business name and town:</label>
              <div>
                <input id="rv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Falcon Installations Swansea" />
                <button type="submit" className="btn-secondary btn-small" disabled={!!busy || !q.trim()}>Search</button>
              </div>
            </form>
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
      </section>
    );
  }

  // ---- Connected ----
  return (
    <>
      <section className="card rv-listing">
        <span className="rv-g"><GoogleMark /></span>
        <div className="rv-listing-main">
          <h2>{source.title}</h2>
          <p className="note">{source.address}</p>
          <p className="note">
            {source.url && <a href={source.url} target="_blank" rel="noreferrer">View on Google Maps ↗</a>}
            {source.fetched_at && <> · Updated {fmtDate(source.fetched_at)}</>}
          </p>
        </div>
        <div className="rv-listing-actions">
          <button type="button" className="btn-dark btn-small" onClick={refresh} disabled={fetching}>{fetching ? "Fetching reviews…" : "Refresh reviews"}</button>
          <button type="button" className="link-btn" onClick={async () => { await disconnectGoogle(domain); router.refresh(); }}>Change listing</button>
        </div>
      </section>
      {fetching && (
        <div className="card rv-progress">
          <div className="progress"><span className="rv-indeterminate" /></div>
          <p className="note">Getting reviews from Google. This usually takes 1–3 minutes; you can keep working, they&apos;ll appear here.</p>
        </div>
      )}
      <GbpPanel domain={domain} gbp={gbp} />
      {source.status === "failed" && !fetching && <p className="field-error">Couldn&apos;t fetch reviews: {source.error}. Try Refresh reviews.</p>}
      {error && <p className="field-error">{error}</p>}

      <div className={reviews.length > 0 ? "rv-layout" : undefined}>
      {reviews.length > 0 && (
        <section className="rv-summary">
          <div className="card rv-score">
            <span className="rv-big">{(source.rating ?? 0).toFixed(1)}</span>
            <Stars value={source.rating ?? 0} size={22} />
            <span className="note">{fmtNum(source.reviews_count ?? reviews.length)} reviews on Google</span>
          </div>
          <div className="card rv-dist">
            {stats.dist.map((d) => (
              <button key={d.n} type="button" className="rv-dist-row" onClick={() => { setFilter(String(d.n) as Filter); setShown(PAGE); }}>
                <span>{d.n} ★</span>
                <span className="dist-track"><span style={{ width: `${(d.count / stats.max) * 100}%`, background: d.n >= 4 ? "var(--good)" : d.n === 3 ? "#e0a030" : "var(--bad)" }} /></span>
                <b>{d.count}</b>
              </button>
            ))}
            <p className="note">Based on the {reviews.length} most recent reviews</p>
          </div>
          <div className="card rv-kpis">
            <div><span className="rv-kpi">{reviews.length ? Math.round((stats.answered / reviews.length) * 100) : 0}%</span><span className="note">replied to</span></div>
            <div><span className="rv-kpi">{reviews.length - stats.answered}</span><span className="note">waiting for a reply</span></div>
            <div><span className="rv-kpi">{stats.month}</span><span className="note">new in the last 30 days</span></div>
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="card cr-table-card">
          <div className="rv-toolbar">
            <div className="seg" role="group" aria-label="Filter reviews">
              {([["all", "All"], ["unanswered", "Needs reply"], ["answered", "Replied"], ["5", "5★"], ["4", "4★"], ["3", "3★"], ["2", "2★"], ["1", "1★"]] as const).map(([k, l]) => (
                <button key={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}>{l}</button>
              ))}
            </div>
            <div className="rv-toolbar-right">
              <div className="cr-search">
                <label htmlFor="rv-s" className="sr-only">Search reviews</label>
                <input id="rv-s" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reviews" />
                <Icon name="search" size={16} />
              </div>
              <label><span className="sr-only">Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="lowest">Lowest rating</option>
                  <option value="highest">Highest rating</option>
                </select>
              </label>
            </div>
          </div>
          <ul className="rv-list">
            {list.slice(0, shown).map((r) => (
              <li key={r.id} className="rv-item">
                <div className="rv-head">
                  {r.author_image ? <img src={r.author_image} alt="" className="rv-avatar" referrerPolicy="no-referrer" /> : <span className="rv-avatar rv-initial">{(r.author ?? "?").charAt(0)}</span>}
                  <div>
                    <p className="rv-author">{r.author_url ? <a href={r.author_url} target="_blank" rel="noreferrer">{r.author ?? "Google user"}</a> : r.author ?? "Google user"}
                      {r.local_guide && <span className="rv-guide">Local Guide</span>}</p>
                    <p className="rv-meta"><Stars value={r.rating ?? 0} size={14} /> <span>{fmtDate(r.published_at) || r.time_ago}</span>{r.photos ? <span> · {r.photos} photos</span> : null}</p>
                  </div>
                  {!r.owner_reply && <span className="pill pill-missing rv-tag">Needs reply</span>}
                </div>
                {r.text ? <p className="rv-text">{plain(r.text)}</p> : <p className="rv-text muted">Rating only, no text.</p>}
                {r.owner_reply && (
                  <div className="rv-reply">
                    <p className="rv-reply-label">Your reply{r.owner_reply_at ? ` · ${fmtDate(r.owner_reply_at)}` : ""}</p>
                    <p className="rv-reply-text">{plain(r.owner_reply)}</p>
                  </div>
                )}
                {!r.owner_reply && (
                  <div className="rv-draft">
                    {drafts[r.id] ? (
                      <>
                        <label className="rv-reply-label" htmlFor={`d-${r.id}`}>{canPost ? "AI draft reply (edit, then post to Google)" : "AI draft reply (edit, then copy to Google)"}</label>
                        <textarea id={`d-${r.id}`} rows={3} value={drafts[r.id]} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} />
                        <div className="draft-actions">
                          {canPost && (
                            <button type="button" className="btn-dark btn-small" disabled={posting === r.id || !drafts[r.id]?.trim()} onClick={() => post(r.id)}
                              title={`Posts this reply publicly on Google as ${gbp.connection?.title ?? "your business"}`}>
                              {posting === r.id ? "Posting to Google…" : "Reply on Google"}
                            </button>
                          )}
                          <button type="button" className={canPost ? "btn-secondary btn-small" : "btn-dark btn-small"} onClick={() => copy(r.id, drafts[r.id])}>{copied === r.id ? "Copied" : "Copy reply"}</button>
                          {!canPost && r.review_url && (
                            <a className="btn-secondary btn-small" href={r.review_url} target="_blank" rel="noreferrer"
                              title="Copies your reply, then opens this review on Google: paste it into the reply box and post"
                              onClick={() => { navigator.clipboard.writeText(drafts[r.id]).catch(() => {}); setOpened(r.id); }}>
                              Reply on Google ↗
                            </a>
                          )}
                          <button type="button" className="link-btn" onClick={() => draft(r.id)} disabled={drafting === r.id}>{drafting === r.id ? "Writing…" : "Rewrite"}</button>
                        </div>
                        {postError[r.id] && <p className="field-error rv-hint" role="alert">{postError[r.id]}</p>}
                        {opened === r.id && (
                          <p className="note rv-hint" role="status">Reply copied. On Google, click <b>Reply</b>, paste with <b>Cmd + V</b> (Ctrl + V on Windows) and press <b>Post</b>. You need to be signed in with the Google account that manages this business.</p>
                        )}
                      </>
                    ) : (
                      <button type="button" className="btn-secondary btn-small" onClick={() => draft(r.id)} disabled={drafting === r.id}>
                        <Icon name="sparkles" size={14} /> {drafting === r.id ? "Writing…" : "Draft reply with AI"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {list.length === 0 && <li className="note cr-empty">No reviews match.</li>}
          </ul>
          {list.length > shown && (
            <div className="cr-pagination"><button type="button" className="btn-secondary btn-small" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown} left)</button></div>
          )}
        </section>
      )}
      </div>
      {reviews.length === 0 && !fetching && source.status === "ready" && <div className="card"><p className="note cr-empty">This listing has no reviews yet.</p></div>}
    </>
  );
}
