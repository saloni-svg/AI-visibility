"use client";

import { useRouter } from "next/navigation";

// "Site Audit: <project ▾>" switcher.
export default function AuditProjectSwitch({ current, projects }: { current: string; projects: { name: string; domain: string }[] }) {
  const router = useRouter();
  return (
    <label className="au-switch">
      <span className="sr-only">Project</span>
      <select value={current} onChange={(e) => router.push(`/audit/site?domain=${e.target.value}`)}>
        {projects.map((p) => <option key={p.domain} value={p.domain}>{p.name}</option>)}
      </select>
    </label>
  );
}
