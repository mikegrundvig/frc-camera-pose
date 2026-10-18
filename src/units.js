// The units the page shows and takes: imperial (feet and inches) or metric (meters and
// centimeters). The page's model, its link and its JSON are all in meters; the conversions happen
// here, at the edge, and nowhere else. The choice is one viewer's own and is kept in this browser's
// local storage, not in the link.

export const IMPERIAL = 'imperial';
export const METRIC = 'metric';

export const INCH = 0.0254;
export const FOOT = 0.3048;

const KEY = 'units';

// A whole number of inches from meters, as feet and inches with the inches carried: 11 ft 12 in
// comes out as 12 ft 0 in. `negative` is for a value below zero (-0 in and the like are not).
export function splitFeetInches(meters) {
  const totalInches = Math.round(Math.abs(meters) / INCH);
  const feet = Math.floor(totalInches / 12);
  return { negative: meters < 0 && totalInches > 0, feet, inches: totalInches - 12 * feet };
}

// Meters as "11 ft 8 in", to the nearest inch.
export function formatFeetInches(meters) {
  const { negative, feet, inches } = splitFeetInches(meters);
  return `${negative ? '-' : ''}${feet} ft ${inches} in`;
}

// A number shown to at most `digits` decimals, without trailing zeros.
export function trimmed(value, digits) {
  return String(Number(value.toFixed(digits)));
}

// The units for a system. Each length on the page is one of three kinds:
// - long: where things are on the field and how far the cameras see (feet or meters);
// - short: sizes, mounts and heights, and the estimate's error (inches or centimeters).
// `toLong` and `toShort` turn meters into the number shown, `fromLong` and `fromShort` back.
// `errorScale` is the error the map reads as good (and as poor), round numbers in the units.
export function unitsFor(system) {
  const imperial = system !== METRIC;
  const long = imperial ? { label: 'ft', size: FOOT, step: 0.1 } : { label: 'm', size: 1, step: 0.05 };
  const short = imperial ? { label: 'in', size: INCH, step: 0.25 } : { label: 'cm', size: 0.01, step: 0.5 };
  return {
    system: imperial ? IMPERIAL : METRIC,
    longLabel: long.label,
    shortLabel: short.label,
    longStep: long.step,
    shortStep: short.step,
    toLong: (meters) => meters / long.size,
    fromLong: (value) => value * long.size,
    toShort: (meters) => meters / short.size,
    fromShort: (value) => value * short.size,
    // A distance or a place on the field: "12 ft 4 in" or "3.76 m".
    distance: (meters) => (imperial ? formatFeetInches(meters) : `${meters.toFixed(2)} m`),
    // A length for a label: "21 in" or "53.3 cm".
    length: (meters) => `${trimmed(meters / short.size, imperial ? 2 : 1)} ${short.label}`,
    // The estimate's error: "1.0 in" or "2.5 cm".
    error: (meters) => `${(meters / short.size).toFixed(1)} ${short.label}`,
    // How far apart the grid's positions are: "1.6 ft" or "0.49 m".
    grid: (meters) => (imperial ? `${(meters / FOOT).toFixed(1)} ft` : `${meters.toFixed(2)} m`),
    errorScale: imperial ? { good: 0.5 * INCH, poor: 3 * INCH } : { good: 0.01, poor: 0.08 },
    // The scale's ends as the legend reads them: "0.5 in" and "3 in", "1 cm" and "8 cm".
    scaleLabel: (meters) => `${trimmed(meters / short.size, 1)} ${short.label}`,
  };
}

// The system in saved text: anything but metric is imperial, the default.
export function unitsFromText(text) {
  return text === METRIC ? METRIC : IMPERIAL;
}

export function loadUnits() {
  try {
    return unitsFromText(localStorage.getItem(KEY));
  } catch {
    return IMPERIAL;
  }
}

export function saveUnits(system) {
  try {
    localStorage.setItem(KEY, system);
  } catch {
    // Storage may be off; the choice just isn't remembered.
  }
}
