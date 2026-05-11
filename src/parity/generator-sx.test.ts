import assert from "node:assert/strict";
import test from "node:test";
import { countTopLevelSxProperties, extractSharedSxConstantsFromScreenContent, findSxBodyEndIndex } from "./generator-sx.js";

const countOccurrences = (source: string, token: string): number => source.split(token).length - 1;

test("shared sx extraction deduplicates semantically identical objects with reordered keys", () => {
  const source = `import { Box } from "@mui/material";
export default function Demo() {
  return (
    <>
      <Box sx={{ left: "0px", width: "24px", height: "24px" }} />
      <Box sx={{ width: "24px", height: "24px", left: "0px" }} />
      <Box sx={{ height: "24px", left: "0px", width: "24px" }} />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(content.includes("const sharedSxStyle1 = {"), true);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
  assert.equal(countOccurrences(content, "sx={{"), 0);
});

test("shared sx extraction deduplicates nested pseudo-selector objects regardless of key ordering", () => {
  const source = `import { Button } from "@mui/material";
export default function Demo() {
  return (
    <>
      <Button sx={{ color: "primary.main", "&:hover": { bgcolor: "red", color: "white" } }} />
      <Button sx={{ "&:hover": { color: "white", bgcolor: "red" }, color: "primary.main" }} />
      <Button sx={{ color: "primary.main", "&:hover": { color: "white", bgcolor: "red" } }} />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(content.includes("const sharedSxStyle1 = {"), true);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
  assert.equal(countOccurrences(content, '"&:hover": {'), 1);
});

test("shared sx extraction keeps legacy fallback behavior when parser cannot build AST", () => {
  const source = `import { Box } from "@mui/material";
export default function Demo() {
  const baseSx = { left: "0px" };
  return (
    <>
      <Box sx={{ ...baseSx, width: "24px" }} />
      <Box sx={{ ...baseSx, width: "24px" }} />
      <Box sx={{ ...baseSx, width: "24px" }} />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(content.includes("const sharedSxStyle1 = {"), true);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
});

test("shared sx extraction does not normalize parse-fallback bodies with different formatting", () => {
  const source = `import { Box } from "@mui/material";
export default function Demo() {
  const baseSx = { left: "0px" };
  return (
    <>
      <Box sx={{ ...baseSx, width: "24px" }} />
      <Box sx={{ ...baseSx , width: "24px" }} />
      <Box sx={{ ...baseSx, width:"24px" }} />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(content.includes("const sharedSxStyle1 = {"), false);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle"), 0);
});

test("top-level sx property counting counts direct entries deterministically", () => {
  const count = countTopLevelSxProperties(`
    px: 2,
    py: 3,
    display: "flex",
    "&:hover": { bgcolor: "primary.main", color: "common.white" }
  `);
  assert.equal(count, 4);
});

test("top-level sx property counting returns undefined for invalid sx object syntax", () => {
  const count = countTopLevelSxProperties(`px: 2, display:`);
  assert.equal(count, undefined);
});

test("top-level sx property counting parses quoted keys, nested objects, and escaped string literals", () => {
  const count = countTopLevelSxProperties(`
    "font-family": "Inter\\nUI",
    "&:hover": { color: "white", content: "A\\tB" },
    label: formatAmount(total, { currency: "EUR" }),
  `);

  assert.equal(count, 3);
});

test("top-level sx property counting rejects unsupported spreads, computed keys, and mismatched delimiters", () => {
  assert.equal(countTopLevelSxProperties(`...baseSx, width: 24`), undefined);
  assert.equal(countTopLevelSxProperties(`[dynamicKey]: 24`), undefined);
  assert.equal(countTopLevelSxProperties(`label: totals]`), undefined);
  assert.equal(countTopLevelSxProperties(`label: openPanel)`), undefined);
  assert.equal(countTopLevelSxProperties(`"unterminated: "value"`), undefined);
});

test("findSxBodyEndIndex handles nested braces and quoted braces while returning undefined for malformed bodies", () => {
  const source = `sx={{ content: "}", nested: { value: "{" }, label: \`A { B }\` }}`;
  const startIndex = source.indexOf("{{") + 2;
  const endIndex = findSxBodyEndIndex({ source, startIndex });

  assert.equal(source.slice(endIndex ?? 0, (endIndex ?? 0) + 2), "}}");
  assert.equal(findSxBodyEndIndex({ source: `sx={{ content: "oops" `, startIndex }), undefined);
});

test("shared sx extraction skips malformed attributes, handles identifier collisions, and rewrites without default exports", () => {
  const source = `const sharedSxStyle1 = {};
const sharedSxStyle2 = {};
function Demo() {
  return (
    <>
      <Box sx={{ color: "red", "&:hover": { bgcolor: "black" } }} />
      <Box sx={{ "&:hover": { bgcolor: "black" }, color: "red" }} />
      <Box sx={{ color: "red", "&:hover": { bgcolor: "black" } }} />
      <Box sx={{ broken: formatAmount(total } />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(content.includes("const sharedSxStyle3 = {"), false);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle3}"), 3);
  assert.equal(content.includes('sx={{ broken: formatAmount(total }'), true);
  assert.equal(content.includes("export default function"), false);
});

test("shared sx extraction keeps unique low-frequency patterns inline", () => {
  const source = `import { Box } from "@mui/material";
export default function Demo() {
  return (
    <>
      <Box sx={{ color: "red", px: 2 }} />
      <Box sx={{ color: "red", px: 2 }} />
      <Box sx={{ color: "red", px: 2 }} />
      <Box sx={{ color: "blue", px: 2 }} />
    </>
  );
}`;

  const content = extractSharedSxConstantsFromScreenContent(source);
  assert.equal(countOccurrences(content, "sx={sharedSxStyle1}"), 3);
  assert.equal(content.includes('<Box sx={{ color: "blue", px: 2 }} />'), true);
});
