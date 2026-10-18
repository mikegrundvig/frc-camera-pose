// Scoring a camera layout over the whole field: what every camera sees at every pose on a grid,
// at several headings (and, with other robots on, several arrangements of them), summed up into
// the maps and the field's numbers.

import { cameraPose, intrinsics } from './camera.js';
import { DEG } from './math.js';
import { cameraView, combine, cornerInverseVariance, within95 } from './estimate.js';
import { lookAtTags } from './visibility.js';
import {
  box,
  boxCorners,
  mixSeed,
  outlinesOverlap,
  placeRobots,
  random,
  reachMeters,
} from './robots.js';

// The grid's spacing and the headings at each position, as the study's defaults.
export const GRID_METERS = 0.5;
export const HEADINGS = 8;
// With other robots on, how many arrangements of them each pose averages over: 4 keeps a field of
// eight cameras and five robots to a couple of seconds.
export const ARRANGEMENTS = 4;
// Where each position's offset in heading comes from: fixed, so the clear-field map never moves.
const HEADING_SEED = 1;
// Blocks reaching lower than this stand in a robot's way: a bumper's top is about this high.
export const FLOOR_BLOCK_BELOW_METERS = 0.15;

// The camera models the scoring needs: each camera's lens model and mount, in meters and degrees.
export function prepareCameras(cameras) {
  return cameras.map((c) => ({
    name: c.name,
    intrinsics: intrinsics(c.sensor),
    mount: c.mount,
  }));
}

// What every camera makes of one pose: its look at the tags and its contribution to the estimate.
export function viewsAt(field, cameras, pose, settings, blockers) {
  const inverseVariance = cornerInverseVariance(
    settings.cornerNoisePixels,
    settings.cornerNoisePixels * settings.cornerSpreadRatio,
  );
  return cameras.map((camera) => {
    const placed = cameraPose(pose, camera.mount);
    const located = { ...placed, intrinsics: camera.intrinsics };
    const results = lookAtTags(field, located, settings, blockers);
    const view = cameraView(located, results, pose, inverseVariance, settings.maxDistanceMeters);
    return { located, results, view };
  });
}

// One sample's outcome for some of the cameras (their indices): how many cameras see a tag, the
// most tags one camera sees, and the estimate's eigenvalues (null for no measurement).
export function outcome(views, which, gyroSigma) {
  let seeing = 0;
  let most = 0;
  const chosen = [];
  for (const i of which) {
    const v = views[i];
    chosen.push(v);
    seeing += v.tags > 0 ? 1 : 0;
    most = Math.max(most, v.tags);
  }
  return { seeing, most, eigenvalues: combine(chosen, gyroSigma) };
}

// The share of samples for each coverage measure, and the error 95% of them are within.
export function summarize(outcomes) {
  const n = outcomes.length || 1;
  let oneTag = 0;
  let twoTags = 0;
  let twoCameras = 0;
  let measured = 0;
  for (const o of outcomes) {
    oneTag += o.seeing >= 1 ? 1 : 0;
    twoTags += o.most >= 2 ? 1 : 0;
    twoCameras += o.seeing >= 2 ? 1 : 0;
    measured += o.eigenvalues ? 1 : 0;
  }
  return {
    oneTag: oneTag / n,
    twoTags: twoTags / n,
    twoCameras: twoCameras / n,
    measured: measured / n,
    within95: within95(outcomes.map((o) => o.eigenvalues)),
  };
}

// The field's blocks that stand in a robot's way: the ones reaching down to the floor, as opposed
// to a bar to drive under.
export function floorBlocks(field) {
  const blocks = [];
  for (const element of field.elements) {
    for (const block of element.blocks) {
      if (block.bottomMeters < FLOOR_BLOCK_BELOW_METERS) blocks.push(block);
    }
  }
  return blocks;
}

// Whether a robot's outline (corners) runs into a field element standing on the floor.
export function hitsElement(field, outline) {
  return floorBlocks(field).some((block) => outlinesOverlap(outline, block.outline));
}

// The names of the field elements a robot's outline runs into, each once.
export function elementsHit(field, outline) {
  const names = [];
  for (const element of field.elements) {
    const hit = element.blocks.some(
      (block) => block.bottomMeters < FLOOR_BLOCK_BELOW_METERS && outlinesOverlap(outline, block.outline),
    );
    if (hit && !names.includes(element.name)) names.push(element.name);
  }
  return names;
}

// What one heading of a grid point came to, kept for every heading of every cell (see
// `scoreField`): measured, no room for the robot at this heading, no tag in view, or tags seen
// only too far away on average, which the robot ignores.
export const HEADING_MEASURED = 0;
export const HEADING_NO_ROOM = 1;
export const HEADING_NO_TAGS = 2;
export const HEADING_TOO_FAR = 3;

// A cell's headings start at their own fraction of the step, so they don't all line up with the
// walls and with cameras splayed 45 degrees (as the study does). The offset is that fraction, and
// `headingAt` is heading number `h` of the cell, in radians.
export function headingOffset(column, row) {
  return random(mixSeed(HEADING_SEED, column, row))();
}

export function headingAt(offset, h) {
  return (2 * Math.PI * (h + offset)) / HEADINGS;
}

// Which of a point's headings the robot's outline fits at: no element in the way.
export function fittingHeadings(field, robotSize, x, y, offset) {
  const fits = [];
  for (let h = 0; h < HEADINGS; h++) {
    const outline = robotOutline({ x, y, heading: headingAt(offset, h) }, robotSize);
    fits.push(field.elements.length === 0 || !hitsElement(field, outline));
  }
  return fits;
}

