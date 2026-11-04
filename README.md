# Sepia Slicer

A friendlier slicer for the **Snapmaker U1**, the four-toolhead printer. Sepia is a new interface on top of [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer)'s slicing engine: Orca does the slicing, Sepia is what you see and touch.

> **Early prototype.** It loads models, slices them for the U1 with up to four toolheads and shows the result, but much of what Orca does is still missing. Not affiliated with Snapmaker or the OrcaSlicer project.

*En español: Sepia es un laminador para la Snapmaker U1 con una interfaz nueva sobre el motor de OrcaSlicer. Está en inglés y español, y sigue el modo claro u oscuro del sistema (o el que elijas).*

## What is different

- **Settings are always in view.** Every setting lives in one list with sections, next to the 3D scene, instead of behind tabs and dialogs. Changed values are marked, and one click sets each back to the profile's value.
- **Per-piece settings where you expect them.** Select an object and the same list shows its own settings: what you changed only for it, with the rest greyed out as inherited from the plate.
- **Search everything with ⌘K.** Settings, objects and actions, in English or Spanish. Pick a setting and the list scrolls to it.
- **Made for four toolheads.** Each object gets a toolhead in the object list. The preview colours by toolhead, shows which layers each head prints and counts the toolhead changes, which is where a toolchanger spends its time.

## Requirements

- macOS (Windows and Linux are not wired up yet)
- [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer/releases) **2.4 or newer** installed in `/Applications`. Sepia uses its command line and its Snapmaker U1 profiles. Snapmaker Orca is detected as a fallback.
- Node.js 22 or newer to build from source

## Run it

```bash
npm install
npm run dev
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the app into `out/` |
| `npm start` | Runs the built app |
| `npm test` | Unit tests (G-code reader) |
| `npm run smoke` | Builds, opens the app, loads two models on two toolheads, slices with Orca and saves screenshots to `smoke-shots/` |
| `npm run typecheck` | TypeScript checks |
| `npm run dist` | Packages a macOS app with electron-builder |

## How it works

- **Electron + React + three.js.** `src/main` runs Orca and talks to the printer, `src/renderer` is the interface, `src/shared` holds the settings list and the types both sides use.
- **Profiles.** Sepia reads Orca's Snapmaker U1 profiles from the installed app, merges their inheritance chain and asks Orca for its full config once per profile, so every value it shows is the one Orca will use.
- **Slicing.** Each object is written as an STL in bed coordinates, all four toolheads are loaded as filaments, and Orca's command line slices the plate. When an object has settings of its own, Sepia exports a 3MF project, writes those settings into it and slices the project, since the command line has no option for per-object settings.
- **Preview.** A Web Worker reads Orca's G-code (layers, toolheads, line types, arcs, time and filament per toolhead) and three.js draws it layer by layer.
- **Printer.** Sending uses Moonraker's upload API on the U1. It has not been tested against a real printer yet.

## Not done yet

- More than one plate; cut and paint tools; arranging objects automatically
- Filament settings (temperatures, fans) in the settings list. Today a toolhead's filament profile is picked as a whole.
- Different toolheads for different parts of one object
- Windows and Linux paths for OrcaSlicer
- Warnings from the slice (thin walls, floating regions)

## Licence

[AGPL-3.0](LICENSE), the same licence as OrcaSlicer, so Sepia can link Orca's engine directly in the future.
