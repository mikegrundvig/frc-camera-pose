// A camera's view and the robot it is on: whether the camera looks out of the robot or across it.
//
// From above, in the robot's frame (x forward, y left), the robot is its bumper rectangle and a camera
// is a point inside it, looking along its yaw with a horizontal field of view. A ray from the mount
// runs inside the rectangle until it crosses the outline; "the view crosses the robot" means some ray
// of the field of view runs inside for too long. The longest a ray may run inside is PATH_LIMIT: the
// mounts the page places are 6 in inside the bumper, so a ray straight out runs 6 in inside and one
// at 60 degrees to the face 12 in; the limit is that 12 in and 2 in over. A camera in the middle of
// the robot (17.75 in from every edge of a 35.5 in robot) runs at least that far inside whichever way
// it looks, so it always crosses.
//
// Only the view from above is checked: cameras sit above the bumpers, so the height of the view is
// ignored (a camera looking along the top of the robot at a mechanism is not seen here).

export const PATH_LIMIT_METERS = 14 * 0.0254;

const DEG = Math.PI / 180;

// How far from a mount, inside the robot's outline, the ray at angle `alpha` (radians, from straight
// ahead, turning left) leaves it: the first of the four edges it reaches. A mount outside the outline
// (or on it) has no path inside.
export function pathInside(size, mount, alpha) {
  const a = size.length / 2;
  const b = size.width / 2;
  if (Math.abs(mount.forward) >= a || Math.abs(mount.left) >= b) return 0;
  const c = Math.cos(alpha);
  const s = Math.sin(alpha);
  let t = Infinity;
  if (c > 1e-12) t = Math.min(t, (a - mount.forward) / c);
  if (c < -1e-12) t = Math.min(t, (-a - mount.forward) / c);
  if (s > 1e-12) t = Math.min(t, (b - mount.left) / s);
  if (s < -1e-12) t = Math.min(t, (-b - mount.left) / s);
  return t;
}

// The longest path inside the outline of any ray of the view: yaw (degrees) plus and minus the half
// field of view. The path along the rays is the lesser of the distances to the edges, so over an
// interval of rays its largest is at an end or at a ray that goes through a corner of the outline,
// where the nearest edge changes; those are all that are tried, so the answer is exact.
export function longestPath(size, mount, yawDegrees, halfFovDegrees) {
  const low = (yawDegrees - halfFovDegrees) * DEG;
  const high = (yawDegrees + halfFovDegrees) * DEG;
  const rays = [low, high];
  const a = size.length / 2;
  const b = size.width / 2;
  for (const [x, y] of [
    [a, b],
    [-a, b],
    [-a, -b],
    [a, -b],
  ]) {
    const toCorner = Math.atan2(y - mount.left, x - mount.forward);
    // The corner's bearing, brought to within a turn of the view's low end.
    const along = ((((toCorner - low) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) + low;
    if (along <= high) rays.push(along);
  }
  return Math.max(...rays.map((alpha) => pathInside(size, mount, alpha)));
}

// Whether the whole horizontal field of view faces out of the robot.
export function viewFacesOut(size, mount, yawDegrees, halfFovDegrees, limit = PATH_LIMIT_METERS) {
  return longestPath(size, mount, yawDegrees, halfFovDegrees) <= limit + 1e-9;
}

// The yaws (degrees) that face out, as runs { from, to } turning left from `from` to `to` (both in
// -180 to 180; a run that wraps has `to` below `from`). A run's ends are found to a ten-thousandth of
// a degree. Empty when no yaw faces out (a camera in the middle of the robot).
export function outwardYawRuns(size, mount, halfFovDegrees, limit = PATH_LIMIT_METERS) {
  const step = 0.5;
  const ok = (yaw) => viewFacesOut(size, mount, yaw, halfFovDegrees, limit);
  const steps = Math.round(360 / step);
  const flags = [];
  for (let i = 0; i < steps; i++) flags.push(ok(-180 + i * step));
  if (flags.every(Boolean)) return [{ from: -180, to: 180, all: true }];
  if (!flags.some(Boolean)) return [];
  // Where each run starts and ends, refined between the step that changes and its neighbor.
  const refine = (inside, outside) => {
    let lo = inside;
    let hi = outside;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const wrap = (yaw) => ((((yaw + 180) % 360) + 360) % 360) - 180;
  const runs = [];
  for (let i = 0; i < steps; i++) {
    if (!flags[i] || flags[(i + steps - 1) % steps]) continue;
    // A run starts at step i: walk to where it ends (round the end of the list if need be).
    let j = i;
    while (flags[(j + 1) % steps]) j++;
    const first = -180 + i * step;
    const last = -180 + j * step;
    runs.push({ from: wrap(refine(first, first - step)), to: wrap(refine(last, last + step)), all: false });
  }
  return runs;
}

// ---- Where the view lies over the robot ----

// The part of a camera's horizontal view that lies over its own robot, as a polygon of [x, y] points in
// the robot's frame (x forward, y left, meters): the view's wedge from the mount, clipped to the bumper
// rectangle. It always holds the mount's own inset; empty only for a mount outside the outline.
export function viewOverRobot(size, mount, yawDegrees, halfFovDegrees) {
  if (Math.abs(mount.forward) >= size.length / 2 || Math.abs(mount.left) >= size.width / 2) return [];
  // The wedge as a triangle reaching well past the rectangle (a half field of view under 90 degrees).
  const reach = 4 * Math.hypot(size.length, size.width);
  const ray = (degrees) => [mount.forward + (reach * Math.cos(degrees * DEG)) / Math.cos(halfFovDegrees * DEG), mount.left + (reach * Math.sin(degrees * DEG)) / Math.cos(halfFovDegrees * DEG)];
  let polygon = [[mount.forward, mount.left], ray(yawDegrees - halfFovDegrees), ray(yawDegrees + halfFovDegrees)];
  // Clipped to each side of the rectangle in turn (Sutherland-Hodgman): `keep(point)` is how far inside it is.
  const a = size.length / 2;
  const b = size.width / 2;
  const sides = [(p) => a - p[0], (p) => p[0] + a, (p) => b - p[1], (p) => p[1] + b];
  for (const inside of sides) {
    const next = [];
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      const dp = inside(p);
      const dq = inside(q);
      if (dp >= 0) next.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    });
    polygon = next;
  }
  return polygon;
}

// A polygon's area, in square meters.
export function polygonArea(points) {
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    twice += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(twice) / 2;
}

// How the part of a view over the robot is shown: 'warn' when the rule is on (`allowed` false) and the
// view crosses the robot further than `limit`, else 'soft' (information only).
export function overlapStyle(size, mount, yawDegrees, halfFovDegrees, limit = PATH_LIMIT_METERS, allowed = false) {
  return !allowed && !viewFacesOut(size, mount, yawDegrees, halfFovDegrees, limit) ? 'warn' : 'soft';
}
