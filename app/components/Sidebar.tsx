import { signOut } from "../(auth)/actions";

// Left side panel: app name, links to each dashboard section, and the
// signed-in account with a log-out button.
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "competitors", label: "You vs competitors" },
  { id: "trend", label: "Over time" },
  { id: "recommended", label: "Who AI recommends" },
  { id: "sources", label: "Cited websites" },
  { id: "questions", label: "Question by question" },
];

export default function Sidebar({ email }: { email: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-mark">AI Visibility</div>
      <nav aria-label="Dashboard sections">
        <p className="sidebar-heading">Dashboard</p>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-account">
        <p className="sidebar-heading">Signed in as</p>
        <p className="sidebar-email" title={email}>{email}</p>
        <form action={signOut}>
          <button type="submit" className="btn-secondary">Log out</button>
        </form>
      </div>
    </aside>
  );
}
