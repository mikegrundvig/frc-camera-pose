// Common FRC AprilTag cameras and a few camera layouts to start from.
//
// The camera specs are nominal, as each manufacturer publishes them (checked October 2026); a real
// lens differs a little, so measure yours (calibrate it) when it matters.
// - Arducam OV9281 USB, B0332: 1280 x 800, 70 degrees horizontal (Arducam's product listing).
// - Arducam OV2311 USB, B0322: 1600 x 1200, 75 degrees horizontal (Arducam's product listing).
// - Limelight 3G and Limelight 4: 1280 x 800, 82 degrees horizontal by 56.2 vertical
//   (docs.limelightvision.io, hardware comparison).
// - ThriftyCam with its 80 degree lens (standard since January 2026): 1600 x 1304, 80 degrees
//   diagonal (docs.thethriftybot.com, lens info).
// - The camera placement study's camera: 1280 x 800, 80 degrees diagonal, a typical global-shutter
//   AprilTag camera as PhotonVision's simulation models it.

import { INCH } from './units.js';

export const CAMERA_PRESETS = [
  {
    id: 'study',
    label: 'Generic 1280 x 800, 80° diagonal',
    widthPixels: 1280,
    heightPixels: 800,
    fovDegrees: 80,
    fovAcross: 'diagonal',
  },
  {
    id: 'ov9281',
    label: 'Arducam OV9281 (B0332), 70° lens',
    widthPixels: 1280,
    heightPixels: 800,
    fovDegrees: 70,
    fovAcross: 'horizontal',
  },
  {
    id: 'ov2311',
    label: 'Arducam OV2311 (B0322), 75° lens',
    widthPixels: 1600,
    heightPixels: 1200,
    fovDegrees: 75,
    fovAcross: 'horizontal',
  },
  {
    id: 'limelight',
    label: 'Limelight 3G or 4',
    widthPixels: 1280,
    heightPixels: 800,
    fovDegrees: 82,
    fovAcross: 'horizontal',
  },
  {
    id: 'thriftycam',
    label: 'ThriftyCam, 80° lens',
    widthPixels: 1600,
    heightPixels: 1304,
    fovDegrees: 80,
    fovAcross: 'diagonal',
  },
];

export const CUSTOM = 'custom';

export const MOST_CAMERAS = 8;

// Lenses sit this far in from the bumpers' outside: 4 in of bumper and 2 in of frame, where a
// camera can bolt on (the study's example robot: 11.75 in from the center of a 35.5 in robot).
export const INSET_METERS = 6 * INCH;

// Places on the robot, each a name, how far toward the front (1) or back (-1) and toward the left
// (1) or right (-1) side it sits, and the way it faces (degrees, counterclockwise from ahead).
const SPOTS = {
  'front-left': [1, 1, 45],
  'front-right': [1, -1, -45],
  'back-left': [-1, 1, 135],
  'back-right': [-1, -1, -135],
  front: [1, 0, 0],
  back: [-1, 0, 180],
  left: [0, 1, 90],
  right: [0, -1, -90],
};

export const LAYOUT_PRESETS = [
  { id: 'corners', label: 'Four corners, splayed 45°', spots: ['front-left', 'front-right', 'back-left', 'back-right'] },
  { id: 'sides', label: 'Four sides', spots: ['front', 'back', 'left', 'right'] },
  {
    id: 'six',
    label: 'Six: four corners, front and back',
    spots: ['front-left', 'front-right', 'back-left', 'back-right', 'front', 'back'],
  },
  { id: 'two', label: 'Two: front and back', spots: ['front', 'back'] },
  { id: 'one', label: 'One: front', spots: ['front'] },
];

// A camera at one of the robot's spots (the robot's size in meters): 21 in up, tilted up 10 degrees, the study's sensor.
export function cameraAt(spot, robot) {
  const [ahead, left, yaw] = SPOTS[spot];
  const forward = Math.max(0, robot.lengthMeters / 2 - INSET_METERS);
  const side = Math.max(0, robot.widthMeters / 2 - INSET_METERS);
  const preset = CAMERA_PRESETS[0];
  return {
    name: spot,
    preset: preset.id,
    widthPixels: preset.widthPixels,
    heightPixels: preset.heightPixels,
    fovDegrees: preset.fovDegrees,
    fovAcross: preset.fovAcross,
    forwardMeters: ahead * forward,
    leftMeters: left * side,
    upMeters: 21 * INCH,
    yawDegrees: yaw,
    tiltUpDegrees: 10,
  };
}

export function layoutCameras(id, robot) {
  const layout = LAYOUT_PRESETS.find((l) => l.id === id) || LAYOUT_PRESETS[0];
  return layout.spots.map((spot) => cameraAt(spot, robot));
}
