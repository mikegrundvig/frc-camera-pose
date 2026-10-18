// The camera placement study's "pipeline estimate" of the position error: a cheap geometric model
// with no images and no solves. Each tag's own solve has a covariance from the Fisher information
// of its four corners; a camera averages its tags as the robot's vision pipeline does (by 1/d^2);
// the cameras are combined by the pipeline's own spreads; and the gyro's heading error moves every
// tag's fix by its lever from the robot. Ported from the study's CameraEstimate.

import { eigen2, invert } from './math.js';
import { SEEN } from './visibility.js';

// The robot's vision pipeline settings (VisionConfig.DEFAULTS in frc-robot-runtime's
// localization library). The first two scale every camera alike, so they cancel when cameras are
// combined; they are kept for faithfulness.
export const VISION = {
  // Results from tags farther than this, on average, are thrown out.
  maxDistanceMeters: 6.0,
  // Position uncertainty in meters for one tag at one meter.
  linearStdDevBaseline: 0.02,
  // How much less uncertain a position is when the gyro's heading is used.
  headingConstrainedFactor: 0.5,
  // Uncertainty grows with the tags' average distance to this power.
  distanceExponent: 2.0,
};

// The study's defaults (CameraStudyConfig.DEFAULTS, VisionSim's corner noise).
export const DEFAULT_NOISE = {
  cornerNoisePixels: 0.25,
  // PhotonVision's corner noise has a spread; the study keeps it in proportion to the mean.
  cornerSpreadRatio: 0.08 / 0.25,
  gyroErrorDegrees: 0.25,
};

// One over the per-axis variance of a corner's pixel position. PhotonVision moves each corner a
// distance ~ N(mean, spread) in a uniformly random direction, so each axis has variance
// (mean^2 + spread^2) / 2.
export function cornerInverseVariance(mean, spread) {
  return 2 / (mean * mean + spread * spread);
}

// What one camera contributes at one pose, from its look at the tags. `camera` has its rotation
// (field from camera) and lens model; `robot` is the pose {x, y}.
// `maxDistance` is how far its tags may average and still count (a camera whose tags average farther
// measures nothing); Infinity for no limit.
export function cameraView(camera, results, robot, inverseVariance, maxDistance = VISION.maxDistanceMeters) {
  const k = camera.intrinsics;
  const r = camera.rotation;
  const view = { tags: 0, ok: false, weight: 0, axx: 0, axy: 0, ayy: 0, lx: 0, ly: 0 };
  let sumU = 0;
  let sumD = 0;
  const perTag = [];
  for (const result of results) {
    if (result.status !== SEEN) continue;
    view.tags++;
    const tc = result.centerCamera;
    const info = [];
    for (let i = 0; i < 6; i++) info.push([0, 0, 0, 0, 0, 0]);
    for (const p of result.cornersCamera) {
      const [x, y, z] = p;
      // The projection's gradient with respect to the corner, for u and for v.
      const gradients = [
        [(k.fx * y) / (x * x), -k.fx / x, 0],
        [(k.fy * z) / (x * x), 0, -k.fy / x],
      ];
      const q = [x - tc[0], y - tc[1], z - tc[2]];
      for (const g of gradients) {
        // d(pixel)/d(tag translation, tag rotation): the gradient, and q cross the gradient.
        const row = [
          g[0],
          g[1],
          g[2],
          q[1] * g[2] - q[2] * g[1],
          q[2] * g[0] - q[0] * g[2],
          q[0] * g[1] - q[1] * g[0],
        ];
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) info[i][j] += row[i] * row[j] * inverseVariance;
        }
      }
    }
    const cov = invert(info);
    // The translation block, camera frame, turned into the field frame: R C R^T, x and y only.
    const s = [
      [0, 0],
      [0, 0],
    ];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        let sum = 0;
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) sum += r[i][a] * cov[a][b] * r[j][b];
        }
        s[i][j] = sum;
      }
    }
    const distance = Math.sqrt(tc[0] * tc[0] + tc[1] * tc[1] + tc[2] * tc[2]);
    const u = 1 / Math.max(distance * distance, 1e-6);
    sumU += u;
    sumD += distance;
    perTag.push({
      u,
      sxx: s[0][0],
      sxy: s[0][1],
      syy: s[1][1],
      lx: result.tag.position[0] - robot.x,
      ly: result.tag.position[1] - robot.y,
    });
  }
  if (view.tags === 0) return view;
  const meanDistance = sumD / view.tags;
  view.ok = meanDistance <= maxDistance;
  const spread =
    (VISION.linearStdDevBaseline *
      VISION.headingConstrainedFactor *
      Math.pow(meanDistance, VISION.distanceExponent)) /
    view.tags;
  view.weight = 1 / (spread * spread);
  for (const t of perTag) {
    const a = t.u / sumU;
    view.axx += a * a * t.sxx;
    view.axy += a * a * t.sxy;
    view.ayy += a * a * t.syy;
    view.lx += a * t.lx;
    view.ly += a * t.ly;
  }
  return view;
}

