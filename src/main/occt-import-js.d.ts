// The parts of occt-import-js that Sepia uses. The package ships no types.
declare module 'occt-import-js' {
  export interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctMesh {
    name: string;
    /** Vertex positions in the file's coordinates, with assembly placements already applied. */
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    /** Three vertex indices per triangle. */
    index: { array: number[] };
  }

  export interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  export interface Occt {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  }

  /** Emscripten's module factory: loads occt-import-js.wasm and resolves once it is ready. */
  export default function occtimportjs(options?: { locateFile?: (path: string, prefix: string) => string }): Promise<Occt>;
}
