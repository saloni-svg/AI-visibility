"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCountries } from "../(dashboard)/actions";

// Pick which countries the questions are asked from. Saving starts a check for new countries.
export default function CountriesEditor({
  domain,
  selected,
  options,
}: {
  domain: string;
  selected: string[];
  options: { code: string; name: string; flag: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(selected);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  function save() {
    setError("");
    start(async () => {
      const res = await updateCountries(domain, picked);
      if ("error" in res) return setError(res.error);
      router.push(`/analyze?domain=${domain}`);
    });
  }

  return (
    <div className="countries-editor">
      <button type="button" className="segmented-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        + Countries
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Countries to check">
          <p className="popover-title">Ask the questions from</p>
          <div className="country-options">
            {options.map((c) => (
              <label key={c.code} className="check-row">
                <input type="checkbox" checked={picked.includes(c.code)} onChange={() => toggle(c.code)} />
                <span>{c.flag} {c.name}</span>
              </label>
            ))}
          </div>
          <p className="note">Each country adds one more set of AI answers to every check.</p>
          {error && <p className="field-error">{error}</p>}
          <div className="popover-actions">
            <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setPicked(selected); }}>Cancel</button>
            <button type="button" className="btn-primary" disabled={pending || !picked.length} onClick={save}>
              {pending ? "Saving…" : "Save and check"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
