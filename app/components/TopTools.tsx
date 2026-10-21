"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DomainForm from "./DomainForm";
import { useDomain } from "./useDomain";

// Top bar tools: domain box and "+ New analysis".
export default function TopTools() {
  const path = usePathname();
  const { urlDomain } = useDomain();
  // Keyword and prompt research don't use a domain, so the box is hidden there.
  const showDomain = !(path === "/" && !urlDomain) && !path.startsWith("/keywords") && !path.startsWith("/prompts") && !path.startsWith("/tracking");
  return (
    <>
      {showDomain && <DomainForm key={urlDomain ?? ""} initial={urlDomain ?? ""} />}
      <Link href="/" className={`appbar-new${path === "/" && !urlDomain ? " is-active" : ""}`}>+ New analysis</Link>
    </>
  );
}
