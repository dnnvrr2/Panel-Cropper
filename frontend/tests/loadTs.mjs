import { readFile } from "node:fs/promises";
import ts from "typescript";

const modules = new Map();

export async function loadTs(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const source = await readFile(url, "utf8");
  let javascript = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const imports = [...javascript.matchAll(/from ["']([^"']+)["']/g)];
  for (const match of imports) {
    const specifier = match[1];
    let resolved;
    if (specifier.startsWith(".")) {
      const base = new URL(specifier, url);
      try { resolved = await loadTs(new URL(`${base.href}.ts`)); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        resolved = await loadTs(new URL(`${base.href}.tsx`));
      }
    } else resolved = import.meta.resolve(specifier);
    javascript = javascript.replace(match[0], `from ${JSON.stringify(resolved)}`);
  }
  const resolved = `data:text/javascript,${encodeURIComponent(javascript)}`;
  modules.set(url.href, resolved);
  return resolved;
}
