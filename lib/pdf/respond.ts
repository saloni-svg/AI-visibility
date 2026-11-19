import { renderToBuffer } from "@react-pdf/renderer";
import type { ShareKind } from "../share";
import { buildReportPdf } from "./reports";

const NAMES: Record<ShareKind, string> = {
  overview: "AI-Visibility-Overview", competitors: "Competitor-Research", changes: "AI-Visibility-Changes", positions: "Position-Tracking", seo: "SEO-Plan",
};

// Builds the report's PDF and returns it as a file download ("RyzeIQ-SEO-Plan-digitalryze.com-2026-11-19.pdf").
export async function pdfResponse(kind: ShareKind, domain: string, params: Record<string, string | undefined>) {
  try {
    const doc = await buildReportPdf(kind, domain, params);
    const buffer = await renderToBuffer(doc);
    const file = `RyzeIQ-${NAMES[kind]}-${domain}-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return new Response(`Couldn't create the PDF: ${(err as Error).message}`, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
