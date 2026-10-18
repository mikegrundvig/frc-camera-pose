// Running the best-angles search (angles.js) on a pool of workers: the table of every candidate's
// views, the search from the current angles and from random starts, the slack around the answer, and
// the before and after on the page's own map.

import { SEARCH_PLAN } from './finder-pool.js';
import { makeCandidates } from './angles.js';
import { createPool, workerCount as poolWorkerCount } from './pool.js';

// How many random restarts to run (fewer when also choosing which mounts to keep, as each is
// slower), and how many a task runs.
export const RESTARTS = 24;
export const RESTARTS_CHOOSING = 12;
const PER_TASK = 4;

export function workerCount(otherRobots) {
  return poolWorkerCount(otherRobots ? 4 : 8);
}

// Starts a search. `job` has the `field`, the `scoring` state (with the other robots to use in
// `otherRobots`), `cameras` (the page's cameras, with their limits), `rule` ({ size, halfFovs } or null: see makeCandidates), `best` (how many mounts to keep,
// all of them or fewer) and `workers`. `onProgress(share, text)` is told how it goes. Gives
// { done, stop, finish }; `done` is a promise of { layout, slack, before, after, candidates }.
export function startAngles(job, onProgress) {
  const pool = createPool(new URL('./angles-worker.js', import.meta.url), job.workers);
  const { everyWorker, runQueue } = pool;
  const candidates = makeCandidates(job.cameras, undefined, job.rule);
  const plan = { ...SEARCH_PLAN, arrangements: job.scoring.otherRobots.count > 0 ? SEARCH_PLAN.arrangements : 0 };
  const choosing = job.best < job.cameras.length;
  const restarts = choosing ? RESTARTS_CHOOSING : RESTARTS;

  const done = new Promise((resolve, fail) => {
    pool.onStop(fail);
    run().then(resolve, fail);
  });

  async function run() {
    onProgress(0, 'Starting');
    const ready = await everyWorker(() => ({ type: 'init', field: job.field, scoring: job.scoring, cameras: job.cameras, plan, rule: job.rule }), 'ready');
    const samples = ready[0].samples;

    // The table: every camera's views at each of its angles, at every sample.
    const stride = samples * 6;
    const table = new Float32Array(candidates.count * stride);
    const sliceSize = Math.max(1, Math.ceil(candidates.count / (pool.workers.length * 4)));
    const slices = [];
    for (let from = 0; from < candidates.count; from += sliceSize) slices.push({ from, to: Math.min(candidates.count, from + sliceSize) });
    const totalSlices = slices.length;
    await runQueue(
      slices,
      (worker, slice) => {
        worker.postMessage({ type: 'slice', from: slice.from, to: slice.to });
        return 'slice';
      },
      (reply) => {
        table.set(reply.data, reply.from * stride);
        onProgress((0.4 * (totalSlices - slices.length)) / totalSlices, 'Looking at every angle of every camera');
      },
    );
    await everyWorker(() => ({ type: 'table', data: table }), 'table');

    // The search: from the current angles, and from random starts.
    let best = null;
    const tasks = [{ kind: 'start' }];
    for (let first = 0; first < restarts; first += PER_TASK) tasks.push({ kind: 'restart', first, runs: Math.min(PER_TASK, restarts - first) });
    const total = tasks.length;
    let finished = 0;
    await runQueue(
      tasks,
      (worker, task) => {
        worker.postMessage({ type: 'task', task: 0, ...task, best: job.best, seed: 1 });
        return 'done';
      },
      (reply) => {
        finished++;
        if (!best || reply.result.score.rank < best.score.rank) best = reply.result;
        onProgress(0.4 + (0.45 * finished) / total, 'Searching');
      },
    );

    // The slack around the answer, and the whole map before and after.
    const layout = best.layout;
    const camerasAfter = layout.kept.map((c, k) => {
      const base = job.scoring.cameras[c];
      const a = candidates.angles(layout.ids[k]);
      return { ...base, mount: { ...base.mount, yawDegrees: a.yawDegrees, tiltUpDegrees: a.tiltUpDegrees } };
    });
    const extra = [
      { kind: 'finish', layout },
      { kind: 'before', cameras: job.scoring.cameras },
      { kind: 'after', cameras: camerasAfter },
    ];
    const out = {};
    await runQueue(
      extra,
      (worker, item) => {
        if (item.kind === 'finish') worker.postMessage({ type: 'task', task: 0, kind: 'finish', layout: item.layout });
        else worker.postMessage({ type: 'rescore', task: 0, cameras: item.cameras });
        return 'done';
      },
      (reply, item) => {
        out[item.kind] = reply.result;
        onProgress(0.85 + 0.05 * Object.keys(out).length, 'Scoring on the whole map');
      },
    );
    return {
      layout,
      angles: layout.ids.map((id) => candidates.angles(id)),
      slack: out.finish.slack,
      quick: out.finish.score,
      before: out.before,
      after: out.after,
      restarts,
      blocked: candidates.cameras.map((e) => e.blocked),
    };
  }

  return { done, stop: pool.stop, finish: pool.finish };
}
