import { validatePresentation } from "./render-config.mjs";
export function assembleFoundationScript(model, presentation, renderer) {
  validatePresentation(model, presentation);
  if (typeof renderer !== "string" || !renderer.includes("DSFoundations"))
    throw new Error("Missing prebuilt Foundations renderer");
  const data = JSON.stringify({ model, presentation })
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `${renderer}\nconst foundationInput = ${data};\nreturn DSFoundations.renderFoundations(figma, foundationInput.model, foundationInput.presentation);\n`;
}
