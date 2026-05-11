/**
 * Provider training-data statements for the EU AI Act Art. 13 model card
 * (Issue #2112). Each entry is the textual evidence the LLM provider
 * publishes about how the model was trained, transcribed at the date
 * stamped on the entry.
 *
 * `fidelity: "transcribed-verbatim"` records that the statement quotes
 * the provider's published copy without paraphrase. `paraphrased` is
 * used when the only public source is structured prose without a
 * quotable summary, in which case the entry surfaces the structural
 * facts (training date cut-off, deployment region, retention policy)
 * rather than fabricating a verbatim string. `unavailable` records
 * gaps so auditors can see where the lineage is partial rather than
 * being misled into thinking the provider published more than it did.
 *
 * The transcription dates are intentionally pinned: the model card
 * regenerator does not re-fetch live URLs at build time. Re-transcription
 * is a manual operator step driven by the post-market monitoring
 * runbook.
 */

import type { ModelCardProviderStatement } from "./model-card.js";

export const PROVIDER_TRAINING_DATA_STATEMENTS: ReadonlyArray<ModelCardProviderStatement> =
  Object.freeze([
    Object.freeze({
      providerId: "azure-ai-foundry",
      fidelity: "paraphrased",
      sourceUrl:
        "https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/transparency-note",
      transcribedOn: "2026-05-09",
      statement: Object.freeze([
        "Azure AI Foundry hosts third-party foundation models on Microsoft's Azure infrastructure. The training data and methodology are owned by the model provider (OpenAI, Mistral, Microsoft Research, Meta, etc.); Azure AI Foundry does not retrain or fine-tune the bound deployments and does not use customer data sent to the inference endpoint to train any model.",
        "Customer prompts and completions sent to Azure AI Foundry deployments are processed under the Microsoft Products and Services Data Protection Addendum and the Azure OpenAI / AI Foundry data-handling commitments: data is not used to train Azure-hosted models, is not shared with the model provider, and is retained only for abuse-monitoring purposes (with optional opt-out for eligible customers).",
        "workspace-dev consumes Azure AI Foundry deployments read-only via the configured EU region tenant. The exact training-data lineage of each underlying model is documented by the model provider; see the per-provider entries below for the upstream statements.",
      ]),
      appliesToDeployments: Object.freeze([
        "mistral-large-3",
        "gpt-oss-120b",
        "phi-4-mini-instruct",
        "phi-4",
        "phi-4-multimodal-instruct",
        "llama-4-maverick-vision",
        "mistral-document-ai-2512",
      ]),
    }),
    Object.freeze({
      providerId: "mistral",
      fidelity: "paraphrased",
      sourceUrl: "https://mistral.ai/news/",
      transcribedOn: "2026-05-09",
      statement: Object.freeze([
        "Mistral models (mistral-large-3 and mistral-document-ai-2512 in this deployment) are trained on a curated corpus that combines licensed text, publicly available web data filtered for licensing and quality, and synthetic data generated under Mistral's own training pipeline. Mistral publishes the training cut-off and supported languages with each model release; see the model-specific release notes on the Mistral news page for the exact cut-off applicable to the bound version.",
        "Mistral does not use prompts sent to its API (or to enterprise resellers such as Azure AI Foundry) to train its foundation models without explicit customer opt-in. The deployment in workspace-dev does not opt into training-data contributions.",
      ]),
      appliesToDeployments: Object.freeze([
        "mistral-large-3",
        "mistral-document-ai-2512",
      ]),
    }),
    Object.freeze({
      providerId: "openai",
      fidelity: "paraphrased",
      sourceUrl: "https://openai.com/policies/usage-policies/",
      transcribedOn: "2026-05-09",
      statement: Object.freeze([
        "OpenAI's gpt-oss-120b deployment is sourced from OpenAI's public model release. OpenAI publishes the training-data cut-off and high-level lineage (mixture of licensed corpora, publicly available internet text, and human-generated content) on the model release page.",
        "When the model is consumed via Azure AI Foundry the data-handling terms inherit the Azure data-protection addendum: prompts and completions are not used to train OpenAI's foundation models and are not shared back to OpenAI.",
      ]),
      appliesToDeployments: Object.freeze(["gpt-oss-120b"]),
    }),
    Object.freeze({
      providerId: "microsoft-research",
      fidelity: "paraphrased",
      sourceUrl: "https://aka.ms/phi4",
      transcribedOn: "2026-05-09",
      statement: Object.freeze([
        "Microsoft Research's Phi family (phi-4, phi-4-mini-instruct, phi-4-multimodal-instruct in this deployment) is trained on a curriculum of licensed textbook-style data, code, and synthetic instruction-tuning corpora. The Phi technical report documents the data-mixture composition, the deduplication pipeline, and the bias / safety evaluations applied at training time.",
        "Phi deployments hosted on Azure AI Foundry do not train on customer prompts or completions; they are consumed read-only.",
      ]),
      appliesToDeployments: Object.freeze([
        "phi-4",
        "phi-4-mini-instruct",
        "phi-4-multimodal-instruct",
      ]),
    }),
    Object.freeze({
      providerId: "meta",
      fidelity: "paraphrased",
      sourceUrl: "https://llama.meta.com/llama-downloads/",
      transcribedOn: "2026-05-09",
      statement: Object.freeze([
        "Meta's Llama-4-Maverick vision deployment is sourced from Meta's public Llama 4 release. Meta publishes the training-data lineage in the Llama 4 model card: a mixture of publicly available text and image data, licensed corpora, and synthetic alignment data. The model card lists the supported input/output modalities, the languages exercised at training time, and the safety-tuning regime applied.",
        "When the model is hosted on Azure AI Foundry the inference traffic does not flow back to Meta. workspace-dev consumes the deployment read-only.",
      ]),
      appliesToDeployments: Object.freeze(["llama-4-maverick-vision"]),
    }),
  ]);
