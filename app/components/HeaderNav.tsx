"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import DomainForm from "./DomainForm";
import { GROUPS } from "./SidebarNav";

// Top navigation: the four groups as top-level items; the chosen group's links
// show in a row underneath. Same links, labels and "Soon" badges as before.
export default function HeaderNav({ brand, account }: { brand: React.ReactNode; account: React.ReactNode }) {
  const path = usePathname();
  const urlDomain = useSearchParams().get("domain");
  // Pages without a website in the address (e.g. Site audit) use the last one you opened.
  const [lastDomain, setLastDomain] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (urlDomain) localStorage.setItem("lastDomain", urlDomain);
      else setLastDomain(localStorage.getItem("lastDomain"));
    } catch { /* storage unavailable: links stay disabled until a domain is chosen */ }
  }, [urlDomain]);
  const domain = urlDomain ?? lastDomain;
  const isCurrent = (match?: string, always?: boolean) => !!match && (path === match || (!!always && path.startsWith(match)));
  const currentGroup = GROUPS.find((g) => g.items.some((i) => isCurrent(i.match, i.always)))?.title ?? GROUPS[0].title;
  const [open, setOpen] = useState(currentGroup);
  useEffect(() => setOpen(currentGroup), [currentGroup]); // follow the page you're on
  const group = GROUPS.find((g) => g.title === open) ?? GROUPS[0];
  const showDomain = !(path === "/" && !urlDomain);

  return (
    <header className="appbar">
      <div className="appbar-row">
        {brand}
        <nav aria-label="Main" className="appbar-groups">
          {GROUPS.map((g) => (
            <button key={g.title} type="button" aria-expanded={open === g.title} aria-controls="appbar-sub"
              className={g.title === currentGroup ? "is-current" : undefined} onClick={() => setOpen(g.title)}>
              {g.title}
            </button>
          ))}
        </nav>
        <div className="appbar-tools">
          {showDomain && <DomainForm key={urlDomain ?? ""} initial={urlDomain ?? ""} />}
          <Link href="/" className={`appbar-new${path === "/" && !urlDomain ? " is-active" : ""}`}>+ New analysis</Link>
          {account}
        </div>
      </div>
      <nav id="appbar-sub" aria-label={group.title} className="appbar-sub">
        <ul>
          {group.items.map((item) => (
            <li key={item.label}>
              {item.href && (domain || item.always) ? (
                <Link href={item.href(domain ?? "")} aria-current={isCurrent(item.match, item.always) ? "page" : undefined}>{item.label}</Link>
              ) : (
                <span className="appbar-disabled" title={item.href ? "Analyze a domain first" : "Coming soon"}>
                  {item.label}
                  {!item.href && <span className="soon">Soon</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
