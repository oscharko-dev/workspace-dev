"use strict";
/**
 * WorkspaceDev Figma Plugin - clipboard-first export.
 *
 * Exports selected nodes as a versioned clipboard envelope that the
 * Inspector can accept without any cross-origin localhost transport.
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/985
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/997
 */
const ENVELOPE_KIND = "workspace-dev/figma-selection@1";
const PLUGIN_VERSION = "0.2.0";
/**
 * Node types that can be meaningfully exported.
 * Plugin API `type` values: https://developers.figma.com/docs/plugins/api/nodes/
 */
const ALLOWED_NODE_TYPES = new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
    "GROUP",
    "SECTION",
    "BOOLEAN_OPERATION",
    "VECTOR",
    "STAR",
    "LINE",
    "ELLIPSE",
    "POLYGON",
    "RECTANGLE",
    "TEXT",
    "SHAPE_WITH_TEXT",
]);
figma.showUI(__html__, { width: 380, height: 320 });
figma.ui.onmessage = async (message) => {
    if (message.type === "export-selection") {
        await exportSelection("clipboard");
    }
    if (message.type === "upload-to-local") {
        await exportSelection("upload", message.endpointUrl);
    }
    if (message.type === "close") {
        figma.closePlugin();
    }
};
async function exportSelection(mode, endpointUrl) {
    const selection = [...figma.currentPage.selection].sort(compareNodesForExport);
    if (selection.length === 0) {
        figma.ui.postMessage({
            type: "error",
            message: "No nodes selected. Please select at least one layer.",
        });
        return;
    }
    // Validate node types.
    const unsupported = selection.filter((node) => !ALLOWED_NODE_TYPES.has(node.type));
    if (unsupported.length > 0) {
        const names = unsupported
            .slice(0, 3)
            .map((n) => `"${n.name}" (${n.type})`)
            .join(", ");
        const overflow = unsupported.length > 3 ? ` and ${unsupported.length - 3} more` : "";
        figma.ui.postMessage({
            type: "error",
            message: `Unsupported node type(s): ${names}${overflow}. Supported: ${[...ALLOWED_NODE_TYPES].join(", ")}.`,
        });
        return;
    }
    figma.ui.postMessage({ type: "status", message: "Exporting..." });
    const selections = [];
    for (const node of selection) {
        try {
            const exported = await node.exportAsync({
                format: "JSON_REST_V1",
            });
            selections.push(createSelectionUnit(node, exported));
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown export error";
            figma.ui.postMessage({
                type: "error",
                message: `Failed to export "${node.name}": ${errorMessage}`,
            });
            return;
        }
    }
    const envelope = {
        kind: ENVELOPE_KIND,
        pluginVersion: PLUGIN_VERSION,
        copiedAt: new Date().toISOString(),
        selections,
    };
    if (mode === "upload") {
        figma.ui.postMessage({
            type: "status",
            message: "Uploading to WorkspaceDev...",
        });
        try {
            const response = (await fetch(`${endpointUrl}/workspace/submit`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    figmaSourceMode: "figma_plugin",
                    figmaJsonPayload: JSON.stringify(envelope),
                }),
            }));
            if (response.ok) {
                const result = (await response.json());
                figma.ui.postMessage({
                    type: "upload-result",
                    jobId: result.jobId,
                    trackingUrl: `${endpointUrl}/workspace/jobs/${result.jobId}`,
                });
            }
            else {
                const requestId = response.headers.get("x-request-id") || "";
                let serverMessage = `HTTP ${response.status}`;
                try {
                    const body = (await response.json());
                    if (body.message) {
                        serverMessage = body.message;
                    }
                }
                catch {
                    // ignore parse failure; use status text
                }
                figma.ui.postMessage({
                    type: "upload-error",
                    message: serverMessage,
                    requestId,
                });
            }
        }
        catch (error) {
            figma.ui.postMessage({
                type: "upload-error",
                message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
        return;
    }
    // clipboard mode (default)
    figma.ui.postMessage({
        type: "copy-to-clipboard",
        payload: JSON.stringify(envelope),
    });
}
function createSelectionUnit(node, exported) {
    const parsed = isRecord(exported) ? exported : {};
    const rawDocument = parsed.document;
    const document = isRecord(rawDocument) && Object.keys(rawDocument).length > 0
        ? rawDocument
        : {
            id: node.id,
            type: node.type,
            name: node.name,
        };
    return {
        document,
        components: isRecord(parsed.components) ? parsed.components : {},
        componentSets: isRecord(parsed.componentSets) ? parsed.componentSets : {},
        styles: isRecord(parsed.styles) ? parsed.styles : {},
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function compareNodesForExport(left, right) {
    const leftKey = `${left.id}:${left.name}`;
    const rightKey = `${right.id}:${right.name}`;
    return leftKey.localeCompare(rightKey);
}
