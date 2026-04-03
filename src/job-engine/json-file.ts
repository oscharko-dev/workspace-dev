import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

const INDENT = "  ";

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const applyJsonTransform = ({
  value,
  key
}: {
  value: unknown;
  key: string;
}): unknown => {
  if (
    value !== null &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return (value as { toJSON: (key: string) => unknown }).toJSON(key);
  }
  return value;
};

const writeChunk = async ({
  stream,
  chunk
}: {
  stream: ReturnType<typeof createWriteStream>;
  chunk: string;
}): Promise<void> => {
  if (chunk.length === 0) {
    return;
  }
  if (stream.write(chunk)) {
    return;
  }
  await once(stream, "drain");
};

const writeScalarValue = async ({
  stream,
  value
}: {
  stream: ReturnType<typeof createWriteStream>;
  value: unknown;
}): Promise<void> => {
  const serialized = JSON.stringify(value);
  await writeChunk({
    stream,
    chunk: serialized ?? "null"
  });
};

const writeJsonValue = async ({
  stream,
  value,
  depth,
  key
}: {
  stream: ReturnType<typeof createWriteStream>;
  value: unknown;
  depth: number;
  key: string;
}): Promise<void> => {
  const normalizedValue = applyJsonTransform({
    value,
    key
  });
  if (
    normalizedValue === null ||
    normalizedValue === undefined ||
    typeof normalizedValue === "string" ||
    typeof normalizedValue === "number" ||
    typeof normalizedValue === "boolean" ||
    typeof normalizedValue === "bigint"
  ) {
    await writeScalarValue({
      stream,
      value: normalizedValue
    });
    return;
  }

  if (Array.isArray(normalizedValue)) {
    if (normalizedValue.length === 0) {
      await writeChunk({
        stream,
        chunk: "[]"
      });
      return;
    }

    await writeChunk({
      stream,
      chunk: "[\n"
    });
    for (let index = 0; index < normalizedValue.length; index += 1) {
      await writeChunk({
        stream,
        chunk: `${INDENT.repeat(depth + 1)}`
      });
      await writeJsonValue({
        stream,
        value: normalizedValue[index],
        depth: depth + 1,
        key: String(index)
      });
      await writeChunk({
        stream,
        chunk: index < normalizedValue.length - 1 ? ",\n" : "\n"
      });
    }
    await writeChunk({
      stream,
      chunk: `${INDENT.repeat(depth)}]`
    });
    return;
  }

  if (!isObjectRecord(normalizedValue)) {
    await writeScalarValue({
      stream,
      value: normalizedValue
    });
    return;
  }

  const entries = Object.entries(normalizedValue).filter(([, entryValue]) => {
    const transformedEntry = applyJsonTransform({
      value: entryValue,
      key
    });
    return JSON.stringify(transformedEntry) !== undefined || Array.isArray(transformedEntry) || isObjectRecord(transformedEntry);
  });

  if (entries.length === 0) {
    await writeChunk({
      stream,
      chunk: "{}"
    });
    return;
  }

  await writeChunk({
    stream,
    chunk: "{\n"
  });
  for (let index = 0; index < entries.length; index += 1) {
    const [entryKey, entryValue] = entries[index] ?? ["", undefined];
    await writeChunk({
      stream,
      chunk: `${INDENT.repeat(depth + 1)}${JSON.stringify(entryKey)}: `
    });
    await writeJsonValue({
      stream,
      value: entryValue,
      depth: depth + 1,
      key: entryKey
    });
    await writeChunk({
      stream,
      chunk: index < entries.length - 1 ? ",\n" : "\n"
    });
  }
  await writeChunk({
    stream,
    chunk: `${INDENT.repeat(depth)}}`
  });
};

export const writePrettyJsonFile = async ({
  filePath,
  value
}: {
  filePath: string;
  value: unknown;
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath, { encoding: "utf8" });
    stream.once("error", reject);
    stream.once("finish", resolve);

    void (async () => {
      try {
        await writeJsonValue({
          stream,
          value,
          depth: 0,
          key: ""
        });
        await writeChunk({
          stream,
          chunk: "\n"
        });
        stream.end();
      } catch (error) {
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
};
