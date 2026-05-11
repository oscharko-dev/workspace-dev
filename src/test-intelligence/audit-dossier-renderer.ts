import { createHash } from "node:crypto";

import type {
  AuditDossierManifest,
  AuditDossierRegulationCoverageEntry,
} from "../contracts/index.js";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN_X = 44;
const PAGE_MARGIN_TOP = 52;
const PAGE_MARGIN_BOTTOM = 48;
const BODY_FONT_SIZE = 11;
const HEADING_FONT_SIZE = 15;
const TITLE_FONT_SIZE = 19;
const LINE_HEIGHT = 15;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2;
const MAX_CHARS_PER_LINE = 96;

type PdfFont = "regular" | "bold";

interface PdfLine {
  readonly text: string;
  readonly font: PdfFont;
  readonly size: number;
}

interface RenderAuditDossierPdfInput {
  readonly manifest: AuditDossierManifest;
}

const escapePdfString = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

const wrapLine = (text: string, maxChars: number): string[] => {
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxChars) return [normalized];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

const pushWrapped = (
  lines: PdfLine[],
  text: string,
  font: PdfFont = "regular",
  size: number = BODY_FONT_SIZE,
): void => {
  for (const wrapped of wrapLine(text, MAX_CHARS_PER_LINE)) {
    lines.push({ text: wrapped, font, size });
  }
};

const pushHeading = (lines: PdfLine[], text: string): void => {
  lines.push({ text, font: "bold", size: HEADING_FONT_SIZE });
};

const coverageLine = (
  entry: AuditDossierRegulationCoverageEntry,
  manifest: AuditDossierManifest,
): string => {
  const refs = entry.artifactKinds
    .map((kind) => manifest.sourceArtifacts.find((artifact) => artifact.kind === kind))
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== undefined)
    .map((artifact) => artifact.filename)
    .join(", ");
  const notes = entry.notes.length > 0 ? ` Notes: ${entry.notes.join(" ")}` : "";
  return `${entry.requirement}: ${refs}.${notes}`;
};

