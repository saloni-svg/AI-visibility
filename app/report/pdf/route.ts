import { writeLog } from "@/lib/activity";
import { currentUser } from "@/lib/auth";
import { cleanDomain } from "@/lib/domain";
import { pdfResponse } from "@/lib/pdf/respond";
import { SHARE_KINDS, type ShareKind } from "@/lib/share";

// GET /report/pdf?kind=overview&domain=example.com&country=…: the report as a designed PDF file.
// Signed-in users only (proxy.ts also requires a login for this path).
export const maxDuration = 120;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response("Log in to download reports.", { status: 401 });
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const kind = q.kind as ShareKind;
  const domain = cleanDomain(q.domain ?? "");
  if (!SHARE_KINDS.includes(kind) || !domain) return new Response("Unknown report.", { status: 400 });
  await writeLog({ id: user.id, email: user.email ?? null }, "downloadPdf", { report: kind, domain }, { label: "Downloaded PDF report" });
  return pdfResponse(kind, domain, q);
}
