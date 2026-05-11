/**
 * OpenText ALM reference XML writer (Issue #1365).
 *
 * Emits a deterministic, byte-identical XML envelope describing the QC
 * mapping preview. The schema is workspace-dev-internal (not OpenText
 * native) but maps cleanly onto OpenText ALM concepts:
 *
 *   <workspace-alm-export
 *       xmlns="https://workspace-dev.local/schema/alm-export/v1"
 *       schemaVersion="1.0.0"
 *       contractVersion="..."
 *       jobId="..."
 *       generatedAt="..."
 *       profileId="..."
 *       profileVersion="...">
 *     <testCases>
 *       <testCase
 *           id="..."
 *           externalId="..."
 *           priority="..."
 *           riskCategory="..."
 *           subject="..."
 *           type="MANUAL">
 *         <name>...</name>
 *         <description><![CDATA[...]]></description>
 *         <preconditions>
 *           <item>...</item>
 *         </preconditions>
 *         <testData>
 *           <item>...</item>
 *         </testData>
 *         <expectedResults>
 *           <item>...</item>
 *         </expectedResults>
 *         <steps>
 *           <step index="1">
 *             <action>...</action>
 *             <data>...</data>
 *             <expected>...</expected>
 *           </step>
 *         </steps>
 *         <traceRefs>
 *           <traceRef screenId="..." nodeId="..." nodeName="..."/>
 *         </traceRefs>
 *         <provenance
 *             deployment="..."
 *             fallbackReason="..."
 *             confidenceMean="..."
 *             ambiguityCount="..."
 *             evidenceHash="..."/>
 *       </testCase>
 *     </testCases>
 *   </workspace-alm-export>
 *
 * Operators that need an OpenText-native shape can transform this on
 * their side; the namespaced root keeps the workspace-dev contract
 * stable across OpenText product revisions.
 */

import {
  ALM_EXPORT_SCHEMA_VERSION,
  ALM_EXPORT_XML_NAMESPACE,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCaseFigmaTrace,
  type OpenTextAlmExportProfile,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
} from "../contracts/index.js";
import { neutralizeFormulaLeading } from "./spreadsheet-formula-guard.js";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const INDENT = "  ";
const NEWLINE = "\n";

// Issue #1664 (audit-2026-05): symmetric formula-injection neutralizer
// for the OpenText ALM XML export. Customers that re-export ALM data
// to XLSX or CSV would otherwise re-introduce the CWE-1236 attack
// surface. Shared neutralizer in `./spreadsheet-formula-guard.ts`.

