// Best angles: with every camera's mount point kept where it is, the yaw and tilt of each that give
// the field the lowest 95% position error. It reuses the layout search's table (finder.js): one
// camera's view at a pose does not depend on the others, so every (camera, yaw, tilt) is looked at
// once over the coarse poses, and a layout of angles is scored by combining table rows.
//
// A layout here is { kept, ids }: the cameras kept (indexes into the robot's cameras; all of them
// unless the best few are asked for) and, for each, the id of the candidate (its yaw and tilt) it
// uses.

import { viewFacesOut } from './clip.js';
import { MIN_GAIN, cameraRecords } from './finder.js';
import { mixSeed, random } from './robots.js';

export const STEP_DEGREES = 5;
// A camera's tilt, when its limits say nothing, goes from level to this.
export const DEFAULT_TILT_RANGE = [0, 30];
// How far from the best an angle may be and still count as inside its slack: 1 mm of error.
export const SLACK_METERS = 0.001;

const wrap180 = (degrees) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const near = (a, b) => Math.abs(wrap180(a - b)) < 1e-6;

// A camera's yaw limits as a start and a width, both in degrees: the yaw may be from `start` turning
// left (counterclockwise) through `width` degrees; a range that wraps past 180 is fine. No limits
// (or only one end) mean any direction.
export function yawRange(limits) {
  const { yawMin, yawMax } = limits || {};
  if (typeof yawMin !== 'number' || typeof yawMax !== 'number') return { start: -180, width: 360, full: true };
  const width = (((yawMax - yawMin) % 360) + 360) % 360;
  return { start: yawMin, width, full: false };
}

// The yaws to try, in degrees, in order from the start of the range, one every `step` (and the end
// of the range if it falls between steps); a full circle takes the steps from -180 (exclusive).
export function allowedYaws(limits, step = STEP_DEGREES) {
  const range = yawRange(limits);
  const yaws = [];
  if (range.full) {
    for (let a = -180 + step; a <= 180 + 1e-9; a += step) yaws.push(a);
    return yaws;
  }
  for (let a = 0; a <= range.width + 1e-9; a += step) yaws.push(wrap180(range.start + a));
  if (range.width % step > 1e-9) yaws.push(wrap180(range.start + range.width));
  return yaws.map((y) => (y === -180 ? 180 : y));
}

// The tilts to try, in degrees: the limits (0 to 30 where one is empty), every `step`, and the ends.
export function allowedTilts(limits, step = STEP_DEGREES) {
  const low = typeof limits?.tiltMin === 'number' ? limits.tiltMin : DEFAULT_TILT_RANGE[0];
  const high = typeof limits?.tiltMax === 'number' ? limits.tiltMax : DEFAULT_TILT_RANGE[1];
  const [a, b] = low <= high ? [low, high] : [high, low];
  const tilts = [];
  for (let t = Math.ceil(a / step - 1e-9) * step; t <= b + 1e-9; t += step) tilts.push(t + 0);
  // A range between two steps: its middle.
  if (tilts.length === 0) tilts.push((a + b) / 2);
  return tilts;
}

// Whether an angle is inside the limits.
export function yawAllowed(limits, yaw) {
  const range = yawRange(limits);
  if (range.full) return true;
  const along = (((yaw - range.start) % 360) + 360) % 360;
  return along <= range.width + 1e-9;
}

export function tiltAllowed(limits, tilt) {
  const tilts = allowedTilts(limits);
  return tilt >= tilts[0] - 1e-9 && tilt <= tilts[tilts.length - 1] + 1e-9;
}

