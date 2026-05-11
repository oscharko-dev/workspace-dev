import type {
  CustomContextPolicySignal,
  CustomContextStructuredEntry,
} from "../contracts/index.js";

export const deriveCustomContextPolicySignals = (input: {
  sourceId: string;
  structuredEntries: readonly CustomContextStructuredEntry[];
}): CustomContextPolicySignal[] => {
  const signals: CustomContextPolicySignal[] = [];
  for (const entry of input.structuredEntries) {
    for (const attribute of entry.attributes) {
      const signal = signalFromAttribute({
        sourceId: input.sourceId,
        entryId: entry.entryId,
        contentHash: entry.contentHash,
        key: attribute.key,
        value: attribute.value,
      });
      if (signal !== null) signals.push(signal);
    }
  }
  return signals.sort((a, b) =>
    a.attributeKey === b.attributeKey
      ? a.attributeValue.localeCompare(b.attributeValue)
      : a.attributeKey.localeCompare(b.attributeKey),
  );
};

const signalFromAttribute = (input: {
  sourceId: string;
  entryId: string;
  contentHash: string;
  key: string;
  value: string;
}): CustomContextPolicySignal | null => {
  const normalized = input.value.trim().toLowerCase();
  if (
    input.key === "data_class" &&
    /(?:pci|pci-dss|cardholder|pan|regulated|personal\s*data|pii)/iu.test(
      normalized,
    )
  ) {
    return {
      sourceId: input.sourceId,
      entryId: input.entryId,
      attributeKey: input.key,
      attributeValue: input.value,
      riskCategory: "regulated_data",
      reason: `custom context data_class "${input.value}" requires regulated-data review`,
      contentHash: input.contentHash,
    };
  }
  if (
    input.key === "regulatory_scope" &&
    /(?:psd2|gdpr|sox|pci|aml|kyc)/iu.test(normalized)
  ) {
    return {
      sourceId: input.sourceId,
      entryId: input.entryId,
      attributeKey: input.key,
      attributeValue: input.value,
      riskCategory: "regulated_data",
      reason: `custom context regulatory_scope "${input.value}" requires regulated-data review`,
      contentHash: input.contentHash,
    };
  }
  return null;
};
