// The page: its controls, the field drawing, and the coverage worker.

import {
  HEADING_MEASURED,
  HEADING_NO_ROOM,
  HEADING_NO_TAGS,
  HEADING_TOO_FAR,
  elementsHit,
  headingAt,
  headingOffset,
  otherRobotsAt,
  prepareCameras,
  robotOutline,
  viewsAt,
} from './coverage.js';
import { CAMERA_COLORS, HANDLE_METERS, drawEye, drawScene, fieldView, goodness, scaleStops } from './draw.js';
import { VISION, combine, within95 } from './estimate.js';
import { SEASONS, loadField } from './field.js';
import { DEG } from './math.js';
import { CAMERA_PRESETS, CUSTOM, LAYOUT_PRESETS, MOST_CAMERAS, cameraAt, layoutCameras } from './presets.js';
import { DRIVE_CODES, FIELD_RELATIVE, ROBOT_RELATIVE, asksForMotion, driveStep, inputFromGamepad, inputFromKeys } from './drive.js';
import { MOST_ACROSS, MOST_OTHER_ROBOTS } from './state.js';
import { initAngles } from './angles-ui.js';
import { outwardYawRuns, overlapStyle, viewFacesOut, viewOverRobot } from './clip.js';
import { initFinder } from './finder-ui.js';
import { intrinsics } from './camera.js';
import { INCH, METRIC, IMPERIAL, loadUnits, saveUnits, trimmed, unitsFor } from './units.js';
import { asKept, outlineAt, placeAt, moveTo, spotNear, turnTo } from './placement.js';
import { box, mixSeed } from './robots.js';
import { MAPS, defaultState, fromText, robotPose, scoringState, toHash, toJson } from './state.js';
import { SHOW_ITEMS, loadShow, saveShow } from './show.js';
import { spots } from './spots.js';
import { FACING_AWAY, HIDDEN, OUTSIDE_IMAGE, SEEN, TOO_FAR, TOO_SMALL } from './visibility.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');

let finder = null; // the "Find a layout" section, once it is set up
let angles = null; // the "Best angles" section, once it is set up
let units = unitsFor(loadUnits()); // what lengths are shown in: this viewer's own, not in the link
let show = loadShow(); // what the drawing shows: this viewer's own, not in the link
let state = location.hash.length > 1 ? fromText(decodeURIComponent(location.hash.slice(1))) : defaultState();
let field = null;
let here = null; // what the cameras see at the current pose
let coverage = null;
let mode = 'top'; // 'top' or '3d': this viewer's pick, not in the link
let view3d = null; // the 3D view, made the first time it is chosen
let selectedOther = -1; // the placed robot picked on the field, or -1
let randomPress = 0; // how many times Place at random has been pressed: its seed
let selected = 0; // the camera the camera's view shows: this viewer's pick, not in the link
let job = 0;

const worker = new Worker(new URL('./coverage-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (event) => {
  const message = event.data;
  if (message.id !== job) return;
  if (message.progress !== undefined) {
    $('status').textContent = `Working out the field: ${Math.round(message.progress * 100)}%`;
  } else if (message.error) {
    $('status').textContent = `Could not work out the field: ${message.error}`;
  } else {
    coverage = message.result;
    hideSquareCard();
    $('status').textContent = describeSamples(coverage);
    renderCoverage();
    draw();
  }
};

// ---- Theme ----

function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? 'Light' : 'Dark';
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Storage may be off; the theme just isn't remembered.
  }
  draw();
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    saved = null;
  }
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  $('theme').textContent = effectiveTheme() === 'dark' ? 'Light' : 'Dark';
  $('theme').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
}

// ---- Units ----

function initUnits() {
  const menu = $('units');
  menu.append(option(IMPERIAL, 'Imperial (ft, in)'), option(METRIC, 'Metric (m, cm)'));
  menu.value = units.system;
  menu.addEventListener('change', () => {
    units = unitsFor(menu.value);
    saveUnits(units.system);
    applyUnits();
  });
}

// Shows every length in the chosen units: the labels, the boxes, the tables and the maps' scale.
// The model stays in meters; only what is shown and typed changes.
function applyUnits() {
  for (const e of document.querySelectorAll('[data-unit="long"]')) e.textContent = units.longLabel;
  for (const e of document.querySelectorAll('[data-unit="short"]')) e.textContent = units.shortLabel;
  for (const e of document.querySelectorAll('[data-unit-name="short"]')) {
    e.textContent = units.system === IMPERIAL ? 'inches' : 'centimeters';
  }
  $('pose-x').step = String(units.longStep);
  $('pose-y').step = String(units.longStep);
  $('sight').step = String(units.longStep * 10);
  $('cutoff').step = String(units.longStep * 10);
  $('robot-length').step = String(units.shortStep * 2);
  $('robot-width').step = String(units.shortStep * 2);
  $('robot-height').step = String(units.shortStep * 2);
  $('view-across').step = String(units.shortStep * 4);
  $('others-height').step = String(units.shortStep * 4);
  $('sight-default').textContent = units.distance(7);
  $('cutoff-default').textContent = units.distance(VISION.maxDistanceMeters);
  renderSettings();
  renderCameras(selected);
  if (finder) finder.refresh();
  if (angles) angles.refresh();
  if (!field || !here) return;
  renderPoseInputsNow();
  renderSees();
  renderCoverage();
  if (coverage) $('status').textContent = describeSamples(coverage);
  draw();
}

// ---- Season and placement ----

async function setSeason(year) {
  state.season = year;
  const season = SEASONS.find((s) => s.year === year);
  field = await loadField(season);
  // A pose from a link is kept if the robot may stand there, else moved to the nearest place it may.
  if (!state.pose || !placeAt(field, robotSize(), state.pose)) {
    // The blue alliance's center start, or the first spot there is.
    const list = spotList();
    const first = list.find((s) => s.label === 'Start: blue center') || list[0];
    state.pose = { x: round(first.pose.x, 3), y: round(first.pose.y, 3), headingDegrees: first.pose.headingDegrees };
  }
  settleRobots();
  fillSpots();
  renderOthers();
  renderNote();
  coverage = null;
  update({ coverage: true });
}

const DRIVING_HINT =
  ' With the field selected, hold W A S D or the arrow keys to drive (W is away from the blue wall when field-relative) and Q and E to turn; Shift is slow.';

function renderNote() {
  if (!field) return;
  const elements =
    field.elements.length > 0
      ? `${field.name}: its field elements (gray) block the cameras' view. `
      : `${field.name}: no field element data for this season, so only the walls and tags are drawn and nothing blocks the view.`;
  const moving =
    mode === '3d'
      ? ' Drag a robot to move it; drag anywhere else to orbit, right-drag or Shift-drag to pan, scroll to zoom. Turn other robots in the top view.' + DRIVING_HINT
      : field.elements.length > 0
        ? 'Drag the robot to move it and the round handle to turn it. It stops at the elements, the walls and other robots.' + DRIVING_HINT
        : '';
  $('field-note').textContent = elements + moving;
}