// The candidates for a robot's cameras. `cameras` are page cameras (mount in meters, `yawDegrees`,
// `tiltUpDegrees`, the lens fields and, optionally, the yaw and tilt limits). Each camera gets a list
// of yaws and of tilts, with its current angles added when they are inside its limits, and a run of
// ids: a camera's candidates are `offset + yawIndex * tilts.length + tiltIndex`. With a `rule`
// ({ size, halfFovs, limitMeters }: the robot's size, each camera's half horizontal field of view and how far a
// view may run inside the robot, default PATH_LIMIT_METERS) only the yaws
// whose view faces out of the robot (see clip.js) are candidates; a camera with none (one in the middle
// of the robot) keeps the yaw it has, and is marked `blocked`.
export function makeCandidates(cameras, steps = { yaw: STEP_DEGREES, tilt: STEP_DEGREES }, rule = null) {
  let offset = 0;
  const list = cameras.map((camera, index) => {
    const mount = { forward: camera.forwardMeters, left: camera.leftMeters };
    const facesOut = (yaw) => !rule || viewFacesOut(rule.size, mount, yaw, rule.halfFovs[index], rule.limitMeters);
    let yaws = allowedYaws(camera, steps.yaw).filter(facesOut);
    const tilts = allowedTilts(camera, steps.tilt);
    const blocked = yaws.length === 0;
    if (blocked) yaws = [wrap180(camera.yawDegrees)];
    else if (yawAllowed(camera, camera.yawDegrees) && facesOut(camera.yawDegrees) && !yaws.some((y) => near(y, camera.yawDegrees))) yaws.push(wrap180(camera.yawDegrees));
    if (tiltAllowed(camera, camera.tiltUpDegrees) && !tilts.some((t) => Math.abs(t - camera.tiltUpDegrees) < 1e-9)) tilts.push(camera.tiltUpDegrees);
    // Circular order for the yaws (so a slack interval can run round), tilts ascending.
    const range = yawRange(camera);
    const along = (y) => (((y - range.start) % 360) + 360) % 360;
    yaws.sort((a, b) => along(a) - along(b));
    tilts.sort((a, b) => a - b);
    // A circle of yaws is only whole when nothing was taken out of it.
    const full = range.full && !rule && yaws.length >= 72;
    const entry = { index, yaws, tilts, offset, count: yaws.length * tilts.length, full, blocked };
    offset += entry.count;
    return entry;
  });
  const idOf = (c, yi, ti) => list[c].offset + yi * list[c].tilts.length + ti;
  // Which camera, yaw index and tilt index an id is.
  const locate = (id) => {
    let c = list.length - 1;
    while (list[c].offset > id) c--;
    const within = id - list[c].offset;
    const ti = within % list[c].tilts.length;
    return { camera: c, yi: (within - ti) / list[c].tilts.length, ti };
  };
  // The index in a sorted list of the value nearest to `target`, by `distance`.
  const nearest = (values, target, distance) => {
    let at = 0;
    values.forEach((v, i) => {
      if (distance(v, target) < distance(values[at], target)) at = i;
    });
    return at;
  };
  return {
    cameras: list,
    count: offset,
    idOf,
    decode: locate,
    angles: (id) => {
      const { camera: c, yi, ti } = locate(id);
      return { yawDegrees: list[c].yaws[yi], tiltUpDegrees: list[c].tilts[ti] };
    },
    // The id of a camera's current angles (the closest allowed ones when they are outside its limits).
    current: (c) => {
      const camera = cameras[c];
      const yi = nearest(list[c].yaws, camera.yawDegrees, (a, b) => Math.abs(wrap180(a - b)));
      const ti = nearest(list[c].tilts, camera.tiltUpDegrees, (a, b) => Math.abs(a - b));
      return idOf(c, yi, ti);
    },
    // The camera as a mount in meters and degrees, at the angles of an id.
    mount: (id) => {
      const { camera: c, yi, ti } = locate(id);
      const cam = cameras[c];
      return { forward: cam.forwardMeters, left: cam.leftMeters, up: cam.upMeters, yawDegrees: list[c].yaws[yi], tiltUpDegrees: list[c].tilts[ti] };
    },
  };
}

