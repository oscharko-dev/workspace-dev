import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicScreenFile } from "./generator-core.js";
import type { ScreenIR } from "./types.js";

const createDetachedFieldScreen = (): ScreenIR => ({
  id: "forms-regression-screen",
  name: "Forms Regression",
  layoutMode: "NONE",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "helper-text",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum.",
      x: 32,
      y: 8,
      width: 420,
      height: 18
    },
    {
      id: "detached-label",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Zu welchem Monat soll die Besparung starten?",
      x: 32,
      y: 44,
      width: 300,
      height: 14
    },
    {
      id: "detached-input",
      name: "MuiInputRoot",
      nodeType: "FRAME",
      type: "input",
      x: 32,
      y: 68,
      width: 360,
      height: 24,
      children: [
        {
          id: "detached-value",
          name: "MuiInputBaseInput",
          nodeType: "TEXT",
          type: "text",
          text: "April 2026",
          x: 32,
          y: 68,
          width: 120,
          height: 20
        }
      ]
    }
  ]
});

const createEmbeddedLabelScreen = (): ScreenIR => ({
  id: "forms-embedded-screen",
  name: "Forms Embedded Label",
  layoutMode: "NONE",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "helper-text",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Bitte erfassen Sie den Zeitraum bis zum geplanten Bau oder Kauf.",
      x: 32,
      y: 8,
      width: 420,
      height: 18
    },
    {
      id: "input-with-label",
      name: "MuiInputBaseRoot",
      nodeType: "FRAME",
      type: "input",
      x: 32,
      y: 44,
      width: 360,
      height: 44,
      children: [
        {
          id: "embedded-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text",
          text: "Monatliche Sparrate (optional)",
          x: 32,
          y: 44,
          width: 260,
          height: 14
        },
        {
          id: "embedded-value",
          name: "MuiInputBaseInput",
          nodeType: "TEXT",
          type: "text",
          text: "50,00",
          x: 32,
          y: 62,
          width: 72,
          height: 20
        }
      ]
    }
  ]
});

test("deterministic form rendering keeps helper text while consuming detached field labels", () => {
  const content = createDeterministicScreenFile(createDetachedFieldScreen()).content;

  assert.ok(content.includes("Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum."));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.equal(content.includes('{"detached-label"}'), false);
});

test("deterministic form rendering preserves helper text when semantic model already has field label", () => {
  const content = createDeterministicScreenFile(createEmbeddedLabelScreen()).content;

  assert.ok(content.includes("Bitte erfassen Sie den Zeitraum bis zum geplanten Bau oder Kauf."));
  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
});