function robotSize() {
  return scoringState(state).robotSize;
}

function spotList() {
  return spots(field, robotSize());
}

function fillSpots() {
  const select = $('spot');
  select.replaceChildren(option('', 'Pick a spot'));
  spotList().forEach((spot, i) => select.append(option(String(i), spot.label)));
  select.value = '';
}

function option(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

// The robots: the main one (MAIN) and the other robots placed on the field (0, 1, ...). None
// overlaps a field element, a wall or another robot (see placement.js): every way of moving one
// ends in a pose that is legal.
const MAIN = -1;

function poseOf(target) {
  return target === MAIN ? state.pose : state.otherRobots.robots[target];
}

function setPoseOf(target, pose) {
  if (target === MAIN) {
    state.pose = pose;
    $('spot').value = '';
  } else {
    state.otherRobots.robots[target] = pose;
  }
  update({});
}

// The outlines a robot must stay off besides the field: every other robot, and the main one.
function outlinesBesides(target) {
  const size = robotSize();
  const outlines = target === MAIN ? [] : [outlineAt(size, state.pose)];
  state.otherRobots.robots.forEach((r, i) => {
    if (i !== target) outlines.push(outlineAt(size, r));
  });
  return outlines;
}

// Slides a robot toward a point, along whatever it touches on the way.
function slideRobot(x, y, target = MAIN) {
  setPoseOf(target, moveTo(field, robotSize(), poseOf(target), x, y, outlinesBesides(target)));
}

// Turns a robot toward a heading, stopping short of a turn that would hit.
function turnRobot(headingDegrees, target = MAIN) {
  setPoseOf(target, turnTo(field, robotSize(), poseOf(target), headingDegrees, outlinesBesides(target)));
}

// Puts a robot at a point, or at the nearest legal place to it.
function placeRobot(x, y, target = MAIN) {
  const at = placeAt(field, robotSize(), { ...poseOf(target), x, y }, outlinesBesides(target));
  setPoseOf(target, at || poseOf(target));
}

// Moves every robot to a legal place: the main one first, then each other robot clear of it and
// of those before it (one with no room is dropped). For after the field or the size changes.
function settleRobots() {
  const size = robotSize();
  state.pose = placeAt(field, size, state.pose) || state.pose;
  const kept = [];
  const outlines = [outlineAt(size, state.pose)];
  for (const r of state.otherRobots.robots) {
    const at = placeAt(field, size, r, outlines);
    if (!at) continue;
    kept.push(at);
    outlines.push(outlineAt(size, at));
  }
  state.otherRobots.robots = kept;
  if (selectedOther >= kept.length) selectedOther = -1;
}

// After the robot's size changes: its spots change, and where robots stand may no longer fit.
function robotSizeChanged() {
  if (!field) return;
  settleRobots();
  fillSpots();
  renderOthers();
}

// ---- Other robots ----

function addOther() {
  if (state.otherRobots.robots.length >= MOST_OTHER_ROBOTS) return;
  const at = spotNear(field, robotSize(), state.pose, outlinesBesides(MAIN));
  if (!at) {
    $('others-note').textContent = 'There is no room for another robot.';
    return;
  }
  state.otherRobots.robots.push(at);
  selectedOther = state.otherRobots.robots.length - 1;
  othersChanged();
}

function removeOther(index) {
  state.otherRobots.robots.splice(index, 1);
  selectedOther = -1;
  othersChanged();
}

// Puts the placed robots at random places near the robot, once: the same seeded random placement
// the maps use, with the same number of robots. They stay where it puts them.
function placeAtRandom() {
  if (state.otherRobots.robots.length === 0) return;
  randomPress++;
  const boxes = otherRobotsAt(field, robotPose(state), scoringState(state), mixSeed(randomPress));
  state.otherRobots.robots = boxes.map((b) => ({
    x: round(b.x, 3),
    y: round(b.y, 3),
    headingDegrees: round(b.heading / DEG, 1),
  }));
  settleRobots();
  selectedOther = -1;
  othersChanged();
}

// The number of robots changed: the list, the maps' assumption, and the maps themselves.
function othersChanged() {
  renderOthers();
  update({ coverage: true });
}

function selectOther(index) {
  selectedOther = index;
  renderOthers();
  draw();
}

function renderOthers() {
  const n = state.otherRobots.robots.length;
  const list = $('others-list');
  list.replaceChildren();
  state.otherRobots.robots.forEach((_, i) => {
    const row = document.createElement('div');
    row.className = i === selectedOther ? 'other-row selected' : 'other-row';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'link-button';
    pick.textContent = `Robot ${i + 1}`;
    pick.setAttribute('aria-pressed', String(i === selectedOther));
    pick.addEventListener('click', () => selectOther(i));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeOther(i));
    row.append(pick, remove);
    list.append(row);
  });
  $('add-other').disabled = n >= MOST_OTHER_ROBOTS;
  $('place-random').disabled = n === 0;
  const assumed =
    n === 0
      ? 'Maps assume no other robots.'
      : `Maps assume ${n} other ${n === 1 ? 'robot' : 'robots'} at random around each spot, not the ones you placed.`;
  $('others-note').textContent = assumed;
  $('maps-note').textContent = assumed;
}

// ---- Top view and 3D ----

async function setMode(next) {
  if (next === mode) return;
  const before = mode;
  mode = next;
  showMode();
  if (next === '3d' && !view3d) {
    $('field-note').textContent = 'Loading the 3D view.';
    try {
      const { createView3d } = await import('./scene3d.js');
      view3d = await createView3d($('field3d'), { onPress: press3d });
    } catch (error) {
      mode = before;
      showMode();
      $('field-note').textContent = `Could not start the 3D view: ${error.message}`;
      return;
    }
  }
  renderNote();
  draw();
}

function showMode() {
  const is3d = mode === '3d';
  $('field').hidden = is3d;
  $('field3d').hidden = !is3d;
  $('view-reset').hidden = !is3d;
  $('view-top').setAttribute('aria-pressed', String(!is3d));
  $('view-3d').setAttribute('aria-pressed', String(is3d));
  renderNote();
}

// A press on the 3D view: on a robot it starts a drag across the floor (the ray under the pointer
// meets the plane at the height where it hit the robot), else the orbit controls take it.
let drag3 = null;