// The records of the candidates from `from` to `to`, for the table: each camera's own lens.
export function candidateSlice(field, scoring, candidates, lenses, samples, from, to) {
  const stride = samples.length * 6;
  const data = new Float32Array((to - from) * stride);
  for (let id = from; id < to; id++) {
    const { camera } = candidates.decode(id);
    data.set(cameraRecords(field, scoring, lenses[camera], candidates.mount(id), samples), (id - from) * stride);
  }
  return data;
}

// ---- The search ----

const idsWith = (ids, k, id) => ids.map((x, i) => (i === k ? id : x));

// A layout improved by coordinate descent: each camera in turn takes the angles that score best with
// the others held, until a whole sweep changes nothing (or `sweeps` have been made). Gives
// { layout, score }.
export function descend(candidates, score, layout, sweeps = 30) {
  let ids = layout.ids.slice();
  let best = score(ids);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let changed = false;
    layout.kept.forEach((c, k) => {
      const entry = candidates.cameras[c];
      let pick = ids[k];
      let pickScore = best;
      for (let id = entry.offset; id < entry.offset + entry.count; id++) {
        const s = score(idsWith(ids, k, id));
        if (s.rank < pickScore.rank - MIN_GAIN) {
          pick = id;
          pickScore = s;
        }
      }
      if (pick !== ids[k]) {
        ids = idsWith(ids, k, pick);
        best = pickScore;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return { layout: { kept: layout.kept, ids }, score: best };
}

// The layout with every camera at its current angles.
export function startLayout(candidates, kept) {
  return { kept: kept.slice(), ids: kept.map((c) => candidates.current(c)) };
}

// Random angles for each of the cameras kept.
export function randomAngles(candidates, kept, next) {
  return {
    kept: kept.slice(),
    ids: kept.map((c) => {
      const e = candidates.cameras[c];
      return e.offset + Math.floor(next() * e.count);
    }),
  };
}

// One random restart of the angles of the cameras kept: random angles, then descent.
export function restartAngles(candidates, score, kept, seed) {
  return descend(candidates, score, randomAngles(candidates, kept, random(seed)));
}

// The best angles of one camera given the others: the id and score of the best of its candidates,
// holding the rest of `ids` (a layout without that camera), or null when it has no candidates.
function bestFor(candidates, score, ids, camera) {
  const e = candidates.cameras[camera];
  let best = null;
  for (let id = e.offset; id < e.offset + e.count; id++) {
    const s = score(ids.concat([id]));
    if (!best || s.rank < best.score.rank) best = { id, score: s };
  }
  return best;
}

// Swaps a kept mount for a dropped one while that helps (with its best angles), settling the angles
// of all of them by descent after each swap. Gives { layout, score }.
export function improveMounts(candidates, score, start) {
  const all = candidates.cameras.map((_, i) => i);
  let current = descend(candidates, score, start);
  for (let pass = 0; pass < 6; pass++) {
    let swapped = false;
    for (let k = 0; k < current.layout.kept.length; k++) {
      const dropped = all.filter((x) => !current.layout.kept.includes(x));
      const without = current.layout.ids.filter((_, i) => i !== k);
      let better = null;
      for (const c of dropped) {
        const b = bestFor(candidates, score, without, c);
        if (b && b.score.rank < current.score.rank - MIN_GAIN && (!better || b.score.rank < better.score.rank)) better = { camera: c, ...b };
      }
      if (better) {
        const keptNow = current.layout.kept.filter((_, i) => i !== k).concat([better.camera]);
        current = descend(candidates, score, { kept: keptNow, ids: without.concat([better.id]) });
        swapped = true;
        break;
      }
    }
    if (!swapped) break;
  }
  return current;
}

// The greedy choice of `n` mounts, each with the best angles it has: the mount that gains most each
// time. Gives the layout (before any settling of the angles).
export function greedyMounts(candidates, score, n) {
  const all = candidates.cameras.map((_, i) => i);
  let kept = [];
  let ids = [];
  for (let step = 0; step < n; step++) {
    let pick = null;
    for (const c of all.filter((x) => !kept.includes(x))) {
      const b = bestFor(candidates, score, ids, c);
      if (b && (!pick || b.score.rank < pick.score.rank)) pick = { camera: c, ...b };
    }
    kept = kept.concat([pick.camera]);
    ids = ids.concat([pick.id]);
  }
  return { kept, ids };
}

// Chooses `n` of the cameras' mounts and their angles: the greedy choice, settled, then swaps. Gives
// { layout, score, greedy } where `greedy` is the settled greedy choice before any swap.
export function chooseMounts(candidates, score, n) {
  const greedy = descend(candidates, score, greedyMounts(candidates, score, n));
  const improved = improveMounts(candidates, score, greedy.layout);
  return { ...improved, greedy };
}

// A random restart of the choice: `n` mounts at random with random angles, improved the same way.
export function restartChoose(candidates, score, n, seed) {
  const next = random(seed);
  const pool = candidates.cameras.map((_, i) => i);
  const kept = [];
  while (kept.length < n) kept.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return improveMounts(candidates, score, randomAngles(candidates, kept, next));
}

// ---- Slack ----

// Around the best angles of each camera, holding the others: the run of yaws (and of tilts) whose
// error is within 1 mm of the best. For a yaw interval, the tilt stays at the best one, and the other
// way round. Each is { from, to, all }: degrees from the first to the last allowed value in the run
// (turning left for yaw), and `all` when every allowed value is inside.
export function slack(candidates, score, layout, tolerance = SLACK_METERS) {
  const base = score(layout.ids);
  return layout.kept.map((c, k) => {
    const e = candidates.cameras[c];
    const { yi, ti } = candidates.decode(layout.ids[k]);
    const within = (id) => score(idsWith(layout.ids, k, id)).rank <= base.rank + tolerance;
    const run = (length, at, test, circular) => {
      let lo = at;
      let hi = at;
      let count = 1;
      while (count < length && (circular || hi + 1 < length) && test((hi + 1) % length)) {
        hi = (hi + 1) % length;
        count++;
      }
      while (count < length && (circular || lo - 1 >= 0) && test((lo - 1 + length) % length)) {
        lo = (lo - 1 + length) % length;
        count++;
      }
      return { lo, hi, all: count === length };
    };
    const yawRun = run(e.yaws.length, yi, (i) => within(candidates.idOf(c, i, ti)), e.full);
    const tiltRun = run(e.tilts.length, ti, (i) => within(candidates.idOf(c, yi, i)), false);
    return {
      yaw: { from: e.yaws[yawRun.lo], to: e.yaws[yawRun.hi], all: yawRun.all },
      tilt: { from: e.tilts[tiltRun.lo], to: e.tilts[tiltRun.hi], all: tiltRun.all },
    };
  });
}

// The whole search in one place, for the tests and small jobs: descent from the current angles and
// `restarts` seeded random starts, the best kept; with `best` fewer than the cameras, the mounts are
// chosen too. Gives { layout, score }.
export function searchAngles(candidates, score, restarts, seed = 1, best = candidates.cameras.length) {
  const all = candidates.cameras.map((_, i) => i);
  let found;
  if (best >= all.length) {
    found = descend(candidates, score, startLayout(candidates, all));
    for (let r = 0; r < restarts; r++) {
      const trial = restartAngles(candidates, score, all, mixSeed(seed, r));
      if (trial.score.rank < found.score.rank) found = trial;
    }
  } else {
    found = chooseMounts(candidates, score, best);
    for (let r = 0; r < restarts; r++) {
      const trial = restartChoose(candidates, score, best, mixSeed(seed, r));
      if (trial.score.rank < found.score.rank) found = trial;
    }
  }
  return found;
}
