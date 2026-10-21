import { Suspense } from "react";
import { signOut } from "../(auth)/actions";
import Icon from "./Icon";
import SidebarNav from "./SidebarNav";

// Left side panel: logo, section links, and the signed-in account with log out.
export default function Sidebar({ email }: { email: string }) {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <span className="logo-mark"><Icon name="logo" size={18} /></span>
        <div>
          <div className="brand-name">AI Visibility</div>
          <div className="brand-tag">Brand monitor</div>
        </div>
      </div>
      <Suspense fallback={<nav className="side-nav" aria-label="Main" />}>
        <SidebarNav />
      </Suspense>
      <div className="account">
        <span className="avatar" aria-hidden="true">{initials}</span>
        <div className="account-text">
          <span className="account-label">Signed in as</span>
          <span className="account-email" title={email}>{email}</span>
        </div>
        <form action={signOut}>
          <button type="submit" className="icon-btn" aria-label="Log out" title="Log out">
            <Icon name="logout" size={18} />
          </button>
        </form>
      </div>
    </aside>
  );
}
