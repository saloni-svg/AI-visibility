// Parses saved answers into mentions and sources. Useful if parsing failed,
// you ran track with --skip-parse, or you changed the parser.
//
//   npm run parse                     parse every answer not yet parsed
//   npm run parse -- --run=<run id>   only answers from one run
//   npm run parse -- --force          re-parse answers that were already parsed
import "../lib/env";
import { parseAnswers } from "../lib/parser";

const args = process.argv.slice(2);
const runId = args.find((a) => a.startsWith("--run="))?.split("=")[1];
const force = args.includes("--force");

parseAnswers({ runId, force }).catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
