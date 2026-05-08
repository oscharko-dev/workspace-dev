import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  PROVENANCE_ARTIFACT_FILENAME,
  type A11yVerdict,
  type FaithfulnessVerdict,
  type GeneratedTestCaseList,
  type JudgeConsensusVerdict,
  type JudgeVerdict,
} from "../contracts/index.js";
import type { AdversarialCriticFinding } from "./adversarial-critic-agent.js";
import type { RepairLoopIterationRecord } from "./repair-loop.js";
import { canonicalJson } from "./content-hash.js";

export const PROVENANCE_SCHEMA_VERSION = "1.0.0" as const;
export const PROV_JSONLD_CONTEXT_URL = "https://www.w3.org/ns/prov.jsonld";
export const PROVENANCE_MERKLE_ALGORITHM = "sha256_merkle_v1" as const;

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

type ProvenanceNode = { [key: string]: JsonValue };

interface ArtifactDigest {
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface BaseJudgeInput<TVerdict> {
  readonly artifactFilename: string;
  readonly verdict: TVerdict;
}

export interface BuildRunProvenanceGraphInput {
  readonly runDir: string;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly sourceKind: string;
  readonly finalGeneratedTestCases: GeneratedTestCaseList;
  readonly initialGenerationDeployment: string;
  readonly adversarialCriticRounds?: readonly {
    readonly round: number;
    readonly artifactFilename: string;
    readonly domain: string;
    readonly findings: readonly AdversarialCriticFinding[];
    readonly regeneratedListHash?: string;
    readonly generatedCaseCount?: number;
  }[];
  readonly repairIterations?: readonly RepairLoopIterationRecord[];
  readonly logicJudge: BaseJudgeInput<JudgeVerdict>;
  readonly judgeConsensus: BaseJudgeInput<JudgeConsensusVerdict>;
  readonly faithfulnessJudge?: BaseJudgeInput<FaithfulnessVerdict>;
  readonly a11yJudge?: BaseJudgeInput<A11yVerdict>;
}

export interface ProvenanceMerkleSeal {
  readonly algorithm: typeof PROVENANCE_MERKLE_ALGORITHM;
  readonly root: string;
  readonly leafCount: number;
}

export interface ProvenanceDocument {
  readonly "@context": readonly JsonValue[];
  readonly "@id": string;
  readonly "@type": string;
  readonly "ti:schemaVersion": typeof PROVENANCE_SCHEMA_VERSION;
  readonly "ti:jobId": string;
  readonly "ti:generatedAt": string;
  readonly "ti:sourceKind": string;
  readonly "ti:merkleSeal": ProvenanceMerkleSeal;
  readonly "@graph": readonly ProvenanceNode[];
}

export interface WriteProvenanceGraphResult {
  readonly artifactPath: string;
  readonly document: ProvenanceDocument;
  readonly bytes: Uint8Array;
}

const PROVENANCE_CONTEXT = Object.freeze({
  ti: "https://workspace-dev.local/ns/test-intelligence#",
  label: "http://www.w3.org/2000/01/rdf-schema#label",
});

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const toUtf8Bytes = (value: string): Uint8Array =>
  new TextEncoder().encode(value);

const toIriRef = (value: string): { "@id": string } => ({ "@id": value });

const makeNodeId = (jobId: string, kind: string, value: string): string =>
  `urn:workspace-dev:test-intelligence:${jobId}:${kind}:${value}`;

const sanitizeIriToken = (value: string): string =>
  value.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");

const buildArtifactNode = (input: {
  readonly jobId: string;
  readonly digest: ArtifactDigest;
  readonly label: string;
  readonly generatedBy?: string;
  readonly derivedFrom?: readonly string[];
  readonly extra?: Record<string, JsonValue>;
}): ProvenanceNode => ({
  "@id": makeNodeId(
    input.jobId,
    "artifact",
    sanitizeIriToken(input.digest.filename),
  ),
  "@type": "prov:Entity",
  label: input.label,
  "ti:artifactPath": input.digest.filename,
  "ti:sha256": input.digest.sha256,
  "ti:bytes": input.digest.bytes,
  ...(input.generatedBy !== undefined
    ? { "prov:wasGeneratedBy": toIriRef(input.generatedBy) }
    : {}),
  ...(input.derivedFrom !== undefined && input.derivedFrom.length > 0
    ? {
        "prov:wasDerivedFrom": input.derivedFrom
          .slice()
          .sort((left, right) => left.localeCompare(right))
          .map((value) => toIriRef(value)),
      }
    : {}),
  ...(input.extra ?? {}),
});

const buildAgentNode = (input: {
  readonly jobId: string;
  readonly kind: "software" | "model";
  readonly id: string;
  readonly label: string;
  readonly deployment?: string;
}): ProvenanceNode => ({
  "@id": makeNodeId(input.jobId, "agent", sanitizeIriToken(input.id)),
  "@type": "prov:SoftwareAgent",
  label: input.label,
  "ti:agentKind": input.kind,
  ...(input.deployment !== undefined
    ? { "ti:modelDeployment": input.deployment }
    : {}),
});

const buildActivityNode = (input: {
  readonly jobId: string;
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly associatedWith: readonly string[];
  readonly used?: readonly string[];
  readonly informedBy?: readonly string[];
  readonly generatedAt: string;
  readonly extra?: Record<string, JsonValue>;
}): ProvenanceNode => ({
  "@id": makeNodeId(input.jobId, "activity", sanitizeIriToken(input.id)),
  "@type": "prov:Activity",
  label: input.label,
  "ti:role": input.role,
  "prov:startedAtTime": input.generatedAt,
  "prov:endedAtTime": input.generatedAt,
  "prov:wasAssociatedWith": input.associatedWith
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((value) => toIriRef(value)),
  ...(input.used !== undefined && input.used.length > 0
    ? {
        "prov:used": input.used
          .slice()
          .sort((left, right) => left.localeCompare(right))
          .map((value) => toIriRef(value)),
      }
    : {}),
  ...(input.informedBy !== undefined && input.informedBy.length > 0
    ? {
        "prov:wasInformedBy": input.informedBy
          .slice()
          .sort((left, right) => left.localeCompare(right))
          .map((value) => toIriRef(value)),
      }
    : {}),
  ...(input.extra ?? {}),
});

const readArtifactDigest = async (
  runDir: string,
  filename: string,
): Promise<ArtifactDigest> => {
  const bytes = await readFile(join(runDir, filename));
  return {
    filename,
    sha256: sha256Hex(bytes),
    bytes: bytes.byteLength,
  };
};

const computeMerkleRoot = (hashes: readonly string[]): ProvenanceMerkleSeal => {
  const sorted = hashes
    .slice()
    .sort((left, right) => left.localeCompare(right));
  if (sorted.length === 0) {
    return {
      algorithm: PROVENANCE_MERKLE_ALGORITHM,
      root: sha256Hex(""),
      leafCount: 0,
    };
  }
  let level = sorted;
  while (level.length > 1) {
    const nextLevel: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      nextLevel.push(sha256Hex(`${left}:${right}`));
    }
    level = nextLevel;
  }
  return {
    algorithm: PROVENANCE_MERKLE_ALGORITHM,
    root: level[0]!,
    leafCount: sorted.length,
  };
};

