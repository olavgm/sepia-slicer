// Every filament setting Sepia shows, grouped by section. Each toolhead has its own filament profile,
// so these are edited per toolhead. Keys are OrcaSlicer 2.4.2 filament keys (Preset.cpp's filament
// options); option values are the exact strings Orca accepts (see PrintConfig.cpp).
//
// How Orca stores these values, which matters when writing them back for slicing:
// - Every key is a list of strings, even with a single value: nozzle_temperature = ["220"]. A filament
//   profile has one entry per extruder variant (filament_extruder_variant); the U1 has one variant,
//   "Direct Drive Standard", so every list has one entry. Write the value to every entry, as
//   applyOverrides in src/main/orca.ts does. When Orca loads the four toolheads it joins the lists, one
//   entry per filament (the G-code header shows hot_plate_temp = 55,55,55,55).
// - Numbers are plain strings ("0.98", "100"). Fan speeds use "%" only as the unit shown: Orca stores
//   "100", not "100%", so no setting here has `percent`. The options of overhang_fan_threshold do end in
//   "%" ("25%"), but they are option values, not numbers.
// - Toggles are "1" or "0".
// - Retraction overrides (`nullable: true`) hold "nil" while the filament does not override the printer;
//   Orca then uses the printer's value (retraction_length, z_hop, wipe… in the printer profile). An empty
//   field in the UI writes ["nil"] back, and a nil toggle or option is "use the printer's value" too.
//   No other key here is ever nil.
// - Bed temperatures: the U1 has no plate choice (support_multi_bed_types = 0), so Orca uses the
//   "High Temp Plate" keys, hot_plate_temp*. Its default_bed_type, "Textured PEI Plate", is not a number,
//   so Preset::get_default_bed_type falls back to the High Temp Plate, and the U1 filament profiles set
//   hot_plate_temp and leave textured_plate_temp at 0. The command line defaults to "Cool Plate"
//   (bed at 0 °C) unless the process sets curr_bed_type = "High Temp Plate".
//
// Left out on purpose: chamber temperature (the U1 has no chamber heater and its start G-code does not use
// it), the single-extruder loading, unloading and cooling moves (only used when
// single_extruder_multi_material is on, and the U1 has it off), and the prime tower interface keys
// (only used with enable_tower_interface_features, off in the U1 processes).

import type { Localized, SettingKind, SettingOption } from './settings-types';

export type FilamentSectionId = 'temperatures' | 'fan' | 'flow' | 'retraction' | 'toolchange';

export interface FilamentSectionDef {
  id: FilamentSectionId;
  label: Localized;
}

export interface FilamentSettingDef {
  /** Orca filament key, e.g. "nozzle_temperature". Must exist in Orca's resolved filament config. */
  key: string;
  section: FilamentSectionId;
  kind: SettingKind;
  /** Shown without pressing "Show more". */
  basic: boolean;
  /**
   * Filament override of a printer setting: "nil" (an empty field) means "use the printer's value".
   * Only Orca's filament retraction overrides are nullable.
   */
  nullable?: boolean;
  /** Unit shown after the value, e.g. "mm", "%", "mm/s", "°C", "s", "mm³", "mm³/s" or "layers". */
  unit?: string;
  /** Orca stores the value with a trailing "%" (e.g. "15%"); the UI shows the number only. */
  percent?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
  label: Localized;
  /** One short sentence, written for someone who is not an expert. */
  help: Localized;
  /** Extra search terms (both languages), e.g. Orca's own name for the setting. */
  keywords?: string[];
}

export const FILAMENT_SECTIONS: FilamentSectionDef[] = [
  { id: 'temperatures', label: { en: 'Temperatures', es: 'Temperaturas' } },
  { id: 'fan', label: { en: 'Cooling fan', es: 'Ventilador' } },
  { id: 'flow', label: { en: 'Flow and speed', es: 'Caudal y velocidad' } },
  { id: 'retraction', label: { en: 'Filament retraction', es: 'Retracción del filamento' } },
  { id: 'toolchange', label: { en: 'Toolchange', es: 'Cambio de cabezal' } },
];

