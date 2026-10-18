// Finding a camera layout: a search for the cameras that give the field the lowest 95% position
// error, with the cameras on the robot's edges only. This file is the search itself (it runs in the
// page's workers, and in the tests); the pool that runs it is in finder-pool.js.
//
// The idea that makes it fast: one camera's view at a pose does not depend on the other cameras.
// So every camera the search could place is looked at once, over a coarse set of sample poses, and
// kept in a table; a layout is then scored by combining the table's rows, with no rays or tags in
// the loop.

import { prepareCameras, viewsAt, grid, hitsElement, headingOffset, otherRobotsAt, robotOutline } from './coverage.js';
import { viewFacesOut } from './clip.js';
import { eigen2 } from './math.js';
import { cameraView, cornerInverseVariance } from './estimate.js';
import { INSET_METERS } from './presets.js';
import { mixSeed, random } from './robots.js';

// ---- The places a camera can be ----

// The robot's edge, as places in a ring (each next to the next): the four corners and the four
// side middles. `ahead` and `left` are 1, 0 or -1 (toward the front or the left side, or midway);
// `base` is the way a camera there faces straight out, in degrees. A corner's straight out is its
// diagonal.
export const PLACES = [
  { name: 'front-left', ahead: 1, left: 1, base: 45 },
  { name: 'front', ahead: 1, left: 0, base: 0 },
  { name: 'front-right', ahead: 1, left: -1, base: -45 },
  { name: 'right', ahead: 0, left: -1, base: -90 },
  { name: 'back-right', ahead: -1, left: -1, base: -135 },
  { name: 'back', ahead: -1, left: 0, base: 180 },
  { name: 'back-left', ahead: -1, left: 1, base: 135 },
  { name: 'left', ahead: 0, left: 1, base: 90 },
];

// A place's mirror, left for right; the front and back middles are their own.
const MIRROR_PLACE = [2, 1, 0, 7, 6, 5, 4, 3];
// The places on the left side: the ones a mirrored pair is named by. The others (front and back
// middles) are on the centerline.
const LEFT_SIDE = [0, 6, 7];
const CENTERLINE = [1, 5];

// A camera turns up to 45 degrees either side of straight out, in steps of 15: for a corner that
// is from facing one edge's way to facing the other's. The index 3 is straight out.
export const YAW_STEP_DEGREES = 15;
export const YAW_STEPS = 7;
const YAW_MIDDLE = 3;

// Tilt up from level, 0 to 30 degrees in steps of 5.
export const TILT_STEP_DEGREES = 5;
export const TILT_STEPS = 7;

// Heights, in inches, a camera may be at: 6 in up, then every 4 in from 8 to the robot's height,
// and the height itself.
const HEIGHT_INCHES = [6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48];
const INCH = 0.0254;

export const MOST_CAMERAS = 6;

