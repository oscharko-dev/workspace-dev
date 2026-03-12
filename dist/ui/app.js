const endpoints = {
  health: "/healthz",
  workspace: "/workspace",
  submit: "/workspace/submit"
};

const pollIntervalMs = 5000;

const selectors = {
  runtimeMode: document.querySelector("#runtime-mode"),
  refreshRuntime: document.querySelector("#refresh-runtime"),
  workspaceForm: document.querySelector("#workspace-submit-form"),
  figmaFileKey: document.querySelector("#figma-file-key"),
  figmaSourceMode: document.querySelector("#figma-source-mode"),
  llmCodegenMode: document.querySelector("#llm-codegen-mode"),
  restPatStatus: document.querySelector("#status-rest-pat"),
  healthStatus: document.querySelector("#health-status"),
  workspaceStatus: document.querySelector("#workspace-status"),
  submitStatus: document.querySelector("#submit-status"),
  previewMessage: document.querySelector("#preview-message"),
  workspacePayload: document.querySelector("#workspace-payload"),
  submitPayload: document.querySelector("#submit-payload"),
  footerVersion: document.querySelector("#footer-version")
};

const setBadgeState = (element, { text, variant = "default" }) => {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove("badge--ok", "badge--warn", "badge--error");
  if (variant === "ok") {
    element.classList.add("badge--ok");
  } else if (variant === "warn") {
    element.classList.add("badge--warn");
  } else if (variant === "error") {
    element.classList.add("badge--error");
  }
};

const toPrettyJson = (value) => JSON.stringify(value, null, 2);

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

const refreshRuntimeStatus = async () => {
  selectors.runtimeMode.textContent = "refreshing";
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
    setBadgeState(selectors.restPatStatus, {
      text: healthResponse.ok ? "READY" : "UNAVAILABLE",
      variant: healthResponse.ok ? "ok" : "error"
    });

    if (workspaceResponse.ok && workspacePayload) {
      if (selectors.figmaSourceMode && workspacePayload.figmaSourceMode) {
        selectors.figmaSourceMode.value = workspacePayload.figmaSourceMode;
      }
      if (selectors.llmCodegenMode && workspacePayload.llmCodegenMode) {
        selectors.llmCodegenMode.value = workspacePayload.llmCodegenMode;
      }
    }

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

    selectors.runtimeMode.textContent = "ready";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBadgeState(selectors.healthStatus, { text: "ERROR", variant: "error" });
    setBadgeState(selectors.workspaceStatus, { text: "ERROR", variant: "error" });
    selectors.workspacePayload.textContent = toPrettyJson({
      error: "RUNTIME_UNAVAILABLE",
      message
    });
    selectors.runtimeMode.textContent = "error";
  }
};

const submitWorkspaceRequest = async (event) => {
  event.preventDefault();

  const figmaFileKey = selectors.figmaFileKey.value.trim();
  if (!figmaFileKey) {
    setBadgeState(selectors.submitStatus, { text: "VALIDATION_ERROR", variant: "error" });
    selectors.submitPayload.textContent = toPrettyJson({
      error: "VALIDATION_ERROR",
      message: "figmaFileKey is required before submitting."
    });
    selectors.previewMessage.textContent = "Provide a figmaFileKey to run submit validation.";
    return;
  }

  setBadgeState(selectors.submitStatus, { text: "SUBMITTING", variant: "warn" });
  selectors.previewMessage.textContent = "Running mode-locked submit validation...";

  try {
    const response = await fetch(endpoints.submit, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ figmaFileKey })
    });
    const payload = await safeJson(response);
    const responseLabel = payload.error ?? `HTTP_${response.status}`;

    if (response.status === 501) {
      setBadgeState(selectors.submitStatus, { text: responseLabel, variant: "warn" });
      selectors.previewMessage.textContent =
        "Submit request validated. Runtime intentionally stops at deterministic not_implemented boundary.";
    } else if (response.ok) {
      setBadgeState(selectors.submitStatus, { text: responseLabel, variant: "ok" });
      selectors.previewMessage.textContent = "Submit finished successfully.";
    } else {
      setBadgeState(selectors.submitStatus, { text: responseLabel, variant: "error" });
      selectors.previewMessage.textContent = "Submit rejected. Inspect payload for details.";
    }

    selectors.submitPayload.textContent = toPrettyJson({
      status: response.status,
      payload
    });
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
  selectors.workspaceForm.addEventListener("submit", submitWorkspaceRequest);
  selectors.refreshRuntime.addEventListener("click", () => {
    void refreshRuntimeStatus();
  });

  selectors.footerVersion.textContent = "workspace-dev ui v0.1";

  void refreshRuntimeStatus();
  setInterval(() => {
    void refreshRuntimeStatus();
  }, pollIntervalMs);
};

main();

