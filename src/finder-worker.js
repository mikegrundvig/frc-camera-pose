// A worker for the layout search (see finder.js): it looks at the cameras it is given, holds the
// table of every camera's views, and runs search tasks and the final scoring on request.

import { scoreField } from './coverage.js';
import { buildSamples, greedy, improve, makeScorer, makeSpace, onePerPlace, restart, tableSlice } from './finder.js';
import { mixSeed } from './robots.js';

let job = null; // the field, the scoring state, the lens, the space and the sample poses
let score = null; // the scorer over the table, once it has been sent

self.onmessage = (event) => {
  const message = event.data;
  try {
    handle(message);
  } catch (error) {
    self.postMessage({ type: 'error', task: message.task, message: String(error && error.message ? error.message : error) });
  }
};

function handle(message) {
  if (message.type === 'init') {
    const space = makeSpace(message.scoring.robotSize, message.robotHeight, message.rule);
    const samples = buildSamples(message.field, message.scoring, message.plan);
    job = { ...message, space, samples };
    self.postMessage({ type: 'ready', samples: samples.length, candidates: space.count });
  } else if (message.type === 'slice') {
    const data = tableSlice(job.field, job.scoring, job.lens, job.space, job.samples, message.from, message.to);
    self.postMessage({ type: 'slice', from: message.from, to: message.to, data }, [data.buffer]);
  } else if (message.type === 'table') {
    const gyro = (job.scoring.settings.gyroErrorDegrees * Math.PI) / 180;
    score = makeScorer(message.data, job.samples.length, gyro);
    self.postMessage({ type: 'table' });
  } else if (message.type === 'task') {
    self.postMessage({ type: 'done', task: message.task, result: runTask(message) });
  } else if (message.type === 'rescore') {
    // The layout's cameras on the page's own map (full grid and headings), with and without each
    // camera in turn.
    const scoring = { ...job.scoring, cameras: message.cameras };
    const result = scoreField(job.field, scoring);
    self.postMessage({ type: 'done', task: message.task, result: { within95: result.field.within95, measured: result.field.measured, oneLost: result.oneLost } });
  }
}

function runTask(message) {
  const { space } = job;
  // With one camera to a place, layouts with two at a place are refused.
  const scorer = message.distinct ? onePerPlace(space, score) : score;
  if (message.kind === 'greedy') return greedy(space, message.mirrored, scorer, message.most);
  if (message.kind === 'improve') return improve(space, message.mirrored, scorer, message.units);
  // A batch of random restarts for one count: the best of them.
  let best = null;
  for (let i = 0; i < message.runs; i++) {
    const trial = restart(space, message.mirrored, scorer, message.count, mixSeed(message.seed, message.count, message.first + i), 12, message.distinct);
    if (!best || trial.score.rank < best.score.rank) best = trial;
  }
  return best;
}
