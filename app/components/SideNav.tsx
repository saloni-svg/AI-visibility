"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GROUPS } from "./SidebarNav";
import { useDomain } from "./useDomain";

// Left navigation: the four groups with their links underneath.
// Same links, labels and "Soon" badges as before.
export default function SideNav() {
  const path = usePathname();
  const { domain } = useDomain();
  const isCurrent = (match?: string, always?: boolean) => !!match && (path === match || (!!always && path.startsWith(match)));
  return (
    <nav aria-label="Main" className="leftnav-groups">
      {GROUPS.map((g) => (
        <div key={g.title} className="leftnav-group">
          <p className="leftnav-heading">{g.title}</p>
          <ul>
            {g.items.map((item) => (
              <li key={item.label}>
                {item.href && (domain || item.always) ? (
                  <Link href={item.href(domain ?? "")} aria-current={isCurrent(item.match, item.always) ? "page" : undefined}>{item.label}</Link>
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
      ))}
    </nav>
  );
}
