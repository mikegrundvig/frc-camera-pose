// The seasons' fields: WPILib's AprilTag layouts, and the field elements that block a camera's view
// where we have them.

import { add, apply, quaternionToMatrix } from './math.js';
import { tagOutlinePoints } from './robots.js';

// An AprilTag 36h11 tag's black square, 6.5 in across, as PhotonVision models it.
export const TAG_SIZE_METERS = 6.5 * 0.0254;

export const SEASONS = [
  {
    year: 2026,
    game: 'Rebuilt',
    layout: 'fields/2026-rebuilt-welded.json',
    elements: 'fields/2026-elements.json',
  },
  {
    year: 2025,
    game: 'Reefscape',
    layout: 'fields/2025-reefscape-welded.json',
    elements: 'fields/2025-elements.json',
  },
  {
    year: 2024,
    game: 'Crescendo',
    layout: 'fields/2024-crescendo.json',
    elements: 'fields/2024-elements.json',
  },
];

// A tag's four corners in the field frame, in PhotonVision's order: in the tag's own frame
// (x out of its face, y left, z up) they are (0, -s/2, -s/2), (0, s/2, -s/2), (0, s/2, s/2) and
// (0, -s/2, s/2).
function tagCorners(position, rotation) {
  const h = TAG_SIZE_METERS / 2;
  const local = [
    [0, -h, -h],
    [0, h, -h],
    [0, h, h],
    [0, -h, h],
  ];
  return local.map((c) => add(position, apply(rotation, c)));
}

// Builds a field from WPILib's layout JSON and, if there is one, the elements JSON. Both are the
// parsed files; elements may be null.
export function buildField(season, layoutJson, elementsJson) {
  const tags = layoutJson['field-tags'].map((tag) => {
    const t = tag.pose.translation;
    const q = tag.pose.rotation.quaternion;
    const rotation = quaternionToMatrix(q.W, q.X, q.Y, q.Z);
    const position = [t.x, t.y, t.z];
    const result = {
      id: tag.ID,
      position,
      rotation,
      // The way the tag's face looks: its frame's x axis.
      normal: [rotation[0][0], rotation[1][0], rotation[2][0]],
      corners: tagCorners(position, rotation),
    };
    result.outlinePoints = tagOutlinePoints(result);
    return result;
  });
  return {
    year: season.year,
    game: season.game,
    name: layoutJson.name,
    length: layoutJson['field-dimensions'].length,
    width: layoutJson['field-dimensions'].width,
    tags,
    elements: elementsJson ? elementsJson.elements : [],
    starts: elementsJson ? elementsJson.starts : [],
    places: elementsJson ? elementsJson.places : [],
  };
}

// Loads a season's field with the browser's fetch. A missing elements file means none.
export async function loadField(season) {
  const layout = await fetchJson(season.layout);
  let elements = null;
  if (season.elements) {
    try {
      elements = await fetchJson(season.elements);
    } catch {
      elements = null;
    }
  }
  return buildField(season, layout, elements);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`could not load ${path}: ${response.status}`);
  return response.json();
}