const buildPdfLines = (manifest: AuditDossierManifest): PdfLine[] => {
  const lines: PdfLine[] = [];
  lines.push({
    text: `Audit Dossier — ${manifest.runId}`,
    font: "bold",
    size: TITLE_FONT_SIZE,
  });
  lines.push({
    text: `Signed regulator-ready bundle for ${manifest.runId}`,
    font: "regular",
    size: BODY_FONT_SIZE,
  });
  lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  pushWrapped(lines, `Harness version: ${manifest.summary.harnessVersion}`);
  pushWrapped(lines, `Git SHA: ${manifest.summary.gitSha}`);
  pushWrapped(lines, `ICT register reference: ${manifest.summary.ictRegisterRefs.join(", ")}`);
  pushWrapped(lines, `Benchmark protocol version: ${manifest.summary.benchmarkProtocolVersion}`);
  pushWrapped(lines, `Policy profile: ${manifest.summary.policyProfileId}`);
  pushWrapped(lines, `Model card: ${manifest.summary.modelCardId}`);
  pushWrapped(lines, `Provenance Merkle root: ${manifest.provenance.merkleRoot}`);
  lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });

  pushHeading(lines, "Bundle Contents");
  pushWrapped(lines, `JSON manifest: ${manifest.bundle.jsonFilename}`);
  pushWrapped(lines, `Signature: ${manifest.bundle.signatureFilename}`);
  pushWrapped(lines, `Merkle proof: ${manifest.bundle.merkleProofFilename}`);
  pushWrapped(lines, `Rendered PDF: ${manifest.bundle.pdfFilename}`);
  lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });

  pushHeading(lines, "Run Summary");
  pushWrapped(lines, `Compliance frameworks covered: ${manifest.summary.complianceFrameworkCount}`);
  pushWrapped(lines, `Compliance annotations: ${manifest.summary.complianceAnnotationCount}`);
  pushWrapped(lines, `Calibration samples: ${manifest.summary.calibrationSampleCount}`);
  pushWrapped(lines, `Locale calibration curves: ${manifest.summary.localeCurveCount}`);
  pushWrapped(lines, `Inter-rater failures: ${manifest.summary.interRaterFailureCount}`);
  pushWrapped(lines, `Drift findings: ${manifest.summary.driftFindingCount}`);
  pushWrapped(lines, `Incidents logged: ${manifest.summary.incidentCount}`);
  pushWrapped(lines, `Subprocessors tracked: ${manifest.summary.subprocessorCount}`);
  pushWrapped(lines, `Faithfulness mismatch count: ${manifest.summary.faithfulnessMismatchCount}`);
  pushWrapped(lines, `Self-consistency reviewed targets: ${manifest.summary.selfConsistencyTargetCount}`);
  lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });

  const sections = [
    "BaFin / Bundesbank",
    "EIOPA",
    "EBA",
    "DORA Art. 10",
    "DORA Art. 28",
    "EU AI Act Art. 12",
    "EU AI Act Art. 13",
    "EU AI Act Art. 14",
    "GDPR Ch. V",
  ] as const;
  for (const section of sections) {
    pushHeading(lines, section);
    const entries = manifest.regulatorCoverage.filter(
      (entry) => entry.regulation === section,
    );
    for (const entry of entries) {
      pushWrapped(lines, coverageLine(entry, manifest));
    }
    lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  }

  pushHeading(lines, "Source Artifacts");
  for (const artifact of manifest.sourceArtifacts) {
    pushWrapped(
      lines,
      `${artifact.kind}: ${artifact.filename} sha256=${artifact.sha256} bytes=${artifact.bytes}`,
    );
  }
  lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });

  if (manifest.regionAttestations !== undefined) {
    pushHeading(lines, "Region Attestations");
    for (const row of manifest.regionAttestations) {
      pushWrapped(
        lines,
        `${row.filename}: ${row.distinctRegions.join(", ")} (attestations=${row.attestationCount})`,
      );
    }
    lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  }

  if (manifest.formalVerification !== undefined) {
    const fv = manifest.formalVerification;
    pushHeading(lines, "Formal Verification");
    pushWrapped(
      lines,
      `${fv.filename}: verdict=${fv.verdict} specs=${fv.specCount} formulae=${fv.formulaCount} pass=${fv.passCount} fail=${fv.failCount}`,
    );
    for (const spec of fv.specs) {
      pushWrapped(
        lines,
        `  ${spec.specPath} (module=${spec.module}, reachable=${spec.reachableStateCount}): ${spec.verdict.toUpperCase()} — ${spec.passCount}/${spec.formulaCount}`,
      );
    }
    lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  }

  if (manifest.customerBundle !== undefined) {
    const cb = manifest.customerBundle;
    pushHeading(lines, "Customer-Specific Configuration");
    pushWrapped(
      lines,
      `${cb.filename}: tenant=${cb.tenantId} version=${cb.bundleVersion} inherits=${cb.inheritsFromPolicyProfile} contentHash=${cb.contentHash}`,
    );
    pushWrapped(
      lines,
      `terminology=${cb.terminologyGlossaryCount} risk-class-labels=${cb.riskClassOverrideCount} house-standards=${cb.complianceHouseStandardCount} design-tokens=${cb.designSystemTokenCount}`,
    );
    pushWrapped(
      lines,
      `naming-convention=${cb.hasNamingConvention ? "yes" : "no"} customer-eval-rubric-ref=${cb.hasCustomerEvalRubricRef ? "yes" : "no"}`,
    );
    if (cb.appliedOverrides.length > 0) {
      pushWrapped(
        lines,
        `applied-overrides: ${cb.appliedOverrides.join(", ")}`,
      );
    } else {
      pushWrapped(lines, "applied-overrides: (none — additive surfaces only)");
    }
    lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  }

  if (manifest.selfImprovingCalibrationRefitHistory !== undefined) {
    const refit = manifest.selfImprovingCalibrationRefitHistory;
    pushHeading(lines, "Self-Improving Calibration Refit History");
    pushWrapped(
      lines,
      `production=${refit.productionCurveCount} proposals=${refit.proposalCount} ratified=${refit.ratifiedCount} rolled-back=${refit.rolledBackCount}`,
    );
    for (const row of refit.rows) {
      const stamp =
        row.status === "ratified" && row.ratifiedAt !== undefined
          ? `ratified=${row.ratifiedAt}`
          : `proposed=${row.proposedAt}`;
      pushWrapped(
        lines,
        `  ${row.locale}/${row.riskClass} [${row.status.toUpperCase()}] ${stamp} ECE=${row.heldOutEce} κ=${row.heldOutKappa} (${row.proposalId})`,
      );
    }
    lines.push({ text: "", font: "regular", size: BODY_FONT_SIZE });
  }

  pushHeading(lines, "Signing");
  pushWrapped(lines, `Algorithm: ${manifest.signing.algorithm}`);
  pushWrapped(lines, `Key fingerprint: ${manifest.signing.keyFingerprintSha256}`);
  return lines;
};