export const computeProvenanceMerkleSeal = (
  nodes: readonly ProvenanceNode[],
): ProvenanceMerkleSeal =>
  computeMerkleRoot(
    nodes.map((node) => {
      const sanitized = { ...node } as Record<string, JsonValue>;
      delete sanitized["ti:leafHash"];
      return sha256Hex(canonicalJson(sanitized));
    }),
  );

const upsertNode = (
  nodes: Map<string, ProvenanceNode>,
  node: ProvenanceNode,
): void => {
  nodes.set(readNodeId(node), node);
};

const readNodeId = (node: ProvenanceNode): string => {
  const id = node["@id"];
  if (typeof id !== "string") {
    throw new TypeError("provenance node is missing @id");
  }
  return id;
};

const verdictEntityId = (
  jobId: string,
  judgeRole: string,
  testCaseId: string,
): string =>
  makeNodeId(
    jobId,
    "entity",
    sanitizeIriToken(`${judgeRole}-verdict-${testCaseId}`),
  );

const caseEntityId = (jobId: string, testCaseId: string): string =>
  makeNodeId(jobId, "entity", sanitizeIriToken(`test-case-${testCaseId}`));

const listEntityId = (jobId: string, suffix: string): string =>
  makeNodeId(jobId, "entity", sanitizeIriToken(`generated-list-${suffix}`));

