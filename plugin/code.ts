/**
 * WorkspaceDev Figma Plugin — clipboard-first export.
 *
 * Exports selected nodes as a versioned clipboard envelope that the
 * Inspector can accept without cross-origin communication.
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/997
 */

const ENVELOPE_KIND = "workspace-dev/figma-selection@1";
const PLUGIN_VERSION = "0.1.0";

interface SelectionUnit {
  document: Record<string, unknown>;
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface ClipboardEnvelope {
  kind: string;
  pluginVersion: string;
  copiedAt: string;
  selections: SelectionUnit[];
}

figma.showUI(__html__, { width: 320, height: 200 });

figma.ui.onmessage = async (message: { type: string }) => {
  if (message.type === "export-selection") {
    await exportSelection();
  }
  if (message.type === "close") {
    figma.closePlugin();
  }
};

async function exportSelection(): Promise<void> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      message: "No nodes selected. Please select at least one layer.",
    });
    return;
  }

  figma.ui.postMessage({ type: "status", message: "Exporting…" });

  const selections: SelectionUnit[] = [];

  for (const node of selection) {
    try {
      const exported = await node.exportAsync({
        format: "JSON_REST_V1",
      } as ExportSettingsREST);
      const text = new TextDecoder().decode(exported);
      const parsed = JSON.parse(text) as Record<string, unknown>;

      selections.push({
        document: (parsed.document as Record<string, unknown>) ?? {
          id: node.id,
          type: node.type,
          name: node.name,
        },
        components: (parsed.components as Record<string, unknown>) ?? {},
        componentSets: (parsed.componentSets as Record<string, unknown>) ?? {},
        styles: (parsed.styles as Record<string, unknown>) ?? {},
      });
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

  const envelope: ClipboardEnvelope = {
    kind: ENVELOPE_KIND,
    pluginVersion: PLUGIN_VERSION,
    copiedAt: new Date().toISOString(),
    selections,
  };

  const json = JSON.stringify(envelope);

  figma.ui.postMessage({
    type: "copy-to-clipboard",
    payload: json,
  });
}
