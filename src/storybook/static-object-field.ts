import {
  createEvaluationState,
  createJsEvaluationEnvironment,
  evaluateJsExpression,
  type JsStaticValue
} from "./js-subset-evaluator.js";
import { findObjectLiteralValuesByFieldName } from "./text.js";

export type StaticJsonValue =
  | boolean
  | number
  | string
  | null
  | StaticJsonValue[]
  | { [key: string]: StaticJsonValue };

const isStaticJsonRecord = (value: StaticJsonValue | undefined): value is Record<string, StaticJsonValue> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStaticJsonValue = (value: JsStaticValue): StaticJsonValue | undefined => {
  switch (value.kind) {
    case "unknown":
    case "undefined":
    case "function":
      return undefined;
    case "null":
      return null;
    case "boolean":
    case "number":
    case "string":
      return value.value;
    case "array":
      return value.values
        .map((entryValue) => toStaticJsonValue(entryValue))
        .filter((entryValue): entryValue is StaticJsonValue => entryValue !== undefined);
    case "object": {
      const record: Record<string, StaticJsonValue> = {};
      const entries = [...value.properties.entries()].sort(([left], [right]) => left.localeCompare(right));
      for (const [key, propertyValue] of entries) {
        const normalized = toStaticJsonValue(propertyValue);
        if (normalized !== undefined) {
          record[key] = normalized;
        }
      }
      return record;
    }
  }
};

export const extractStaticObjectField = ({
  bundleText,
  fieldName
}: {
  bundleText: string;
  fieldName: string;
}): Record<string, StaticJsonValue> | undefined => {
  const env = createJsEvaluationEnvironment(bundleText);
  const normalizedObjects = findObjectLiteralValuesByFieldName({
    source: bundleText,
    fieldName
  })
    .map((objectLiteral) =>
      toStaticJsonValue(
        evaluateJsExpression({
          source: objectLiteral,
          env,
          state: createEvaluationState()
        })
      )
    )
    .filter(isStaticJsonRecord);

  if (normalizedObjects.length === 0) {
    return undefined;
  }

  if (normalizedObjects.length === 1) {
    return normalizedObjects[0];
  }

  const occurrenceCount = new Map<string, number>();
  const serializedByKey = new Map<string, string>();
  const valueByKey = new Map<string, StaticJsonValue>();
  const inconsistentKeys = new Set<string>();

  for (const objectValue of normalizedObjects) {
    for (const [key, propertyValue] of Object.entries(objectValue)) {
      occurrenceCount.set(key, (occurrenceCount.get(key) ?? 0) + 1);
      const serialized = JSON.stringify(propertyValue);
      const existingSerialized = serializedByKey.get(key);
      if (existingSerialized === undefined) {
        serializedByKey.set(key, serialized);
        valueByKey.set(key, propertyValue);
        continue;
      }
      if (existingSerialized !== serialized) {
        inconsistentKeys.add(key);
      }
    }
  }

  const commonRecord: Record<string, StaticJsonValue> = {};
  for (const key of [...occurrenceCount.keys()].sort((left, right) => left.localeCompare(right))) {
    if (occurrenceCount.get(key) !== normalizedObjects.length || inconsistentKeys.has(key)) {
      continue;
    }

    const propertyValue = valueByKey.get(key);
    if (propertyValue !== undefined) {
      commonRecord[key] = propertyValue;
    }
  }

  return Object.keys(commonRecord).length > 0 ? commonRecord : undefined;
};
