import { requireEnv } from "../env";
import { postJson } from "../http";

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small"; // 1536 dimensions

// Turns texts into embedding vectors (lists of numbers that capture meaning).
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const raw = await postJson(
      "https://api.openai.com/v1/embeddings",
      { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}` },
      { model: EMBEDDING_MODEL, input: texts.slice(i, i + 96).map((t) => t.slice(0, 8000)) },
      2,
      60_000,
    );
    out.push(...raw.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding));
  }
  return out;
}

// pgvector accepts vectors written as "[0.1,0.2,...]".
export const toVector = (v: number[]) => `[${v.join(",")}]`;
