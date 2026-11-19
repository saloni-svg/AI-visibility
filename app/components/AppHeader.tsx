import "./app-frame-v5.css";
import { Suspense } from "react";
import BrandLockup from "./BrandMark";
import NavProgress from "./NavProgress";
import PageViewLogger from "./PageViewLogger";
import ProfileMenu from "./ProfileMenu";
import SideNav from "./SideNav";
import TopTools from "./TopTools";

// App frame: navigation on the left; domain box, new analysis and account on top.
export default function AppHeader({ email, name, role, children }: { email: string; name?: string | null; role?: string | null; children?: React.ReactNode }) {
  return (
    <div className="app-frame">
      <aside className="leftnav">
        <BrandLockup />
        <Suspense fallback={<nav aria-label="Main" className="leftnav-groups" />}>
          <SideNav />
        </Suspense>
      </aside>
      <div className="app-body">
        <header className="appbar">
          <div className="appbar-row">
            <div className="appbar-tools">
              <Suspense fallback={null}><TopTools /></Suspense>
              <ProfileMenu email={email} name={name} role={role} />
            </div>
          </div>
        </header>
        {children}
        <Suspense fallback={null}><PageViewLogger /></Suspense>
        <Suspense fallback={null}><NavProgress /></Suspense>
      </div>
    </div>
  );
}
