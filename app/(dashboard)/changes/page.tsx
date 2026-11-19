import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cleanDomain } from "@/lib/domain";
import ChangesReport from "../../reports/ChangesReport";

export const dynamic = "force-dynamic";

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ domain?: string; run?: string; prev?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const p = await searchParams;
  const domain = cleanDomain(p.domain ?? "");
  if (!domain) redirect("/");
  return <ChangesReport domain={domain} params={p} />;
}
