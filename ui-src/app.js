const endpoints = {
  health: "/healthz",
  workspace: "/workspace",
  submit: "/workspace/submit",
  job: (jobId) => `/workspace/jobs/${encodeURIComponent(jobId)}`,
  result: (jobId) => `/workspace/jobs/${encodeURIComponent(jobId)}/result`
};

const runtimePollIntervalMs = 5000;
const jobPollIntervalMs = 1500;

const selectors = {
  refreshRuntime: document.querySelector("#refresh-runtime"),
  workspaceForm: document.querySelector("#workspace-submit-form"),
  figmaFileKey: document.querySelector("#figma-file-key"),
  figmaAccessToken: document.querySelector("#figma-access-token"),
  enableGitPr: document.querySelector("#enable-git-pr"),
  repoUrl: document.querySelector("#repo-url"),
  repoToken: document.querySelector("#repo-token"),
  projectName: document.querySelector("#project-name"),
  targetPath: document.querySelector("#target-path"),
  healthStatus: document.querySelector("#health-status"),
  workspaceStatus: document.querySelector("#workspace-status"),
  submitStatus: document.querySelector("#submit-status"),
  workspacePayload: document.querySelector("#workspace-payload"),
  submitPayload: document.querySelector("#submit-payload"),
  jobPayload: document.querySelector("#job-payload"),
  jobSummary: document.querySelector("#job-summary"),
  stageList: document.querySelector("#stage-list"),
  previewMessage: document.querySelector("#preview-message"),
  previewLink: document.querySelector("#preview-link"),
  footerVersion: document.querySelector("#footer-version")
};

let activeJobId = null;
let runtimePollHandle = null;
let jobPollHandle = null;

const toPrettyJson = (value) => JSON.stringify(value, null, 2);

const setBadgeState = (element, { text, variant = "default" }) => {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove("badge--ok", "badge--warn", "badge--error");
  if (variant === "ok") {
    element.classList.add("badge--ok");
  }
  if (variant === "warn") {
    element.classList.add("badge--warn");
  }
  if (variant === "error") {
    element.classList.add("badge--error");
  }
};

const safeJson = async (response) => {
  const bodyText = await response.text();
  if (!bodyText) {
    return {};
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return { raw: bodyText };
  }
};

const redactSecrets = (input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((value) => redactSecrets(value));
  }

  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase().includes("token") || key.toLowerCase().includes("access") || key.toLowerCase().includes("key")) {
      if (key === "figmaFileKey") {
        result[key] = value;
      } else {
        result[key] = typeof value === "string" && value.length > 0 ? "[REDACTED]" : value;
      }
      continue;
    }
    result[key] = redactSecrets(value);
  }
  return result;
};

const renderStageList = (stages) => {
  selectors.stageList.innerHTML = "";
  if (!Array.isArray(stages) || stages.length === 0) {
    return;
  }

  for (const stage of stages) {
    const item = document.createElement("li");
    item.className = "stage-item";

    const status = (stage.status || "queued").toUpperCase();
    const variant = stage.status === "completed" ? "ok" : stage.status === "failed" ? "error" : stage.status === "running" ? "warn" : "default";

    const left = document.createElement("span");
    left.textContent = stage.name || "unknown";

    const right = document.createElement("span");
    right.className = "badge";
    setBadgeState(right, { text: status, variant });

    item.append(left, right);
    selectors.stageList.appendChild(item);
  }
};

const getInitialFigmaKeyFromPath = () => {
  const path = window.location.pathname;
  if (!path.startsWith("/workspace/")) {
    return null;
  }
  if (path.startsWith("/workspace/ui") || path.startsWith("/workspace/jobs") || path.startsWith("/workspace/repros")) {
    return null;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }

  return decodeURIComponent(parts[1]);
};

