"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type Item = { label: string; href?: (domain: string) => string; match?: string; always?: boolean };
export const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "AI Analysis",
    items: [
      { label: "Visibility overview", href: (d) => `/?domain=${d}`, match: "/" },
      { label: "Competitor research", href: (d) => `/competitors?domain=${d}`, match: "/competitors" },
      { label: "Change explainer", href: (d) => `/changes?domain=${d}`, match: "/changes" },
      { label: "Prompt research", href: (d) => (d ? `/prompts?domain=${d}` : "/prompts"), match: "/prompts", always: true },
    ],
  },
  { title: "Keyword Research", items: [{ label: "Keyword overview", href: (d) => (d ? `/keywords?domain=${d}` : "/keywords"), match: "/keywords", always: true }] },
  { title: "Brand Performance", items: [{ label: "Brand performance" }, { label: "Perception" }, { label: "Narrative drivers" }, { label: "Questions" }] },
  {
    title: "Boost & Monitor",
    items: [
      { label: "Content agent", href: (d) => `/agent?domain=${d}`, match: "/agent" },
      { label: "Page fixes", href: (d) => `/fixes?domain=${d}`, match: "/fixes" },
      { label: "Position tracking", href: (d) => `/positions?domain=${d}`, match: "/positions" },
      { label: "Site audit", href: () => "/audit", match: "/audit", always: true },
      { label: "Review management", href: (d) => `/reviews?domain=${d}`, match: "/reviews" },
      { label: "Prompt tracking", href: () => "/tracking", match: "/tracking", always: true },
    ],
  },
];

// Section links for the chosen domain. Items without a page yet show "Soon".
export default function SidebarNav() {
  const path = usePathname();
  const domain = useSearchParams().get("domain");

  return (
    <nav aria-label="Main" className="side-nav">
      <Link href="/" className={`side-new${path === "/" && !domain ? " is-active" : ""}`}>+ New analysis</Link>
      {GROUPS.map((g) => (
        <div key={g.title} className="side-group">
          <p className="side-heading">{g.title}</p>
          <ul>
            {g.items.map((item) => (
              <li key={item.label}>
                {item.href && (domain || item.always) ? (
                  <Link href={item.href(domain ?? "")} aria-current={path === item.match || (item.always && path.startsWith(item.match ?? "-")) ? "page" : undefined}>{item.label}</Link>
                ) : (
                  <span className="side-disabled" title={item.href ? "Analyze a domain first" : "Coming soon"}>
                    {item.label}
                    {!item.href && <span className="soon">Soon</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