// The search space for a robot: its size (meters) and how high it stands. A camera is an id, from
// 0 up to `count`. With a `rule` ({ halfFovDegrees, limitMeters }: the lens's half horizontal field of
// view, and how far a view may run inside the robot) the
// cameras whose view crosses the robot (see clip.js) are not valid, and no search uses them; with none,
// every camera is valid.
export function makeSpace(robotSize, robotHeightMeters, rule = null) {
  const limit = robotHeightMeters / INCH;
  const heightsInches = HEIGHT_INCHES.filter((h) => h <= limit + 1e-9);
  if (heightsInches.length === 0 || heightsInches[heightsInches.length - 1] < limit - 1e-9) heightsInches.push(limit);
  const heights = heightsInches.map((h) => h * INCH);
  const H = heights.length;
  const count = PLACES.length * YAW_STEPS * H * TILT_STEPS;
  const encode = (place, yaw, height, tilt) => ((place * YAW_STEPS + yaw) * H + height) * TILT_STEPS + tilt;
  const decode = (id) => {
    const tilt = id % TILT_STEPS;
    const rest = (id - tilt) / TILT_STEPS;
    const height = rest % H;
    const rest2 = (rest - height) / H;
    const yaw = rest2 % YAW_STEPS;
    return { place: (rest2 - yaw) / YAW_STEPS, yaw, height, tilt };
  };
  const mountOf = (id) => {
    const c = decode(id);
    const place = PLACES[c.place];
    const yaw = place.base + (c.yaw - YAW_MIDDLE) * YAW_STEP_DEGREES;
    return {
      forward: place.ahead * (robotSize.length / 2 - INSET_METERS),
      left: place.left * (robotSize.width / 2 - INSET_METERS),
      up: heights[c.height],
      yawDegrees: ((((yaw + 180) % 360) + 360) % 360) - 180,
      tiltUpDegrees: c.tilt * TILT_STEP_DEGREES,
    };
  };
  // Whether a place and yaw face out of the robot (it does not depend on height or tilt).
  const facesOut = new Map();
  const valid = (id) => {
    if (!rule) return true;
    const c = decode(id);
    const key = c.place * YAW_STEPS + c.yaw;
    if (!facesOut.has(key)) {
      const m = mountOf(id);
      facesOut.set(key, viewFacesOut(robotSize, m, m.yawDegrees, rule.halfFovDegrees, rule.limitMeters));
    }
    return facesOut.get(key);
  };
  return {
    robotSize,
    heights,
    count,
    encode,
    decode,
    valid,
    // The camera that mirrors this one, left for right.
    mirror: (id) => {
      const c = decode(id);
      return encode(MIRROR_PLACE[c.place], YAW_STEPS - 1 - c.yaw, c.height, c.tilt);
    },
    // Where it sits and which way it points, as a camera mount in meters and degrees.
    mount: mountOf,
  };
}

// ---- Units of a layout ----

// A layout is a list of units, each a list of camera ids: one camera, or (when left and right are
// kept mirrored) a camera and its mirror. A camera on the centerline faces straight out, so that
// it is its own mirror.

// Every unit the search can place, each as a list of ids.
export function allUnits(space, mirrored) {
  const units = [];
  for (let id = 0; id < space.count; id++) {
    if (!space.valid(id)) continue;
    const c = space.decode(id);
    if (!mirrored) {
      units.push([id]);
    } else if (LEFT_SIDE.includes(c.place)) {
      units.push([id, space.mirror(id)]);
    } else if (CENTERLINE.includes(c.place) && c.yaw === YAW_MIDDLE) {
      units.push([id]);
    }
  }
  return units;
}

// A unit's ids for the camera that names it (the left one of a pair).
function unitOf(space, mirrored, id) {
  const c = space.decode(id);
  return mirrored && LEFT_SIDE.includes(c.place) ? [id, space.mirror(id)] : [id];
}

// Whether the camera `id` can name a unit of the size asked for (a pair, or one camera) in a layout
// of this kind.
function validUnit(space, mirrored, id, pair) {
  if (!mirrored) return true;
  const c = space.decode(id);
  return pair ? LEFT_SIDE.includes(c.place) : CENTERLINE.includes(c.place) && c.yaw === YAW_MIDDLE;
}

// The units one step from a unit: its camera to the next place round the edge, or turned, raised,
// lowered, tilted a step either way. Those that are not a unit of this kind of layout are left out.
export function neighbors(space, mirrored, unit) {
  const id = unit[0];
  const c = space.decode(id);
  const next = [];
  const H = space.heights.length;
  const centerline = mirrored && CENTERLINE.includes(c.place);
  const moves = [];
  for (const step of [-1, 1]) {
    // On the centerline, a mirrored camera can only go to the other centerline place.
    const place = centerline ? (c.place === 1 ? 5 : 1) : (c.place + step + PLACES.length) % PLACES.length;
    moves.push({ ...c, place });
    if (!centerline) moves.push({ ...c, yaw: c.yaw + step });
    moves.push({ ...c, height: c.height + step });
    moves.push({ ...c, tilt: c.tilt + step });
  }
  for (const m of moves) {
    if (m.yaw < 0 || m.yaw >= YAW_STEPS || m.height < 0 || m.height >= H || m.tilt < 0 || m.tilt >= TILT_STEPS) continue;
    const moved = space.encode(m.place, m.yaw, m.height, m.tilt);
    if (moved === id || !space.valid(moved) || !validUnit(space, mirrored, moved, unit.length === 2)) continue;
    const u = unitOf(space, mirrored, moved);
    if (!next.some((v) => v[0] === u[0])) next.push(u);
  }
  return next;
}

