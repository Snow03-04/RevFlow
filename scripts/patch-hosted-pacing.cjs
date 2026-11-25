// Patch only the budget schema in a downloaded, deployed revflow-sync bundle.
// The hosted worker contains independent changes: never rebuild it from an
// older checkout just to add these two optional, backwards-compatible fields.
function patchHostedPacing(source) {
  const blocks = source.match(/var ScriptBudget = external_exports\.object\(\{[\s\S]*?\n\}\);/g);
  if (blocks?.length !== 1) throw Error("Expected exactly one ScriptBudget schema");
  const before = blocks[0];
  if (before.includes("firstDayExtra:") && before.includes("forecast:")) return source;
  const spent = "  spent: external_exports.number().finite().nonnegative()";
  if (!before.includes(spent)) throw Error("Unknown schema shape; review before editing");
  const newline = before.includes("\r\n") ? "\r\n" : "\n";
  const after = before.replace(spent, [spent + ",",
    "  forecast: external_exports.number().finite().nonnegative().nullable().optional(),",
    "  firstDayExtra: external_exports.number().finite().nonnegative().nullable().optional()",
  ].join(newline));
  return source.replace(before, after);
}
module.exports = { patchHostedPacing };
if (require.main === module) {
  const fs = require("node:fs");
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output) throw Error("Use distinct input and output paths");
  const source = fs.readFileSync(input, "utf8");
  fs.writeFileSync(output, patchHostedPacing(source));
  console.log("Prepared compatible budget schema; all other worker code preserved.");
}
