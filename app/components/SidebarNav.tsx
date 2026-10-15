"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "./Icon";

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "competitors", label: "You vs competitors", icon: "users" },
  { id: "trend", label: "Over time", icon: "trend" },
  { id: "recommended", label: "Who AI recommends", icon: "sparkles" },
  { id: "sources", label: "Cited websites", icon: "globe" },
  { id: "questions", label: "Question by question", icon: "list" },
];

// Section links that highlight whichever section is currently on screen.
export default function SidebarNav() {
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Dashboard sections" className="side-nav">
      <p className="side-heading">Dashboard</p>
      <ul>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined} onClick={() => setActive(s.id)}>
              <Icon name={s.icon} size={17} />
              <span>{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
