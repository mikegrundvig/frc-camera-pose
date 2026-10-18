// Running the layout search (finder.js) on a pool of workers. It looks at every camera the search
// could place over a coarse set of poses (the table), shares the table with each worker, runs the
// greedy build, its improvement and the random restarts as tasks, and scores each count's best
// layout on the page's own map (the full grid and headings).

import { MOST_CAMERAS, layoutMounts, makeSpace } from './finder.js';
import { createPool, workerCount as poolWorkerCount } from './pool.js';
import { mixSeed } from './robots.js';

// The coarse look the search takes: a grid 1 m apart, 4 headings at each; with other robots on,
// 4 arrangements of them at each.
export const SEARCH_PLAN = { spacing: 1.0, headings: 4, arrangements: 4 };
// How many random restarts each count gets, and how many a task runs.
export const RESTARTS = 200;
const RESTARTS_PER_TASK = 20;

// How many workers: the cores, less one for the page, at least one. With other robots on the
// table is four times larger and every worker keeps a copy, so fewer.
export function workerCount(otherRobots) {
  return poolWorkerCount(otherRobots ? 4 : 8);
}

// A camera as the page keeps it from a layout's mount: the lens of `lens` (a camera), the mount.
export function cameraFromMount(lens, mount, name) {
  return {
    name,
    preset: lens.preset,
    widthPixels: lens.widthPixels,
    heightPixels: lens.heightPixels,
    fovDegrees: lens.fovDegrees,
    fovAcross: lens.fovAcross,
    forwardMeters: mount.forward,
    leftMeters: mount.left,
    upMeters: mount.up,
    yawDegrees: mount.yawDegrees,
    tiltUpDegrees: mount.tiltUpDegrees,
  };
}

// Starts a search. `job` has the `field`, the `scoring` state (see state.js, with the other robots
// the search should use in `otherRobots`), the `lens` (a page camera: the sensor every camera
// takes), the robot's `heightMeters`, `mirrored`, `distinct` (one camera to a place), `rule` ({ halfFovDegrees }, or null to allow views across the robot), `restarts` and `workers`. `onProgress(share,
// text)` is told how it goes. Gives { done, stop }: `done` is a promise of the results by count
// (an array, index 0 unused) and `stop` ends the search (the promise rejects).
export function startFinder(job, onProgress) {
  const pool = createPool(new URL('./finder-worker.js', import.meta.url), job.workers);
  const { everyWorker, runQueue } = pool;
  const workers = pool.workers;
  const sensor = {
    widthPixels: job.lens.widthPixels,
    heightPixels: job.lens.heightPixels,
    fovDegrees: job.lens.fovDegrees,
    fovAcross: job.lens.fovAcross,
  };
  const plan = { ...SEARCH_PLAN, arrangements: job.scoring.otherRobots.count > 0 ? SEARCH_PLAN.arrangements : 0 };
  const space = makeSpace(job.scoring.robotSize, job.heightMeters, job.rule);

  const done = new Promise((resolve, fail) => {
    pool.onStop(fail);
    run().then(resolve, fail);
  });

  async function run() {
    onProgress(0, 'Starting');
    const init = { type: 'init', field: job.field, scoring: job.scoring, lens: sensor, robotHeight: job.heightMeters, plan, rule: job.rule };
    const ready = await everyWorker(() => init, 'ready');
    const samples = ready[0].samples;

    // The table: every camera's views at every sample, a slice of cameras to a task.
    const stride = samples * 6;
    const table = new Float32Array(space.count * stride);
    const sliceSize = Math.ceil(space.count / (workers.length * 4));
    const slices = [];
    for (let from = 0; from < space.count; from += sliceSize) slices.push({ from, to: Math.min(space.count, from + sliceSize) });
    const totalSlices = slices.length;
    const tableShare = 0.35;
    await runQueue(
      slices,
      (worker, slice) => {
        worker.postMessage({ type: 'slice', from: slice.from, to: slice.to });
        return 'slice';
      },
      (reply) => {
        table.set(reply.data, reply.from * stride);
        const finished = totalSlices - slices.length;
        onProgress((tableShare * finished) / totalSlices, 'Looking at every camera the search could place');
      },
    );
    await everyWorker(() => ({ type: 'table', data: table }), 'table');

    // The search: the greedy build, then its improvement, and batches of random restarts.
    const best = Array.from({ length: MOST_CAMERAS + 1 }, () => null);
    const keep = (candidate, count) => {
      if (candidate && (!best[count] || candidate.score.rank < best[count].score.rank)) best[count] = candidate;
    };
    const tasks = [{ kind: 'greedy' }];
    for (let count = 1; count <= MOST_CAMERAS; count++) {
      for (let first = 0; first < job.restarts; first += RESTARTS_PER_TASK) {
        tasks.push({ kind: 'restart', count, first, runs: Math.min(RESTARTS_PER_TASK, job.restarts - first) });
      }
    }
    const total = tasks.length + MOST_CAMERAS;
    let finished = 0;
    await runQueue(
      tasks,
      (worker, task) => {
        worker.postMessage({ type: 'task', task: 0, ...task, mirrored: job.mirrored, distinct: job.distinct, most: MOST_CAMERAS, seed: 1 });
        return 'done';
      },
      (reply, task) => {
        finished++;
        if (task.kind === 'greedy') {
          for (let count = 1; count <= MOST_CAMERAS; count++) {
            keep(reply.result[count], count);
            tasks.unshift({ kind: 'improve', count, units: reply.result[count].units });
          }
        } else {
          keep(reply.result, task.count);
        }
        onProgress(tableShare + ((0.95 - tableShare) * finished) / total, 'Searching');
      },
    );

    // Each count's best, on the page's own map.
    const results = [null];
    const rescoring = [];
    for (let count = 1; count <= MOST_CAMERAS; count++) {
      const ids = best[count].units.flat();
      const mounts = layoutMounts(space, ids);
      rescoring.push({ count, ids, mounts, search: best[count].score });
    }
    let rescored = 0;
    const queue = rescoring.slice();
    await runQueue(
      queue,
      (worker, item) => {
        const cameras = item.mounts.map((m, i) => ({
          name: `camera ${i + 1}`,
          sensor,
          mount: { forward: m.forward, left: m.left, up: m.up, yawDegrees: m.yawDegrees, tiltUpDegrees: m.tiltUpDegrees },
        }));
        worker.postMessage({ type: 'rescore', task: item.count, cameras });
        return 'done';
      },
      (reply, item) => {
        rescored++;
        item.full = reply.result;
        onProgress(0.95 + (0.05 * rescored) / MOST_CAMERAS, 'Scoring the best of each count on the whole map');
      },
    );
    for (const item of rescoring) results[item.count] = item;
    return results;
  }

  return { done, stop: pool.stop, finish: pool.finish };
}
