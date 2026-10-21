// Brand names that differ only by a generic word or company suffix are one brand:
// "HubSpot CRM" = "HubSpot", "Zoho Corporation" = "Zoho". Shared by the server and the page.
const GENERIC = new Set(["crm", "software", "app", "apps", "platform", "suite", "tool", "tools", "inc", "llc", "ltd", "corp", "corporation", "company", "co", "group"]);

export function brandKey(name: string) {
  const words = name.toLowerCase().replace(/\.com\b/, "").replace(/[.,®™]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && GENERIC.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}
