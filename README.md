# Sepia Slicer

A friendlier slicer for the **Snapmaker U1**, the four-toolhead printer. Sepia is a new interface on top of [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer)'s slicing engine: Orca does the slicing, Sepia is what you see and touch.

> **Early prototype.** It loads models, slices them for the U1 with up to four toolheads and shows the result, but much of what Orca does is still missing. Not affiliated with Snapmaker or the OrcaSlicer project.

*En español: Sepia es un laminador para la Snapmaker U1 con una interfaz nueva sobre el motor de OrcaSlicer. Está en inglés y español, y sigue el modo claro u oscuro del sistema (o el que elijas).*

## What is different

- **Settings are always in view.** Every setting lives in one list with sections, next to the 3D scene, instead of behind tabs and dialogs. Changed values are marked, and one click sets each back to the profile's value. Each toolhead's filament settings (temperatures, fan, flow, retraction) are in the same list.
- **Per-piece settings where you expect them.** Select an object and the same list shows its own settings: what you changed only for it, with the rest greyed out as inherited.
- **Search everything with ⌘K.** Settings, objects and actions, in English or Spanish. Pick a setting and the list scrolls to it.
- **Made for four toolheads.** Each object, and each part of an object, gets a toolhead. Paint faces with another toolhead, paint where supports go or must not, and where the seam goes. The preview colours by toolhead, shows which layers each head prints and counts the toolhead changes.
- **OrcaSlicer projects.** Projects are 3MF files that OrcaSlicer opens and slices as they are, and Sepia opens 3MF projects from OrcaSlicer, Bambu Studio and PrusaSlicer: objects, parts, toolheads, painted faces, per-object settings and plates.
- **Editing.** Several plates; exact position, rotation, scale and size; mirror; duplicate, copy and paste; select several objects; cut with a horizontal plane; arrange (A); undo and redo.
- **Models.** STL, 3MF, OBJ and STEP, from the menu, by dropping them on the window, or by opening them from Finder.
- **Warnings.** What Orca reports while slicing (parts in mid-air, objects off the bed, empty layers…), in your language, plus objects wholly off the bed, which Orca drops without a word.
- **The printer at a glance.** The Printer tab shows the U1's state, progress, the temperature of each toolhead and the bed, and its camera, through Moonraker.

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
| `npm test` | Unit tests: G-code reader, arrange, painted-face codec, Orca's warnings, cut |
| `npm run smoke` | Builds the app and drives it end to end: models on several toolheads, a per-piece setting, arrange, undo/redo, exact values, duplicate, two plates, a 3MF with parts and painted faces, painting, cutting, slicing with Orca, saving a project and slicing it with OrcaSlicer itself, and a fake printer. Screenshots go to `smoke-shots/` |
| `npm run typecheck` | TypeScript checks |
| `npm run dist` | Packages a macOS app with electron-builder |

## How it works

- **Electron + React + three.js.** `src/main` runs Orca and talks to the printer, `src/renderer` is the interface, `src/shared` holds the settings list and the types both sides use.
- **Profiles.** Sepia reads Orca's Snapmaker U1 profiles from the installed app, merges their inheritance chain and asks Orca for its full config once per profile, so every value it shows is the one Orca will use.
- **Slicing.** Sepia writes the plate as an OrcaSlicer-style 3MF (objects, parts with their toolheads, painted faces, per-object settings), asks Orca for its full config with all four toolheads, adds it to the 3MF and slices it with Orca's command line. Saved projects are the same 3MF, with every plate, plus a small `Metadata/sepia.json` that Orca ignores.
- **Bed type.** The U1 profile defaults to the Textured PEI Plate, but its filament profiles only give a bed temperature for the High Temp Plate, so Sepia defaults to that one. It is the "Build plate" setting.
- **Preview.** A Web Worker reads Orca's G-code (layers, toolheads, line types, arcs, time and filament per toolhead) and three.js draws it layer by layer.
- **Printer.** Status, camera snapshots and sending use Moonraker's API on the U1. The smoke test checks them against a fake Moonraker; they have not been tried on a real U1 yet.

## Not done yet

- Painting paints whole triangles. Sepia reads finer painting from other programs as the colour that covers most of each triangle.
- Modifiers, negative parts and other non-model parts in 3MF files are left out, with a notice.
- Suggestions after slicing, such as how to cut down toolhead changes.
- Windows and Linux paths for OrcaSlicer; a signed macOS build.

## Licence

[AGPL-3.0](LICENSE), the same licence as OrcaSlicer, so Sepia can link Orca's engine directly in the future.
