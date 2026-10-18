// What a camera's image holds: each tag as its four corners in pixels, found with the same
// projection the visibility code and the estimate use, and the horizon. The image is `width` by
// `height` pixels with (0, 0) at the top left.

import { DEG, applyTransposed } from './math.js';
import { FACING_AWAY, SEEN, project, toCamera } from './visibility.js';

// A tag's corners in pixels, or null when a corner is behind the lens.
function cornersInImage(camera, tag) {
  const inCamera = tag.corners.map((c) => toCamera(camera, c));
  if (inCamera.some((p) => p[0] <= 1e-6)) return null;
  return inCamera.map((p) => project(camera.intrinsics, p));
}

// Whether any corner is in the image, or the corners' box crosses it.
function touchesImage(k, corners) {
  const us = corners.map((c) => c[0]);
  const vs = corners.map((c) => c[1]);
  return Math.max(...us) >= 0 && Math.min(...us) <= k.width && Math.max(...vs) >= 0 && Math.min(...vs) <= k.height;
}

// The tags to draw for one camera, from its looks at the tags (see lookAtTags): each with its id,
// its status, why it is not seen (the status, or what hides it), its size in pixels across for a
// tag seen, and its four corners. A tag facing away is left out, and so is one with no corner in
// the image.
export function tagsInImage(camera, results) {
  const shown = [];
  for (const r of results) {
    if (r.status === FACING_AWAY) continue;
    const corners = r.cornersPx || cornersInImage(camera, r.tag);
    if (!corners || !touchesImage(camera.intrinsics, corners)) continue;
    shown.push({
      id: r.id,
      seen: r.status === SEEN,
      reason: r.status === 'hidden' ? `behind ${r.hiddenBy}` : r.status,
      pixels: r.pixels,
      corners,
    });
  }
  return shown;
}

// The horizon as a line across the image, [[u0, v0], [u1, v1]] at the image's left and right
// edges, or null when the camera looks too far up or down to see it. It is where level directions
// meet the image: found from two of them either side of the camera's heading.
export function horizon(camera) {
  const k = camera.intrinsics;
  const r = camera.rotation;
  const ahead = Math.atan2(r[1][0], r[0][0]);
  const points = [-30, 30].map((turn) => {
    const a = ahead + turn * DEG;
    const p = applyTransposed(r, [Math.cos(a), Math.sin(a), 0]);
    return p[0] > 1e-6 ? project(k, p) : null;
  });
  if (points.some((p) => !p)) return null;
  const [[u0, v0], [u1, v1]] = points;
  if (Math.abs(u1 - u0) < 1e-6) return null;
  const slope = (v1 - v0) / (u1 - u0);
  return [
    [0, v0 - slope * u0],
    [k.width, v0 + slope * (k.width - u0)],
  ];
}
