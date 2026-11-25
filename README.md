# diffcanvas

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-10b981.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)

> Zero-config CLI & interactive spatial PR storyboarder that turns flat `git diff` output into a navigable symbol impact graph.

## Quickstart

```bash
npm install && npm run build
npx diffcanvas --demo              # Launch interactive spatial storyboard with built-in refactor dataset
npx diffcanvas HEAD~3..HEAD        # Visualize a commit range in your current git repository
```

## Highlights

- **Symbol & Call-Graph Extraction:** Parses modified functions, classes, methods, types, and imports across TypeScript, JavaScript, Python, Rust, and Go unified diffs.
- **Impact Radius Scoring:** Computes `low` / `medium` / `high` blast scores from exported contracts, fan-in callers, transitive upstream depth, and hunk churn.
- **Spatial Canvas & Tour Mode:** Draggable symbol cards, animated directional caller/import Bezier edges, camera pan/zoom, guided step-by-step PR Tour Mode, semantic side-by-side diff drawer, and 1-click SVG/PNG export.

## Architecture

- `src/core/diffParser.ts` — Streaming unified diff parser, symbol extractor, cross-file call/import linker, and impact scorer.
- `src/cli/server.ts` & `bin/diffcanvas.js` — Node ESM server serving `/api/graph` (staged + unstaged or arbitrary commit ranges with clean `--demo` fallback) and static client assets.
- `src/App.tsx` & `src/components/DiffDrawer.tsx` — Dark-mode (`#0B0F17` / `#111827`) interactive spatial storyboard and diff inspector.

## Verify

```bash
npm test
npm run build
```
