"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cleanDomain } from "@/lib/domain";

// Domain box: checks the input, then opens the analysis page for it.
export default function DomainForm({ initial = "", large = false, button = "Analyze" }: { initial?: string; large?: boolean; button?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const domain = cleanDomain(value);
    if (!domain) return setError("Enter a domain, like example.com");
    setError("");
    router.push(`/analyze?domain=${encodeURIComponent(domain)}`);
  }

  return (
    <form onSubmit={submit} className={`domain-form${large ? " domain-form-large" : ""}`} noValidate>
      <label htmlFor={large ? "domain-hero" : "domain-bar"} className="sr-only">Website domain</label>
      <input
        id={large ? "domain-hero" : "domain-bar"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter a domain, like example.com"
        aria-invalid={!!error}
        aria-describedby={error ? "domain-error" : undefined}
        autoComplete="off"
      />
      <button type="submit" className="btn-primary">{button}</button>
      {error && <p id="domain-error" className="field-error">{error}</p>}
    </form>
  );
}
