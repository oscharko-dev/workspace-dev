import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_TENANT_SCOPE } from "../contracts/index.js";
import {
  AIR_GAP_MODE_ENV,
  AirGapResourceLocationError,
} from "./air-gap-guard.js";
import { createPersistentReplayCache } from "./replay-cache-persistent.js";

const withAirGapEnv = async <T,>(value: string, fn: () => Promise<T>): Promise<T> => {
  const prior = process.env[AIR_GAP_MODE_ENV];
  process.env[AIR_GAP_MODE_ENV] = value;
  try {
    return await fn();
  } finally {
    if (prior === undefined) {
      delete process.env[AIR_GAP_MODE_ENV];
    } else {
      process.env[AIR_GAP_MODE_ENV] = prior;
    }
  }
};

test("persistent replay cache accepts local filesystem roots under air-gap mode", async () => {
  await withAirGapEnv("1", async () => {
    const root = await mkdtemp(join(tmpdir(), "sovereign-cache-"));
    try {
      const cache = createPersistentReplayCache(root, {
        tenantScope: DEFAULT_TENANT_SCOPE,
      });
      assert.equal(cache.kind, "filesystem");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("persistent replay cache refuses remote schemes under air-gap mode", async () => {
  await withAirGapEnv("1", async () => {
    for (const remote of [
      "s3://my-bucket/cache",
      "https://cache.example.com/",
      "gs://workspace-dev/cache",
    ]) {
      assert.throws(
        () =>
          createPersistentReplayCache(remote, {
            tenantScope: DEFAULT_TENANT_SCOPE,
          }),
        AirGapResourceLocationError,
        `expected reject for ${remote}`,
      );
    }
  });
});

test("persistent replay cache stays permissive when air-gap mode is off", async () => {
  // Outside air-gap mode the guard is a no-op even though we wouldn't
  // sensibly point the cache at an s3:// URL; this asserts the call
  // doesn't gain a spurious validation regression.
  const prior = process.env[AIR_GAP_MODE_ENV];
  delete process.env[AIR_GAP_MODE_ENV];
  try {
    const root = await mkdtemp(join(tmpdir(), "sovereign-cache-off-"));
    try {
      const cache = createPersistentReplayCache(root, {
        tenantScope: DEFAULT_TENANT_SCOPE,
      });
      assert.equal(cache.kind, "filesystem");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    if (prior !== undefined) {
      process.env[AIR_GAP_MODE_ENV] = prior;
    }
  }
});
