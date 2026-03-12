import { createHash } from "node:crypto";

const BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;

const toSlug = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-");
};

export const resolveBoardKey = (figmaFileKey: string): string => {
  const trimmed = figmaFileKey.trim();
  if (!trimmed) {
    throw new Error("Cannot resolve board key: figmaFileKey is empty");
  }

  const hash = createHash("sha1").update(trimmed).digest("hex").slice(0, 10);
  const slug = toSlug(trimmed).slice(0, 64);
  const candidate = `${slug || "board"}-${hash}`;
  if (!BOARD_KEY_PATTERN.test(candidate)) {
    throw new Error("Resolved board key is invalid");
  }
  return candidate;
};

export const toSyncBranchName = (boardKey: string): string => {
  const normalized = boardKey.trim().toLowerCase();
  if (!BOARD_KEY_PATTERN.test(normalized)) {
    throw new Error(`Invalid board key '${boardKey}'`);
  }
  return `auto/figma-sync/${normalized}`;
};

export const isValidBoardKey = (value: string): boolean => {
  return BOARD_KEY_PATTERN.test(value);
};
