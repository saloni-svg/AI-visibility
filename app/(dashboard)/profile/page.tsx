import "./profile.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listLogs, type LogKind } from "@/lib/activity";
import { currentUser } from "@/lib/auth";
import { canEditProfile, canManageUsers, canSeeEveryone, canSeeUsers, currentProfile, getProfile, listUsers, type Profile } from "@/lib/users";
import Icon from "../../components/Icon";
import { PasswordForm, ProfileDetails, UsersAdmin } from "../../components/ProfileForms";

export const dynamic = "force-dynamic";

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
const ROLE_TEXT = {
  owner: "Owner: manages users and roles, edits anyone's details, sees everyone's activity and query logs.",
  admin: "Admin: uses the whole app; edits their own details and those of users.",
  user: "User: uses the whole app and edits their own details.",
};

// Profile: details, activity log, query log and (owner only) users. ?user= shows another user
// (owner only); ?tab=details|activity|queries|users; ?q= search; ?page= page of the logs.
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string; user?: string; q?: string; page?: string }> }) {
  const auth = await currentUser();
  if (!auth) redirect("/login");
  const me = await currentProfile();
  if (!me) {
    return (
      <main className="dash">
        <div className="card empty-state empty-error">
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h2>Profiles aren&apos;t set up yet</h2>
          <p className="note">Run <code>supabase/migrations/0015_users_and_logs.sql</code> in the Supabase SQL editor, then reload.</p>
        </div>
      </main>
    );
  }
  const p = await searchParams;
  const owner = canManageUsers(me);
  const seesUsers = canSeeUsers(me);
  const tab = (["details", "activity", "queries", "users"] as const).find((t) => t === p.tab && (t !== "users" || seesUsers)) ?? "details";
  // Whose page this is: your own, or (owner and admins) the user picked. Others' logs: owner only.
  const picked = seesUsers && p.user && p.user !== "all" ? await getProfile(p.user).catch(() => me) : me;
  const viewing: Profile = tab === "details" || owner ? picked : me;
  const self = viewing.id === me.id;
  const tabLink = (t: string) => `/profile?tab=${t}${owner && p.user ? `&user=${p.user}` : ""}`;

  return (
    <main className="dash">
      <header className="page-header">
        <div>
          <p className="crumbs">Home <span aria-hidden="true">›</span> Profile</p>
          <h1>{self ? "Your profile" : <>Profile: <span className="muted-strong">{viewing.full_name || viewing.email}</span></>}</h1>
          <p className="subtitle">{viewing.email} · <span className={`pill ${viewing.role === "owner" ? "pill-strong" : viewing.role === "admin" ? "pill-weak" : "pill-shared"}`}>{viewing.role}</span></p>
        </div>
        {!self && <div className="header-actions"><Link href="/profile" className="btn-secondary btn-small">Back to your profile</Link></div>}
      </header>

      <nav className="segmented pf-tabs" aria-label="Profile sections">
        <Link href={tabLink("details")} aria-current={tab === "details"}>Details</Link>
        <Link href={tabLink("activity")} aria-current={tab === "activity"}>Activity log</Link>
        <Link href={tabLink("queries")} aria-current={tab === "queries"}>Query log</Link>
        {seesUsers && <Link href="/profile?tab=users" aria-current={tab === "users"}>Users</Link>}
      </nav>

      {tab === "details" && <Details me={me} viewing={viewing} />}
      {(tab === "activity" || tab === "queries") && <Logs me={me} kind={tab === "queries" ? "query" : "activity"} userParam={p.user} q={p.q ?? ""} page={Math.max(1, Number(p.page) || 1)} />}
      {tab === "users" && seesUsers && <Users me={me} manage={owner} />}
    </main>
  );
}

async function Details({ me, viewing }: { me: Profile; viewing: Profile }) {
  const editable = canEditProfile(me, viewing);
  const reason = "Only the owner can change this user's details.";
  return (
    <div className="two-col pf-cols">
      <section className="card panel">
        <div className="panel-head"><div className="panel-title"><h2>Details</h2></div></div>
        <div className="panel-body">
          <ProfileDetails key={viewing.id} userId={viewing.id} email={viewing.email} editable={editable} reason={reason}
            fields={{ full_name: viewing.full_name, phone: viewing.phone, company: viewing.company, job_title: viewing.job_title }} />
        </div>
      </section>
      <div className="pf-side">
        <section className="card panel">
          <div className="panel-head"><div className="panel-title"><h2>Account</h2></div></div>
          <div className="panel-body">
            <dl className="pf-facts">
              <dt>Role</dt><dd>{ROLE_TEXT[viewing.role]}</dd>
              <dt>Account created</dt><dd>{fmt(viewing.created_at)}</dd>
              <dt>Last active</dt><dd>{fmt(viewing.last_seen_at)}</dd>
              <dt>Details last changed</dt><dd>{fmt(viewing.updated_at)}</dd>
            </dl>
          </div>
        </section>
        {viewing.id === me.id && (
          <section className="card panel">
            <div className="panel-head"><div className="panel-title"><h2>Password</h2></div></div>
            <div className="panel-body"><PasswordForm /></div>
          </section>
        )}
      </div>
    </div>
  );
}