function press3d(event) {
  if (!field || event.button !== 0) return false;
  $('field3d').focus();
  const hit = view3d.pick(event.clientX, event.clientY);
  if (!hit) return false;
  const at = view3d.floorPoint(event.clientX, event.clientY, hit.z);
  if (!at) return false;
  const robot = poseOf(hit.robot);
  drag3 = { target: hit.robot, z: hit.z, dx: at[0] - robot.x, dy: at[1] - robot.y };
  if (hit.robot !== MAIN && hit.robot !== selectedOther) selectOther(hit.robot);
  $('field3d').setPointerCapture(event.pointerId);
  $('field3d').style.cursor = 'grabbing';
  return true;
}

function initViews() {
  const c3 = $('field3d');
  c3.addEventListener('pointerleave', hideSquareCard);
  c3.addEventListener('pointermove', (event) => {
    if (!drag3 && view3d && event.buttons === 0) {
      // Where the pointer's ray meets the floor (an element in front does not stop it).
      const at = view3d.floorPoint(event.clientX, event.clientY, 0);
      if (at) showSquareCard(at[0], at[1], event.clientX, event.clientY, c3.parentElement);
      else hideSquareCard();
      return;
    }
    hideSquareCard();
    if (!drag3 || !view3d) return;
    const at = view3d.floorPoint(event.clientX, event.clientY, drag3.z);
    if (at) slideRobot(at[0] - drag3.dx, at[1] - drag3.dy, drag3.target);
  });
  const release = () => {
    drag3 = null;
    c3.style.cursor = '';
  };
  c3.addEventListener('pointerup', release);
  c3.addEventListener('pointercancel', release);
  $('view-top').addEventListener('click', () => setMode('top'));
  $('view-3d').addEventListener('click', () => setMode('3d'));
  $('view-reset').addEventListener('click', () => view3d && view3d.reset());
  new ResizeObserver(() => view3d && view3d.resize()).observe($('field3d'));
}

// ---- What to show ----

function initShow() {
  for (const item of SHOW_ITEMS) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `show-${item.id}`;
    input.checked = show[item.id];
    input.addEventListener('change', () => {
      show = { ...show, [item.id]: input.checked };
      saveShow(show);
      draw();
    });
    const label = document.createElement('label');
    label.className = 'inline';
    label.append(input, item.label);
    $('show-items').append(label);
  }
}

// ---- Updating ----

let coverageTimer = 0;
let hashTimer = 0;

// Redraws after a change; `coverage: true` when the change alters the coverage maps too.
function update(changes) {
  if (!field) return;
  lookFromHere();
  draw();
  renderCameraWarnings();
  renderEye();
  renderPoseInputs();
  renderSees();
  if (changes.coverage) {
    $('status').textContent = 'Working out the field';
    clearTimeout(coverageTimer);
    coverageTimer = setTimeout(startCoverage, 400);
  }
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', toHash(state)), 300);
}

function startCoverage() {
  job++;
  worker.postMessage({ id: job, field, scoring: scoringState(state) });
}

// Whether a camera's view crosses the robot (see clip.js); the page flags it, and the maps still score
// the camera as set. Nothing crosses when views across the robot are allowed.
function crossesRobot(camera) {
  if (state.allowViewsAcross) return false;
  const mount = { forward: camera.forwardMeters, left: camera.leftMeters };
  return !viewFacesOut(robotSize(), mount, camera.yawDegrees, intrinsics(camera).halfWidthDegrees, state.viewAcrossMeters);
}

// The part of each camera's view over the robot, in field coordinates, and how to show it: 'soft'
// (information) or 'warn' (the rule is on and the view crosses further than allowed).
function overlapsOf(pose) {
  const size = robotSize();
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return state.cameras.map((camera) => {
    const mount = { forward: camera.forwardMeters, left: camera.leftMeters };
    const half = intrinsics(camera).halfWidthDegrees;
    const local = viewOverRobot(size, mount, camera.yawDegrees, half);
    return {
      polygon: local.map(([x, y]) => [pose.x + x * c - y * s, pose.y + x * s + y * c]),
      style: overlapStyle(size, mount, camera.yawDegrees, half, state.viewAcrossMeters, state.allowViewsAcross),
    };
  });
}

// The warning under each camera's card: which way would face out.
function renderCameraWarnings() {
  for (const line of document.querySelectorAll('.camera-warning')) {
    const camera = state.cameras[Number(line.dataset.index)];
    if (!camera || !crossesRobot(camera)) {
      line.hidden = true;
      continue;
    }
    const mount = { forward: camera.forwardMeters, left: camera.leftMeters };
    const runs = outwardYawRuns(robotSize(), mount, intrinsics(camera).halfWidthDegrees, state.viewAcrossMeters);
    const faces = runs.length === 0 ? 'no yaw faces out from this mount' : `yaw ${trimmed(runs[0].from, 0)} to ${trimmed(runs[0].to, 0)} would face out`;
    line.textContent = `This camera's view crosses the robot (${faces}).`;
    line.hidden = false;
  }
}

function lookFromHere() {
  const scoring = scoringState(state);
  const pose = robotPose(state);
  const cameras = prepareCameras(scoring.cameras);
  // The other robots stand where they were put.
  const size = scoring.robotSize;
  const others = state.otherRobots.robots.map((r) =>
    box(r.x, r.y, r.headingDegrees * DEG, size.length / 2, size.width / 2, scoring.otherRobots.heightMeters),
  );
  const looks = viewsAt(field, cameras, pose, scoring.settings, { elements: true, robots: others });
  here = {
    pose,
    others,
    cameras: looks.map((look, i) => ({ ...look, name: cameras[i].name })),
    overlaps: overlapsOf(pose),
    eigenvalues: combine(
      looks.map((l) => l.view),
      scoring.settings.gyroErrorDegrees * DEG,
    ),
  };
}

function draw() {
  if (!field || !here) return;
  $('legend3d').hidden = !(mode === '3d' && show.map && coverage);
  const scene = sceneNow();
  if (mode === '3d') {
    if (view3d) view3d.render(scene);
  } else {
    drawScene(canvas, scene);
  }
}

// The scene the drawings take: the field, the robot, the cameras' looks and what to show.
function sceneNow() {
  return {
    field,
    pose: here.pose,
    robotSize: robotSize(),
    cameras: here.cameras,
    others: here.others,
    selectedOther,
    coverage,
    map: state.map,
    show,
    overlaps: here.overlaps,
    selected,
    sightMeters: state.sightMeters,
    errorScale: units.errorScale,
  };
}

// ---- The camera's view ----

function renderEye() {
  if (!here || here.cameras.length === 0) return;
  const camera = here.cameras[Math.min(selected, here.cameras.length - 1)];
  drawEye($('eye'), { located: camera.located, results: camera.results, color: CAMERA_COLORS[selected % 8] });
  const k = camera.located.intrinsics;
  const seen = camera.results.filter((r) => r.status === SEEN).length;
  const count = seen === 0 ? 'no tags' : seen === 1 ? '1 tag' : `${seen} tags`;
  $('eye-note').textContent = `${camera.name}: ${k.width} x ${k.height} pixels in the image, ${count} seen. Dashed tags are in view but not seen.`;
}

