import "./app-frame-v5.css";
import { Suspense } from "react";
import { signOut } from "../(auth)/actions";
import Icon from "./Icon";
import SideNav from "./SideNav";
import TopTools from "./TopTools";

// App frame: navigation on the left; domain box, new analysis and account on top.
export default function AppHeader({ email, children }: { email: string; children?: React.ReactNode }) {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <div className="app-frame">
      <aside className="leftnav">
        <div className="brand-lockup">
          <span className="logo-mark"><Icon name="logo" size={16} /></span>
          <div>
            <div className="brand-name">AI Visibility</div>
            <div className="brand-tag">Brand monitor</div>
          </div>
        </div>
        <Suspense fallback={<nav aria-label="Main" className="leftnav-groups" />}>
          <SideNav />
        </Suspense>
      </aside>
      <div className="app-body">
        <header className="appbar">
          <div className="appbar-row">
            <div className="appbar-tools">
              <Suspense fallback={null}><TopTools /></Suspense>
              <div className="account">
                <span className="avatar" aria-hidden="true">{initials}</span>
                <div className="account-text">
                  <span className="account-label">Signed in as</span>
                  <span className="account-email" title={email}>{email}</span>
                </div>
                <form action={signOut}>
                  <button type="submit" className="icon-btn" aria-label="Log out" title="Log out">
                    <Icon name="logout" size={16} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