// How a heading's samples (one per arrangement of other robots) came to be: measured when most
// are, else why not.
function headingCode(outcomes) {
  const measured = outcomes.filter((o) => o.eigenvalues).length;
  if (measured * 2 > outcomes.length) return HEADING_MEASURED;
  const tooFar = outcomes.filter((o) => !o.eigenvalues && o.seeing > 0).length;
  return tooFar * 2 > outcomes.length - measured ? HEADING_TOO_FAR : HEADING_NO_TAGS;
}

// The robot's outline at a pose.
export function robotOutline(pose, robotSize) {
  return boxCorners(box(pose.x, pose.y, pose.heading, robotSize.length / 2, robotSize.width / 2, 0));
}

// The other robots for one arrangement at one pose, drawn from a seed: `count` of them (fewer if
// there's no room), kept off the field's elements.
export function otherRobotsAt(field, pose, state, seed) {
  if (!state.otherRobots || state.otherRobots.count <= 0) return [];
  const next = random(seed);
  const reach = reachMeters(state.settings.sightMeters, state.robotSize);
  return placeRobots(
    pose,
    field,
    state.robotSize,
    state.otherRobots.heightMeters,
    state.otherRobots.count,
    reach,
    next,
    (outline) => hitsElement(field, outline),
  );
}

// The grid: positions kept half the robot's longer side off the walls, each cell a little under
// 0.5 m (or the spacing asked for) so the grid fits the field evenly, as the study's FieldGrid lays
// it out.
export function grid(field, robotSize, spacing = GRID_METERS) {
  const margin = Math.max(robotSize.length, robotSize.width) / 2;
  const spanX = field.length - 2 * margin;
  const spanY = field.width - 2 * margin;
  const columns = Math.ceil(spanX / spacing - 1e-9);
  const rows = Math.ceil(spanY / spacing - 1e-9);
  const stepX = spanX / columns;
  const stepY = spanY / rows;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cells.push({
        column,
        row,
        x: margin + (column + 0.5) * stepX,
        y: margin + (row + 0.5) * stepY,
      });
    }
  }
  return { columns, rows, margin, stepX, stepY, cells };
}

// Scores the layout over the field. `state` is the page's state (see state.js); the result has a
// value per cell for each map (null for a cell with no room at any heading), what each heading
// came to, the field's numbers, and the same with any one camera lost.
// `progress` is told the share done now and then.
export function scoreField(field, state, progress = () => {}) {
  const cameras = prepareCameras(state.cameras);
  const g = grid(field, state.robotSize);
  const gyroSigma = state.settings.gyroErrorDegrees * DEG;
  const blockers = { elements: state.useElements && field.elements.length > 0 };
  const arrangements = state.otherRobots && state.otherRobots.count > 0 ? ARRANGEMENTS : 1;
  const everyCamera = cameras.map((_, i) => i);
  // Leaving out each camera in turn: the views are shared, only the combination differs.
  const lessOne = cameras.length > 1 ? cameras.map((_, lost) => everyCamera.filter((i) => i !== lost)) : [];
  const all = [];
  const allLessOne = lessOne.map(() => []);
  const cellValues = [];
  // What each heading of each cell came to, as the HEADING_ codes, cell by cell.
  const headings = new Uint8Array(g.cells.length * HEADINGS);
  g.cells.forEach((cell, index) => {
    const offset = headingOffset(cell.column, cell.row);
    const fits = fittingHeadings(field, state.robotSize, cell.x, cell.y, offset);
    const outcomes = [];
    for (let h = 0; h < HEADINGS; h++) {
      // A heading where the robot would overlap an element is not scored: it is left out of the
      // cell's samples, not counted as unmeasured.
      if (!fits[h]) {
        headings[index * HEADINGS + h] = HEADING_NO_ROOM;
        continue;
      }
      const pose = { x: cell.x, y: cell.y, heading: headingAt(offset, h) };
      const here = [];
      for (let a = 0; a < arrangements; a++) {
        const robots = otherRobotsAt(field, pose, state, mixSeed(state.seed, cell.column, cell.row, h, a));
        const views = viewsAt(field, cameras, pose, state.settings, { ...blockers, robots }).map((c) => c.view);
        const o = outcome(views, everyCamera, gyroSigma);
        outcomes.push(o);
        here.push(o);
        all.push(o);
        lessOne.forEach((which, k) => allLessOne[k].push(outcome(views, which, gyroSigma)));
      }
      headings[index * HEADINGS + h] = headingCode(here);
    }
    // A cell is no place for the robot only when it fits at none of the headings.
    cellValues.push(outcomes.length === 0 ? null : cellSummary(outcomes));
    if (index % 20 === 0) progress(index / g.cells.length);
  });
  const field95 = summarize(all);
  let oneLost = null;
  if (lessOne.length > 0) {
    oneLost = { within95: 0, measured: 1, oneTag: 1 };
    for (const outcomes of allLessOne) {
      const s = summarize(outcomes);
      oneLost.within95 = Math.max(oneLost.within95, s.within95);
      oneLost.measured = Math.min(oneLost.measured, s.measured);
      oneLost.oneTag = Math.min(oneLost.oneTag, s.oneTag);
    }
  }
  return { grid: g, cells: cellValues, headings, field: field95, oneLost, arrangements };
}

// One cell's values for the maps: the share of its samples with at least one tag, two tags in one
// camera, two cameras seeing a tag, and the error 95% of them are within (Infinity when more than
// 5% have no measurement).
function cellSummary(outcomes) {
  const s = summarize(outcomes);
  return {
    oneTag: s.oneTag,
    twoTags: s.twoTags,
    twoCameras: s.twoCameras,
    error: s.within95,
  };
}
