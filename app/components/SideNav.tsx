"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { GROUPS } from "./SidebarNav";
import { useDomain } from "./useDomain";

// A small spinner next to the menu item that was clicked, until its page opens.
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-pending${pending ? " is-pending" : ""}`} />;
}

const GROUP_ICON: Record<string, IconName> = {
  "AI Analysis": "sparkles",
  "Keyword Research": "search",
  "Brand Performance": "chart",
  "AI Agents": "bot",
  "Boost & Monitor": "pulse",
};

// Left navigation: each main topic is a button; its pages show only when it's opened.
// The topic of the page you're on opens by itself.
export default function SideNav() {
  const path = usePathname();
  const { domain } = useDomain();
  const isCurrent = (match?: string, always?: boolean) => !!match && (path === match || (!!always && path.startsWith(match)));
  const currentGroup = GROUPS.find((g) => g.items.some((i) => isCurrent(i.match, i.always)))?.title ?? GROUPS[0].title;
  const [open, setOpen] = useState<string | null>(currentGroup);
  useEffect(() => setOpen(currentGroup), [currentGroup]);

  return (
    <nav aria-label="Main" className="leftnav-groups">
      {GROUPS.map((g) => {
        const isOpen = open === g.title;
        const hasCurrent = g.title === currentGroup;
        const id = `nav-${g.title.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <div key={g.title} className={`leftnav-group${isOpen ? " is-open" : ""}${hasCurrent ? " has-current" : ""}`}>
            <button type="button" className="leftnav-topic" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : g.title)}>
              <span className="leftnav-topic-icon"><Icon name={GROUP_ICON[g.title] ?? "grid"} size={17} /></span>
              <span className="leftnav-topic-label">{g.title}</span>
              <span className="leftnav-caret"><Icon name="chevron" size={15} /></span>
            </button>
            <div className="leftnav-sub" id={id} hidden={!isOpen}>
              <ul>
                {g.items.map((item) => (
                  <li key={item.label}>
                    {item.href && (domain || item.always) ? (
                      <Link href={item.href(domain ?? "")} aria-current={isCurrent(item.match, item.always) ? "page" : undefined}>{item.label}<Pending /></Link>
                    ) : (
                      <span className="leftnav-disabled" title={item.href ? "Analyze a domain first" : "Coming soon"}>
                        {item.label}
                        {!item.href && <span className="soon">Soon</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
