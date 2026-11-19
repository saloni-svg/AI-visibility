"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// "Loading…" pill in the bottom-left corner from the moment a link inside the app is clicked
// until the new page is on screen. Works on the live site (not only in development), for
// every page, filter and tab link. Stays at least a moment so it never just flickers.
export default function NavProgress() {
  const path = usePathname();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const since = useRef(0);
  const here = `${path}?${params.toString()}`;

  // A click on a link to another page of this site starts the indicator.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page
      since.current = Date.now();
      setLoading(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page is showing: hide it (after a short minimum so it's visible).
  useEffect(() => {
    if (!loading) return;
    const wait = Math.max(0, 350 - (Date.now() - since.current));
    const t = setTimeout(() => setLoading(false), wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

  // Safety net: never stay on screen forever (e.g. a link that didn't navigate).
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 30_000);
    return () => clearTimeout(t);
  }, [loading]);

  if (!loading) return null;
  return (
    <div className="load-pill" role="status" aria-live="polite">
      <span className="load-spin" aria-hidden="true" />
      Loading…
    </div>
  );
}
