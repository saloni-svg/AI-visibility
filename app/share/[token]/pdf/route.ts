import { pdfResponse } from "@/lib/pdf/respond";
import { readShareToken } from "@/lib/share";

// GET /share/<token>/pdf: the shared report as a PDF file, for people with the share link
// (no login; the signed link decides the report, domain and filters).
export const maxDuration = 120;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const share = readShareToken((await params).token);
  if (!share) return new Response("This link has expired or isn't valid.", { status: 404 });
  return pdfResponse(share.kind, share.domain, share.params);
}
