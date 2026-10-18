// A worker for the best-angles search (see angles.js): it looks at the candidates it is given, holds
// the table, and runs the search tasks, the slack and the final scoring on request.

import { scoreField } from './coverage.js';
import { buildSamples, makeScorer } from './finder.js';
import { candidateSlice, chooseMounts, descend, makeCandidates, restartAngles, restartChoose, slack, startLayout } from './angles.js';
import { mixSeed } from './robots.js';

let job = null;
let score = null;

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
    const candidates = makeCandidates(message.cameras, undefined, message.rule);
    const samples = buildSamples(message.field, message.scoring, message.plan);
    const lenses = message.scoring.cameras.map((c) => c.sensor);
    job = { ...message, candidates, samples, lenses };
    self.postMessage({ type: 'ready', samples: samples.length, candidates: candidates.count });
  } else if (message.type === 'slice') {
    const data = candidateSlice(job.field, job.scoring, job.candidates, job.lenses, job.samples, message.from, message.to);
    self.postMessage({ type: 'slice', from: message.from, to: message.to, data }, [data.buffer]);
  } else if (message.type === 'table') {
    score = makeScorer(message.data, job.samples.length, (job.scoring.settings.gyroErrorDegrees * Math.PI) / 180);
    self.postMessage({ type: 'table' });
  } else if (message.type === 'task') {
    self.postMessage({ type: 'done', task: message.task, result: runTask(message) });
  } else if (message.type === 'rescore') {
    const scoring = { ...job.scoring, cameras: message.cameras };
    const result = scoreField(job.field, scoring);
    const f = result.field;
    self.postMessage({
      type: 'done',
      task: message.task,
      result: { within95: f.within95, measured: f.measured, oneTag: f.oneTag, twoTags: f.twoTags, twoCameras: f.twoCameras, oneLost: result.oneLost },
    });
  }
}

function runTask(message) {
  const { candidates } = job;
  const all = candidates.cameras.map((_, i) => i);
  const choosing = message.best < all.length;
  if (message.kind === 'start') {
    return choosing ? chooseMounts(candidates, score, message.best) : descend(candidates, score, startLayout(candidates, all));
  }
  if (message.kind === 'finish') {
    return { slack: slack(candidates, score, message.layout), score: score(message.layout.ids) };
  }
  // A batch of random restarts: the best of them.
  let best = null;
  for (let i = 0; i < message.runs; i++) {
    const seed = mixSeed(message.seed, message.first + i);
    const trial = choosing ? restartChoose(candidates, score, message.best, seed) : restartAngles(candidates, score, all, seed);
    if (!best || trial.score.rank < best.score.rank) best = trial;
  }
  return best;
}