// ---- Sample poses ----

// Where the search looks, coarser than the page's maps: a grid `spacing` meters apart, `headings`
// headings at each (where the robot fits), and, with other robots on, `arrangements` of them for
// each. `scoring` is the scoring state (see state.js).
export function buildSamples(field, scoring, plan) {
  const g = grid(field, scoring.robotSize, plan.spacing);
  const samples = [];
  const withRobots = scoring.otherRobots && scoring.otherRobots.count > 0 && plan.arrangements > 0;
  for (const cell of g.cells) {
    const offset = headingOffset(cell.column, cell.row);
    for (let h = 0; h < plan.headings; h++) {
      const pose = { x: cell.x, y: cell.y, heading: (2 * Math.PI * (h + offset)) / plan.headings };
      if (field.elements.length > 0 && hitsElement(field, robotOutline(pose, scoring.robotSize))) continue;
      if (!withRobots) {
        samples.push({ pose, robots: [] });
        continue;
      }
      for (let a = 0; a < plan.arrangements; a++) {
        const robots = otherRobotsAt(field, pose, scoring, mixSeed(scoring.seed, cell.column, cell.row, h, a));
        samples.push({ pose, robots });
      }
    }
  }
  return samples;
}

// ---- The table of camera views ----

// Numbers kept for one camera at one sample: its weight (0 when it measures nothing) and the
// parts of its covariance and its lever, as the estimate combines them.
export const RECORD = 6;

// One camera's views at every sample, as a Float32Array of `RECORD` numbers a sample.
export function cameraRecords(field, scoring, lens, mount, samples) {
  const camera = prepareCameras([{ name: 'camera', sensor: lens, mount }]);
  const out = new Float32Array(samples.length * RECORD);
  const blockers = { elements: scoring.useElements && field.elements.length > 0 };
  const inverseVariance = cornerInverseVariance(
    scoring.settings.cornerNoisePixels,
    scoring.settings.cornerNoisePixels * scoring.settings.cornerSpreadRatio,
  );
  samples.forEach((sample, s) => {
    const [look] = viewsAt(field, camera, sample.pose, scoring.settings, { ...blockers, robots: sample.robots });
    const v = look.view;
    if (!v.ok) return;
    const o = s * RECORD;
    out[o] = v.weight;
    out[o + 1] = v.axx;
    out[o + 2] = v.axy;
    out[o + 3] = v.ayy;
    out[o + 4] = v.lx;
    out[o + 5] = v.ly;
  });
  return out;
}

// Records for the cameras from `from` up to `to`, one after the other.
export function tableSlice(field, scoring, lens, space, samples, from, to) {
  const size = samples.length * RECORD;
  const data = new Float32Array((to - from) * size);
  for (let id = from; id < to; id++) {
    // A camera the search cannot use (its view crosses the robot) is left as zeros.
    if (!space.valid(id)) continue;
    data.set(cameraRecords(field, scoring, lens, space.mount(id), samples), (id - from) * size);
  }
  return data;
}

// ---- Scoring a layout from the table ----

// How many angles the search's quick 95% error averages over, and how many halvings it takes: the
// page's own figure (estimate.js) uses 16 and 50, and the final numbers are worked out with it.
const QUICK_ANGLES = 4;
const QUICK_STEPS = 18;