const refreshRuntimeStatus = async () => {
  try {
    const [healthResponse, workspaceResponse] = await Promise.all([
      fetch(endpoints.health),
      fetch(endpoints.workspace)
    ]);

    const healthPayload = await safeJson(healthResponse);
    const workspacePayload = await safeJson(workspaceResponse);

    setBadgeState(selectors.healthStatus, {
      text: healthResponse.ok ? "READY" : `ERROR ${healthResponse.status}`,
      variant: healthResponse.ok ? "ok" : "error"
    });
    setBadgeState(selectors.workspaceStatus, {
      text: workspaceResponse.ok ? "ONLINE" : `ERROR ${workspaceResponse.status}`,
      variant: workspaceResponse.ok ? "ok" : "error"
    });

    selectors.workspacePayload.textContent = toPrettyJson({
      health: {
        status: healthResponse.status,
        payload: healthPayload
      },
      workspace: {
        status: workspaceResponse.status,
        payload: workspacePayload
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBadgeState(selectors.healthStatus, { text: "ERROR", variant: "error" });
    setBadgeState(selectors.workspaceStatus, { text: "ERROR", variant: "error" });
    selectors.workspacePayload.textContent = toPrettyJson({
      error: "RUNTIME_UNAVAILABLE",
      message
    });
  }
};

const stopJobPolling = () => {
  if (jobPollHandle) {
    clearInterval(jobPollHandle);
    jobPollHandle = null;
  }
};

const renderPreview = (preview) => {
  if (!preview || !preview.enabled || !preview.url) {
    selectors.previewLink.hidden = true;
    selectors.previewLink.href = "#";
    return;
  }

  selectors.previewLink.hidden = false;
  selectors.previewLink.href = preview.url;
};

const syncGitInputsState = () => {
  const enabled = Boolean(selectors.enableGitPr.checked);
  selectors.repoUrl.toggleAttribute("required", enabled);
  selectors.repoToken.toggleAttribute("required", enabled);
  selectors.repoUrl.disabled = !enabled;
  selectors.repoToken.disabled = !enabled;
};

const updateJobStatus = async () => {
  if (!activeJobId) {
    return;
  }

  try {
    const response = await fetch(endpoints.job(activeJobId));
    const payload = await safeJson(response);

    if (!response.ok) {
      setBadgeState(selectors.submitStatus, {
        text: `ERROR ${response.status}`,
        variant: "error"
      });
      selectors.jobSummary.textContent = "Job status could not be loaded.";
      selectors.jobPayload.textContent = toPrettyJson(payload);
      return;
    }

    renderStageList(payload.stages);
    selectors.jobPayload.textContent = toPrettyJson(redactSecrets(payload));

    if (payload.status === "queued" || payload.status === "running") {
      setBadgeState(selectors.submitStatus, {
        text: payload.status.toUpperCase(),
        variant: payload.status === "running" ? "warn" : "default"
      });
      selectors.jobSummary.textContent = `Job ${payload.jobId} is ${payload.status}.`;
      selectors.previewMessage.textContent = "Generation läuft. Bitte warten...";
      renderPreview(payload.preview);
      return;
    }

    if (payload.status === "completed") {
      setBadgeState(selectors.submitStatus, {
        text: "COMPLETED",
        variant: "ok"
      });
      selectors.jobSummary.textContent = `Job ${payload.jobId} completed successfully.`;
      selectors.previewMessage.textContent = "Code wurde lokal generiert.";
      renderPreview(payload.preview);
      stopJobPolling();

      const resultResponse = await fetch(endpoints.result(activeJobId));
      const resultPayload = await safeJson(resultResponse);
      selectors.submitPayload.textContent = toPrettyJson(redactSecrets({
        status: resultResponse.status,
        payload: resultPayload
      }));
      return;
    }

    setBadgeState(selectors.submitStatus, {
      text: "FAILED",
      variant: "error"
    });
    selectors.jobSummary.textContent = `Job ${payload.jobId} failed.`;
    selectors.previewMessage.textContent = payload.error?.message || "Generation failed.";
    renderPreview(payload.preview);
    stopJobPolling();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBadgeState(selectors.submitStatus, {
      text: "POLL_ERROR",
      variant: "error"
    });
    selectors.jobSummary.textContent = "Polling failed.";
    selectors.jobPayload.textContent = toPrettyJson({
      error: "POLL_ERROR",
      message
    });
    stopJobPolling();
  }
};

const startJobPolling = () => {
  stopJobPolling();
  void updateJobStatus();
  jobPollHandle = setInterval(() => {
    void updateJobStatus();
  }, jobPollIntervalMs);
};

const collectSubmitPayload = () => {
  const enableGitPr = Boolean(selectors.enableGitPr.checked);
  return {
    figmaFileKey: selectors.figmaFileKey.value.trim(),
    figmaAccessToken: selectors.figmaAccessToken.value.trim(),
    repoUrl: selectors.repoUrl.value.trim() || undefined,
    repoToken: selectors.repoToken.value.trim() || undefined,
    enableGitPr,
    projectName: selectors.projectName.value.trim() || undefined,
    targetPath: selectors.targetPath.value.trim() || undefined,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  };
};

const validateRequiredFields = (payload) => {
  const missing = [];
  if (!payload.figmaFileKey) missing.push("figmaFileKey");
  if (!payload.figmaAccessToken) missing.push("figmaAccessToken");
  if (payload.enableGitPr) {
    if (!payload.repoUrl) missing.push("repoUrl");
    if (!payload.repoToken) missing.push("repoToken");
  }
  return missing;
};

const submitWorkspaceRequest = async (event) => {
  event.preventDefault();

  const payload = collectSubmitPayload();
  const missing = validateRequiredFields(payload);

  if (missing.length > 0) {
    setBadgeState(selectors.submitStatus, { text: "VALIDATION_ERROR", variant: "error" });
    selectors.submitPayload.textContent = toPrettyJson({
      error: "VALIDATION_ERROR",
      message: `Missing required fields: ${missing.join(", ")}`
    });
    return;
  }

  setBadgeState(selectors.submitStatus, { text: "SUBMITTING", variant: "warn" });
  selectors.previewMessage.textContent = "Starting autonomous job...";

  try {
    const response = await fetch(endpoints.submit, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responsePayload = await safeJson(response);
    selectors.submitPayload.textContent = toPrettyJson(redactSecrets({
      request: payload,
      response: {
        status: response.status,
        payload: responsePayload
      }
    }));

    if (response.status !== 202 || !responsePayload.jobId) {
      setBadgeState(selectors.submitStatus, {
        text: responsePayload.error || `ERROR ${response.status}`,
        variant: "error"
      });
      selectors.previewMessage.textContent = "Submit failed.";
      return;
    }

    activeJobId = responsePayload.jobId;
    setBadgeState(selectors.submitStatus, {
      text: "QUEUED",
      variant: "warn"
    });
    selectors.jobSummary.textContent = `Job ${activeJobId} accepted.`;
    selectors.previewMessage.textContent = "Job accepted. Polling status...";
    startJobPolling();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBadgeState(selectors.submitStatus, { text: "NETWORK_ERROR", variant: "error" });
    selectors.previewMessage.textContent = "Submit failed due to a network/runtime error.";
    selectors.submitPayload.textContent = toPrettyJson({
      error: "NETWORK_ERROR",
      message
    });
  }
};

const main = () => {
  const initialFigmaKey = getInitialFigmaKeyFromPath();
  if (initialFigmaKey) {
    selectors.figmaFileKey.value = initialFigmaKey;
  }

  selectors.workspaceForm.addEventListener("submit", submitWorkspaceRequest);
  selectors.enableGitPr.addEventListener("change", () => {
    syncGitInputsState();
  });
  selectors.refreshRuntime.addEventListener("click", () => {
    void refreshRuntimeStatus();
  });

  selectors.footerVersion.textContent = "workspace-dev ui v0.3";
  syncGitInputsState();

  void refreshRuntimeStatus();
  runtimePollHandle = setInterval(() => {
    void refreshRuntimeStatus();
  }, runtimePollIntervalMs);
};

window.addEventListener("beforeunload", () => {
  if (runtimePollHandle) {
    clearInterval(runtimePollHandle);
  }
  stopJobPolling();
});

main();
