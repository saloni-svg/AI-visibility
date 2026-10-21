"use client";

import { usePathname, useRouter } from "next/navigation";

// "All AI platforms" dropdown. Keeps the other filters in `query`.
export default function PlatformSelect({ value, options, query }: { value: string; options: { value: string; label: string }[]; query: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <label>
      <span className="sr-only">AI platform</span>
      <select value={value} onChange={(e) => router.push(`${path}?${query}&platform=${e.target.value}`, { scroll: false })}>
        <option value="all">All AI platforms</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
