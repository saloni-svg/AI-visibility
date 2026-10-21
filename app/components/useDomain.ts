"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// The website in the address, or (on pages without one, like Site audit) the last one opened.
export function useDomain() {
  const urlDomain = useSearchParams().get("domain");
  const [lastDomain, setLastDomain] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (urlDomain) localStorage.setItem("lastDomain", urlDomain);
      else setLastDomain(localStorage.getItem("lastDomain"));
    } catch { /* storage unavailable */ }
  }, [urlDomain]);
  return { urlDomain, domain: urlDomain ?? lastDomain };
}
