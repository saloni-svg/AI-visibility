import { redirect } from "next/navigation";
import { cleanDomain } from "@/lib/domain";
import AnalyzeProgress from "../../components/AnalyzeProgress";

export const dynamic = "force-dynamic";

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ domain?: string; force?: string }> }) {
  const params = await searchParams;
  const domain = cleanDomain(params.domain ?? "");
  if (!domain) redirect("/");
  return (
    <main className="dash">
      <AnalyzeProgress domain={domain} force={params.force === "1"} />
    </main>
  );
}
