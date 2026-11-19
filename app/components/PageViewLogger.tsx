"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { logPageView } from "../(dashboard)/actions";

// Logs each page someone opens (once per page + domain/keyword, not for tab switches inside it).
export default function PageViewLogger() {
  const path = usePathname();
  const params = useSearchParams();
  const last = useRef("");
  const key = `${path}|${params.get("domain") ?? ""}|${params.get("keyword") ?? ""}|${params.get("topic") ?? ""}|${path === "/profile" ? params.get("tab") ?? "" : ""}`;
  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    void logPageView(path, Object.fromEntries(params.entries()));
  }, [key, path, params]);
  return null;
}
