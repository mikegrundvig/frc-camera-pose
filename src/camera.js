// A camera's lens model and where it sits on the field, as PhotonVision's simulation models them:
// a perfect pinhole lens, its principal point at the image's center.

import { DEG, add, apply, multiply, rotationFromRollPitchYaw } from './math.js';

// The diagonal field of view in degrees, from one across the width or the diagonal. A camera's
// datasheet usually gives the horizontal one; PhotonVision calibrates with the diagonal.
export function diagonalFov(sensor) {
  if (sensor.fovAcross === 'diagonal') return sensor.fovDegrees;
  const diagonal = Math.hypot(sensor.widthPixels, sensor.heightPixels);
  const half = Math.tan((sensor.fovDegrees * DEG) / 2);
  return (2 * Math.atan((half * diagonal) / sensor.widthPixels)) / DEG;
}

// The focal lengths, principal point and half fields of view, as PhotonVision's
// SimCameraProperties.setCalibration(width, height, diagonal fov) works them out.
export function intrinsics(sensor) {
  const width = sensor.widthPixels;
  const height = sensor.heightPixels;
  const fovDiagonal = Math.min(179, Math.max(1, diagonalFov(sensor))) * DEG;
  const resDiagonal = Math.hypot(width, height);
  const diagonalRatio = Math.tan(fovDiagonal / 2);
  const fovWidth = Math.atan(diagonalRatio * (width / resDiagonal)) * 2;
  const fovHeight = Math.atan(diagonalRatio * (height / resDiagonal)) * 2;
  const cx = width / 2 - 0.5;
  const cy = height / 2 - 0.5;
  const fx = cx / Math.tan(fovWidth / 2);
  const fy = cy / Math.tan(fovHeight / 2);
  // getHorizFOV and getVertFOV: the angles to the image's edges, either side of the principal
  // point, which sits half a pixel off center.
  const horizontal = Math.atan2(cx, fx) - Math.atan2(cx - width, fx);
  const vertical = Math.atan2(height - cy, fy) - Math.atan2(-cy, fy);
  return {
    width,
    height,
    fx,
    fy,
    cx,
    cy,
    halfWidthDegrees: horizontal / DEG / 2,
    halfHeightDegrees: vertical / DEG / 2,
  };
}

// The camera's position and rotation on the field (its axes: x out of the lens, y left, z up)
// for a robot at (x, y) facing heading (radians), the camera mounted as `mount` says: forward,
// left and up in meters from the robot's center on the floor, yaw and tilt up in degrees.
export function cameraPose(robot, mount) {
  const robotRotation = rotationFromRollPitchYaw(0, 0, robot.heading);
  // Tilting up is a negative pitch in WPILib's convention.
  const mountRotation = rotationFromRollPitchYaw(
    (mount.rollDegrees || 0) * DEG,
    -mount.tiltUpDegrees * DEG,
    mount.yawDegrees * DEG,
  );
  const offset = apply(robotRotation, [mount.forward, mount.left, mount.up]);
  return {
    position: add([robot.x, robot.y, 0], offset),
    rotation: multiply(robotRotation, mountRotation),
  };
}
