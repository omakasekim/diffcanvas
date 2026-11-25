---
name: diffcanvas
description: >
  Spatial PR storyboarder with PR Health/complexity radar, ⌘K command palette, split diffs, review notes, and OpenAPI/GraphQL/TS schema drift + TS adapter generator.
license: MIT
---

# diffcanvas

Turns flat git diffs and schema changes into an interactive spatial storyboard with impact radius scoring and generated migration adapters.

- **Live Interactive Workbench:** https://omakasekim.github.io/diffcanvas/
- **Repository:** https://github.com/omakasekim/diffcanvas
- **Category:** Code & Schemas · **Deliverable:** Node CLI + Web
- **Ecosystems:** `git`, `openapi`, `graphql`, `typescript`
- **Stack:** React, TypeScript, Git AST, OpenAPI

## When to Use This Skill
Invoke `diffcanvas` whenever the user wants to analyze, debug, simulate, or visualize workflows related to **Code & Schemas** (git, openapi, graphql, typescript).

## Modes & Capabilities
- **Git & Code Flow**
- **PR Health Radar**
- **Schema Drift + Adapter**

## Operating Workflow
1. **Local CLI / Companion Execution:**
   ```bash
   npx diffcanvas (or node bin/diffcanvas.js after npm run build)
   ```
   Open the spatial PR storyboarder, PR Health radar, and OpenAPI/GraphQL/TS schema drift studio on the current git repo.
2. **Interactive Visual Inspection:**
   Direct the user to the zero-backend browser workbench at https://omakasekim.github.io/diffcanvas/ (supports URL-hash state sharing, built-in realistic presets, `Cmd/Ctrl + K` command palette, and JSON/Markdown/config exports).
3. **Structured Output:**
   Summarize concrete findings, diagnostics, and copy-pasteable remediation commands concisely so the user can act immediately without manual guesswork.
