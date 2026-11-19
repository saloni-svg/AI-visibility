import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cleanDomain } from "@/lib/domain";
import PositionsReport from "../../reports/PositionsReport";

export const dynamic = "force-dynamic";

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ domain?: string; country?: string; run?: string; project?: string; ads?: string; ads_error?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");
  return <PositionsReport domain={domain} params={params} />;
}
