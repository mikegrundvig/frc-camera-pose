// The "Best angles" section: its controls, the progress of a search, and the answer: before and
// after, each camera's angles now and suggested with their slack, and Apply and Undo. The page gives
// it what it needs through `host` (see app.js).

import { intrinsics } from './camera.js';
import { startAngles, workerCount } from './angles-pool.js';
import { trimmed } from './units.js';

// What to use for the number of other robots when the search is asked to put them in the way and
// none are placed.
const OTHER_ROBOTS_WHEN_NONE_PLACED = 3;

export function initAngles(host) {
  const $ = host.$;
  let running = null;
  let answer = null; // the last search: { found, cameras, seconds, ... }
  let undo = null; // the cameras before an answer was applied

  const robotsInTheWay = () => Math.max(host.context().scoring.otherRobots.count, OTHER_ROBOTS_WHEN_NONE_PLACED);

  function renderOthersLabel() {
    $('angles-others-label').textContent = `With other robots in the way (${robotsInTheWay()} at random, about 4 times slower)`;
  }

  function setBusy(busy) {
    $('angles-run').hidden = busy;
    $('angles-stop').hidden = !busy;
    $('angles-progress').hidden = !busy;
  }

  // How many mounts to keep: the number asked for, between 1 and all of them.
  function keepCount(cameras) {
    const asked = Math.round(Number($('angles-best').value));
    return $('angles-best').value === '' || !Number.isFinite(asked) ? cameras : Math.max(1, Math.min(cameras, asked));
  }

  async function run() {
    const context = host.context();
    if (!context.field) return;
    const withRobots = $('angles-others').checked;
    const scoring = { ...context.scoring, otherRobots: { ...context.scoring.otherRobots, count: withRobots ? robotsInTheWay() : 0 } };
    const originals = context.state.cameras.map((c) => ({ ...c }));
    const cameras = originals;
    // Views that cross the robot are out, unless they are allowed.
    const rule = context.state.allowViewsAcross
      ? null
      : { size: scoring.robotSize, halfFovs: cameras.map((c) => intrinsics(c).halfWidthDegrees), limitMeters: context.state.viewAcrossMeters };
    const best = keepCount(cameras.length);
    const workers = workerCount(withRobots);
    const started = performance.now();
    const search = startAngles({ field: context.field, scoring, cameras, rule, best, workers }, (share, text) => {
      $('angles-bar').value = share;
      $('angles-status').textContent = `${text}: ${Math.round(share * 100)}%`;
    });
    running = search;
    setBusy(true);
    $('angles-status').textContent = 'Starting';
    try {
      const found = await search.done;
      search.finish();
      answer = { found, cameras: originals, facingOut: rule !== null, best, withRobots, robots: scoring.otherRobots.count, workers, seconds: (performance.now() - started) / 1000 };
      renderAnswer();
    } catch (error) {
      $('angles-results').textContent = error.message === 'stopped' ? 'Stopped.' : `The search stopped: ${error.message}`;
    } finally {
      running = null;
      setBusy(false);
    }
  }

  const stop = () => running && running.stop();

  // Angles as text: "yaw 45°, tilt 10°".
  const anglesText = (yaw, tilt) => `yaw ${trimmed(yaw, 1)}°, tilt ${trimmed(tilt, 1)}°`;

  function intervalText(name, s) {
    return s.all ? `any ${name}` : s.from === s.to ? `${name} ${trimmed(s.from, 1)}° only` : `${name} ${trimmed(s.from, 1)} to ${trimmed(s.to, 1)}°`;
  }

  const errorText = (full, units) => (Number.isFinite(full.within95) ? units.error(full.within95) : `not enough of the field (${(full.measured * 100).toFixed(0)}% measured)`);
  const percent = (share) => `${(share * 100).toFixed(1)}%`;

  function renderAnswer() {
    const box = $('angles-results');
    box.replaceChildren();
    if (!answer) return;
    const units = host.context().units;
    const { found, cameras } = answer;
    const kept = found.layout.kept;

    const summary = document.createElement('p');
    summary.className = 'note';
    const dropped = cameras.length - kept.length;
    summary.textContent = `Searched in ${answer.seconds.toFixed(0)} s on ${answer.workers} workers: the current angles and ${found.restarts} random starts${answer.facingOut ? ', every view facing out of the robot' : ''}, ${dropped > 0 ? `keeping the best ${kept.length} of ${cameras.length} mounts` : 'every mount where it is'}${answer.withRobots ? `, with ${answer.robots} other robots at random in the way` : ''}.`;

    // Before and after on the whole map.
    const compare = document.createElement('table');
    compare.className = 'finder-table angles-compare';
    compare.innerHTML = '<thead><tr><th></th><th>Before</th><th>After</th></tr></thead>';
    const body = document.createElement('tbody');
    const line = (label, before, after) => {
      const tr = document.createElement('tr');
      for (const text of [label, before, after]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      body.append(tr);
    };
    line('95% error', errorText(found.before, units), errorText(found.after, units));
    line('With one camera lost', found.before.oneLost ? errorText(found.before.oneLost, units) : 'none left', found.after.oneLost ? errorText(found.after.oneLost, units) : 'none left');
    line('At least one tag', percent(found.before.oneTag), percent(found.after.oneTag));
    line('Two tags in one camera', percent(found.before.twoTags), percent(found.after.twoTags));
    line('Two cameras see a tag', percent(found.before.twoCameras), percent(found.after.twoCameras));
    compare.append(body);

    // Each camera now and suggested.
    const list = document.createElement('table');
    list.className = 'finder-table angles-cameras';
    list.innerHTML = '<thead><tr><th>Camera</th><th>Now</th><th>Suggested</th></tr></thead>';
    const rows = document.createElement('tbody');
    let changed = false;
    cameras.forEach((camera, c) => {
      const k = kept.indexOf(c);
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = camera.name;
      const now = document.createElement('td');
      now.textContent = anglesText(camera.yawDegrees, camera.tiltUpDegrees);
      const next = document.createElement('td');
      if (k < 0) {
        next.textContent = 'not used';
        next.className = 'unseen';
        changed = true;
      } else {
        const a = found.angles[k];
        const same = Math.abs(((a.yawDegrees - camera.yawDegrees + 540) % 360) - 180) < 1e-6 && Math.abs(a.tiltUpDegrees - camera.tiltUpDegrees) < 1e-6;
        if (!same) changed = true;
        next.textContent = same ? 'no change: already the best found' : anglesText(a.yawDegrees, a.tiltUpDegrees);
        const s = found.slack[k];
        const slack = document.createElement('div');
        slack.className = 'unseen';
        slack.textContent = found.blocked[c]
          ? "no yaw faces out from this mount, so its yaw was left as it is"
          : `${intervalText('yaw', s.yaw)}, ${intervalText('tilt', s.tilt)} all within 1 mm`;
        next.append(slack);
      }
      tr.append(name, now, next);
      rows.append(tr);
    });
    list.append(rows);

    const buttons = document.createElement('div');
    buttons.className = 'row';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = changed ? 'Apply' : 'Nothing to change';
    apply.disabled = !changed;
    apply.addEventListener('click', applyAnswer);
    buttons.append(apply);

    const applied = document.createElement('p');
    applied.className = 'note';
    applied.id = 'angles-applied';

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      "The mounts stay where they are; only yaw and tilt change, in 5 degree steps within each camera's limits. It does not know your robot's own mechanisms: use the limits and the camera's view to rule out directions that are blocked. The estimate's assumptions apply; differences under about 1 mm are noise.";
    box.append(summary, compare, list, buttons, applied, note);
    renderApplied();
  }

  // Puts the suggested angles on the robot's cameras (those not used are removed), one click to undo.
  function applyAnswer() {
    const { found, cameras } = answer;
    const next = [];
    cameras.forEach((camera, c) => {
      const k = found.layout.kept.indexOf(c);
      if (k < 0) return;
      next.push({ ...camera, yawDegrees: found.angles[k].yawDegrees, tiltUpDegrees: found.angles[k].tiltUpDegrees });
    });
    undo = { cameras: host.getCameras() };
    host.setCameras(next);
    renderApplied();
  }

  function renderApplied() {
    const line = $('angles-applied');
    if (!line) return;
    line.replaceChildren();
    if (!undo) return;
    line.append('Applied to the robot. ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
      host.setCameras(undo.cameras);
      undo = null;
      renderApplied();
    });
    line.append(button);
  }

  $('angles-run').addEventListener('click', run);
  $('angles-stop').addEventListener('click', stop);
  $('angles-others').addEventListener('change', renderOthersLabel);
  renderOthersLabel();
  return {
    refresh: () => {
      renderOthersLabel();
      renderAnswer();
    },
  };
}