// A scorer for layouts over a table: `data` has the records of every camera in turn, `samples`
// rows each. Gives { error, measured, rank } for a list of camera ids: the 95% error in meters
// (Infinity when under 95% of the poses are measured), the share of poses with a measurement, and
// a rank to compare by (lower is better; layouts with an error come before those without, which go
// by the share measured).
export function makeScorer(data, samples, gyroSigmaRadians) {
  const g = gyroSigmaRadians * gyroSigmaRadians;
  const half = new Float64Array(samples * QUICK_ANGLES);
  const cache = new Map();
  const angles = [];
  for (let k = 0; k < QUICK_ANGLES; k++) {
    const phi = ((k + 0.5) * (Math.PI / 2)) / QUICK_ANGLES;
    angles.push([Math.cos(phi) ** 2, Math.sin(phi) ** 2]);
  }
  const stride = samples * RECORD;
  function score(ids) {
    const key = ids.slice().sort((a, b) => a - b).join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    let measured = 0;
    for (let s = 0; s < samples; s++) {
      let w = 0;
      for (const id of ids) w += data[id * stride + s * RECORD];
      if (!(w > 0)) {
        for (let k = 0; k < QUICK_ANGLES; k++) half[s * QUICK_ANGLES + k] = NaN;
        continue;
      }
      measured++;
      let xx = 0;
      let xy = 0;
      let yy = 0;
      let lx = 0;
      let ly = 0;
      for (const id of ids) {
        const o = id * stride + s * RECORD;
        const b = data[o] / w;
        xx += b * b * data[o + 1];
        xy += b * b * data[o + 2];
        yy += b * b * data[o + 3];
        lx += b * data[o + 4];
        ly += b * data[o + 5];
      }
      xx += g * ly * ly;
      xy -= g * lx * ly;
      yy += g * lx * lx;
      const [l1, l2] = eigen2(xx, xy, yy);
      for (let k = 0; k < QUICK_ANGLES; k++) {
        const q = l1 * angles[k][0] + l2 * angles[k][1];
        half[s * QUICK_ANGLES + k] = q > 0 ? 1 / (2 * q) : Infinity;
      }
    }
    const share = (r) => {
      let sum = 0;
      for (let j = 0; j < half.length; j++) {
        const h = half[j];
        if (h === h) sum += h === Infinity ? 1 : 1 - Math.exp(-r * r * h);
      }
      return sum / half.length;
    };
    let error = Infinity;
    if (share(10) >= 0.95) {
      let lo = 1e-5;
      let hi = 10;
      for (let i = 0; i < QUICK_STEPS; i++) {
        const mid = Math.sqrt(lo * hi);
        if (share(mid) >= 0.95) hi = mid;
        else lo = mid;
      }
      error = hi;
    }
    const share0 = measured / samples;
    const result = { error, measured: share0, rank: error === Infinity ? 100 + (1 - share0) : error };
    cache.set(key, result);
    return result;
  }
  return score;
}

// ---- The search ----

// Layouts are compared by rank; a change must gain this much to count, so a search cannot circle
// on rounding.
export const MIN_GAIN = 1e-6;

const flat = (units) => units.flat();

// A scorer that refuses layouts with two cameras at one place (a pair counts at its two places): it
// ranks them last, so no search step keeps one.
export function onePerPlace(space, score) {
  const clash = { error: Infinity, measured: 0, rank: 1000 };
  return (ids) => {
    const places = new Set(ids.map((id) => space.decode(id).place));
    return places.size < ids.length ? clash : score(ids);
  };
}

// The best layout of each camera count from 1 to `most`, built one unit at a time: for a count, the
// best of the best layout one camera fewer with one more camera, and the best two fewer with a
// mirrored pair added. Gives an array by count (index 0 is unused), each { units, score }.
export function greedy(space, mirrored, score, most = MOST_CAMERAS) {
  const units = allUnits(space, mirrored);
  const singles = units.filter((u) => u.length === 1);
  const pairs = units.filter((u) => u.length === 2);
  const best = [{ units: [], score: null }];
  for (let k = 1; k <= most; k++) {
    let winner = null;
    const tryAdding = (base, added) => {
      if (!base) return;
      for (const u of added) {
        const ids = flat(base.units).concat(u);
        if (new Set(ids).size < ids.length) continue;
        const s = score(ids);
        if (!winner || s.rank < winner.score.rank) winner = { units: base.units.concat([u]), score: s };
      }
    };
    tryAdding(best[k - 1], singles);
    if (k >= 2) tryAdding(best[k - 2], pairs);
    best.push(winner);
  }
  return best;
}