// Picks the camera whose view is shown, from its card, the menu or its wedge on the field.
function selectCamera(index) {
  selected = Math.max(0, Math.min(state.cameras.length - 1, index));
  $('eye-camera').value = String(selected);
  document.querySelectorAll('details.camera').forEach((card, i) => card.classList.toggle('selected', i === selected));
  draw();
  renderEye();
}

function fillEyeMenu() {
  const menu = $('eye-camera');
  menu.replaceChildren(...state.cameras.map((c, i) => option(String(i), c.name)));
  menu.value = String(selected);
}

// The camera whose view from above holds the point, the nearest one if several do, or -1.
function cameraAtPoint(x, y) {
  if (!show.views) return -1;
  let found = -1;
  let nearest = Infinity;
  here.cameras.forEach((camera, i) => {
    const [cx, cy] = camera.located.position;
    const r = camera.located.rotation;
    const away = Math.hypot(x - cx, y - cy);
    const off = Math.atan2(y - cy, x - cx) - Math.atan2(r[1][0], r[0][0]);
    const across = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
    if (away <= state.sightMeters && across <= camera.located.intrinsics.halfWidthDegrees * DEG && away < nearest) {
      found = i;
      nearest = away;
    }
  });
  return found;
}

function renderPoseInputs() {
  setValue($('pose-x'), longText(state.pose.x));
  setValue($('pose-y'), longText(state.pose.y));
  setValue($('pose-heading'), state.pose.headingDegrees);
}

// The same, even for the input that has the focus.
function renderPoseInputsNow() {
  $('pose-x').value = longText(state.pose.x);
  $('pose-y').value = longText(state.pose.y);
  $('pose-heading').value = String(state.pose.headingDegrees);
}

// Sets an input's value unless someone is typing in it.
function setValue(input, value) {
  if (document.activeElement !== input) input.value = String(value);
}

// ---- What each camera sees ----

const REASONS = {
  [FACING_AWAY]: 'facing away',
  [TOO_FAR]: 'too far',
  [OUTSIDE_IMAGE]: 'outside the image',
  [TOO_SMALL]: 'too small',
};

function renderSees() {
  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr><th>Camera</th><th>Tags seen: size in the camera\'s image, distance away</th><th>In view but not seen</th></tr></thead>';
  const body = document.createElement('tbody');
  here.cameras.forEach((camera, i) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.innerHTML = `<span class="dot" style="background:${CAMERA_COLORS[i % 8]}"></span>`;
    name.append(camera.name);
    const seenCell = document.createElement('td');
    const seen = camera.results.filter((r) => r.status === SEEN).sort((a, b) => a.distance - b.distance);
    if (seen.length === 0) {
      seenCell.className = 'unseen';
      seenCell.textContent = 'None';
    }
    for (const r of seen) {
      const line = document.createElement('div');
      line.textContent = `Tag ${r.id}: ${Math.round(r.pixels)} px wide in the image, ${units.distance(r.distance)} away`;
      seenCell.append(line);
    }
    if (camera.view.tags > 0 && !camera.view.ok) {
      const note = document.createElement('div');
      note.className = 'unseen';
      note.textContent = `Over ${units.distance(state.noise.cutoffMeters)} away on average, so the robot ignores them`;
      seenCell.append(note);
    }
    // Tags within the camera's view from above and not too far beyond its range.
    const unseen = camera.results
      .filter((r) => r.status !== SEEN && r.inWedge && r.distance <= state.sightMeters * 1.5)
      .sort((a, b) => a.id - b.id)
      .map((r) => `${r.id} ${r.status === HIDDEN ? `behind ${r.hiddenBy}` : REASONS[r.status]}`);
    const unseenCell = cell(unseen.length > 0 ? unseen.join('; ') : 'None', 'unseen');
    tr.append(name, seenCell, unseenCell);
    body.append(tr);
  });
  table.append(body);
  const summary = document.createElement('p');
  summary.className = 'note';
  const measuring = here.cameras.filter((c) => c.view.ok).length;
  summary.textContent =
    here.eigenvalues === null
      ? 'From here no camera measures where the robot is.'
      : `From here ${measuring} ${measuring === 1 ? 'camera measures' : 'cameras measure'}; the estimated error is within ${errorText(within95([here.eigenvalues]))} 95% of the time.`;
  $('sees').replaceChildren(summary, table);
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

// ---- Coverage ----

function describeSamples(result) {
  const positions = result.cells.filter((c) => c).length;
  const each = result.arrangements > 1 ? `, each with ${result.arrangements} arrangements of other robots` : '';
  return `${positions} positions about ${units.grid(result.grid.stepX)} apart, 8 headings at each${each}.`;
}

function renderMaps() {
  const select = $('map');
  select.replaceChildren(...MAPS.map((map) => option(map.id, map.label)));
  select.value = state.map;
  select.addEventListener('change', () => {
    state.map = select.value;
    renderCoverage();
    update({});
  });
}

function renderCoverage() {
  renderLegend();
  const numbers = $('numbers');
  numbers.replaceChildren();
  $('worst').replaceChildren();
  if (!coverage) return;
  const f = coverage.field;
  const tiles = [
    ['oneTag', percent(f.oneTag), 'of the field: at least one tag'],
    ['twoTags', percent(f.twoTags), 'of the field: two or more tags in one camera'],
    ['twoCameras', percent(f.twoCameras), 'of the field: two or more cameras see a tag'],
    [
      'error',
      f.within95 === Infinity ? 'Not enough' : errorText(f.within95),
      f.within95 === Infinity
        ? `of the field covered for an error: ${percent(f.measured)} measured, 95% needed`
        : 'estimated error, within it on 95% of the field',
    ],
  ];
  for (const [id, value, what] of tiles) numbers.append(tile(value, what, id === state.map));
  const lost = coverage.oneLost;
  if (!lost) {
    numbers.append(tile('Nothing left', 'with one camera lost: a single camera has no spare', false));
  } else if (lost.within95 === Infinity) {
    numbers.append(
      tile('Not enough', `with any one camera lost, at worst: ${percent(lost.measured)} of the field measured`, false),
    );
  } else {
    numbers.append(
      tile(
        errorText(lost.within95),
        `with any one camera lost, at worst (${percent(lost.measured)} of the field measured)`,
        false,
      ),
    );
  }
  renderWorst();
}

function tile(value, what, current) {
  const div = document.createElement('div');
  div.className = current ? 'number current' : 'number';
  const v = document.createElement('div');
  v.className = 'value';
  v.textContent = value;
  const w = document.createElement('div');
  w.className = 'what';
  w.textContent = what;
  div.append(v, w);
  return div;
}