const activityId = (jobId: string, value: string): string =>
  makeNodeId(jobId, "activity", sanitizeIriToken(value));

export const buildRunProvenanceGraph = async (
  input: BuildRunProvenanceGraphInput,
): Promise<ProvenanceDocument> => {
  const nodes = new Map<string, ProvenanceNode>();
  const modelAgents = new Map<string, string>();

  const workspaceAgent = buildAgentNode({
    jobId: input.jobId,
    kind: "software",
    id: "workspace-dev",
    label: "workspace-dev production runner",
  });
  upsertNode(nodes, workspaceAgent);

  const ensureModelAgent = (deployment: string): string => {
    const existing = modelAgents.get(deployment);
    if (existing) return existing;
    const node = buildAgentNode({
      jobId: input.jobId,
      kind: "model",
      id: `model-${deployment}`,
      label: deployment,
      deployment,
    });
    const nodeId = node["@id"] as string;
    modelAgents.set(deployment, nodeId);
    upsertNode(nodes, node);
    return nodeId;
  };

  ensureModelAgent(input.initialGenerationDeployment);
  ensureModelAgent(input.logicJudge.verdict.modelDeployment);
  if (input.faithfulnessJudge !== undefined) {
    ensureModelAgent(input.faithfulnessJudge.verdict.modelDeployment);
  }
  if (input.a11yJudge !== undefined) {
    ensureModelAgent(input.a11yJudge.verdict.modelDeployment);
  }

  const requiredArtifactDigests = await Promise.all([
    readArtifactDigest(input.runDir, "business-intent-ir.json"),
    readArtifactDigest(input.runDir, "compiled-prompt.json"),
    readArtifactDigest(input.runDir, "coverage-plan.json"),
    readArtifactDigest(input.runDir, "workflow-topology.json"),
    readArtifactDigest(input.runDir, "risk-ranking.json"),
    readArtifactDigest(input.runDir, "generated-testcases.json"),
    readArtifactDigest(input.runDir, input.logicJudge.artifactFilename),
    readArtifactDigest(input.runDir, input.judgeConsensus.artifactFilename),
  ]);

  const [
    businessIntentDigest,
    compiledPromptDigest,
    coveragePlanDigest,
    workflowTopologyDigest,
    riskRankingDigest,
    generatedTestCasesDigest,
    logicJudgeDigest,
    judgeConsensusDigest,
  ] = requiredArtifactDigests;

  const sourcePreparationActivity = activityId(
    input.jobId,
    "source_preparation",
  );
  upsertNode(
    nodes,
    buildActivityNode({
      jobId: input.jobId,
      id: "source_preparation",
      label: "Source preparation",
      role: "source_preparation",
      associatedWith: [workspaceAgent["@id"] as string],
      generatedAt: input.generatedAt,
    }),
  );

  const businessIntentEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: businessIntentDigest,
    label: "Business Test Intent IR",
    generatedBy: sourcePreparationActivity,
  });
  const workflowTopologyEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: workflowTopologyDigest,
    label: "Workflow topology",
    generatedBy: sourcePreparationActivity,
  });
  const coveragePlanEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: coveragePlanDigest,
    label: "Coverage plan",
    generatedBy: sourcePreparationActivity,
  });
  const riskRankingEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: riskRankingDigest,
    label: "Risk ranking",
    generatedBy: sourcePreparationActivity,
  });
  upsertNode(nodes, businessIntentEntity);
  upsertNode(nodes, workflowTopologyEntity);
  upsertNode(nodes, coveragePlanEntity);
  upsertNode(nodes, riskRankingEntity);

  const compiledPromptEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: compiledPromptDigest,
    label: "Compiled generator prompt",
    derivedFrom: [
      businessIntentEntity["@id"] as string,
      workflowTopologyEntity["@id"] as string,
      coveragePlanEntity["@id"] as string,
      riskRankingEntity["@id"] as string,
    ],
  });
  upsertNode(nodes, compiledPromptEntity);

  const initialGenerationActivity = activityId(input.jobId, "test_generation");
  upsertNode(
    nodes,
    buildActivityNode({
      jobId: input.jobId,
      id: "test_generation",
      label: "Initial test generation",
      role: "generator",
      associatedWith: [
        workspaceAgent["@id"] as string,
        ensureModelAgent(input.initialGenerationDeployment),
      ],
      used: [compiledPromptEntity["@id"] as string],
      informedBy: [sourcePreparationActivity],
      generatedAt: input.generatedAt,
    }),
  );

  let previousListId = listEntityId(input.jobId, "initial");
  upsertNode(nodes, {
    "@id": previousListId,
    "@type": "prov:Entity",
    label: "Initial generated case list",
    "ti:listHash": generatedTestCasesDigest.sha256,
    "prov:wasGeneratedBy": toIriRef(initialGenerationActivity),
  });
  let previousGenerationActivityId = initialGenerationActivity;

  if (input.adversarialCriticRounds !== undefined) {
    for (const round of input.adversarialCriticRounds) {
      const criticDigest = await readArtifactDigest(
        input.runDir,
        round.artifactFilename,
      );
      const criticArtifactEntity = buildArtifactNode({
        jobId: input.jobId,
        digest: criticDigest,
        label: `Adversarial critic round ${round.round} artifact`,
      });
      upsertNode(nodes, criticArtifactEntity);
      const criticActivityId = activityId(
        input.jobId,
        `adversarial_critic_round_${round.round}`,
      );
      upsertNode(
        nodes,
        buildActivityNode({
          jobId: input.jobId,
          id: `adversarial_critic_round_${round.round}`,
          label: `Adversarial critic round ${round.round}`,
          role: "adversarial_critic",
          associatedWith: [
            workspaceAgent["@id"] as string,
            ensureModelAgent(input.logicJudge.verdict.modelDeployment),
          ],
          used: [
            previousListId,
            compiledPromptEntity["@id"] as string,
            coveragePlanEntity["@id"] as string,
            riskRankingEntity["@id"] as string,
          ],
          informedBy: [initialGenerationActivity],
          generatedAt: input.generatedAt,
          extra: {
            "ti:iteration": round.round,
            "ti:domain": round.domain,
            "ti:findingCount": round.findings.length,
          },
        }),
      );
      const findingsEntityId = makeNodeId(
        input.jobId,
        "entity",
        sanitizeIriToken(`adversarial-critic-findings-${round.round}`),
      );
      upsertNode(nodes, {
        "@id": findingsEntityId,
        "@type": "prov:Entity",
        label: `Adversarial critic findings round ${round.round}`,
        "ti:findingCount": round.findings.length,
        "ti:categories": round.findings.map((finding) => finding.category).sort(),
        "prov:wasGeneratedBy": toIriRef(criticActivityId),
        "prov:hadPrimarySource": toIriRef(
          criticArtifactEntity["@id"] as string,
        ),
        "prov:wasDerivedFrom": [
          toIriRef(previousListId),
          toIriRef(coveragePlanEntity["@id"] as string),
          toIriRef(riskRankingEntity["@id"] as string),
        ],
      });
      if (round.regeneratedListHash !== undefined) {
        const adversarialGenerationActivityId = activityId(
          input.jobId,
          `test_generation_adversarial_round_${round.round}`,
        );
        upsertNode(
          nodes,
          buildActivityNode({
            jobId: input.jobId,
            id: `test_generation_adversarial_round_${round.round}`,
            label: `Adversarial repair generation round ${round.round}`,
            role: "generator",
            associatedWith: [
              workspaceAgent["@id"] as string,
              ensureModelAgent(input.initialGenerationDeployment),
            ],
            used: [
              compiledPromptEntity["@id"] as string,
              previousListId,
              findingsEntityId,
            ],
            informedBy: [criticActivityId],
            generatedAt: input.generatedAt,
            extra: {
              "ti:iteration": round.round,
              ...(round.generatedCaseCount !== undefined
                ? { "ti:generatedCaseCount": round.generatedCaseCount }
                : {}),
            },
          }),
        );
        const nextListId = listEntityId(input.jobId, `adversarial-${round.round}`);
        upsertNode(nodes, {
          "@id": nextListId,
          "@type": "prov:Entity",
          label: `Generated case list after adversarial critic round ${round.round}`,
          "ti:listHash": round.regeneratedListHash,
          "prov:wasGeneratedBy": toIriRef(adversarialGenerationActivityId),
          "prov:wasRevisionOf": toIriRef(previousListId),
        });
        previousListId = nextListId;
        previousGenerationActivityId = adversarialGenerationActivityId;
      }
    }
  }

  if (input.repairIterations !== undefined) {
    for (const iteration of input.repairIterations) {
      const plannerActivityId = activityId(
        input.jobId,
        `repair_planner_iter_${iteration.iteration}`,
      );
      upsertNode(
        nodes,
        buildActivityNode({
          jobId: input.jobId,
          id: `repair_planner_iter_${iteration.iteration}`,
          label: `Repair planner iteration ${iteration.iteration}`,
          role: "repair_planner",
          associatedWith: [workspaceAgent["@id"] as string],
          used: [previousListId],
          generatedAt: input.generatedAt,
          extra: {
            "ti:iteration": iteration.iteration,
            "ti:generatedCaseCount": iteration.generatedCaseCount,
          },
        }),
      );
      const repairActivityId = activityId(
        input.jobId,
        `test_generation_repair_iter_${iteration.iteration}`,
      );
      upsertNode(
        nodes,
        buildActivityNode({
          jobId: input.jobId,
          id: `test_generation_repair_iter_${iteration.iteration}`,
          label: `Repair generation iteration ${iteration.iteration}`,
          role: "test_generation_repair",
          associatedWith: [
            workspaceAgent["@id"] as string,
            ensureModelAgent(input.initialGenerationDeployment),
          ],
          used: [compiledPromptEntity["@id"] as string, previousListId],
          informedBy: [plannerActivityId, previousGenerationActivityId],
          generatedAt: input.generatedAt,
          extra: {
            "ti:iteration": iteration.iteration,
            "ti:verdictSignature": iteration.verdictSignature,
          },
        }),
      );
      const nextListId = listEntityId(
        input.jobId,
        `repair-${iteration.iteration}`,
      );
      upsertNode(nodes, {
        "@id": nextListId,
        "@type": "prov:Entity",
        label: `Generated case list after repair iteration ${iteration.iteration}`,
        "ti:listHash": iteration.outputHash,
        "prov:wasGeneratedBy": toIriRef(repairActivityId),
        "prov:wasRevisionOf": toIriRef(previousListId),
      });
      previousListId = nextListId;
      previousGenerationActivityId = repairActivityId;
    }
  }

  const finalGenerationActivity = previousGenerationActivityId;
  const finalGeneratedArtifactEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: generatedTestCasesDigest,
    label: "Generated test cases artifact",
    generatedBy: finalGenerationActivity,
    derivedFrom: [previousListId],
  });
  upsertNode(nodes, finalGeneratedArtifactEntity);
  const finalListNode = nodes.get(previousListId);
  if (finalListNode !== undefined) {
    upsertNode(nodes, {
      ...finalListNode,
      "prov:hadPrimarySource": toIriRef(
        finalGeneratedArtifactEntity["@id"] as string,
      ),
    });
  }

  for (const testCase of input.finalGeneratedTestCases.testCases) {
    upsertNode(nodes, {
      "@id": caseEntityId(input.jobId, testCase.id),
      "@type": "prov:Entity",
      label: testCase.title,
      "ti:testCaseId": testCase.id,
      "ti:riskCategory": testCase.riskCategory,
      "ti:technique": testCase.technique,
      "ti:promptHash": testCase.audit.promptHash,
      "ti:schemaHash": testCase.audit.schemaHash,
      "ti:inputHash": testCase.audit.inputHash,
      "prov:wasGeneratedBy": toIriRef(finalGenerationActivity),
      "prov:hadPrimarySource": toIriRef(previousListId),
    });
  }

  const logicJudgeEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: logicJudgeDigest,
    label: "Logic judge verdict artifact",
  });
  upsertNode(nodes, logicJudgeEntity);
  const logicJudgeActivity = activityId(input.jobId, "logic_judge");
  upsertNode(
    nodes,
    buildActivityNode({
      jobId: input.jobId,
      id: "logic_judge",
      label: "Logic judge evaluation",
      role: "logic_judge",
      associatedWith: [
        workspaceAgent["@id"] as string,
        ensureModelAgent(input.logicJudge.verdict.modelDeployment),
      ],
      used: [previousListId],
      informedBy: [finalGenerationActivity],
      generatedAt: input.generatedAt,
    }),
  );

  const createVerdictEntities = (inputVerdict: {
    readonly judgeRole: string;
    readonly activityNodeId: string;
    readonly artifactNodeId: string;
    readonly attributedAgentId: string;
    readonly testCaseIds: readonly string[];
    readonly extra?: Record<string, JsonValue>;
  }): void => {
    for (const testCaseId of inputVerdict.testCaseIds) {
      upsertNode(nodes, {
        "@id": verdictEntityId(input.jobId, inputVerdict.judgeRole, testCaseId),
        "@type": "prov:Entity",
        label: `${inputVerdict.judgeRole} verdict for ${testCaseId}`,
        "ti:judgeRole": inputVerdict.judgeRole,
        "ti:testCaseId": testCaseId,
        "prov:wasGeneratedBy": toIriRef(inputVerdict.activityNodeId),
        "prov:wasAttributedTo": toIriRef(inputVerdict.attributedAgentId),
        "prov:wasDerivedFrom": [
          toIriRef(caseEntityId(input.jobId, testCaseId)),
          toIriRef(inputVerdict.artifactNodeId),
        ],
        ...(inputVerdict.extra ?? {}),
      });
    }
  };

  createVerdictEntities({
    judgeRole: "logic_judge",
    activityNodeId: logicJudgeActivity,
    artifactNodeId: logicJudgeEntity["@id"] as string,
    attributedAgentId: ensureModelAgent(
      input.logicJudge.verdict.modelDeployment,
    ),
    testCaseIds: input.finalGeneratedTestCases.testCases.map(
      (testCase) => testCase.id,
    ),
    extra: {
      "ti:verdict": input.logicJudge.verdict.verdict,
    },
  });

  if (input.faithfulnessJudge !== undefined) {
    const faithfulnessDigest = await readArtifactDigest(
      input.runDir,
      input.faithfulnessJudge.artifactFilename,
    );
    const faithfulnessEntity = buildArtifactNode({
      jobId: input.jobId,
      digest: faithfulnessDigest,
      label: "Faithfulness judge verdict artifact",
    });
    upsertNode(nodes, faithfulnessEntity);
    const faithfulnessActivity = activityId(input.jobId, "faithfulness_judge");
    upsertNode(
      nodes,
      buildActivityNode({
        jobId: input.jobId,
        id: "faithfulness_judge",
        label: "Faithfulness judge evaluation",
        role: "faithfulness_judge",
        associatedWith: [
          workspaceAgent["@id"] as string,
          ensureModelAgent(input.faithfulnessJudge.verdict.modelDeployment),
        ],
        used: [previousListId],
        informedBy: [logicJudgeActivity],
        generatedAt: input.generatedAt,
      }),
    );
    createVerdictEntities({
      judgeRole: "faithfulness_judge",
      activityNodeId: faithfulnessActivity,
      artifactNodeId: faithfulnessEntity["@id"] as string,
      attributedAgentId: ensureModelAgent(
        input.faithfulnessJudge.verdict.modelDeployment,
      ),
      testCaseIds: input.finalGeneratedTestCases.testCases.map(
        (testCase) => testCase.id,
      ),
      extra: {
        "ti:verdict": input.faithfulnessJudge.verdict.verdict,
      },
    });
  }

  if (input.a11yJudge !== undefined) {
    const a11yDigest = await readArtifactDigest(
      input.runDir,
      input.a11yJudge.artifactFilename,
    );
    const a11yEntity = buildArtifactNode({
      jobId: input.jobId,
      digest: a11yDigest,
      label: "Accessibility judge verdict artifact",
    });
    upsertNode(nodes, a11yEntity);
    const a11yActivity = activityId(input.jobId, "a11y_judge");
    upsertNode(
      nodes,
      buildActivityNode({
        jobId: input.jobId,
        id: "a11y_judge",
        label: "Accessibility judge evaluation",
        role: "a11y_judge",
        associatedWith: [
          workspaceAgent["@id"] as string,
          ensureModelAgent(input.a11yJudge.verdict.modelDeployment),
        ],
        used: [previousListId],
        informedBy: [logicJudgeActivity],
        generatedAt: input.generatedAt,
      }),
    );
    createVerdictEntities({
      judgeRole: "a11y_judge",
      activityNodeId: a11yActivity,
      artifactNodeId: a11yEntity["@id"] as string,
      attributedAgentId: ensureModelAgent(
        input.a11yJudge.verdict.modelDeployment,
      ),
      testCaseIds: input.finalGeneratedTestCases.testCases.map(
        (testCase) => testCase.id,
      ),
      extra: {
        "ti:verdict": input.a11yJudge.verdict.verdict,
      },
    });
  }

  const consensusEntity = buildArtifactNode({
    jobId: input.jobId,
    digest: judgeConsensusDigest,
    label: "Judge consensus artifact",
  });
  upsertNode(nodes, consensusEntity);
  const consensusActivity = activityId(input.jobId, "judge_consensus");
  upsertNode(
    nodes,
    buildActivityNode({
      jobId: input.jobId,
      id: "judge_consensus",
      label: "Judge consensus",
      role: "judge_consensus",
      associatedWith: [workspaceAgent["@id"] as string],
      used: [logicJudgeEntity["@id"] as string],
      informedBy: [logicJudgeActivity],
      generatedAt: input.generatedAt,
      extra: {
        "ti:repairState": input.judgeConsensus.verdict.repairState,
        "ti:verdict": input.judgeConsensus.verdict.verdict,
      },
    }),
  );
  createVerdictEntities({
    judgeRole: "judge_consensus",
    activityNodeId: consensusActivity,
    artifactNodeId: consensusEntity["@id"] as string,
    attributedAgentId: workspaceAgent["@id"] as string,
    testCaseIds: input.finalGeneratedTestCases.testCases.map(
      (testCase) => testCase.id,
    ),
    extra: {
      "ti:verdict": input.judgeConsensus.verdict.verdict,
    },
  });

  const sortedNodes = [...nodes.values()].sort((left, right) =>
    readNodeId(left).localeCompare(readNodeId(right)),
  );
  const merkleSeal = computeProvenanceMerkleSeal(sortedNodes);
  const nodesWithLeafHashes = sortedNodes.map((node) => ({
    ...node,
    "ti:leafHash": sha256Hex(
      canonicalJson(
        Object.fromEntries(
          Object.entries(node).filter(([key]) => key !== "ti:leafHash"),
        ),
      ),
    ),
  }));

  return {
    "@context": [PROV_JSONLD_CONTEXT_URL, PROVENANCE_CONTEXT],
    "@id": makeNodeId(input.jobId, "bundle", "provenance"),
    "@type": "prov:Bundle",
    "ti:schemaVersion": PROVENANCE_SCHEMA_VERSION,
    "ti:jobId": input.jobId,
    "ti:generatedAt": input.generatedAt,
    "ti:sourceKind": input.sourceKind,
    "ti:merkleSeal": merkleSeal,
    "@graph": nodesWithLeafHashes,
  };
};

export const serializeProvenanceGraph = (
  document: ProvenanceDocument,
): string => canonicalJson(document);

export const writeProvenanceGraph = async (input: {
  readonly runDir: string;
  readonly document: ProvenanceDocument;
}): Promise<WriteProvenanceGraphResult> => {
  const artifactPath = join(input.runDir, PROVENANCE_ARTIFACT_FILENAME);
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${serializeProvenanceGraph(input.document)}\n`;
  const bytes = toUtf8Bytes(serialized);
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return {
    artifactPath,
    document: input.document,
    bytes,
  };
};
