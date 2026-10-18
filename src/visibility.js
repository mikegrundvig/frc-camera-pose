// Which tags a camera detects, with the camera placement study's test on noiseless corners: the tag
// is in front of the camera and facing it, within sight range, all four corners land inside the
// image, and it covers at least 100 square pixels. Field elements and other robots may hide a tag
// too (the study's estimate had neither; the study itself has other robots).

import { DEG, applyTransposed, norm, sub, wrap } from './math.js';
import { elementHidingTag } from './occlusion.js';
import { robotHidesTag } from './robots.js';

// The smallest tag the detector finds, in square pixels (the study's CameraImageSim).
export const MIN_AREA_PIXELS = 100;

export const SEEN = 'seen';
export const FACING_AWAY = 'facing away';
export const TOO_FAR = 'too far';
export const OUTSIDE_IMAGE = 'outside the image';
export const TOO_SMALL = 'too small';
export const HIDDEN = 'hidden';

// A point in the field frame, in the camera's frame (x out of the lens, y left, z up).
export function toCamera(camera, point) {
  return applyTransposed(camera.rotation, sub(point, camera.position));
}

// Where a point in the camera's frame lands in the image, in pixels.
export function project(k, p) {
  return [k.cx - (k.fx * p[1]) / p[0], k.cy - (k.fy * p[2]) / p[0]];
}

// The angles PhotonVision's CameraTargetRelation works out between a camera and a tag, in degrees.
function relation(camera, tag) {
  const camToTarg = toCamera(camera, tag.position);
  const distance = norm(camToTarg);
  const distanceXY = Math.hypot(camToTarg[0], camToTarg[1]);
  const yaw = Math.atan2(camToTarg[1], camToTarg[0]);
  const pitch = Math.atan2(-camToTarg[2], distanceXY);
  // The camera as the tag sees it, in the tag's frame.
  const targToCam = applyTransposed(tag.rotation, sub(camera.position, tag.position));
  const tagYaw = Math.atan2(targToCam[1], targToCam[0]);
  // PhotonVision takes this pitch's horizontal leg from the camera's side; kept as it is.
  const tagPitch = Math.atan2(-targToCam[2], distanceXY);
  const tagAngle = wrap(Math.hypot(tagYaw, tagPitch));
  return {
    centerCamera: camToTarg,
    distance,
    yawDegrees: yaw / DEG,
    pitchDegrees: pitch / DEG,
    facingDegrees: tagAngle / DEG,
  };
}

// What one camera makes of each tag on the field. `camera` has the lens model (`intrinsics`) and
// its `position` and `rotation` on the field. Each result says whether the tag is seen and, if not,
// why; `inWedge` is whether the tag is within the camera's view seen from above. `blockers` says
// what may hide tags: `elements` (true to use the field's) and `robots` (other robots' boxes).
export function lookAtTags(field, camera, settings, blockers = {}) {
  const robots = blockers.robots || [];
  const k = camera.intrinsics;
  const results = [];
  for (const tag of field.tags) {
    const r = relation(camera, tag);
    const yawOk = Math.abs(r.yawDegrees) < k.halfWidthDegrees;
    const pitchOk = Math.abs(r.pitchDegrees) < k.halfHeightDegrees;
    const facing = Math.abs(r.facingDegrees) < 90;
    const near = r.distance <= settings.sightMeters;
    const result = {
      tag,
      id: tag.id,
      inWedge: yawOk && r.centerCamera[0] > 0,
      distance: r.distance,
      centerCamera: r.centerCamera,
      status: SEEN,
      pixels: 0,
      hiddenBy: null,
    };
    results.push(result);
    if (!facing) {
      result.status = FACING_AWAY;
      continue;
    }
    if (!near) {
      result.status = TOO_FAR;
      continue;
    }
    if (!yawOk || !pitchOk) {
      result.status = OUTSIDE_IMAGE;
      continue;
    }
    const cornersCamera = tag.corners.map((c) => toCamera(camera, c));
    const cornersPx = cornersCamera.map((p) => project(k, p));
    let inImage = true;
    for (const [u, v] of cornersPx) {
      inImage = inImage && u >= 0 && u <= k.width && v >= 0 && v <= k.height;
    }
    if (!inImage) {
      result.status = OUTSIDE_IMAGE;
      continue;
    }
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = cornersPx[i];
      const b = cornersPx[(i + 1) % 4];
      area += a[0] * b[1] - b[0] * a[1];
    }
    area = Math.abs(area) / 2;
    result.pixels = Math.sqrt(area);
    result.cornersCamera = cornersCamera;
    result.cornersPx = cornersPx;
    if (blockers.elements) {
      const hiding = elementHidingTag(field.elements, camera.position, tag);
      if (hiding) {
        result.status = HIDDEN;
        result.hiddenBy = hiding.name;
        continue;
      }
    }
    if (robotHidesTag(robots, camera.position, tag)) {
      result.status = HIDDEN;
      result.hiddenBy = 'another robot';
      continue;
    }
    // The study compares shares of the image's area; written the same way so the edge matches.
    const imageArea = k.width * k.height;
    if (!((area / imageArea) * 100 >= (MIN_AREA_PIXELS / imageArea) * 100)) {
      result.status = TOO_SMALL;
    }
  }
  return results;
}
