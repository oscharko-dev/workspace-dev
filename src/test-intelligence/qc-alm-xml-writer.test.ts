import assert from "node:assert/strict";
import test from "node:test";
import {
  ALM_EXPORT_SCHEMA_VERSION,
  ALM_EXPORT_XML_NAMESPACE,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
} from "../contracts/index.js";
import { renderQcAlmXml } from "./qc-alm-xml-writer.js";
import { OPENTEXT_ALM_REFERENCE_PROFILE } from "./qc-mapping.js";

const baseEntry = (
  overrides: Partial<QcMappingPreviewEntry>,
): QcMappingPreviewEntry => ({
  testCaseId: "tc-1",
  externalIdCandidate: "abc1234567890123",
  testName: "T",
  objective: "O",
  priority: "p1",
  riskCategory: "low",
  targetFolderPath: "/Subject/X/low",
  preconditions: [],
  testData: [],
  designSteps: [],
  expectedResults: [],
  sourceTraceRefs: [],
  exportable: true,
  blockingReasons: [],
  ...overrides,
});

const wrap = (entries: QcMappingPreviewEntry[]): QcMappingPreviewArtifact => ({
  schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  generatedAt: "2026-04-25T10:00:00.000Z",
  profileId: OPENTEXT_ALM_REFERENCE_PROFILE.id,
  profileVersion: OPENTEXT_ALM_REFERENCE_PROFILE.version,
  entries,
});

test("alm-xml: empty preview produces well-formed empty envelope", () => {
  const xml = renderQcAlmXml({
    preview: wrap([]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(
    xml.includes(`<workspace-alm-export xmlns="${ALM_EXPORT_XML_NAMESPACE}"`),
  );
  assert.ok(xml.includes(`schemaVersion="${ALM_EXPORT_SCHEMA_VERSION}"`));
  assert.ok(xml.includes("<testCases/>"));
  assert.ok(xml.endsWith("</workspace-alm-export>\n"));
});

test("alm-xml: special characters in attributes are escaped", () => {
  const xml = renderQcAlmXml({
    preview: wrap([baseEntry({ testName: 'A"&<B>' })]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  // testName lands in <name> (text), which escapes only & < >.
  assert.match(xml, /<name>A"&amp;&lt;B&gt;<\/name>/);
});

test("alm-xml: CDATA wraps description when profile.cdataDescription=true", () => {
  const xml = renderQcAlmXml({
    preview: wrap([baseEntry({ objective: "<bold>x</bold>" })]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.match(
    xml,
    /<description><!\[CDATA\[<bold>x<\/bold>\]\]><\/description>/,
  );
});

test("alm-xml: CDATA defends against `]]>` in payload", () => {
  const xml = renderQcAlmXml({
    preview: wrap([baseEntry({ objective: "evil ]]> string" })]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.ok(xml.includes("evil ]]]]><![CDATA[> string"));
});

test("alm-xml: deterministic output across two renders", () => {
  const a = renderQcAlmXml({
    preview: wrap([
      baseEntry({ testCaseId: "z" }),
      baseEntry({ testCaseId: "a" }),
    ]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  const b = renderQcAlmXml({
    preview: wrap([
      baseEntry({ testCaseId: "a" }),
      baseEntry({ testCaseId: "z" }),
    ]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.equal(a, b);
});

test("alm-xml: provenance element renders only when visual provenance present", () => {
  const xmlWithout = renderQcAlmXml({
    preview: wrap([baseEntry({})]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.equal(xmlWithout.includes("<provenance "), false);

  const xmlWith = renderQcAlmXml({
    preview: wrap([
      baseEntry({
        visualProvenance: {
          deployment: "phi-4-multimodal-poc",
          fallbackReason: "primary_unavailable",
          confidenceMean: 0.55,
          ambiguityCount: 3,
          evidenceHash: "f00d",
        },
      }),
    ]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.match(xmlWith, /<provenance deployment="phi-4-multimodal-poc"/);
  assert.match(xmlWith, /confidenceMean="0\.550000"/);
});

test("alm-xml: blocking reasons element appears only when populated", () => {
  const xmlEmpty = renderQcAlmXml({
    preview: wrap([baseEntry({ blockingReasons: [] })]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.equal(xmlEmpty.includes("<blockingReasons>"), false);

  const xmlPopulated = renderQcAlmXml({
    preview: wrap([
      baseEntry({ blockingReasons: ["policy:visual_sidecar_failure"] }),
    ]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.match(xmlPopulated, /<reason>policy:visual_sidecar_failure<\/reason>/);
});

test("alm-xml: exportable attribute reflects entry flag", () => {
  const xml = renderQcAlmXml({
    preview: wrap([baseEntry({ exportable: false })]),
    profile: { ...OPENTEXT_ALM_REFERENCE_PROFILE },
  });
  assert.match(xml, /exportable="false"/);
});
