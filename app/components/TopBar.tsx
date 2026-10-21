"use client";

import { usePathname, useSearchParams } from "next/navigation";
import DomainForm from "./DomainForm";

// Domain box at the top of every dashboard page (not on the start page,
// which has its own big one).
export default function TopBar() {
  const path = usePathname();
  const domain = useSearchParams().get("domain") ?? "";
  if (path === "/" && !domain) return null;
  return (
    <div className="topbar">
      <DomainForm key={domain} initial={domain} />
    </div>
  );
}