const escapeText = (value: string): string => {
  return neutralizeFormulaLeading(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const escapeAttr = (value: string): string => {
  return neutralizeFormulaLeading(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const formatNumber = (value: number): string => {
  if (Number.isFinite(value)) return value.toFixed(6);
  return "0.000000";
};

const cdata = (value: string): string => {
  // CDATA cannot contain `]]>`; defensively split it.
  return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
};

const indent = (depth: number): string => INDENT.repeat(depth);

const renderTraceRef = (
  trace: GeneratedTestCaseFigmaTrace,
  depth: number,
): string => {
  const attrs: string[] = [`screenId="${escapeAttr(trace.screenId)}"`];
  if (trace.nodeId !== undefined) {
    attrs.push(`nodeId="${escapeAttr(trace.nodeId)}"`);
  }
  if (trace.nodeName !== undefined) {
    attrs.push(`nodeName="${escapeAttr(trace.nodeName)}"`);
  }
  if (trace.nodePath !== undefined) {
    attrs.push(`nodePath="${escapeAttr(trace.nodePath)}"`);
  }
  return `${indent(depth)}<traceRef ${attrs.join(" ")}/>`;
};

const renderItemList = (
  tag: string,
  items: readonly string[],
  depth: number,
): string[] => {
  const lines: string[] = [];
  if (items.length === 0) {
    lines.push(`${indent(depth)}<${tag}/>`);
    return lines;
  }
  lines.push(`${indent(depth)}<${tag}>`);
  for (const item of items) {
    lines.push(`${indent(depth + 1)}<item>${escapeText(item)}</item>`);
  }
  lines.push(`${indent(depth)}</${tag}>`);
  return lines;
};

const renderTestCase = (
  entry: QcMappingPreviewEntry,
  profile: OpenTextAlmExportProfile,
  depth: number,
): string[] => {
  const lines: string[] = [];
  const attrs: string[] = [
    `id="${escapeAttr(entry.testCaseId)}"`,
    `externalId="${escapeAttr(entry.externalIdCandidate)}"`,
    `priority="${escapeAttr(entry.priority)}"`,
    `riskCategory="${escapeAttr(entry.riskCategory)}"`,
    `subject="${escapeAttr(entry.targetFolderPath)}"`,
    `type="MANUAL"`,
    `exportable="${entry.exportable ? "true" : "false"}"`,
  ];
  lines.push(`${indent(depth)}<testCase ${attrs.join(" ")}>`);
  lines.push(`${indent(depth + 1)}<name>${escapeText(entry.testName)}</name>`);
  if (profile.cdataDescription) {
    lines.push(
      `${indent(depth + 1)}<description>${cdata(entry.objective)}</description>`,
    );
  } else {
    lines.push(
      `${indent(depth + 1)}<description>${escapeText(entry.objective)}</description>`,
    );
  }

  for (const line of renderItemList(
    "preconditions",
    entry.preconditions,
    depth + 1,
  )) {
    lines.push(line);
  }
  for (const line of renderItemList("testData", entry.testData, depth + 1)) {
    lines.push(line);
  }
  for (const line of renderItemList(
    "expectedResults",
    entry.expectedResults,
    depth + 1,
  )) {
    lines.push(line);
  }

  if (entry.designSteps.length === 0) {
    lines.push(`${indent(depth + 1)}<steps/>`);
  } else {
    lines.push(`${indent(depth + 1)}<steps>`);
    for (const step of entry.designSteps
      .slice()
      .sort((a, b) => a.index - b.index)) {
      lines.push(`${indent(depth + 2)}<step index="${step.index}">`);
      lines.push(
        `${indent(depth + 3)}<action>${escapeText(step.action)}</action>`,
      );
      if (step.data !== undefined) {
        lines.push(`${indent(depth + 3)}<data>${escapeText(step.data)}</data>`);
      }
      if (step.expected !== undefined) {
        lines.push(
          `${indent(depth + 3)}<expected>${escapeText(step.expected)}</expected>`,
        );
      }
      lines.push(`${indent(depth + 2)}</step>`);
    }
    lines.push(`${indent(depth + 1)}</steps>`);
  }

  if (entry.sourceTraceRefs.length === 0) {
    lines.push(`${indent(depth + 1)}<traceRefs/>`);
  } else {
    lines.push(`${indent(depth + 1)}<traceRefs>`);
    for (const trace of entry.sourceTraceRefs) {
      lines.push(renderTraceRef(trace, depth + 2));
    }
    lines.push(`${indent(depth + 1)}</traceRefs>`);
  }

  if (entry.blockingReasons.length > 0) {
    lines.push(`${indent(depth + 1)}<blockingReasons>`);
    for (const reason of entry.blockingReasons) {
      lines.push(`${indent(depth + 2)}<reason>${escapeText(reason)}</reason>`);
    }
    lines.push(`${indent(depth + 1)}</blockingReasons>`);
  }

  if (entry.visualProvenance) {
    const v = entry.visualProvenance;
    const provAttrs: string[] = [
      `deployment="${escapeAttr(v.deployment)}"`,
      `fallbackReason="${escapeAttr(v.fallbackReason)}"`,
      `confidenceMean="${formatNumber(v.confidenceMean)}"`,
      `ambiguityCount="${v.ambiguityCount}"`,
      `evidenceHash="${escapeAttr(v.evidenceHash)}"`,
    ];
    lines.push(`${indent(depth + 1)}<provenance ${provAttrs.join(" ")}/>`);
  }

  lines.push(`${indent(depth)}</testCase>`);
  return lines;
};

export interface RenderQcAlmXmlInput {
  preview: QcMappingPreviewArtifact;
  profile: OpenTextAlmExportProfile;
}

/** Render the deterministic OpenText ALM reference XML payload. */
export const renderQcAlmXml = (input: RenderQcAlmXmlInput): string => {
  const lines: string[] = [];
  lines.push(XML_DECLARATION);

  const rootAttrs: string[] = [
    `xmlns="${escapeAttr(ALM_EXPORT_XML_NAMESPACE)}"`,
    `schemaVersion="${escapeAttr(ALM_EXPORT_SCHEMA_VERSION)}"`,
    `contractVersion="${escapeAttr(TEST_INTELLIGENCE_CONTRACT_VERSION)}"`,
    `jobId="${escapeAttr(input.preview.jobId)}"`,
    `generatedAt="${escapeAttr(input.preview.generatedAt)}"`,
    `profileId="${escapeAttr(input.preview.profileId)}"`,
    `profileVersion="${escapeAttr(input.preview.profileVersion)}"`,
  ];
  lines.push(`<workspace-alm-export ${rootAttrs.join(" ")}>`);

  const sortedEntries = input.preview.entries
    .slice()
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  if (sortedEntries.length === 0) {
    lines.push(`${indent(1)}<testCases/>`);
  } else {
    lines.push(`${indent(1)}<testCases>`);
    for (const entry of sortedEntries) {
      for (const line of renderTestCase(entry, input.profile, 2)) {
        lines.push(line);
      }
    }
    lines.push(`${indent(1)}</testCases>`);
  }

  lines.push("</workspace-alm-export>");
  return lines.join(NEWLINE) + NEWLINE;
};