// The cameras combined, the gyro's error added: the 2x2 covariance's eigenvalues [l1, l2], or
// null when no camera measures. `gyroSigma` is in radians.
export function combine(views, gyroSigma) {
  let w = 0;
  for (const v of views) w += v.ok ? v.weight : 0;
  if (!(w > 0)) return null;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let lx = 0;
  let ly = 0;
  for (const v of views) {
    if (!v.ok) continue;
    const b = v.weight / w;
    xx += b * b * v.axx;
    xy += b * b * v.axy;
    yy += b * b * v.ayy;
    lx += b * v.lx;
    ly += b * v.ly;
  }
  const g = gyroSigma * gyroSigma;
  xx += g * ly * ly;
  xy -= g * lx * ly;
  yy += g * lx * lx;
  return eigen2(xx, xy, yy);
}

const ANGLES = 16;

// P(|e| <= r) for a 2D zero-mean Gaussian with these eigenvalues: the mean over 16 angles of the
// chance along each.
export function withinChance(r, l1, l2) {
  let sum = 0;
  for (let k = 0; k < ANGLES; k++) {
    const phi = ((k + 0.5) * (Math.PI / 2)) / ANGLES;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const q = l1 * c * c + l2 * s * s;
    sum += q > 0 ? 1 - Math.exp((-r * r) / (2 * q)) : 1;
  }
  return sum / ANGLES;
}

// The share of poses within r: each pose's eigenvalues, or null for no measurement (never within).
export function shareWithin(r, eigenvalues) {
  if (eigenvalues.length === 0) return 0;
  let sum = 0;
  for (const e of eigenvalues) {
    if (e) sum += withinChance(r, e[0], e[1]);
  }
  return sum / eigenvalues.length;
}

// The error 95% of the poses are within, in meters, or Infinity when more than 5% of them can't be
// placed within 10 m (in practice: more than 5% have no measurement). Found by bisection on a log
// scale, as the study does. Each pose's 16 variances are worked out once, since the bisection asks
// for the share within many distances.
export function within95(eigenvalues) {
  const n = eigenvalues.length;
  if (n === 0) return Infinity;
  const halfInverse = new Float64Array(n * ANGLES);
  for (let i = 0; i < n; i++) {
    const e = eigenvalues[i];
    for (let k = 0; k < ANGLES; k++) {
      const phi = ((k + 0.5) * (Math.PI / 2)) / ANGLES;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      // No measurement: never within (NaN); a variance of zero: always within (Infinity).
      const q = e ? e[0] * c * c + e[1] * s * s : -1;
      halfInverse[i * ANGLES + k] = q > 0 ? 1 / (2 * q) : q === 0 ? Infinity : NaN;
    }
  }
  const share = (r) => {
    let sum = 0;
    for (let j = 0; j < halfInverse.length; j++) {
      const h = halfInverse[j];
      if (h === h) sum += h === Infinity ? 1 : 1 - Math.exp(-r * r * h);
    }
    return sum / (n * ANGLES);
  };
  if (share(10) < 0.95) return Infinity;
  let lo = 1e-5;
  let hi = 10;
  for (let it = 0; it < 50; it++) {
    const mid = Math.sqrt(lo * hi);
    if (share(mid) >= 0.95) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}
