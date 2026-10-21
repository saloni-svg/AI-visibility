"use client";

import { usePathname, useRouter } from "next/navigation";

// Dropdown of completed runs. Changing it reloads the current page for that
// run, keeping the other filters in `query`.
export default function RunPicker({
  runs,
  value,
  query,
}: {
  runs: { id: string; label: string }[];
  value: string;
  query: string;
}) {
  const router = useRouter();
  const path = usePathname();
  return (
    <label>
      Data as of
      <select value={value} onChange={(e) => router.push(`${path}?${query}&run=${encodeURIComponent(e.target.value)}`, { scroll: false })}>
        {runs.map((r, i) => (
          <option key={r.id} value={r.id}>
            {r.label}
            {i === 0 ? " (latest)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