export const FILAMENT_SETTINGS: FilamentSettingDef[] = [
  // ─── Temperatures ───────────────────────────────────────────────────────────
  {
    key: 'nozzle_temperature_initial_layer',
    section: 'temperatures',
    kind: 'number',
    basic: true,
    unit: '°C',
    min: 150,
    max: 300,
    step: 5,
    label: { en: 'Nozzle, first layer', es: 'Boquilla, primera capa' },
    help: {
      en: 'Nozzle temperature for the first layer; a little hotter helps it stick.',
      es: 'Temperatura de la boquilla en la primera capa; un poco más caliente ayuda a que se pegue.',
    },
    keywords: ['first layer nozzle temperature', 'initial layer temperature', 'hotend', 'temperatura de la primera capa'],
  },
  {
    key: 'nozzle_temperature',
    section: 'temperatures',
    kind: 'number',
    basic: true,
    unit: '°C',
    min: 150,
    max: 300,
    step: 5,
    label: { en: 'Nozzle', es: 'Boquilla' },
    help: {
      en: 'Nozzle temperature for every layer after the first.',
      es: 'Temperatura de la boquilla en todas las capas después de la primera.',
    },
    keywords: ['nozzle temperature', 'other layers', 'hotend', 'print temperature', 'temperatura de impresión', 'extrusor'],
  },
  {
    key: 'hot_plate_temp_initial_layer',
    section: 'temperatures',
    kind: 'number',
    basic: true,
    unit: '°C',
    min: 0,
    max: 120,
    step: 5,
    label: { en: 'Plate, first layer', es: 'Placa, primera capa' },
    help: {
      en: 'Plate temperature for the first layer, the one that matters most for sticking.',
      es: 'Temperatura de la placa en la primera capa, la que más importa para que se pegue.',
    },
    keywords: ['first layer bed temperature', 'bed temperature', 'high temp plate', 'cama', 'temperatura de la cama'],
  },
  {
    key: 'hot_plate_temp',
    section: 'temperatures',
    kind: 'number',
    basic: true,
    unit: '°C',
    min: 0,
    max: 120,
    step: 5,
    label: { en: 'Plate', es: 'Placa' },
    help: {
      en: 'Plate temperature for the rest of the print.',
      es: 'Temperatura de la placa durante el resto de la impresión.',
    },
    keywords: ['bed temperature', 'hot plate temp', 'high temp plate', 'heated bed', 'cama caliente', 'temperatura de la cama'],
  },
  {
    key: 'idle_temperature',
    section: 'temperatures',
    kind: 'number',
    basic: false,
    unit: '°C',
    min: 0,
    max: 300,
    step: 5,
    label: { en: 'Parked toolhead', es: 'Cabezal aparcado' },
    help: {
      en: 'Nozzle temperature while this toolhead is parked; 0 uses the standby temperature from the print settings.',
      es: 'Temperatura de la boquilla mientras este cabezal está aparcado; 0 usa la temperatura en espera de los ajustes de impresión.',
    },
    keywords: ['idle temperature', 'standby temperature', 'ooze prevention', 'temperatura en espera', 'goteo'],
  },

  // ─── Cooling fan ────────────────────────────────────────────────────────────
  {
    key: 'fan_min_speed',
    section: 'fan',
    kind: 'number',
    basic: true,
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    label: { en: 'Minimum fan speed', es: 'Velocidad mínima del ventilador' },
    help: {
      en: 'Fan speed for layers that take a while to print; quicker layers get more fan, up to the maximum.',
      es: 'Velocidad del ventilador en las capas que tardan en imprimirse; las más rápidas reciben más, hasta el máximo.',
    },
    keywords: ['fan min speed', 'min fan speed threshold', 'part cooling fan', 'ventilador de capa'],
  },
  {
    key: 'fan_max_speed',
    section: 'fan',
    kind: 'number',
    basic: true,
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    label: { en: 'Maximum fan speed', es: 'Velocidad máxima del ventilador' },
    help: {
      en: 'Fan speed for the quickest layers, which have the least time to cool.',
      es: 'Velocidad del ventilador en las capas más rápidas, que tienen menos tiempo para enfriarse.',
    },
    keywords: ['fan max speed', 'max fan speed threshold', 'part cooling fan', 'ventilador de capa'],
  },
  {
    key: 'close_fan_the_first_x_layers',
    section: 'fan',
    kind: 'number',
    basic: true,
    unit: 'layers',
    min: 0,
    max: 20,
    step: 1,
    label: { en: 'First layers without fan', es: 'Capas iniciales sin ventilador' },
    help: {
      en: 'The fan stays off for these first layers so the print sticks better to the plate.',
      es: 'El ventilador se queda apagado en estas primeras capas para que la pieza se pegue mejor a la placa.',
    },
    keywords: ['no cooling for the first', 'disable fan first layers', 'sin refrigeración', 'primeras capas'],
  },
  {
    key: 'slow_down_layer_time',
    section: 'fan',
    kind: 'number',
    basic: true,
    unit: 's',
    min: 0,
    max: 60,
    step: 1,
    label: { en: 'Minimum layer time', es: 'Tiempo mínimo por capa' },
    help: {
      en: 'Layers quicker than this get the maximum fan and are printed slower so each one has time to cool.',
      es: 'Las capas más rápidas que esto llevan el ventilador al máximo y se imprimen más despacio para que cada una tenga tiempo de enfriarse.',
    },
    keywords: ['slow down layer time', 'max fan speed threshold', 'layer time', 'min layer time', 'tiempo de capa'],
  },
  {
    key: 'fan_cooling_layer_time',
    section: 'fan',
    kind: 'number',
    basic: false,
    unit: 's',
    min: 0,
    max: 300,
    step: 1,
    label: { en: 'Fan for layers under', es: 'Ventilador en capas de menos de' },
    help: {
      en: 'Layers that print in less time than this get the fan, more the quicker they are; slower layers get none unless the fan is kept on.',
      es: 'Las capas que se imprimen en menos tiempo que esto llevan ventilador, más cuanto más rápidas; las más lentas no llevan, salvo que se mantenga encendido.',
    },
    keywords: ['fan cooling layer time', 'min fan speed threshold', 'layer time', 'tiempo de capa'],
  },
  {
    key: 'reduce_fan_stop_start_freq',
    section: 'fan',
    kind: 'toggle',
    basic: false,
    label: { en: 'Keep the fan on', es: 'Mantener el ventilador encendido' },
    help: {
      en: 'Keeps the fan at least at its minimum speed instead of stopping it on slow layers.',
      es: 'Mantiene el ventilador al menos a su velocidad mínima en vez de pararlo en las capas lentas.',
    },
    keywords: ['keep fan always on', 'reduce fan stop start frequency', 'ventilador siempre encendido'],
  },
  {
    key: 'slow_down_for_layer_cooling',
    section: 'fan',
    kind: 'toggle',
    basic: false,
    label: { en: 'Slow down quick layers', es: 'Frenar en capas rápidas' },
    help: {
      en: 'Prints quick layers more slowly so they last at least the minimum layer time.',
      es: 'Imprime más despacio las capas rápidas para que duren al menos el tiempo mínimo por capa.',
    },
    keywords: ['slow printing down for better layer cooling', 'slow down for layer cooling', 'small parts', 'piezas pequeñas'],
  },
  {
    key: 'slow_down_min_speed',
    section: 'fan',
    kind: 'number',
    basic: false,
    unit: 'mm/s',
    min: 0,
    max: 100,
    step: 1,
    label: { en: 'Slowest speed when cooling', es: 'Velocidad mínima al frenar' },
    help: {
      en: 'Slowing down for cooling never goes below this speed.',
      es: 'Al frenar para enfriar, nunca se baja de esta velocidad.',
    },
    keywords: ['min print speed', 'slow down min speed', 'velocidad mínima'],
  },
  {
    key: 'enable_overhang_bridge_fan',
    section: 'fan',
    kind: 'toggle',
    basic: false,
    label: { en: 'More fan on overhangs', es: 'Más ventilador en voladizos' },
    help: {
      en: 'Uses a separate fan speed for overhangs and bridges.',
      es: 'Usa otra velocidad del ventilador para los voladizos y los puentes.',
    },
    keywords: ['force cooling for overhangs and bridges', 'overhang fan', 'bridge fan', 'puentes'],
  },
  {
    key: 'overhang_fan_speed',
    section: 'fan',
    kind: 'number',
    basic: false,
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    label: { en: 'Overhang fan speed', es: 'Ventilador en voladizos' },
    help: {
      en: 'Fan speed for overhangs and bridges, which droop less with more cooling.',
      es: 'Velocidad del ventilador en voladizos y puentes, que se caen menos con más aire.',
    },
    keywords: ['overhangs and external bridges fan speed', 'overhang fan speed', 'bridge fan', 'puentes'],
  },
  {
    key: 'overhang_fan_threshold',
    section: 'fan',
    kind: 'select',
    basic: false,
    options: [
      { value: '0%', label: { en: 'Every outer wall', es: 'Todas las paredes exteriores' } },
      { value: '10%', label: { en: '10% in the air', es: '10 % al aire' } },
      { value: '25%', label: { en: '25% in the air', es: '25 % al aire' } },
      { value: '50%', label: { en: '50% in the air', es: '50 % al aire' } },
      { value: '75%', label: { en: '75% in the air', es: '75 % al aire' } },
      { value: '95%', label: { en: 'Bridges only', es: 'Solo puentes' } },
    ],
    label: { en: 'Overhang fan starts at', es: 'Ventilador de voladizos desde' },
    help: {
      en: 'How much of a line must hang in the air before it gets the overhang fan speed.',
      es: 'Qué parte de una línea tiene que quedar al aire para que use el ventilador de voladizos.',
    },
    keywords: ['overhang cooling activation threshold', 'overhang fan threshold', 'voladizo'],
  },
  {
    key: 'additional_cooling_fan_speed',
    section: 'fan',
    kind: 'number',
    basic: false,
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    label: { en: 'Auxiliary fan speed', es: 'Ventilador auxiliar' },
    help: {
      en: 'Speed of the printer’s extra cooling fan; it stays off during the first layers without fan.',
      es: 'Velocidad del ventilador de refrigeración adicional de la impresora; se queda apagado en las capas iniciales sin ventilador.',
    },
    keywords: ['auxiliary part cooling fan', 'additional cooling fan speed', 'aux fan', 'ventilador auxiliar'],
  },

  // ─── Flow and speed ─────────────────────────────────────────────────────────
  {
    key: 'filament_flow_ratio',
    section: 'flow',
    kind: 'number',
    basic: true,
    min: 0.5,
    max: 1.5,
    step: 0.01,
    label: { en: 'Flow ratio', es: 'Factor de caudal' },
    help: {
      en: 'Scales how much plastic comes out; lower it a little if top surfaces look overfilled.',
      es: 'Ajusta cuánto plástico sale; bájalo un poco si las caras de arriba salen con exceso de material.',
    },
    keywords: ['flow ratio', 'extrusion multiplier', 'flow rate', 'flujo', 'multiplicador de extrusión'],
  },
  {
    key: 'filament_max_volumetric_speed',
    section: 'flow',
    kind: 'number',
    basic: true,
    unit: 'mm³/s',
    min: 0.5,
    max: 60,
    step: 0.5,
    label: { en: 'Maximum flow', es: 'Caudal máximo' },
    help: {
      en: 'The most plastic the nozzle can melt per second; print speeds are capped to stay under it.',
      es: 'El máximo de plástico que la boquilla puede fundir por segundo; las velocidades se limitan para no pasarlo.',
    },
    keywords: ['max volumetric speed', 'volumetric flow', 'max flow', 'caudal volumétrico'],
  },
  {
    key: 'enable_pressure_advance',
    section: 'flow',
    kind: 'toggle',
    basic: false,
    label: { en: 'Pressure advance', es: 'Avance de presión' },
    help: {
      en: 'Sends this filament’s pressure advance to the printer, for sharper corners and more even lines.',
      es: 'Envía a la impresora el avance de presión de este filamento, para esquinas más nítidas y líneas más uniformes.',
    },
    keywords: ['enable pressure advance', 'linear advance', 'pa', 'avance lineal'],
  },
  {
    key: 'pressure_advance',
    section: 'flow',
    kind: 'number',
    basic: false,
    min: 0,
    max: 1,
    step: 0.001,
    label: { en: 'Pressure advance value', es: 'Valor del avance de presión' },
    help: {
      en: 'How far ahead the extruder pushes before speed changes; find it with a calibration print.',
      es: 'Cuánto se adelanta el extrusor a los cambios de velocidad; se ajusta con una impresión de calibración.',
    },
    keywords: ['pressure advance', 'linear advance', 'k factor', 'pa', 'avance lineal'],
  },

  // ─── Filament retraction (overrides of the printer's values) ────────────────
  {
    key: 'filament_retraction_length',
    section: 'retraction',
    kind: 'number',
    basic: true,
    nullable: true,
    unit: 'mm',
    min: 0,
    max: 10,
    step: 0.05,
    label: { en: 'Length', es: 'Longitud' },
    help: {
      en: 'How far this filament is pulled back before a travel move; leave it empty to use the printer’s value.',
      es: 'Cuánto se recoge este filamento antes de un desplazamiento; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['retraction length', 'retract', 'stringing', 'retracción', 'hilos'],
  },
  {
    key: 'filament_retraction_speed',
    section: 'retraction',
    kind: 'number',
    basic: true,
    nullable: true,
    unit: 'mm/s',
    min: 1,
    max: 200,
    step: 1,
    label: { en: 'Speed', es: 'Velocidad' },
    help: {
      en: 'How fast this filament is pulled back; leave it empty to use the printer’s value.',
      es: 'Con qué rapidez se recoge este filamento; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['retraction speed', 'velocidad de retracción'],
  },
  {
    key: 'filament_z_hop',
    section: 'retraction',
    kind: 'number',
    basic: true,
    nullable: true,
    unit: 'mm',
    min: 0,
    max: 5,
    step: 0.05,
    label: { en: 'Z hop', es: 'Elevación en Z' },
    help: {
      en: 'How much the nozzle lifts on travel moves with this filament; leave it empty to use the printer’s value.',
      es: 'Cuánto sube la boquilla en los desplazamientos con este filamento; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['z-hop height', 'z hop', 'lift z', 'salto en z'],
  },
  {
    key: 'filament_deretraction_speed',
    section: 'retraction',
    kind: 'number',
    basic: false,
    nullable: true,
    unit: 'mm/s',
    min: 0,
    max: 200,
    step: 1,
    label: { en: 'Return speed', es: 'Velocidad de vuelta' },
    help: {
      en: 'How fast the filament is pushed back after a retraction, 0 meaning the retraction speed; leave it empty to use the printer’s value.',
      es: 'Con qué rapidez vuelve el filamento tras la retracción, y 0 es la misma velocidad; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['de-retraction speed', 'deretraction speed', 'unretract'],
  },
  {
    key: 'filament_z_hop_types',
    section: 'retraction',
    kind: 'select',
    basic: false,
    nullable: true,
    options: [
      { value: 'Auto Lift', label: { en: 'Auto', es: 'Automático' } },
      { value: 'Normal Lift', label: { en: 'Straight up', es: 'En vertical' } },
      { value: 'Slope Lift', label: { en: 'Slope', es: 'En rampa' } },
      { value: 'Spiral Lift', label: { en: 'Spiral', es: 'En espiral' } },
    ],
    label: { en: 'Z hop type', es: 'Tipo de elevación en Z' },
    help: {
      en: 'How the nozzle lifts with this filament; leave it empty to use the printer’s value.',
      es: 'Cómo sube la boquilla con este filamento; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['z-hop type', 'spiral lift', 'slope lift'],
  },
  {
    key: 'filament_retraction_minimum_travel',
    section: 'retraction',
    kind: 'number',
    basic: false,
    nullable: true,
    unit: 'mm',
    min: 0,
    max: 20,
    step: 0.5,
    label: { en: 'Minimum travel', es: 'Recorrido mínimo' },
    help: {
      en: 'Travel moves shorter than this do not retract; leave it empty to use the printer’s value.',
      es: 'Los desplazamientos más cortos que esto no retraen; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['travel distance threshold', 'retraction minimum travel'],
  },
  {
    key: 'filament_retract_when_changing_layer',
    section: 'retraction',
    kind: 'toggle',
    basic: false,
    nullable: true,
    label: { en: 'Retract on layer change', es: 'Retraer al cambiar de capa' },
    help: {
      en: 'Always retracts before moving up to the next layer; leave it empty to use the printer’s value.',
      es: 'Retrae siempre antes de subir a la siguiente capa; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['retract when change layer', 'retract on layer change', 'cambio de capa'],
  },
  {
    key: 'filament_wipe',
    section: 'retraction',
    kind: 'toggle',
    basic: false,
    nullable: true,
    label: { en: 'Wipe when retracting', es: 'Limpiar al retraer' },
    help: {
      en: 'Moves the nozzle along the last line while retracting to clean off drips; leave it empty to use the printer’s value.',
      es: 'Mueve la boquilla sobre la última línea al retraer para limpiar las gotas; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['wipe while retracting', 'wipe', 'limpieza'],
  },
  {
    key: 'filament_wipe_distance',
    section: 'retraction',
    kind: 'number',
    basic: false,
    nullable: true,
    unit: 'mm',
    min: 0,
    max: 10,
    step: 0.1,
    label: { en: 'Wipe distance', es: 'Distancia de limpieza' },
    help: {
      en: 'How far the nozzle moves when it wipes; leave it empty to use the printer’s value.',
      es: 'Cuánto se mueve la boquilla al limpiar; déjalo vacío para usar el valor de la impresora.',
    },
    keywords: ['wipe distance', 'limpieza'],
  },

  // ─── Toolchange ─────────────────────────────────────────────────────────────
  {
    key: 'filament_multitool_ramming',
    section: 'toolchange',
    kind: 'toggle',
    basic: true,
    label: { en: 'Push out before parking', es: 'Expulsar antes de aparcar' },
    help: {
      en: 'Quickly pushes out a little filament on the prime tower just before the toolhead is parked; needs the prime tower.',
      es: 'Expulsa rápido un poco de filamento en la torre de cebado justo antes de aparcar el cabezal; necesita la torre de cebado.',
    },
    keywords: ['enable ramming for multi-tool setups', 'multitool ramming', 'ramming', 'tool change'],
  },
  {
    key: 'filament_multitool_ramming_volume',
    section: 'toolchange',
    kind: 'number',
    basic: true,
    unit: 'mm³',
    min: 0,
    max: 100,
    step: 1,
    label: { en: 'Amount pushed out', es: 'Cantidad expulsada' },
    help: {
      en: 'How much filament is pushed out before the toolhead is parked.',
      es: 'Cuánto filamento se expulsa antes de aparcar el cabezal.',
    },
    keywords: ['multi-tool ramming volume', 'ramming volume', 'ramming'],
  },
  {
    key: 'filament_multitool_ramming_flow',
    section: 'toolchange',
    kind: 'number',
    basic: false,
    unit: 'mm³/s',
    min: 0,
    max: 60,
    step: 1,
    label: { en: 'Push-out flow', es: 'Caudal de la expulsión' },
    help: {
      en: 'How fast that filament is pushed out.',
      es: 'Con qué caudal se expulsa ese filamento.',
    },
    keywords: ['multi-tool ramming flow', 'ramming flow', 'ramming'],
  },
  {
    key: 'filament_minimal_purge_on_wipe_tower',
    section: 'toolchange',
    kind: 'number',
    basic: true,
    unit: 'mm³',
    min: 0,
    max: 100,
    step: 1,
    label: { en: 'Minimum purge on the tower', es: 'Purga mínima en la torre' },
    help: {
      en: 'Filament always purged on the prime tower after a tool change, even when the rest goes into infill or supports.',
      es: 'Filamento que siempre se purga en la torre de cebado tras un cambio, aunque el resto vaya al relleno o a los soportes.',
    },
    keywords: ['minimal purge on wipe tower', 'prime tower', 'purge', 'purga', 'torre de cebado'],
  },
];
