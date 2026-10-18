// The "Find a layout" section: its controls, the progress of a search, and the table of the best
// layout for each number of cameras. The page gives it what it needs through `host` (see app.js).

import { intrinsics } from './camera.js';
import { MOST_CAMERAS, fewestWithin } from './finder.js';
import { RESTARTS, cameraFromMount, startFinder, workerCount } from './finder-pool.js';

// What to use for the number of other robots when the search is asked to put them in the way and
// none are placed: the maps' own assumption is the number placed.
const OTHER_ROBOTS_WHEN_NONE_PLACED = 3;
// Adding a camera that gains less than this is marked: under a few millimeters.
const SMALL_GAIN_METERS = 0.003;

export function initFinder(host) {
  const $ = host.$;
  let running = null; // the search in progress: { stop }
  let results = null; // the last search: { rows, summary }
  let undo = null; // the cameras before a layout was loaded

  // The number of other robots a search puts in the way, when asked.
  function robotsInTheWay() {
    return Math.max(host.context().scoring.otherRobots.count, OTHER_ROBOTS_WHEN_NONE_PLACED);
  }

  function renderOthersLabel() {
    $('finder-others-label').textContent = `With other robots in the way (${robotsInTheWay()} at random, about 4 times slower)`;
  }

  function setBusy(busy) {
    $('finder-run').hidden = busy;
    $('finder-stop').hidden = !busy;
    $('finder-progress').hidden = !busy;
  }

  async function run() {
    const context = host.context();
    if (!context.field) return;
    const withRobots = $('finder-others').checked;
    const scoring = { ...context.scoring, otherRobots: { ...context.scoring.otherRobots, count: withRobots ? robotsInTheWay() : 0 } };
    const workers = workerCount(withRobots);
    const started = performance.now();
    const search = startFinder(
      {
        field: context.field,
        scoring,
        lens: context.lens,
        heightMeters: context.state.robot.heightMeters,
        mirrored: $('finder-mirror').checked,
        distinct: $('finder-distinct').checked,
        // Views that cross the robot are out, unless they are allowed.
        rule: context.state.allowViewsAcross ? null : { halfFovDegrees: intrinsics(context.lens).halfWidthDegrees, limitMeters: context.state.viewAcrossMeters },
        restarts: RESTARTS,
        workers,
      },
      (share, text) => {
        $('finder-bar').value = share;
        $('finder-status').textContent = `${text}: ${Math.round(share * 100)}%`;
      },
    );
    running = search;
    setBusy(true);
    $('finder-status').textContent = 'Starting';
    try {
      const found = await search.done;
      search.finish();
      const seconds = (performance.now() - started) / 1000;
      results = {
        found,
        mirrored: $('finder-mirror').checked,
        distinct: $('finder-distinct').checked,
        withRobots,
        robots: scoring.otherRobots.count,
        seconds,
        workers,
        title: `${context.seasonLabel}, robot ${context.units.length(context.state.robot.lengthMeters)} by ${context.units.length(context.state.robot.widthMeters)}, ${context.units.length(context.state.robot.heightMeters)} tall, lens: ${context.lensLabel}`,
      };
      renderResults();
    } catch (error) {
      if (error.message !== 'stopped') $('finder-results').textContent = `The search stopped: ${error.message}`;
      else $('finder-results').textContent = 'Stopped.';
    } finally {
      running = null;
      setBusy(false);
    }
  }

  function stop() {
    if (running) running.stop();
  }

  // A layout in a line: each camera's place and yaw, then how high and how far up they tilt.
  function describe(mounts, units) {
    const yaw = (m) => (Math.round(m.yawDegrees) === -180 ? 180 : Math.round(m.yawDegrees));
    const places = mounts.map((m) => `${m.name} ${yaw(m)}°`).join(', ');
    const range = (values, format) => {
      const low = Math.min(...values);
      const high = Math.max(...values);
      return low === high ? format(low) : `${format(low)} to ${format(high)}`;
    };
    const heights = range(mounts.map((m) => m.up), (v) => units.length(v));
    const tilts = range(mounts.map((m) => m.tiltUpDegrees), (v) => `${v}°`);
    return { places, extra: `${heights} up, tilted ${tilts}` };
  }

  function errorText(full, units) {
    return Number.isFinite(full.within95)
      ? units.error(full.within95)
      : `not enough of the field (${(full.measured * 100).toFixed(0)}% measured)`;
  }

  function renderResults() {
    const box = $('finder-results');
    box.replaceChildren();
    if (!results) return;
    const units = host.context().units;
    const { found } = results;
    const errors = [0, ...found.slice(1).map((r) => (Number.isFinite(r.full.within95) ? r.full.within95 : Infinity))];
    const best = fewestWithin(errors, 0.001);
    const summary = document.createElement('p');
    summary.className = 'note';
    summary.textContent =
      best > 0
        ? `The fewest cameras within 1 mm of the best here: ${best}. `
        : 'No number of cameras up to 6 covers 95% of this field. ';
    summary.append(
      `Searched in ${results.seconds.toFixed(0)} s on ${results.workers} workers${results.withRobots ? `, with ${results.robots} other robots at random in the way` : ''}${results.mirrored ? ', left and right mirrored' : ''}${results.distinct ? ', one camera to a place' : ''}. For ${results.title}.`,
    );
    const table = document.createElement('table');
    table.className = 'finder-table';
    table.innerHTML = '<thead><tr><th>Cameras</th><th>95% error</th><th>One camera lost</th></tr></thead>';
    const body = document.createElement('tbody');
    for (let count = 1; count <= MOST_CAMERAS; count++) {
      const r = found[count];
      const tr = document.createElement('tr');
      tr.className = 'finder-count';
      const countCell = document.createElement('td');
      countCell.textContent = `${count}${count === best ? ' ★' : ''}`;
      if (count === best) countCell.title = 'The fewest cameras within 1 mm of the best';
      const error = document.createElement('td');
      error.textContent = errorText(r.full, units);
      const before = errors[count - 1];
      if (count > 1 && Number.isFinite(errors[count]) && Number.isFinite(before) && before - errors[count] < SMALL_GAIN_METERS) {
        const note = document.createElement('div');
        note.className = 'unseen';
        note.textContent = before - errors[count] > 0 ? `gains ${units.error(before - errors[count])}: under 3 mm` : 'no gain over one fewer';
        error.append(note);
      }
      const lost = document.createElement('td');
      lost.textContent = r.full.oneLost ? errorText(r.full.oneLost, units) : 'none left';
      tr.append(countCell, error, lost);
      // The layout, under its numbers, with the button that loads it.
      const text = describe(r.mounts, units);
      const details = document.createElement('tr');
      details.className = 'finder-layout';
      const cell = document.createElement('td');
      cell.colSpan = 3;
      const line = document.createElement('div');
      line.textContent = text.places;
      const extra = document.createElement('div');
      extra.className = 'unseen';
      extra.textContent = text.extra;
      const use = document.createElement('button');
      use.type = 'button';
      use.textContent = 'Use this layout';
      use.setAttribute('aria-label', `Use the ${count}-camera layout`);
      use.addEventListener('click', () => load(count));
      cell.append(line, extra, use);
      details.append(cell);
      for (const row of [tr, details]) row.addEventListener('click', (event) => event.target.closest('button') || load(count));
      body.append(tr, details);
    }
    table.append(body);
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      "Searched cameras on the robot's edges (the four corners and four side middles), all with the lens of the camera selected when you started; the estimate's assumptions apply; differences under about 1 mm are noise. The search looked at the field coarsely, 1 m apart at 4 headings; each count's best is then scored on the whole map, as shown.";
    const loaded = document.createElement('p');
    loaded.className = 'note';
    loaded.id = 'finder-loaded';
    box.append(summary, table, loaded, note);
    renderLoaded();
  }

  // Replaces the robot's cameras with a count's best layout; one click undoes it.
  function load(count) {
    const context = host.context();
    const names = new Map();
    const cameras = results.found[count].mounts.map((m) => {
      const n = (names.get(m.name) || 0) + 1;
      names.set(m.name, n);
      return cameraFromMount(context.lens, m, n > 1 ? `${m.name} ${n}` : m.name);
    });
    undo = { cameras: host.getCameras(), count };
    host.setCameras(cameras);
    renderLoaded();
  }

  function renderLoaded() {
    const line = $('finder-loaded');
    if (!line) return;
    line.replaceChildren();
    if (!undo) return;
    line.append(`Loaded the ${undo.count}-camera layout onto the robot. `);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
      host.setCameras(undo.cameras);
      undo = null;
      renderLoaded();
    });
    line.append(button);
  }

  $('finder-run').addEventListener('click', run);
  $('finder-stop').addEventListener('click', stop);
  $('finder-others').addEventListener('change', renderOthersLabel);
  renderOthersLabel();

  return { refresh: () => { renderOthersLabel(); renderResults(); } };
}
