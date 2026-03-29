import type { WorkspaceLogFormat } from "./contracts/index.js";

export interface IsolatedChildStartConfig {
  host: string;
  workDir: string;
  logFormat?: WorkspaceLogFormat;
}

export interface IsolatedChildAwaitingConfigMessage {
  type: "awaiting_config";
  instanceId: string;
}

export interface IsolatedChildStartMessage {
  type: "start";
  config: IsolatedChildStartConfig;
}

export interface IsolatedChildReadyMessage {
  type: "ready";
  port: number;
  instanceId: string;
}

export interface IsolatedChildErrorMessage {
  type: "error";
  message: string;
}

export interface IsolatedChildShutdownMessage {
  type: "shutdown";
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isWorkspaceLogFormat = (value: unknown): value is WorkspaceLogFormat => {
  return value === "text" || value === "json";
};

export const isIsolatedChildAwaitingConfigMessage = (value: unknown): value is IsolatedChildAwaitingConfigMessage => {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "awaiting_config" && typeof value.instanceId === "string";
};

export const isIsolatedChildStartMessage = (value: unknown): value is IsolatedChildStartMessage => {
  if (!isRecord(value) || value.type !== "start" || !isRecord(value.config)) {
    return false;
  }

  const { config } = value;
  const hasValidLogFormat = config.logFormat === undefined || isWorkspaceLogFormat(config.logFormat);
  return typeof config.host === "string" && typeof config.workDir === "string" && hasValidLogFormat;
};

export const isIsolatedChildReadyMessage = (value: unknown): value is IsolatedChildReadyMessage => {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "ready" && typeof value.port === "number" && typeof value.instanceId === "string";
};

export const isIsolatedChildErrorMessage = (value: unknown): value is IsolatedChildErrorMessage => {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "error" && typeof value.message === "string";
};

export const isIsolatedChildShutdownMessage = (value: unknown): value is IsolatedChildShutdownMessage => {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "shutdown";
};
