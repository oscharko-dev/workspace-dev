import assert from "node:assert/strict";
import test from "node:test";
import {
  collectGeneratedJsxFragmentDiagnostics,
  validateGeneratedJsxFragment,
  validateGeneratedSourceFile
} from "./generated-source-validation.js";

test("validateGeneratedJsxFragment accepts multiple sibling roots in a valid JSX context", () => {
  assert.doesNotThrow(() => {
    validateGeneratedJsxFragment({
      raw: "      <AppBar />\n      <Stack />",
      context: {
        screenName: "Sample Screen",
        nodeId: "node-1",
        nodeName: "Header",
        nodeType: "appbar",
        renderSource: "render strategy 'appbar'"
      }
    });
  });
});

test("validateGeneratedJsxFragment rejects stray closing tags with node context", () => {
  assert.throws(
    () => {
      validateGeneratedJsxFragment({
        raw: "      </AppBar>",
        context: {
          screenName: "Broken Screen",
          nodeId: "node-2",
          nodeName: "Broken Header",
          nodeType: "appbar",
          renderSource: "pre-dispatch strategy"
        }
      });
    },
    /Invalid generated JSX fragment in screen 'Broken Screen' for node 'node-2' \(Broken Header, appbar\) during pre-dispatch strategy: __generated_fragment__\.tsx:1:\d+ - Expected corresponding closing tag for JSX fragment\./
  );
});

test("collectGeneratedJsxFragmentDiagnostics reports mismatched JSX pairs relative to the fragment", () => {
  const diagnostics = collectGeneratedJsxFragmentDiagnostics({
    raw: "      <Box>\n        </Stack>\n      </Box>"
  });
  assert.equal(diagnostics.length > 0, true);
  assert.match(diagnostics.join("; "), /__generated_fragment__\.tsx:2:\d+ -/);
});

test("validateGeneratedSourceFile rejects malformed TSX modules with file path context", () => {
  assert.throws(
    () => {
      validateGeneratedSourceFile({
        filePath: "src/screens/Broken.tsx",
        content: `export default function BrokenScreen() {\n  return (\n    <Box>\n  );\n}\n`
      });
    },
    /Invalid generated source file 'src\/screens\/Broken\.tsx': src\/screens\/Broken\.tsx:\d+:\d+ - JSX element 'Box' has no corresponding closing tag\./
  );
});
