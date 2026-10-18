// Drawing the field from above: the walls, the field elements, the tags, the coverage map, the
// robot with its cameras' views and sight lines, and other robots.

import { BLANK, UNMEASURED, blendCells } from './blend.js';
import { horizon, tagsInImage } from './eye.js';
import { boxCorners } from './robots.js';
import { HIDDEN, SEEN } from './visibility.js';

export const CAMERA_COLORS = [
  '#e8590c',
  '#1c7ed6',
  '#2f9e44',
  '#ae3ec9',
  '#c2255c',
  '#0c8599',
  '#f08c00',
  '#5f3dc4',
];

// A colorblind-safe scale from poor (dark purple) to good (yellow), as viridis runs.
const SCALE = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];

// The handle that turns the robot sits this far ahead of its front, in meters.
export const HANDLE_METERS = 0.35;

// The error the maps read as good and as poor, in meters, when nothing else is said: 1 cm and 8 cm.
export const ERROR_SCALE = { good: 0.01, poor: 0.08 };

// How a map's value reads as good (1) or poor (0). Shares are good when high; the error is good
// at the scale's `good` and poor from its `poor`.
export function goodness(map, value, scale = ERROR_SCALE) {
  if (map !== 'error') return value;
  return 1 - Math.min(1, Math.max(0, (value - scale.good) / (scale.poor - scale.good)));
}

