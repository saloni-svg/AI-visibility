"use client";

import { useRouter } from "next/navigation";

// Dropdown of completed runs. Changing it reloads the page for that run,
// keeping the question-type filter.
export default function RunPicker({
  runs,
  value,
  scope,
}: {
  runs: { id: string; label: string }[];
  value: string;
  scope: string;
}) {
  const router = useRouter();
  return (
    <label>
      Run
      <select
        value={value}
        onChange={(e) => router.push(`/?run=${encodeURIComponent(e.target.value)}&type=${scope}`)}
      >
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
