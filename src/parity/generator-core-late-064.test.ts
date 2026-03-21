import assert from "node:assert/strict"
import test from "node:test"

import { createDeterministicScreenFile } from "./generator-core.js"

test("deterministic screen rendering maps shadow metadata to Card elevation and Box boxShadow with priority rules", () => {
  const screen = {
    id: "shadow-screen",
    name: "Shadow Screen",
    layoutMode: "VERTICAL" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "shadow-card",
        name: "Summary Card",
        nodeType: "FRAME",
        type: "card" as const,
        x: 0,
        y: 0,
        width: 420,
        height: 200,
        elevation: 14,
        insetShadow: "inset 0px 1px 3px rgba(0, 0, 0, 0.2)",
        children: [
          {
            id: "shadow-card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Finanzstatus"
          }
        ]
      },
      {
        id: "shadow-container-elevation",
        name: "Elevated Box",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 220,
        width: 320,
        height: 96,
        elevation: 5,
        children: []
      },
      {
        id: "shadow-container-inset",
        name: "Inset Box",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 332,
        width: 320,
        height: 96,
        elevation: 8,
        insetShadow: "inset 2px 4px 6px rgba(17, 34, 51, 0.25)",
        children: []
      }
    ]
  }

  const content = createDeterministicScreenFile(screen).content
  assert.ok(content.includes("<Card "))
  assert.ok(content.includes("elevation={14}"))
  assert.ok(content.includes("boxShadow: 5"))
  assert.ok(content.includes('boxShadow: "inset 2px 4px 6px rgba(17, 34, 51, 0.25)"'))
  assert.equal(content.includes('boxShadow: "inset 0px 1px 3px rgba(0, 0, 0, 0.2)"'), false)
  assert.equal(content.includes("<Paper "), false)
})
