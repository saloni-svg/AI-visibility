// Countries the platform can check from. Codes are ISO 3166 alpha-2;
// locationCode is DataForSEO's location id; currency is the local one for CPCs.
export const COUNTRIES = {
  US: { name: "United States", flag: "🇺🇸", locationCode: 2840, currency: "USD" },
  GB: { name: "United Kingdom", flag: "🇬🇧", locationCode: 2826, currency: "GBP" },
  IN: { name: "India", flag: "🇮🇳", locationCode: 2356, currency: "INR" },
  AU: { name: "Australia", flag: "🇦🇺", locationCode: 2036, currency: "AUD" },
  CA: { name: "Canada", flag: "🇨🇦", locationCode: 2124, currency: "CAD" },
  AE: { name: "United Arab Emirates", flag: "🇦🇪", locationCode: 2784, currency: "AED" },
  SG: { name: "Singapore", flag: "🇸🇬", locationCode: 2702, currency: "SGD" },
  DE: { name: "Germany", flag: "🇩🇪", locationCode: 2276, currency: "EUR" },
  FR: { name: "France", flag: "🇫🇷", locationCode: 2250, currency: "EUR" },
} as const;

export type CountryCode = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];
export const isCountry = (c: unknown): c is CountryCode => typeof c === "string" && c in COUNTRIES;
export const countryName = (c: string) => (isCountry(c) ? COUNTRIES[c].name : c);
export const countryFlag = (c: string) => (isCountry(c) ? COUNTRIES[c].flag : "🌐");
// Currencies a keyword report's CPCs can be shown in.
export const CURRENCIES = [...new Set(["USD", ...Object.values(COUNTRIES).map((c) => c.currency)])];
