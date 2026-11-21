"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DomainForm from "./DomainForm";
import { GROUPS } from "./SidebarNav";
import { useDomain } from "./useDomain";

// Top bar tools: domain box and "+ New analysis".
export default function TopTools() {
  const path = usePathname();
  const { urlDomain } = useDomain();
  // Keyword and prompt research don't use a domain, so the box is hidden there and the bar
  // shows where you are instead (no empty strip).
  const showDomain = !(path === "/" && !urlDomain) && !path.startsWith("/keywords") && !path.startsWith("/prompts") && !path.startsWith("/tracking");
  const group = GROUPS.find((g) => g.items.some((i) => i.match && i.match !== "/" && path.startsWith(i.match)));
  const item = group?.items.find((i) => i.match && i.match !== "/" && path.startsWith(i.match));
  return (
    <>
      {showDomain ? (
        <DomainForm key={urlDomain ?? ""} initial={urlDomain ?? ""} />
      ) : (
        <p className="appbar-page">
          {group && item ? <><span>{group.title}</span><span aria-hidden="true">›</span><b>{item.label}</b></> : <b>Start a new analysis</b>}
        </p>
      )}
      <Link href="/" className={`appbar-new${path === "/" && !urlDomain ? " is-active" : ""}`}>+ New analysis</Link>
    </>
  );
}
