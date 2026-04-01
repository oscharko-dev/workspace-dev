import { normalizeVariantKey, normalizeVariantValue } from "../parity/ir-variants.js";
import type { ResolvedStorybookTheme } from "./theme-resolver.js";
import type {
  ComponentMatchReportFigmaFamily,
  ComponentMatchReportResolvedImport,
  ComponentMatchResolvedApi,
  ComponentMatchResolvedApiAllowedProp,
  ComponentMatchResolvedContractDiagnostic,
  ComponentMatchResolvedDefaultProp,
  ComponentMatchResolvedPropKind,
  ComponentMatchResolvedProps,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookCatalogJsonValue,
  StorybookPublicComponent,
  StorybookPublicComponentsArtifact
} from "./types.js";

type PrimitiveValue = boolean | number | string;
type JsonRecord = Record<string, StorybookCatalogJsonValue>;
type FallbackPolicy = "allow" | "deny";
type ChildrenMode = "always" | "optional" | "never";

interface GeneratorSurface {
  semanticProps: readonly string[];
  childrenMode: ChildrenMode;
}

interface ResolveComponentApiContractInput {
  figmaFamily: ComponentMatchReportFigmaFamily;
  libraryResolution: {
    status: string;
    componentKey?: string;
    import?: ComponentMatchReportResolvedImport;
  };
  storybookFamily?: StorybookCatalogFamily;
  storyEntry?: StorybookCatalogEntry;
  componentsArtifact?: StorybookPublicComponentsArtifact;
  resolvedStorybookTheme?: ResolvedStorybookTheme;
  fallbackPolicy?: FallbackPolicy;
}

interface ObservedSourceProp {
  sourceProp: string;
  targetProp: string;
  kind: ComponentMatchResolvedPropKind;
  values: PrimitiveValue[];
}

const BOOLEAN_STRING_VALUES = new Map<string, boolean>([
  ["false", false],
  ["no", false],
  ["off", false],
  ["true", true],
  ["yes", true],
  ["on", true]
]);

const ENUM_PROP_NAMES = new Set<string>([
  "color",
  "fontSize",
  "orientation",
  "size",
  "variant"
]);

const BOOLEAN_PROP_NAMES = new Set<string>([
  "checked",
  "disabled",
  "error",
  "expanded",
  "fullWidth",
  "loading",
  "multiple",
  "open",
  "required",
  "selected"
]);

const COMPONENT_GENERATOR_SURFACES: Record<string, GeneratorSurface> = {
  Accordion: {
    semanticProps: ["expanded"],
    childrenMode: "always"
  },
  Button: {
    semanticProps: ["color", "disabled", "endIcon", "size", "startIcon", "variant"],
    childrenMode: "always"
  },
  DatePicker: {
    semanticProps: ["disabled", "label", "slotProps"],
    childrenMode: "never"
  },
  Icon: {
    semanticProps: ["color", "fontSize"],
    childrenMode: "never"
  },
  Select: {
    semanticProps: ["color", "disabled", "label", "orientation", "size", "variant"],
    childrenMode: "always"
  },
  TextField: {
    semanticProps: ["color", "disabled", "error", "helperText", "label", "placeholder", "size", "slotProps", "variant"],
    childrenMode: "never"
  },
  Typography: {
    semanticProps: ["color", "variant"],
    childrenMode: "always"
  }
};

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const comparePrimitiveValues = (left: PrimitiveValue, right: PrimitiveValue): number => {
  if (typeof left === typeof right) {
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    if (typeof left === "boolean" && typeof right === "boolean") {
      return Number(left) - Number(right);
    }
    return String(left).localeCompare(String(right));
  }
  return `${typeof left}:${String(left)}`.localeCompare(`${typeof right}:${String(right)}`);
};

