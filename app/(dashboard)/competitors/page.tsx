import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cleanDomain } from "@/lib/domain";
import CompetitorsReport from "../../reports/CompetitorsReport";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; run?: string; country?: string; platform?: string }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");
  return <CompetitorsReport domain={domain} params={params} />;
}