// The scale's color at a point from 0 (poor) to 1 (good), as [red, green, blue].
export function scaleRgb(t) {
  const x = Math.min(1, Math.max(0, t)) * (SCALE.length - 1);
  const i = Math.min(SCALE.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(SCALE[i]);
  const b = hex(SCALE[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}

export function scaleColor(t) {
  return `rgb(${scaleRgb(t).join(',')})`;
}

export function scaleStops() {
  return SCALE.slice();
}

function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

// A theme color, by its CSS variable's name.
export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Where the field sits on the canvas: meters to pixels and back. The blue alliance's wall is on
// the left, and +y is up.
export function fieldView(canvas, field) {
  const pad = 14;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = Math.min((width - 2 * pad) / field.length, (height - 2 * pad) / field.width);
  const left = (width - field.length * scale) / 2;
  const top = (height - field.width * scale) / 2;
  return {
    scale,
    toCanvas: (x, y) => [left + x * scale, top + (field.width - y) * scale],
    toField: (px, py) => [(px - left) / scale, field.width - (py - top) / scale],
  };
}

// Draws everything. `scene` has the field, the robot's pose and size, the cameras as placed with
// their looks at the tags, the other robots, the coverage result and which map to show (with the
// error scale it is read on), and `show`,
// what to draw (see show.js). What is not drawn still counts: it is only left off the picture.
export function drawScene(canvas, scene) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const field = scene.field;
  const view = fieldView(canvas, field);
  const s = view.scale;
  const show = scene.show;

  // The carpet and the walls.
  const [x0, y0] = view.toCanvas(0, field.width);
  ctx.fillStyle = css('--carpet');
  ctx.fillRect(x0, y0, field.length * s, field.width * s);
  if (scene.coverage && show.map) drawMap(ctx, view, scene.coverage, scene.map, scene.errorScale, show.blend);
  ctx.strokeStyle = css('--wall');
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, field.length * s, field.width * s);
  // The center line and the alliance sides.
  ctx.strokeStyle = css('--line');
  ctx.lineWidth = 1;
  line(ctx, view.toCanvas(field.length / 2, 0), view.toCanvas(field.length / 2, field.width));
  ctx.fillStyle = css('--blue');
  ctx.fillRect(x0 - 6, y0, 4, field.width * s);
  ctx.fillStyle = css('--red');
  ctx.fillRect(x0 + field.length * s + 2, y0, 4, field.width * s);

  // Everything on the field is kept inside the walls: an element may reach past them.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, field.length * s, field.width * s);
  ctx.clip();

  // Field elements, the raised ones (a bar to drive under) lighter.
  for (const element of show.elements ? field.elements : []) {
    for (const block of element.blocks) {
      ctx.beginPath();
      block.outline.forEach(([x, y], i) => {
        const [px, py] = view.toCanvas(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = block.bottomMeters > 0.3 ? css('--element-raised') : css('--element');
      ctx.fill();
      ctx.strokeStyle = css('--element-edge');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Other robots.
  // The one picked has a heavier edge, and the handle that turns it.
  scene.others.forEach((other, i) => {
    if (!show.others) return;
    const picked = i === scene.selectedOther;
    polygon(ctx, view, boxCorners(other));
    ctx.fillStyle = css('--other-robot');
    ctx.fill();
    ctx.strokeStyle = picked ? css('--accent') : css('--other-robot-edge');
    ctx.lineWidth = picked ? 3 : 1;
    ctx.stroke();
    drawArrow(ctx, view, other, other.halfLength, css('--other-robot-edge'));
    if (picked) drawHandle(ctx, view, other, other.halfLength, css('--accent'));
  });

  // Each camera's view from above, then its sight lines.
  if (show.views) {
    scene.cameras.forEach((camera, i) => drawWedge(ctx, view, camera, CAMERA_COLORS[i % 8], scene, i === scene.selected));
  }
  const seenBy = new Set();
  scene.cameras.forEach((camera, i) => {
    const color = CAMERA_COLORS[i % 8];
    const from = view.toCanvas(camera.located.position[0], camera.located.position[1]);
    for (const r of camera.results) {
      if (r.status === SEEN) {
        seenBy.add(r.id);
        if (!show.seenLines) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        line(ctx, from, view.toCanvas(r.tag.position[0], r.tag.position[1]));
      } else if (r.status === HIDDEN && show.hiddenLines) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        line(ctx, from, view.toCanvas(r.tag.position[0], r.tag.position[1]));
        ctx.setLineDash([]);
      }
    }
  });
  ctx.restore();
  if (show.views) {
    scene.cameras.forEach((camera, i) => drawCameraName(ctx, view, camera, CAMERA_COLORS[i % 8], scene));
  }

  drawTags(ctx, view, field, seenBy, show.tagNumbers);
  drawRobot(ctx, view, scene);
  drawOverlaps(ctx, view, scene);
}

// The coverage map: the cells as colored squares, or (with `blend`) smoothed between the grid's
// points. `scale` is the error the map reads as good and poor (see goodness).
export function drawMap(ctx, view, coverage, map, scale, blend = false) {
  if (blend) {
    drawBlendedMap(ctx, view, coverage, map, scale);
    return;
  }
  const g = coverage.grid;
  const s = view.scale;
  coverage.cells.forEach((values, i) => {
    const cell = g.cells[i];
    const [px, py] = view.toCanvas(cell.x - g.stepX / 2, cell.y + g.stepY / 2);
    if (!values) return;
    const value = values[map];
    ctx.fillStyle = value === Infinity ? blindPattern(ctx) : scaleColor(goodness(map, value, scale));
    ctx.globalAlpha = 0.85;
    ctx.fillRect(px, py, g.stepX * s + 0.5, g.stepY * s + 0.5);
    ctx.globalAlpha = 1;
  });
}

// The fill for a square blind at some heading: warm diagonal stripes, nothing the scale uses.
function blindPattern(ctx) {
  const paper = document.createElement('canvas');
  paper.width = 8;
  paper.height = 8;
  const p = paper.getContext('2d');
  p.fillStyle = css('--blind-back');
  p.fillRect(0, 0, 8, 8);
  p.strokeStyle = css('--blind');
  p.lineWidth = 2;
  for (const offset of [-8, 0, 8]) {
    p.beginPath();
    p.moveTo(offset, 8);
    p.lineTo(offset + 8, 0);
    p.stroke();
  }
  return ctx.createPattern(paper, 'repeat');
}

// The blended raster for a map, painted on a small canvas, and kept while nothing it depends on
// changes (the page draws every frame while the robot drives).
let blended = null;

function blendedCanvas(coverage, map, scale) {
  const stripe = css('--blind');
  const back = css('--blind-back');
  const key = `${map}|${scale ? scale.good : ''}|${scale ? scale.poor : ''}|${stripe}|${back}`;
  if (blended && blended.coverage === coverage && blended.key === key) return blended.canvas;
  const g = coverage.grid;
  const raster = blendCells(g, coverage.cells, map);
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(raster.width, raster.height);
  const stripes = [hex(stripe), hex(back)];
  for (let py = 0; py < raster.height; py++) {
    // The raster's first row is the lowest y; the picture's is the top.
    const row = raster.height - 1 - py;
    for (let px = 0; px < raster.width; px++) {
      const at = row * raster.width + px;
      const out = 4 * (py * raster.width + px);
      if (raster.kinds[at] === BLANK) continue;
      // Blind squares are striped: a diagonal run of raster points every four.
      const color = raster.kinds[at] === UNMEASURED ? stripes[(px + py) % 4 < 2 ? 0 : 1] : scaleRgb(goodness(map, raster.values[at], scale));
      image.data.set([color[0], color[1], color[2], Math.round(0.85 * 255)], out);
    }
  }
  ctx.putImageData(image, 0, 0);
  blended = { coverage, key, canvas };
  return canvas;
}

function drawBlendedMap(ctx, view, coverage, map, scale) {
  const g = coverage.grid;
  const [left, top] = view.toCanvas(g.margin, g.margin + g.rows * g.stepY);
  ctx.save();
  // Each raster point is a few pixels wide on the screen: kept as squares, so the edges of cells
  // with nothing to show stay crisp.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(blendedCanvas(coverage, map, scale), left, top, g.columns * g.stepX * view.scale, g.rows * g.stepY * view.scale);
  ctx.restore();
}

// The selected camera's view has a heavier edge.
function drawWedge(ctx, view, camera, color, scene, selected) {
  const k = camera.located.intrinsics;
  const r = camera.located.rotation;
  // The lens's direction seen from above.
  const yaw = Math.atan2(r[1][0], r[0][0]);
  const half = (k.halfWidthDegrees * Math.PI) / 180;
  const reach = scene.sightMeters;
  const [cx, cy] = camera.located.position;
  const [px, py] = view.toCanvas(cx, cy);
  ctx.beginPath();
  ctx.moveTo(px, py);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const a = yaw - half + (2 * half * i) / steps;
    const [qx, qy] = view.toCanvas(cx + reach * Math.cos(a), cy + reach * Math.sin(a));
    ctx.lineTo(qx, qy);
  }
  ctx.closePath();
  ctx.globalAlpha = scene.show.map && scene.coverage ? 0.05 : 0.08;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3 : 1.25;
  ctx.stroke();
}

// A camera's name at the end of its view, kept inside the walls.
function drawCameraName(ctx, view, camera, color, scene) {
  const r = camera.located.rotation;
  const yaw = Math.atan2(r[1][0], r[0][0]);
  const [cx, cy] = camera.located.position;
  const reach = scene.sightMeters;
  const [lx, ly] = view.toCanvas(cx + reach * Math.cos(yaw), cy + reach * Math.sin(yaw));
  const [left, top] = view.toCanvas(0, scene.field.width);
  const [right, bottom] = view.toCanvas(scene.field.length, 0);
  ctx.font = '600 12px system-ui, sans-serif';
  const width = ctx.measureText(camera.name).width;
  const x = Math.min(right - width / 2 - 6, Math.max(left + width / 2 + 6, lx));
  const y = Math.min(bottom - 12, Math.max(top + 12, ly));
  ctx.fillStyle = css('--label-back');
  ctx.fillRect(x - width / 2 - 3, y - 9, width + 6, 17);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(camera.name, x, y);
}

// Each tag as a short bar across its face with a tick out of the face, the side it can be read
// from, and its number beside it (unless numbers are off).
function drawTags(ctx, view, field, seen, numbers) {
  const s = view.scale;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tag of field.tags) {
    const [x, y] = tag.position;
    const nx = tag.normal[0];
    const ny = tag.normal[1];
    const flat = Math.hypot(nx, ny) < 0.3;
    const color = seen.has(tag.id) ? css('--tag-seen') : css('--tag');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const [px, py] = view.toCanvas(x, y);
    if (flat) {
      ctx.fillRect(px - 3, py - 3, 6, 6);
    } else {
      const half = Math.max(0.12, 6 / s);
      const ax = -ny;
      const ay = nx;
      ctx.lineWidth = 3;
      line(ctx, view.toCanvas(x - ax * half, y - ay * half), view.toCanvas(x + ax * half, y + ay * half));
      ctx.lineWidth = 1.5;
      line(ctx, [px, py], view.toCanvas(x + nx * 0.18, y + ny * 0.18));
    }
    if (!numbers) continue;
    const [tx, ty] = view.toCanvas(x + nx * 0.42, y + ny * 0.42);
    ctx.fillText(String(tag.id), tx, ty);
  }
}

function drawRobot(ctx, view, scene) {
  const { pose, robotSize } = scene;
  const corners = boxCorners({
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    halfLength: robotSize.length / 2,
    halfWidth: robotSize.width / 2,
  });
  polygon(ctx, view, corners);
  ctx.fillStyle = css('--robot');
  ctx.fill();
  ctx.strokeStyle = css('--robot-edge');
  ctx.lineWidth = 3;
  ctx.stroke();
  drawArrow(ctx, view, pose, robotSize.length / 2, css('--robot-edge'));
  drawHandle(ctx, view, pose, robotSize.length / 2, css('--robot-edge'));
  // The cameras.
  scene.cameras.forEach((camera, i) => {
    const [px, py] = view.toCanvas(camera.located.position[0], camera.located.position[1]);
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = CAMERA_COLORS[i % 8];
    ctx.fill();
    ctx.strokeStyle = css('--surface');
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

// The part of each camera's view that lies over its own robot (`scene.overlaps`): a quiet tint in the
// camera's color, or the warning color for a view that crosses the robot further than allowed.
function drawOverlaps(ctx, view, scene) {
  if (!scene.show.views || !scene.overlaps) return;
  scene.overlaps.forEach((overlap, i) => {
    if (overlap.polygon.length === 0) return;
    polygon(ctx, view, overlap.polygon);
    const warn = overlap.style === 'warn';
    ctx.globalAlpha = warn ? 0.7 : 0.3;
    ctx.fillStyle = warn ? css('--warn') : CAMERA_COLORS[i % 8];
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// An arrow to a robot's front: `pose` has x, y and heading (radians), `halfLength` its half length.
function drawArrow(ctx, view, pose, halfLength, color) {
  const c = Math.cos(pose.heading);
  const sn = Math.sin(pose.heading);
  const tip = halfLength - 0.05;
  const back = tip - 0.22;
  const side = 0.12;
  polygon(ctx, view, [
    [pose.x + tip * c, pose.y + tip * sn],
    [pose.x + back * c - side * sn, pose.y + back * sn + side * c],
    [pose.x + back * c + side * sn, pose.y + back * sn - side * c],
  ]);
  ctx.fillStyle = color;
  ctx.fill();
}

// The handle that turns a robot, ahead of its front.
function drawHandle(ctx, view, pose, halfLength, color) {
  const c = Math.cos(pose.heading);
  const sn = Math.sin(pose.heading);
  const reach = halfLength + HANDLE_METERS;
  const [hx, hy] = view.toCanvas(pose.x + reach * c, pose.y + reach * sn);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  line(ctx, view.toCanvas(pose.x + halfLength * c, pose.y + halfLength * sn), [hx, hy]);
  ctx.beginPath();
  ctx.arc(hx, hy, 6, 0, 2 * Math.PI);
  ctx.fillStyle = css('--surface');
  ctx.fill();
  ctx.stroke();
}

function polygon(ctx, view, corners) {
  ctx.beginPath();
  corners.forEach(([x, y], i) => {
    const [px, py] = view.toCanvas(x, y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function line(ctx, [ax, ay], [bx, by]) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

// A camera's image, as the camera sees it: the frame at the camera's own resolution, the horizon,
// and each tag as the four corners it lands on, with its number and its size in pixels across, or
// dashed and faint with why it is not seen. `eye` has the camera as placed (`located`), its looks
// at the tags (`results`) and its color.
export function drawEye(canvas, eye) {
  const k = eye.located.intrinsics;
  const ratio = window.devicePixelRatio || 1;
  canvas.style.aspectRatio = `${k.width} / ${k.height}`;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext('2d');
  const s = w / k.width;
  ctx.setTransform(ratio * s, 0, 0, ratio * s, 0, 0);
  ctx.clearRect(0, 0, k.width, k.height);
  ctx.fillStyle = css('--eye-back');
  ctx.fillRect(0, 0, k.width, k.height);

  // Lines and text keep their size on the screen, whatever the image is scaled by.
  const px = (n) => n / s;
  const level = horizon(eye.located);
  if (level) {
    ctx.strokeStyle = css('--line');
    ctx.lineWidth = px(1);
    ctx.setLineDash([px(6), px(4)]);
    line(ctx, level[0], level[1]);
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, k.width, k.height);
  ctx.clip();
  ctx.font = `${px(11)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const labels = [];
  for (const tag of tagsInImage(eye.located, eye.results)) {
    const seen = tag.seen;
    const color = seen ? css('--tag-seen') : css('--muted');
    ctx.beginPath();
    tag.corners.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)));
    ctx.closePath();
    if (seen) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = px(seen ? 2 : 1.25);
    ctx.setLineDash(seen ? [] : [px(4), px(3)]);
    ctx.stroke();
    ctx.setLineDash([]);
    const top = Math.min(...tag.corners.map((c) => c[1]));
    const middle = tag.corners.reduce((total, c) => total + c[0], 0) / 4;
    const text = seen ? `${tag.id} · ${Math.round(tag.pixels)} px` : `${tag.id}: ${tag.reason}`;
    const half = ctx.measureText(text).width / 2;
    const x = Math.min(k.width - half - px(2), Math.max(half + px(2), middle));
    // A label that would sit on another goes a line higher.
    let y = Math.max(px(14), top - px(3));
    while (labels.some((l) => Math.abs(l.y - y) < px(15) && Math.abs(l.x - x) < l.half + half + px(4)) && y > px(30)) {
      y -= px(15);
    }
    labels.push({ x, y, half });
    ctx.fillStyle = css('--label-back');
    ctx.fillRect(x - half - px(2), y - px(13), 2 * half + px(4), px(15));
    ctx.fillStyle = seen ? css('--text') : css('--muted');
    ctx.fillText(text, x, y);
  }
  ctx.restore();

  // The frame, in the camera's color.
  ctx.strokeStyle = eye.color;
  ctx.lineWidth = px(4);
  ctx.strokeRect(0, 0, k.width, k.height);
}