function renderLegend() {
  const legend = $('legend');
  const stops = scaleStops();
  const bar = document.createElement('span');
  bar.className = 'bar';
  bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
  const isError = state.map === 'error';
  const low = document.createElement('span');
  low.textContent = isError ? `${units.scaleLabel(units.errorScale.poor)} or more` : 'At no heading';
  const high = document.createElement('span');
  high.textContent = isError ? `${units.scaleLabel(units.errorScale.good)} or less` : 'At every heading';
  const none = document.createElement('span');
  none.innerHTML = '<span class="swatch blind"></span>';
  none.append('Blind at some heading (over 5% unmeasured)');
  const blank = document.createElement('span');
  blank.innerHTML = '<span class="swatch" style="background:var(--carpet);border:1px solid var(--border)"></span>';
  blank.append('No room for the robot at any heading');
  const over = document.createElement('span');
  over.innerHTML = '<span class="swatch over"></span>';
  over.append("A camera's view over its own robot");
  const crossing = document.createElement('span');
  crossing.innerHTML = '<span class="swatch crossing"></span>';
  crossing.append('A view crossing the robot further than allowed');
  const parts = [low, bar, high];
  if (isError) parts.push(none);
  if (field && field.elements.length > 0) parts.push(blank);
  parts.push(over, crossing);
  legend.replaceChildren(...parts);
  // The same, smaller, on the 3D view.
  $('legend3d').replaceChildren(...parts.map((p) => p.cloneNode(true)));
}

function renderWorst() {
  const cells = coverage.cells
    .map((values, i) => ({ values, cell: coverage.grid.cells[i] }))
    .filter((c) => c.values);
  const score = (c) => (c.values[state.map] === Infinity ? -1 : goodness(state.map, c.values[state.map]));
  const worst = cells.sort((a, b) => score(a) - score(b)).slice(0, 3);
  const box = $('worst');
  const heading = document.createElement('div');
  heading.textContent = 'The worst spots on this map (pick one to put the robot there):';
  const list = document.createElement('ul');
  for (const w of worst) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = `x ${units.distance(w.cell.x)}, y ${units.distance(w.cell.y)}`;
    button.addEventListener('click', () => placeRobot(w.cell.x, w.cell.y));
    const value = w.values[state.map];
    let text;
    if (state.map === 'error') {
      text = value === Infinity ? 'no measurement at some headings' : `error ${errorText(value)}`;
    } else {
      text = `${percent(value)} of headings`;
    }
    li.append(button, `: ${text}`);
    list.append(li);
  }
  box.replaceChildren(heading, list);
}

// ---- What a square says ----

// The index of the map square holding a field point, or -1 when there is none (or no map yet).
function squareAt(x, y) {
  if (!coverage || !show.map) return -1;
  const g = coverage.grid;
  const column = Math.floor((x - g.margin) / g.stepX);
  const row = Math.floor((y - g.margin) / g.stepY);
  if (column < 0 || row < 0 || column >= g.columns || row >= g.rows) return -1;
  return row * g.columns + column;
}

const HEADING_REASONS = {
  [HEADING_NO_ROOM]: () => 'no room',
  [HEADING_NO_TAGS]: () => 'no tags in view',
  [HEADING_TOO_FAR]: () => `tags only farther than ${units.distance(state.noise.cutoffMeters ?? Infinity)} on average, which the robot ignores`,
};

// What a square with no room overlaps, by name: the elements at every heading, else any heading.
function overlappedBy(cell, offset) {
  const sets = [];
  for (let h = 0; h < 8; h++) {
    const outline = robotOutline({ x: cell.x, y: cell.y, heading: headingAt(offset, h) }, robotSize());
    sets.push(elementsHit(field, outline));
  }
  const always = sets[0].filter((name) => sets.every((names) => names.includes(name)));
  return always.length > 0 ? always : [...new Set(sets.flat())];
}

// The lines of a square's card: where it is, what it scored on the current map, at how many
// headings it was measured and why not at the others.
function squareLines(index) {
  const g = coverage.grid;
  const cell = g.cells[index];
  const offset = headingOffset(cell.column, cell.row);
  const lines = [['title', `x ${units.distance(cell.x)}, y ${units.distance(cell.y)}`]];
  const values = coverage.cells[index];
  if (!values) {
    const names = overlappedBy(cell, offset);
    lines.push(['', 'No room for the robot here.']);
    lines.push(['why', names.length > 0 ? `A robot here overlaps ${names.join(' and ')} at every heading.` : 'A robot here overlaps a field element.']);
    return lines;
  }
  const value = values[state.map];
  const label = MAPS.find((m) => m.id === state.map).label;
  const text =
    state.map === 'error'
      ? value === Infinity
        ? 'no measurement at some headings'
        : errorText(value)
      : `${percent(value)} of headings`;
  lines.push(['', `${label}: ${text}`]);
  const codes = Array.from(coverage.headings.slice(index * 8, index * 8 + 8));
  const fit = codes.filter((c) => c !== HEADING_NO_ROOM).length;
  const measured = codes.filter((c) => c === HEADING_MEASURED).length;
  const room = fit < 8 ? ` (${8 - fit} with no room for the robot)` : '';
  lines.push(['', `Measured at ${measured} of ${fit} headings${room}.`]);
  // The headings with no fix, those with the same reason together.
  const byReason = new Map();
  codes.forEach((code, h) => {
    if (code === HEADING_MEASURED) return;
    const degrees = Math.round(((headingAt(offset, h) / DEG) % 360 + 360) % 360);
    byReason.set(code, [...(byReason.get(code) || []), `${degrees}°`]);
  });
  for (const [code, facings] of byReason) {
    const list = facings.length > 1 ? `${facings.slice(0, -1).join(', ')} and ${facings.at(-1)}` : facings[0];
    lines.push(['why', `facing ${list}: ${HEADING_REASONS[code]()}`]);
  }
  lines.push(['why', 'Scored at the center of the square.']);
  return lines;
}

// Shows the card for the square at a field point, beside the pointer, or hides it.
function showSquareCard(x, y, clientX, clientY, wrap) {
  const card = $('cell-card');
  const index = squareAt(x, y);
  if (index < 0) {
    card.hidden = true;
    return;
  }
  card.replaceChildren(
    ...squareLines(index).map(([kind, text]) => {
      const line = document.createElement('div');
      if (kind) line.className = kind;
      line.textContent = text;
      return line;
    }),
  );
  card.hidden = false;
  const rect = wrap.getBoundingClientRect();
  let left = clientX - rect.left + 14;
  let top = clientY - rect.top + 14;
  if (left + card.offsetWidth > rect.width) left = clientX - rect.left - card.offsetWidth - 14;
  if (top + card.offsetHeight > rect.height) top = Math.max(0, rect.height - card.offsetHeight);
  card.style.left = `${Math.max(0, left)}px`;
  card.style.top = `${top}px`;
}

