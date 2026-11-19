import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cleanDomain } from "@/lib/domain";
import SeoReport from "../../reports/SeoReport";

export const dynamic = "force-dynamic";

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ domain?: string; plan?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");
  return <SeoReport domain={domain} params={params} />;
}
