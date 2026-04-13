/**
 * WorkspaceDev Figma Plugin - clipboard-first export.
 *
 * Exports selected nodes as a versioned clipboard envelope that the
 * Inspector can accept without cross-origin communication.
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/997
 */

const ENVELOPE_KIND = "workspace-dev/figma-selection@1";
const PLUGIN_VERSION = "0.1.0";

figma.showUI(__html__, { width: 320, height: 200 });

figma.ui.onmessage = async (message) => {
  if (message.type === "export-selection") {
    await exportSelection();
  }
  if (message.type === "close") {
    figma.closePlugin();
  }
};

async function exportSelection() {
  const selection = [...figma.currentPage.selection].sort(compareNodesForExport);

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      message: "No nodes selected. Please select at least one layer.",
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown export error";
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

  figma.ui.postMessage({
    type: "copy-to-clipboard",
    payload: JSON.stringify(envelope),
  });
}

function createSelectionUnit(node, exported) {
  const parsed = isRecord(exported) ? exported : {};
  const document =
    isRecord(parsed.document) && Object.keys(parsed.document).length > 0
      ? parsed.document
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