const paginate = (lines: readonly PdfLine[]): PdfLine[][] => {
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let y = A4_HEIGHT - PAGE_MARGIN_TOP;
  const minY = PAGE_MARGIN_BOTTOM;
  for (const line of lines) {
    if (y - LINE_HEIGHT < minY) {
      pages.push(page);
      page = [];
      y = A4_HEIGHT - PAGE_MARGIN_TOP;
    }
    page.push(line);
    y -= LINE_HEIGHT;
  }
  if (page.length > 0) {
    pages.push(page);
  }
  return pages;
};

const renderPageContent = (pageLines: readonly PdfLine[]): string => {
  const commands: string[] = [];
  let y = A4_HEIGHT - PAGE_MARGIN_TOP;
  for (const line of pageLines) {
    if (line.text.length === 0) {
      y -= LINE_HEIGHT;
      continue;
    }
    const fontRef = line.font === "bold" ? "/F2" : "/F1";
    commands.push(
      "BT",
      `${fontRef} ${line.size} Tf`,
      `1 0 0 1 ${PAGE_MARGIN_X.toFixed(2)} ${y.toFixed(2)} Tm`,
      `(${escapePdfString(line.text)}) Tj`,
      "ET",
    );
    y -= LINE_HEIGHT;
  }
  return commands.join("\n");
};

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const renderAuditDossierPdf = (
  input: RenderAuditDossierPdfInput,
): Uint8Array => {
  const pages = paginate(buildPdfLines(input.manifest));
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Count 0 /Kids [] >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageObjectNumbers: number[] = [];
  for (const page of pages) {
    const content = renderPageContent(page);
    const contentObjectNumber = objects.length + 1;
    const pageObjectNumber = objects.length + 2;
    const streamBytes = Buffer.byteLength(content, "utf8");
    objects.push(
      `<< /Length ${streamBytes} >>\nstream\n${content}\nendstream`,
    );
    objects.push(
      [
        "<< /Type /Page",
        "/Parent 2 0 R",
        `/MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}]`,
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>`,
        `/Contents ${contentObjectNumber} 0 R`,
        ">>",
      ].join(" "),
    );
    pageObjectNumbers.push(pageObjectNumber);
  }

  objects[1] = `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers
    .map((number) => `${number} 0 R`)
    .join(" ")}] >>`;

  const pdfBody: string[] = ["%PDF-1.4"];
  const offsets: number[] = [0];
  let currentOffset = Buffer.byteLength(`${pdfBody[0]}\n`, "utf8");
  for (let index = 0; index < objects.length; index += 1) {
    const objectText = `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    offsets.push(currentOffset);
    pdfBody.push(objectText);
    currentOffset += Buffer.byteLength(objectText, "utf8");
  }

  const xrefOffset = currentOffset;
  const xrefLines = [
    `xref`,
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n `),
  ];
  const trailerId = sha256Hex(canonicalTrailerSeed(input.manifest)).slice(0, 32);
  pdfBody.push(
    `${xrefLines.join("\n")}\n`,
    [
      "trailer",
      `<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${trailerId}><${trailerId}>] >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF",
    ].join("\n"),
  );

  return new TextEncoder().encode(pdfBody.join(""));
};

const canonicalTrailerSeed = (manifest: AuditDossierManifest): string =>
  [
    manifest.runId,
    manifest.provenance.merkleRoot,
    manifest.signing.keyFingerprintSha256,
    manifest.bundle.pdfFilename,
  ].join("|");

export const auditDossierPdfPageCount = (
  manifest: AuditDossierManifest,
): number => paginate(buildPdfLines(manifest)).length;

export const auditDossierPdfContentWidth = (): number => CONTENT_WIDTH;