const isPlainRecord = (value: StorybookCatalogJsonValue | undefined): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const sortUniquePrimitiveValues = (values: readonly PrimitiveValue[]): PrimitiveValue[] => {
  const byKey = new Map<string, PrimitiveValue>();
  for (const value of values) {
    byKey.set(`${typeof value}:${String(value)}`, value);
  }
  return [...byKey.values()].sort(comparePrimitiveValues);
};

const normalizePropName = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalizedVariantKey = normalizeVariantKey(trimmed);
  if (normalizedVariantKey && (BOOLEAN_PROP_NAMES.has(normalizedVariantKey) || ENUM_PROP_NAMES.has(normalizedVariantKey))) {
    return normalizedVariantKey;
  }
  const parts = trimmed
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  return `${parts[0]!.slice(0, 1).toLowerCase()}${parts[0]!.slice(1)}${parts
    .slice(1)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}`;
};

const normalizeEnumStringValue = (value: string): string => {
  return normalizeVariantValue(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
};

const toPrimitiveValue = ({
  value,
  kindHint
}: {
  value: StorybookCatalogJsonValue | undefined;
  kindHint?: ComponentMatchResolvedPropKind;
}): PrimitiveValue | undefined => {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const booleanValue = BOOLEAN_STRING_VALUES.get(trimmed.toLowerCase());
  if (kindHint === "boolean" && booleanValue !== undefined) {
    return booleanValue;
  }
  if (kindHint === "enum") {
    return normalizeEnumStringValue(trimmed);
  }
  return trimmed;
};

const inferPropKind = ({
  propName,
  values
}: {
  propName: string;
  values: readonly PrimitiveValue[];
}): ComponentMatchResolvedPropKind => {
  if (propName === "slotProps") {
    return "object";
  }
  if (BOOLEAN_PROP_NAMES.has(propName)) {
    return "boolean";
  }
  if (ENUM_PROP_NAMES.has(propName)) {
    return "enum";
  }
  if (values.length > 0) {
    if (values.every((value) => typeof value === "boolean")) {
      return "boolean";
    }
    if (values.every((value) => typeof value === "number")) {
      return "number";
    }
    if (values.every((value) => typeof value === "string")) {
      return values.length > 1 ? "enum" : "string";
    }
  }
  return "unknown";
};

const extractArgTypeOptions = ({
  value
}: {
  value: StorybookCatalogJsonValue | undefined;
}): PrimitiveValue[] => {
  if (!isPlainRecord(value) || !Array.isArray(value.options)) {
    return [];
  }
  return sortUniquePrimitiveValues(
    value.options
      .flatMap((entry): PrimitiveValue[] => {
        if (typeof entry === "boolean" || typeof entry === "number") {
          return [entry];
        }
        if (typeof entry === "string") {
          return [entry.trim()];
        }
        return [];
      })
      .filter((entry) => (typeof entry === "string" ? entry.length > 0 : true))
  );
};

const findPublicComponent = ({
  family,
  componentsArtifact
}: {
  family: StorybookCatalogFamily | undefined;
  componentsArtifact: StorybookPublicComponentsArtifact | undefined;
}): StorybookPublicComponent | undefined => {
  if (!family || !componentsArtifact) {
    return undefined;
  }
  return (
    componentsArtifact.components.find(
      (component) =>
        component.title === family.title &&
        component.name === family.name &&
        component.componentPath === family.componentPath
    ) ??
    componentsArtifact.components.find(
      (component) => component.title === family.title && component.name === family.name
    ) ??
    componentsArtifact.components.find(
      (component) => component.componentPath === family.componentPath && component.name === family.name
    )
  );
};

const toAllowedTargetPropNames = ({
  family,
  storyEntry,
  publicComponent,
  themeDefaultProps
}: {
  family: StorybookCatalogFamily | undefined;
  storyEntry: StorybookCatalogEntry | undefined;
  publicComponent: StorybookPublicComponent | undefined;
  themeDefaultProps: ComponentMatchResolvedDefaultProp[];
}): string[] => {
  const values = new Set<string>();
  const addName = (input: string | undefined): void => {
    const normalized = normalizePropName(input);
    if (normalized) {
      values.add(normalized);
    }
  };

  for (const propKey of publicComponent?.propKeys ?? family?.propKeys ?? []) {
    addName(propKey);
  }
  for (const argKey of Object.keys(storyEntry?.metadata.args ?? {})) {
    addName(argKey);
  }
  for (const argTypeKey of Object.keys(storyEntry?.metadata.argTypes ?? {})) {
    addName(argTypeKey);
  }
  for (const defaultProp of themeDefaultProps) {
    addName(defaultProp.name);
  }

  return [...values].sort(compareStrings);
};

const getThemeComponentAliases = ({ componentKey }: { componentKey: string }): string[] => {
  const aliases = new Set<string>([`Mui${componentKey}`]);
  if (componentKey === "Icon") {
    aliases.add("MuiIcon");
    aliases.add("MuiSvgIcon");
  }
  return [...aliases].sort(compareStrings);
};

const toStableThemeDefaultProps = ({
  resolvedStorybookTheme,
  componentKey
}: {
  resolvedStorybookTheme: ResolvedStorybookTheme | undefined;
  componentKey: string;
}): ComponentMatchResolvedDefaultProp[] => {
  if (!resolvedStorybookTheme) {
    return [];
  }
  const componentAliases = getThemeComponentAliases({ componentKey });
  const schemes = [resolvedStorybookTheme.light, ...(resolvedStorybookTheme.dark ? [resolvedStorybookTheme.dark] : [])];
  const componentDefaults = schemes
    .map((scheme) => {
      for (const alias of componentAliases) {
        const component = scheme.components[alias];
        if (component?.defaultProps) {
          return component.defaultProps;
        }
      }
      return undefined;
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined);

  if (componentDefaults.length === 0) {
    return [];
  }

  const first = componentDefaults[0];
  if (!first) {
    return [];
  }

  const stableDefaults = Object.entries(first)
    .filter(([, value]) => typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    .filter(([propName, value]) =>
      componentDefaults.every((candidate) => candidate[propName] === value)
    )
    .map(([name, value]) => ({
      name,
      value,
      source: "storybook_theme_defaultProps"
    } satisfies ComponentMatchResolvedDefaultProp))
    .sort((left, right) => left.name.localeCompare(right.name));

  return stableDefaults;
};

const addObservedValue = ({
  target,
  sourceProp,
  targetProp,
  kind,
  value
}: {
  target: Map<string, ObservedSourceProp>;
  sourceProp: string;
  targetProp: string;
  kind: ComponentMatchResolvedPropKind;
  value?: PrimitiveValue;
}): void => {
  const existing = target.get(sourceProp);
  if (!existing) {
    target.set(sourceProp, {
      sourceProp,
      targetProp,
      kind,
      values: value === undefined ? [] : [value]
    });
    return;
  }
  existing.kind = existing.kind === "unknown" ? kind : existing.kind;
  if (value !== undefined) {
    existing.values = sortUniquePrimitiveValues([...existing.values, value]);
  }
};

const toInversePropMappings = ({
  resolvedImport
}: {
  resolvedImport: ComponentMatchReportResolvedImport | undefined;
}): Map<string, string> => {
  const result = new Map<string, string>();
  for (const [sourceProp, rawTargetProp] of Object.entries(resolvedImport?.propMappings ?? {})) {
    const targetProp = normalizePropName(rawTargetProp);
    const normalizedSourceProp = normalizePropName(sourceProp);
    if (!targetProp || !normalizedSourceProp || result.has(targetProp)) {
      continue;
    }
    result.set(targetProp, normalizedSourceProp);
  }
  return result;
};

const buildAllowedPropMetadata = ({
  allowedTargetProps,
  observedSourceProps,
  inversePropMappings,
  storyArgs,
  storyArgTypes,
  themeDefaultProps
}: {
  allowedTargetProps: readonly string[];
  observedSourceProps: ReadonlyMap<string, ObservedSourceProp>;
  inversePropMappings: ReadonlyMap<string, string>;
  storyArgs: JsonRecord;
  storyArgTypes: JsonRecord;
  themeDefaultProps: readonly ComponentMatchResolvedDefaultProp[];
}): ComponentMatchResolvedApiAllowedProp[] => {
  const defaultsByName = new Map(themeDefaultProps.map((entry) => [entry.name, entry.value] as const));

  return allowedTargetProps
    .map((targetProp): ComponentMatchResolvedApiAllowedProp => {
      const sourceProp = inversePropMappings.get(targetProp) ?? targetProp;
      const observed = observedSourceProps.get(sourceProp);
      const argTypeOptions = extractArgTypeOptions({ value: storyArgTypes[targetProp] });
      const defaultValue = defaultsByName.get(targetProp);
      const storyArgValue =
        observed?.kind === "enum"
          ? toPrimitiveValue({ value: storyArgs[targetProp], kindHint: "enum" })
          : observed?.kind === "boolean"
            ? toPrimitiveValue({ value: storyArgs[targetProp], kindHint: "boolean" })
            : toPrimitiveValue({ value: storyArgs[targetProp] });
      const values = sortUniquePrimitiveValues([
        ...argTypeOptions,
        ...(storyArgValue !== undefined ? [storyArgValue] : []),
        ...(observed?.values ?? []),
        ...(typeof defaultValue === "boolean" || typeof defaultValue === "number" || typeof defaultValue === "string"
          ? [defaultValue]
          : [])
      ]);
      const kind = observed?.kind ?? inferPropKind({ propName: sourceProp, values });
      const allowedValues =
        kind === "boolean"
          ? [false, true]
          : kind === "enum" && values.length > 0
            ? values
            : undefined;

      return {
        name: targetProp,
        kind,
        ...(allowedValues ? { allowedValues } : {})
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

const toResolvedApiNotApplicable = (): ComponentMatchResolvedApi => ({
  status: "not_applicable",
  allowedProps: [],
  defaultProps: [],
  children: {
    policy: "unknown"
  },
  slots: {
    policy: "not_used",
    props: []
  },
  diagnostics: []
});

const toResolvedPropsNotApplicable = ({
  fallbackPolicy
}: {
  fallbackPolicy?: FallbackPolicy;
}): ComponentMatchResolvedProps => ({
  status: "not_applicable",
  ...(fallbackPolicy ? { fallbackPolicy } : {}),
  props: [],
  omittedProps: [],
  omittedDefaults: [],
  children: {
    policy: "unknown"
  },
  slots: {
    policy: "not_used",
    props: []
  },
  codegenCompatible: true,
  diagnostics: []
});

export const resolveComponentApiContract = ({
  figmaFamily,
  libraryResolution,
  storybookFamily,
  storyEntry,
  componentsArtifact,
  resolvedStorybookTheme,
  fallbackPolicy
}: ResolveComponentApiContractInput): {
  resolvedApi: ComponentMatchResolvedApi;
  resolvedProps: ComponentMatchResolvedProps;
} => {
  const componentKey = libraryResolution.componentKey?.trim();
  const resolvedImport = libraryResolution.import;
  if (libraryResolution.status !== "resolved_import" || !componentKey || !resolvedImport) {
    return {
      resolvedApi: toResolvedApiNotApplicable(),
      resolvedProps: toResolvedPropsNotApplicable(fallbackPolicy ? { fallbackPolicy } : {})
    };
  }

  const surface = COMPONENT_GENERATOR_SURFACES[componentKey] ?? {
    semanticProps: [] as const,
    childrenMode: "optional" as const
  };
  const publicComponent = findPublicComponent({
    family: storybookFamily,
    componentsArtifact
  });
  const themeDefaultProps = toStableThemeDefaultProps({
    resolvedStorybookTheme,
    componentKey
  });
  const allowedTargetProps = toAllowedTargetPropNames({
    family: storybookFamily,
    storyEntry,
    publicComponent,
    themeDefaultProps
  });
  const allowedTargetPropSet = new Set(allowedTargetProps);
  const defaultsByName = new Map(themeDefaultProps.map((entry) => [entry.name, entry] as const));
  const inversePropMappings = toInversePropMappings({
    resolvedImport
  });
  const observedSourceProps = new Map<string, ObservedSourceProp>();
  const figmaVariantPropNames = new Set<string>();

  for (const variantProperty of figmaFamily.variantProperties) {
    const sourceProp = normalizePropName(variantProperty.property);
    if (!sourceProp || sourceProp === "children") {
      continue;
    }
    figmaVariantPropNames.add(sourceProp);
    const targetProp = normalizePropName(resolvedImport.propMappings?.[sourceProp]) ?? sourceProp;
    const kind = inferPropKind({
      propName: sourceProp,
      values: variantProperty.values
        .map((value) => toPrimitiveValue({ value, kindHint: BOOLEAN_PROP_NAMES.has(sourceProp) ? "boolean" : "enum" }))
        .filter((value): value is PrimitiveValue => value !== undefined)
    });
    addObservedValue({
      target: observedSourceProps,
      sourceProp,
      targetProp,
      kind
    });
    for (const rawValue of variantProperty.values) {
      const normalizedValue = toPrimitiveValue({
        value: rawValue,
        kindHint: kind
      });
      addObservedValue({
        target: observedSourceProps,
        sourceProp,
        targetProp,
        kind,
        ...(normalizedValue !== undefined ? { value: normalizedValue } : {})
      });
    }
  }

  const relevantSourceProps = new Set<string>(surface.semanticProps);
  for (const sourceProp of figmaVariantPropNames) {
    relevantSourceProps.add(sourceProp);
  }

  const storyArgs = isPlainRecord(storyEntry?.metadata.args) ? storyEntry.metadata.args : {};
  const storyArgTypes = isPlainRecord(storyEntry?.metadata.argTypes) ? storyEntry.metadata.argTypes : {};
  for (const targetPropName of new Set([...Object.keys(storyArgs), ...Object.keys(storyArgTypes)])) {
    const targetProp = normalizePropName(targetPropName);
    if (!targetProp || targetProp === "children") {
      continue;
    }
    const sourceProp = inversePropMappings.get(targetProp) ?? targetProp;
    if (!relevantSourceProps.has(sourceProp) && targetProp !== "slotProps") {
      continue;
    }
    const kindHint =
      BOOLEAN_PROP_NAMES.has(sourceProp)
        ? "boolean"
        : ENUM_PROP_NAMES.has(sourceProp)
          ? "enum"
          : undefined;
    const primitiveValue = toPrimitiveValue({
      value: storyArgs[targetPropName],
      ...(kindHint ? { kindHint } : {})
    });
    const kind = inferPropKind({
      propName: sourceProp,
      values: primitiveValue === undefined ? [] : [primitiveValue]
    });
    addObservedValue({
      target: observedSourceProps,
      sourceProp,
      targetProp,
      kind,
      ...(primitiveValue !== undefined ? { value: primitiveValue } : {})
    });
  }

  const diagnostics: ComponentMatchResolvedContractDiagnostic[] = [];
  const props: ComponentMatchResolvedProps["props"] = [];
  const omittedProps: ComponentMatchResolvedProps["omittedProps"] = [];
  const omittedDefaults: ComponentMatchResolvedProps["omittedDefaults"] = [];
  let codegenCompatible = true;

  const childrenSupported = allowedTargetPropSet.has("children");
  const childrenPolicy =
    surface.childrenMode === "never"
      ? "not_used"
      : childrenSupported
        ? "supported"
        : surface.childrenMode === "always"
          ? "unsupported"
          : "unknown";
  if (childrenPolicy === "unsupported") {
    diagnostics.push({
      severity: fallbackPolicy === "allow" ? "warning" : "error",
      code: "component_api_children_unsupported",
      message: `Resolved component '${componentKey}' does not expose 'children', but the generator surface relies on it.`,
      targetProp: "children"
    });
    codegenCompatible = false;
  }

  const slotPropsSupported = allowedTargetPropSet.has("slotProps");
  const slotObserved = observedSourceProps.has("slotProps");
  const slotPolicy = slotObserved ? (slotPropsSupported ? "supported" : "unsupported") : "not_used";
  if (slotPolicy === "unsupported") {
    diagnostics.push({
      severity: fallbackPolicy === "allow" ? "warning" : "error",
      code: "component_api_slot_unsupported",
      message: `Resolved component '${componentKey}' does not expose 'slotProps', so the generator cannot preserve that contract safely.`,
      sourceProp: "slotProps",
      targetProp: "slotProps"
    });
    codegenCompatible = false;
  }

  for (const observed of [...observedSourceProps.values()].sort((left, right) => left.sourceProp.localeCompare(right.sourceProp))) {
    if (observed.sourceProp === "slotProps") {
      if (slotPolicy === "supported") {
        props.push({
          sourceProp: observed.sourceProp,
          targetProp: observed.targetProp,
          kind: "object"
        });
      }
      continue;
    }

    const defaultProp = defaultsByName.get(observed.targetProp);
    const values = sortUniquePrimitiveValues(observed.values);
    if (
      defaultProp !== undefined &&
      values.length > 0 &&
      values.every((value) => value === defaultProp.value)
    ) {
      omittedDefaults.push({
        sourceProp: observed.sourceProp,
        targetProp: observed.targetProp,
        value: defaultProp.value,
        source: defaultProp.source
      });
      continue;
    }
    if (!allowedTargetPropSet.has(observed.targetProp)) {
      diagnostics.push({
        severity: fallbackPolicy === "allow" ? "warning" : "error",
        code: "component_api_prop_unsupported",
        message:
          `Resolved component '${componentKey}' does not expose prop '${observed.targetProp}' ` +
          `(mapped from '${observed.sourceProp}').`,
        sourceProp: observed.sourceProp,
        targetProp: observed.targetProp
      });
      omittedProps.push({
        sourceProp: observed.sourceProp,
        targetProp: observed.targetProp
      });
      codegenCompatible = false;
      continue;
    }

    props.push({
      sourceProp: observed.sourceProp,
      targetProp: observed.targetProp,
      kind: observed.kind,
      ...(values.length > 0 ? { values } : {})
    });
  }

  const resolvedApi: ComponentMatchResolvedApi = {
    status: "resolved",
    componentKey,
    import: resolvedImport,
    allowedProps: buildAllowedPropMetadata({
      allowedTargetProps,
      observedSourceProps,
      inversePropMappings,
      storyArgs,
      storyArgTypes,
      themeDefaultProps
    }),
    defaultProps: themeDefaultProps,
    children: {
      policy: childrenPolicy
    },
    slots: {
      policy: slotPolicy,
      props: slotObserved ? ["slotProps"] : []
    },
    diagnostics
  };

  const resolvedProps: ComponentMatchResolvedProps = {
    status: codegenCompatible ? "resolved" : "incompatible",
    ...(fallbackPolicy ? { fallbackPolicy } : {}),
    props: props.sort((left, right) => left.sourceProp.localeCompare(right.sourceProp)),
    omittedProps: omittedProps.sort((left, right) => left.sourceProp.localeCompare(right.sourceProp)),
    omittedDefaults: omittedDefaults.sort((left, right) => left.sourceProp.localeCompare(right.sourceProp)),
    children: {
      policy: childrenPolicy
    },
    slots: {
      policy: slotPolicy,
      props: slotObserved ? ["slotProps"] : []
    },
    codegenCompatible,
    diagnostics
  };

  return {
    resolvedApi,
    resolvedProps
  };
};
