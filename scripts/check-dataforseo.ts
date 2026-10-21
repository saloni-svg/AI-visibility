// Checks that DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in .env work.
//   npm run check:dataforseo
import "../lib/env";
import { checkDataForSeo } from "../lib/dataforseo";

checkDataForSeo().then((r) => {
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
});
