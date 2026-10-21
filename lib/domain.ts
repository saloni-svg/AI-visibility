// Pure helpers, safe to import in browser components.

// "https://www.Example.com/page" -> "example.com". Returns null if it isn't a domain.
export function cleanDomain(input: string): string | null {
  const s = (input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

export const domainRoot = (domain: string) => domain.split(".")[0];
