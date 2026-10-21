"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshInsights } from "../(dashboard)/actions";

export default function InsightsButton({ domain, runId, label }: { domain: string; runId: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="btn-secondary btn-small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const res = await refreshInsights(domain, runId);
            if ("error" in res) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Writing…" : label}
      </button>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