// A layout improved by moving one unit a step at a time, keeping each move that helps, until none
// does (or `passes` sweeps have been made).
export function improve(space, mirrored, score, units, passes = 12) {
  let current = units.map((u) => u.slice());
  let best = score(flat(current));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let i = 0; i < current.length; i++) {
      for (const moved of neighbors(space, mirrored, current[i])) {
        const trial = current.slice();
        trial[i] = moved;
        const ids = flat(trial);
        if (new Set(ids).size < ids.length) continue;
        const s = score(ids);
        if (s.rank < best.rank - MIN_GAIN) {
          current = trial;
          best = s;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return { units: current, score: best };
}

// A layout of `count` cameras chosen at random: with mirroring, a mix of pairs and (if the count
// is odd, or sometimes anyway) centerline cameras; with `distinctPlaces`, none at a place twice.
export function randomLayout(space, mirrored, count, next, distinctPlaces = false) {
  const H = space.heights.length;
  const pick = (n) => Math.floor(next() * n);
  // A try can come to a dead end (every centerline place taken with one camera still to place): then
  // start over.
  let units = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    units = [];
    let ids = [];
    const add = (id) => {
      if (!space.valid(id)) return false;
      const u = unitOf(space, mirrored, id);
      if (u.some((x) => ids.includes(x))) return false;
      // With one camera to a place, no place already used.
      if (distinctPlaces && u.some((x) => ids.some((y) => space.decode(x).place === space.decode(y).place))) return false;
      units.push(u);
      ids = ids.concat(u);
      return true;
    };
    let guard = 0;
    while (ids.length < count && guard++ < 200) {
      const remaining = count - ids.length;
      if (mirrored) {
        const pair = remaining >= 2 && next() < 0.7;
        const place = pair ? LEFT_SIDE[pick(LEFT_SIDE.length)] : CENTERLINE[pick(CENTERLINE.length)];
        const yaw = pair ? pick(YAW_STEPS) : YAW_MIDDLE;
        add(space.encode(place, yaw, pick(H), pick(TILT_STEPS)));
      } else {
        add(space.encode(pick(PLACES.length), pick(YAW_STEPS), pick(H), pick(TILT_STEPS)));
      }
    }
    if (ids.length === count) break;
  }
  return units;
}

// One random restart: a random layout of `count` cameras, improved.
export function restart(space, mirrored, score, count, seed, passes = 12, distinctPlaces = false) {
  const next = random(seed);
  return improve(space, mirrored, score, randomLayout(space, mirrored, count, next, distinctPlaces), passes);
}

// The whole search in one place, for the tests and small jobs: for each count, the greedy layout
// improved and `restarts` random starts improved, the best kept. Gives an array by count.
export function searchAll(space, mirrored, score, restarts, seed = 1, most = MOST_CAMERAS, distinctPlaces = false) {
  if (distinctPlaces) score = onePerPlace(space, score);
  const start = greedy(space, mirrored, score, most);
  const results = [null];
  for (let k = 1; k <= most; k++) {
    let best = start[k] && improve(space, mirrored, score, start[k].units);
    for (let r = 0; r < restarts; r++) {
      const trial = restart(space, mirrored, score, k, mixSeed(seed, k, r), 12, distinctPlaces);
      if (!best || trial.score.rank < best.score.rank) best = trial;
    }
    results.push(best);
  }
  return results;
}

// ---- Describing a layout ----

// A layout's cameras as the page keeps them: a name each and the mount in meters and degrees.
export function layoutMounts(space, ids) {
  return ids.map((id) => ({ name: PLACES[space.decode(id).place].name, ...space.mount(id) }));
}

// The error of a layout counted fairly: how many cameras it takes to be within a tolerance of the
// best. Gives the fewest cameras whose error is within `tolerance` meters of the best error among
// `errors` (an array by count; index 0 unused).
export function fewestWithin(errors, tolerance = 0.001) {
  let best = Infinity;
  for (let k = 1; k < errors.length; k++) best = Math.min(best, errors[k]);
  for (let k = 1; k < errors.length; k++) if (errors[k] <= best + tolerance) return k;
  return 0;
}