async function Logs({ me, kind, userParam, q, page }: { me: Profile; kind: LogKind; userParam?: string; q: string; page: number }) {
  const everyone = canSeeEveryone(me);
  // Owner: everyone by default, or one user. Others: only themselves.
  const userId = everyone ? (userParam && userParam !== "all" ? userParam : null) : me.id;
  const [{ rows, total, pages }, users] = await Promise.all([
    listLogs({ kind, userId, page, search: q }),
    everyone ? listUsers(me).catch(() => []) : Promise.resolve([]),
  ]);
  const tab = kind === "query" ? "queries" : "activity";
  const pageLink = (n: number) => `/profile?tab=${tab}${userParam ? `&user=${userParam}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${n}`;
  const showEmail = everyone && !userId;
  return (
    <section className="card panel">
      <div className="panel-head pf-log-head">
        <div className="panel-title">
          <h2>{kind === "query" ? "Query log" : "Activity log"}</h2>
          <p className="note">
            {kind === "query" ? "Everything searched or run in the app: keyword and prompt research, analyses, agents, position checks, audits, with the inputs and the result." : "Sign-ins, sign-outs and changes: keywords, competitors, connections, share links, users and profile details."}
            {" "}{everyone ? (userId ? "One user." : "All users.") : "Your own."} {total.toLocaleString("en-IN")} entries.
          </p>
        </div>
        <form className="pf-filter" method="get" action="/profile">
          <input type="hidden" name="tab" value={tab} />
          {everyone && (
            <select name="user" defaultValue={userParam ?? "all"} aria-label="User">
              <option value="all">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email} ({u.role})</option>)}
            </select>
          )}
          <input type="search" name="q" defaultValue={q} placeholder={kind === "query" ? "Search keyword, domain, email…" : "Search action, email…"} />
          <button type="submit" className="btn-secondary btn-small">Filter</button>
        </form>
      </div>
      <div className="panel-body table-wrap">
        {!rows.length ? <p className="note">Nothing logged yet{q ? " for this search" : ""}.</p> : (
          <table className="pf-table pf-logs">
            <thead><tr><th>When</th>{showEmail && <th>User</th>}<th>{kind === "query" ? "Query" : "Action"}</th><th>Details</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="pf-when">{fmt(r.created_at)}</td>
                  {showEmail && <td>{r.user_id ? <Link href={`/profile?tab=${tab}&user=${r.user_id}`}>{r.email}</Link> : r.email ?? "–"}</td>}
                  <td><b>{r.label}</b></td>
                  <td className="pf-detail">{r.summary ?? <span className="muted">–</span>}</td>
                  <td>
                    {r.status === "ok" ? <span className="pill pill-strong">OK</span> : <span className="pill pill-missing" title={r.error ?? ""}>Error</span>}
                    {r.status === "error" && r.error && <div className="note pf-err">{r.error.slice(0, 160)}</div>}
                    {r.duration_ms != null && <div className="note">{(r.duration_ms / 1000).toFixed(1)}s</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <nav className="pf-pages" aria-label="Pages">
          {page > 1 && <Link href={pageLink(page - 1)} className="btn-secondary btn-small">← Newer</Link>}
          <span className="note">Page {page} of {pages}</span>
          {page < pages && <Link href={pageLink(page + 1)} className="btn-secondary btn-small">Older →</Link>}
        </nav>
      )}
    </section>
  );
}

async function Users({ me, manage }: { me: Profile; manage: boolean }) {
  const users = await listUsers(me);
  return (
    <section className="card panel">
      <div className="panel-head"><div className="panel-title"><h2>Users</h2><p className="note">{manage ? "Everyone with access: owners, admins and users. Open anyone's details, activity log or query log. Owners add users and choose their role; owners remove admins and users, admins remove users, and nobody can remove an owner. Emails can't be changed." : "As an admin you can open, edit and remove users. Adding users, roles and admins are up to the owner. Owners can't be removed."}</p></div></div>
      <div className="panel-body">
        <UsersAdmin meId={me.id} manage={manage} users={users.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, job_title: u.job_title, role: u.role, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, logs: u.logs }))} />
      </div>
    </section>
  );
}
