import { countryName, isCountry } from "../countries";

// Gemini and Perplexity have no location setting for web search, so the
// country is added to the question, the way a user's location would shape it.
export function askedFrom(prompt: string, country: string) {
  return isCountry(country) ? `${prompt}\n\n(I'm based in ${countryName(country)}.)` : prompt;
}
