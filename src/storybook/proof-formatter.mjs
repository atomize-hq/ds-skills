import { format } from "prettier/standalone";
import babel from "prettier/plugins/babel";
import estree from "prettier/plugins/estree";
export function formatProofReport(report, formatting) {
  return format(JSON.stringify(report), {
    ...formatting,
    parser: "json",
    plugins: [babel, estree],
  });
}