function hideSquareCard() {
  $('cell-card').hidden = true;
}

// ---- Robot, cameras, other robots and noise ----

function bindNumber(input, write, changes) {
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (input.value === '' || !Number.isFinite(value)) return;
    write(value);
    update(changes);
  });
}

function renderSettings() {
  $('robot-length').value = shortText(state.robot.lengthMeters);
  $('robot-width').value = shortText(state.robot.widthMeters);
  $('robot-height').value = shortText(state.robot.heightMeters);
  $('corner-noise').value = state.noise.cornerNoisePixels;
  $('gyro-error').value = state.noise.gyroErrorDegrees;
  $('allow-across').checked = state.allowViewsAcross;
  $('view-across').disabled = state.allowViewsAcross;
  $('view-across').value = shortText(state.viewAcrossMeters);
  $('no-cutoff').checked = state.noise.cutoffMeters === null;
  $('cutoff').disabled = state.noise.cutoffMeters === null;
  $('cutoff').value = trimmed(units.toLong(state.noise.cutoffMeters ?? VISION.maxDistanceMeters), 1);
  $('sight').value = trimmed(units.toLong(state.sightMeters), 1);
  $('others-height').value = shortText(state.otherRobots.heightMeters);
}

function initSettings() {
  const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
  const full = { coverage: true };
  bindNumber(
    $('robot-length'),
    (v) => {
      state.robot.lengthMeters = clamp(units.fromShort(v), 10 * INCH, 60 * INCH);
      robotSizeChanged();
    },
    full,
  );
  bindNumber(
    $('robot-width'),
    (v) => {
      state.robot.widthMeters = clamp(units.fromShort(v), 10 * INCH, 60 * INCH);
      robotSizeChanged();
    },
    full,
  );
  bindNumber($('robot-height'), (v) => (state.robot.heightMeters = clamp(units.fromShort(v), 6 * INCH, 60 * INCH)), {});
  bindNumber($('corner-noise'), (v) => (state.noise.cornerNoisePixels = clamp(v, 0.01, 5)), full);
  bindNumber($('gyro-error'), (v) => (state.noise.gyroErrorDegrees = clamp(v, 0, 10)), full);
  bindNumber($('cutoff'), (v) => (state.noise.cutoffMeters = clamp(units.fromLong(v), 1, 50)), full);
  $('no-cutoff').addEventListener('change', () => {
    state.noise.cutoffMeters = $('no-cutoff').checked ? null : VISION.maxDistanceMeters;
    renderSettings();
    update(full);
  });
  bindNumber($('sight'), (v) => (state.sightMeters = clamp(units.fromLong(v), 1, 20)), full);
  bindNumber($('others-height'), (v) => (state.otherRobots.heightMeters = clamp(units.fromShort(v), INCH, 80 * INCH)), full);
  $('allow-across').addEventListener('change', () => {
    state.allowViewsAcross = $('allow-across').checked;
    $('view-across').disabled = state.allowViewsAcross;
    update({});
  });
  bindNumber($('view-across'), (v) => (state.viewAcrossMeters = clamp(units.fromShort(v), MOST_ACROSS[0], MOST_ACROSS[1])), {});
  $('add-other').addEventListener('click', addOther);
  $('place-random').addEventListener('click', placeAtRandom);
  for (const layout of LAYOUT_PRESETS) $('layout').append(option(layout.id, layout.label));
  $('apply-layout').addEventListener('click', () => {
    state.cameras = layoutCameras($('layout').value, state.robot);
    renderCameras(0);
    update(full);
  });
  $('add-camera').addEventListener('click', () => {
    if (state.cameras.length >= MOST_CAMERAS) return;
    const camera = cameraAt('front', state.robot);
    camera.name = `camera ${state.cameras.length + 1}`;
    state.cameras.push(camera);
    renderCameras(state.cameras.length - 1);
    update(full);
  });
  renderSettings();
}

function renderCameras(open = 0) {
  const box = $('cameras');
  box.replaceChildren();
  state.cameras.forEach((camera, i) => box.append(cameraCard(camera, i, i === open)));
  selected = Math.min(open, state.cameras.length - 1);
  fillEyeMenu();
  box.children[selected]?.classList.add('selected');
  $('add-camera').disabled = state.cameras.length >= MOST_CAMERAS;
  $('add-camera').textContent =
    state.cameras.length >= MOST_CAMERAS ? `Up to ${MOST_CAMERAS} cameras` : 'Add a camera';
}

