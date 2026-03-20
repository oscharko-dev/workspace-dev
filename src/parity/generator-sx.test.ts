import assert from "node:assert/strict";
import test from "node:test";
import { extractSharedSxConstantsFromScreenContent } from "./generator-sx.js";

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
