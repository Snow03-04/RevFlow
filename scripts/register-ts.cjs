// Run the financial regression tests with the project's installed TypeScript.
// Server-only is a bundler guard; these tests run entirely in Node.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/"))
    request = path.join(root, "src", request.slice(2));
  return resolve.call(this, request, parent, ...rest);
};
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return load.call(this, request, ...rest);
};
function compile(module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
}
require.extensions[".ts"] = compile;
require.extensions[".tsx"] = compile;