function cameraCard(camera, index, open) {
  const details = document.createElement('details');
  details.className = 'camera';
  details.open = open;
  const summary = document.createElement('summary');
  const brief = document.createElement('span');
  brief.className = 'brief';
  const title = document.createElement('span');
  const refresh = () => {
    title.textContent = camera.name;
    if ($('eye-camera').options[index]) $('eye-camera').options[index].textContent = camera.name;
    brief.textContent = `yaw ${camera.yawDegrees}°, ${units.length(camera.upMeters)} up`;
  };
  refresh();
  summary.innerHTML = `<span class="dot" style="background:${CAMERA_COLORS[index % 8]}"></span>`;
  summary.append(title, brief);
  summary.addEventListener('click', () => selectCamera(index));
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'body';
  const changed = () => {
    refresh();
    update({ coverage: true });
  };

  const nameRow = row();
  const name = textInput('Name', camera.name, (v) => {
    camera.name = v.trim() || `camera ${index + 1}`;
    changed();
  });
  const preset = document.createElement('select');
  for (const p of CAMERA_PRESETS) preset.append(option(p.id, p.label));
  preset.append(option(CUSTOM, 'Custom'));
  preset.value = camera.preset;
  const presetLabel = labelled('Camera', preset);
  presetLabel.className = 'wide';
  nameRow.append(name, presetLabel);
  body.append(nameRow);

  const lensRow = row();
  const width = numberInput('Image width (pixels)', camera.widthPixels, 1, (v) => (camera.widthPixels = Math.round(v)));
  const height = numberInput('Image height (pixels)', camera.heightPixels, 1, (v) => (camera.heightPixels = Math.round(v)));
  const fov = numberInput('View (°)', camera.fovDegrees, 1, (v) => (camera.fovDegrees = v));
  const across = document.createElement('select');
  across.append(option('horizontal', 'Across'), option('diagonal', 'Diagonal'));
  across.value = camera.fovAcross;
  lensRow.append(width, height, fov, labelled('View is', across));
  body.append(lensRow);
  const lensInputs = [width, height, fov].map((l) => l.querySelector('input'));
  // Editing the lens makes it a custom camera.
  for (const input of lensInputs) {
    input.addEventListener('input', () => {
      camera.preset = CUSTOM;
      preset.value = CUSTOM;
    });
  }
  across.addEventListener('change', () => {
    camera.fovAcross = across.value;
    camera.preset = CUSTOM;
    preset.value = CUSTOM;
    changed();
  });
  preset.addEventListener('change', () => {
    camera.preset = preset.value;
    const p = CAMERA_PRESETS.find((x) => x.id === preset.value);
    if (p) {
      camera.widthPixels = p.widthPixels;
      camera.heightPixels = p.heightPixels;
      camera.fovDegrees = p.fovDegrees;
      camera.fovAcross = p.fovAcross;
      lensInputs[0].value = p.widthPixels;
      lensInputs[1].value = p.heightPixels;
      lensInputs[2].value = p.fovDegrees;
      across.value = p.fovAcross;
    }
    changed();
  });

  const placeRow = row();
  placeRow.append(
    lengthInput('Forward', camera.forwardMeters, (m) => (camera.forwardMeters = m)),
    lengthInput('Left', camera.leftMeters, (m) => (camera.leftMeters = m)),
    lengthInput('Up', camera.upMeters, (m) => (camera.upMeters = m)),
  );
  body.append(placeRow);
  const turnRow = row();
  turnRow.append(
    numberInput('Yaw (°)', camera.yawDegrees, 5, (v) => (camera.yawDegrees = v)),
    numberInput('Tilt up (°)', camera.tiltUpDegrees, 1, (v) => (camera.tiltUpDegrees = v)),
  );
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.disabled = state.cameras.length <= 1;
  remove.addEventListener('click', () => {
    state.cameras.splice(index, 1);
    renderCameras(Math.max(0, index - 1));
    update({ coverage: true });
  });
  turnRow.append(remove);
  body.append(turnRow);
  // The angles Best angles may choose from: empty is no limit (yaw any way, tilt 0 to 30).
  const limitsRow = row();
  limitsRow.className = 'row limits';
  limitsRow.append(
    limitInput('Yaw from (°)', 'yawMin'),
    limitInput('to', 'yawMax'),
    limitInput('Tilt from (°)', 'tiltMin'),
    limitInput('to', 'tiltMax'),
  );
  const warning = document.createElement('p');
  warning.className = 'warning camera-warning';
  warning.dataset.index = String(index);
  warning.hidden = true;
  body.append(warning);
  const limitsHint = document.createElement('p');
  limitsHint.className = 'hint';
  limitsHint.textContent = 'Limits for Best angles, from the robot\'s own frame (empty: no limit).';
  body.append(limitsHint, limitsRow);
  details.append(body);

  // A limit for Best angles: a number, or empty for none. It does not change the scoring, so only
  // the link is brought up to date.
  function limitInput(text, key) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '5';
    input.placeholder = 'any';
    input.value = camera[key] === null || camera[key] === undefined ? '' : String(camera[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      camera[key] = input.value === '' || !Number.isFinite(v) ? null : v;
      update({});
    });
    return labelled(text, input);
  }

  // A length in the page's short unit, kept in meters.
  function lengthInput(text, meters, write) {
    return numberInput(`${text} (${units.shortLabel})`, Number(shortText(meters)), units.shortStep, (v) => write(units.fromShort(v)));
  }

  function numberInput(text, value, step, write) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) return;
      write(v);
      changed();
    });
    return labelled(text, input);
  }
  return details;
}

function row() {
  const div = document.createElement('div');
  div.className = 'row';
  return div;
}

function labelled(text, control) {
  const label = document.createElement('label');
  label.append(text, control);
  return label;
}

function textInput(text, value, write) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 24;
  input.addEventListener('input', () => write(input.value));
  return labelled(text, input);
}

// ---- Driving ----

// While the field (top or 3D) has focus, held keys drive the robot: a frame at a time, at a speed
// per second, so the path does not depend on the frame rate (see drive.js). Nothing here runs from
// the page's inputs: only keys pressed on the field itself count.
const heldKeys = new Set();
let driveRelative = FIELD_RELATIVE;
let driveFrame = 0; // the pending animation frame, or 0
let driveFrom = 0; // when the last frame was drawn
let drivePose = null; // the robot's exact pose while it is driving: the page keeps it rounded
let gamepads = 0; // how many gamepads are plugged in

function initKeys(target) {
  target.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Delete' || event.code === 'Backspace') {
      if (selectedOther < 0) return;
      event.preventDefault();
      removeOther(selectedOther);
    } else if (DRIVE_CODES.includes(event.code)) {
      event.preventDefault();
      heldKeys.add(event.code);
      startDriving();
    }
  });
  target.addEventListener('keyup', (event) => heldKeys.delete(event.code));
  target.addEventListener('blur', () => heldKeys.clear());
}

// The first gamepad's input, when the field is what the person is on (not a box they are typing in).
function gamepadAsks() {
  if (gamepads === 0 || !document.hasFocus()) return null;
  const on = document.activeElement;
  if (on && ['INPUT', 'SELECT', 'TEXTAREA'].includes(on.tagName)) return null;
  const pad = [...navigator.getGamepads()].find((p) => p);
  return pad ? inputFromGamepad(pad) : null;
}

function startDriving() {
  if (driveFrame === 0 && field) {
    driveFrom = performance.now();
    driveFrame = requestAnimationFrame(driveFrameStep);
  }
}

function driveFrameStep(now) {
  driveFrame = 0;
  const seconds = Math.min((now - driveFrom) / 1000, 0.05);
  driveFrom = now;
  const keys = inputFromKeys(heldKeys);
  const input = asksForMotion(keys) ? keys : gamepadAsks() || keys;
  if (asksForMotion(input)) {
    if (!drivePose) drivePose = { ...state.pose };
    drivePose = driveStep(field, robotSize(), drivePose, input, seconds, driveRelative, outlinesBesides(MAIN));
    // Only what is cheap: where it looks from here. The maps do not depend on where the robot is.
    state.pose = asKept(field, robotSize(), drivePose, outlinesBesides(MAIN));
    $('spot').value = '';
    update({});
  } else {
    drivePose = null;
  }
  if (heldKeys.size > 0 || gamepads > 0) driveFrame = requestAnimationFrame(driveFrameStep);
}

function initDriving() {
  const mode = $('drive-mode');
  mode.append(option(FIELD_RELATIVE, 'Field-relative'), option(ROBOT_RELATIVE, 'Robot-relative'));
  mode.addEventListener('change', () => (driveRelative = mode.value));
  window.addEventListener('gamepadconnected', () => {
    gamepads++;
    startDriving();
  });
  window.addEventListener('gamepaddisconnected', () => (gamepads = Math.max(0, gamepads - 1)));
}

// ---- Moving the robot on the field ----

function initField() {
  let dragging = null;
  const pointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    return fieldView(canvas, field).toField(event.clientX - rect.left, event.clientY - rect.top);
  };
  // Whether a field point is on a robot (a little past its edge, to make it easy to grab).
  const onRobot = (pose, x, y) => {
    const size = robotSize();
    const heading = pose.headingDegrees * DEG;
    const dx = x - pose.x;
    const dy = y - pose.y;
    const along = dx * Math.cos(heading) + dy * Math.sin(heading);
    const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
    return Math.abs(along) <= size.length / 2 + 0.1 && Math.abs(across) <= size.width / 2 + 0.1;
  };
  // Whether a field point is on a robot's turning handle.
  const onHandle = (pose, x, y) => {
    const reach = robotSize().length / 2 + HANDLE_METERS;
    const heading = pose.headingDegrees * DEG;
    const hx = pose.x + reach * Math.cos(heading);
    const hy = pose.y + reach * Math.sin(heading);
    return Math.hypot(x - hx, y - hy) * fieldView(canvas, field).scale < 14;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!field) return;
    const [x, y] = pointer(event);
    const others = state.otherRobots.robots;
    dragging = null;
    if (onHandle(state.pose, x, y)) {
      dragging = { target: MAIN, turn: true };
    } else if (selectedOther >= 0 && onHandle(others[selectedOther], x, y)) {
      dragging = { target: selectedOther, turn: true };
    } else if (onRobot(state.pose, x, y)) {
      dragging = { target: MAIN, turn: false, dx: x - state.pose.x, dy: y - state.pose.y };
    } else {
      const hit = others.findIndex((r) => onRobot(r, x, y));
      if (hit >= 0) {
        if (hit !== selectedOther) selectOther(hit);
        dragging = { target: hit, turn: false, dx: x - others[hit].x, dy: y - others[hit].y };
      }
    }
    if (!dragging) {
      // Off the robots: a click in a camera's view picks that camera, and one on bare field lets go
      // of the placed robot.
      const camera = cameraAtPoint(x, y);
      if (camera >= 0) selectCamera(camera);
      if (selectedOther >= 0) selectOther(-1);
      // A touch has no hover: a tap on a square shows its card.
      if (event.pointerType !== 'mouse') showSquareCard(x, y, event.clientX, event.clientY, canvas.parentElement);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointerleave', hideSquareCard);
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      if (event.pointerType === 'mouse') {
        const [px, py] = pointer(event);
        showSquareCard(px, py, event.clientX, event.clientY, canvas.parentElement);
      }
      return;
    }
    hideSquareCard();
    const [x, y] = pointer(event);
    const robot = poseOf(dragging.target);
    if (dragging.turn) {
      let heading = Math.atan2(y - robot.y, x - robot.x) / DEG;
      heading = event.shiftKey ? Math.round(heading / 15) * 15 : Math.round(heading);
      turnRobot(heading, dragging.target);
    } else {
      slideRobot(x - dragging.dx, y - dragging.dy, dragging.target);
    }
  });
  const stop = () => {
    dragging = null;
    canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  for (const field of [canvas, $('field3d')]) initKeys(field);

  $('spot').addEventListener('change', () => {
    const spot = spotList()[Number($('spot').value)];
    if (!spot) return;
    state.pose = placeAt(field, robotSize(), spot.pose, outlinesBesides(MAIN)) || state.pose;
    update({});
  });
  const poseInput = (input, write) => {
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) return;
      write(v);
    });
    // Once they are done typing, show the value the robot ended up with if it was corrected.
    input.addEventListener('change', renderPoseInputsNow);
  };
  poseInput($('pose-x'), (v) => placeRobot(units.fromLong(v), state.pose.y));
  poseInput($('pose-y'), (v) => placeRobot(state.pose.x, units.fromLong(v)));
  poseInput($('pose-heading'), (v) => turnRobot(v));

  for (const season of SEASONS) $('season').append(option(String(season.year), `${season.year} ${season.game}`));
  $('season').value = String(state.season);
  $('season').addEventListener('change', () => {
    state.pose = null;
    state.otherRobots.robots = [];
    selectedOther = -1;
    setSeason(Number($('season').value));
  });
  new ResizeObserver(draw).observe(canvas);
  new ResizeObserver(renderEye).observe($('eye'));
}

// ---- Sharing ----

function initSharing() {
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      $('copied').textContent = done;
    } catch {
      $('copied').textContent = 'Could not reach the clipboard; the link is in the address bar.';
    }
  };
  $('copy-link').addEventListener('click', () => {
    history.replaceState(null, '', toHash(state));
    copy(location.href, 'Link copied.');
  });
  $('copy-json').addEventListener('click', () => copy(toJson(state), 'JSON copied.'));
}

// ---- Small helpers ----

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function percent(share) {
  return `${(share * 100).toFixed(1)}%`;
}

// The estimate's error as shown: in inches or centimeters.
function errorText(meters) {
  return meters === Infinity ? 'no measurement' : units.error(meters);
}

// A field position as typed in a box, in feet or meters, to a thousandth.
function longText(meters) {
  return String(Number(units.toLong(meters).toFixed(3)));
}

// A size, mount or height as typed in a box, in inches or centimeters, to a hundredth.
function shortText(meters) {
  return trimmed(units.toShort(meters), 2);
}

// ---- Start ----

initTheme();
initUnits();
initSettings();
initShow();
initViews();
initDriving();
finder = initFinder({
  $,
  context: () => {
    const lens = state.cameras[Math.min(selected, state.cameras.length - 1)];
    const preset = CAMERA_PRESETS.find((p) => p.id === lens.preset);
    return {
      field,
      state,
      scoring: scoringState(state),
      units,
      lens,
      lensLabel: preset ? preset.label : `${lens.widthPixels} x ${lens.heightPixels}, ${lens.fovDegrees}° ${lens.fovAcross}`,
      seasonLabel: SEASONS.map((s) => (s.year === state.season ? `${s.year} ${s.game}` : null)).find(Boolean),
    };
  },
  getCameras: () => state.cameras.map((c) => ({ ...c })),
  setCameras: (cameras) => {
    state.cameras = cameras;
    renderCameras(0);
    update({ coverage: true });
  },
});
angles = initAngles({
  $,
  context: () => ({ field, state, scoring: scoringState(state), units }),
  getCameras: () => state.cameras.map((c) => ({ ...c })),
  setCameras: (cameras) => {
    state.cameras = cameras;
    renderCameras(0);
    update({ coverage: true });
  },
});
applyUnits();
$('eye-camera').addEventListener('change', () => selectCamera(Number($('eye-camera').value)));
renderCameras(0);
renderMaps();
initField();
initSharing();
setSeason(state.season);
