// The page's state: everything a person sets, kept in meters and degrees whatever units the page
// shows (see units.js), so a link means the same to everyone. It round-trips through the link (the URL's hash) and through
// "copy as JSON".

import { INCH } from './units.js';
import { PATH_LIMIT_METERS } from './clip.js';
import { DEFAULT_NOISE, VISION } from './estimate.js';
import { CAMERA_PRESETS, CUSTOM, MOST_CAMERAS, layoutCameras } from './presets.js';

export const MAPS = [
  { id: 'oneTag', label: 'At least one tag' },
  { id: 'twoTags', label: 'Two or more tags in one camera' },
  { id: 'twoCameras', label: 'Two or more cameras see a tag' },
  { id: 'error', label: 'Estimated position error' },
];

// The most other robots, and the seed for the arrangements the maps draw around each spot.
export const MOST_OTHER_ROBOTS = 5;
// The least and most a view may run inside the robot: the least is the presets' 6 in inset, so a view
// straight out always passes.
export const MOST_ACROSS = [6 * INCH, 36 * INCH];
const MAP_SEED = 1;

export function defaultState() {
  // Its size with bumpers, and how high it stands (the most a camera can be raised: see finder.js).
  const robot = { lengthMeters: 35.5 * INCH, widthMeters: 35.5 * INCH, heightMeters: 30 * INCH };
  return {
    season: 2026,
    robot,
    // Where the robot stands, in meters and degrees: set from the season's first start on load.
    pose: null,
    cameras: layoutCameras('corners', robot),
    noise: {
      cornerNoisePixels: DEFAULT_NOISE.cornerNoisePixels,
      gyroErrorDegrees: DEFAULT_NOISE.gyroErrorDegrees,
      // A camera whose tags average farther than this measures nothing (one robot's rule: see
      // VISION in estimate.js); null for no cutoff.
      cutoffMeters: VISION.maxDistanceMeters,
    },
    sightMeters: 7,
    // Whether a camera's view may cross the robot itself (see clip.js): off, the searches only use
    // views that face out, and a hand-set camera that crosses is flagged.
    allowViewsAcross: false,
    // How far a view may run inside the robot before it counts as crossing it (clip.js); a judgement,
    // since a camera behind the bumpers always looks over some of the robot.
    viewAcrossMeters: PATH_LIMIT_METERS,
    // Other robots stand where they are put: each a pose in meters and degrees.
    otherRobots: { heightMeters: 30 * INCH, robots: [] },
    map: 'error',
  };
}

// The state as the scoring takes it, in meters.
export function scoringState(state) {
  return {
    robotSize: { length: state.robot.lengthMeters, width: state.robot.widthMeters },
    cameras: state.cameras.map((c) => ({
      name: c.name,
      sensor: {
        widthPixels: c.widthPixels,
        heightPixels: c.heightPixels,
        fovDegrees: c.fovDegrees,
        fovAcross: c.fovAcross,
      },
      mount: {
        forward: c.forwardMeters,
        left: c.leftMeters,
        up: c.upMeters,
        yawDegrees: c.yawDegrees,
        tiltUpDegrees: c.tiltUpDegrees,
      },
    })),
    settings: {
      sightMeters: state.sightMeters,
      cornerNoisePixels: state.noise.cornerNoisePixels,
      cornerSpreadRatio: DEFAULT_NOISE.cornerSpreadRatio,
      gyroErrorDegrees: state.noise.gyroErrorDegrees,
      maxDistanceMeters: state.noise.cutoffMeters === null ? Infinity : state.noise.cutoffMeters,
    },
    // The maps cannot use robots placed by hand, which only mean something near one spot: they
    // take as many as are placed, at random around each spot.
    otherRobots: {
      count: state.otherRobots.robots.length,
      heightMeters: state.otherRobots.heightMeters,
    },
    useElements: true,
    seed: MAP_SEED,
  };
}

// The robot's pose in meters and radians.
export function robotPose(state) {
  return { x: state.pose.x, y: state.pose.y, heading: (state.pose.headingDegrees * Math.PI) / 180 };
}

export function toJson(state) {
  return JSON.stringify(state, null, 2);
}

export function toHash(state) {
  return '#' + encodeURIComponent(JSON.stringify(state));
}

// A state read from a link or pasted JSON, every value checked and anything missing or wrong
// taken from the defaults. Returns the defaults when the text isn't a state at all.
export function fromText(text) {
  const d = defaultState();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object') return d;
  const robot = {
    lengthMeters: number(raw.robot?.lengthMeters, d.robot.lengthMeters, 10 * INCH, 60 * INCH),
    widthMeters: number(raw.robot?.widthMeters, d.robot.widthMeters, 10 * INCH, 60 * INCH),
    heightMeters: number(raw.robot?.heightMeters, d.robot.heightMeters, 6 * INCH, 60 * INCH),
  };
  let cameras = Array.isArray(raw.cameras) ? raw.cameras.slice(0, MOST_CAMERAS).map(camera) : [];
  if (cameras.length === 0) cameras = layoutCameras('corners', robot);
  return {
    season: [2024, 2025, 2026].includes(raw.season) ? raw.season : d.season,
    robot,
    pose:
      raw.pose && typeof raw.pose === 'object'
        ? {
            x: number(raw.pose.x, 3, 0, 20),
            y: number(raw.pose.y, 4, 0, 10),
            headingDegrees: number(raw.pose.headingDegrees, 0, -360, 360),
          }
        : null,
    cameras,
    noise: {
      cornerNoisePixels: number(raw.noise?.cornerNoisePixels, d.noise.cornerNoisePixels, 0.01, 5),
      gyroErrorDegrees: number(raw.noise?.gyroErrorDegrees, d.noise.gyroErrorDegrees, 0, 10),
      cutoffMeters: raw.noise?.cutoffMeters === null ? null : number(raw.noise?.cutoffMeters, d.noise.cutoffMeters, 1, 50),
    },
    sightMeters: number(raw.sightMeters, d.sightMeters, 1, 20),
    allowViewsAcross: raw.allowViewsAcross === true,
    // Out of range is as bad as not a number: back to the default.
    viewAcrossMeters:
      typeof raw.viewAcrossMeters === 'number' && raw.viewAcrossMeters >= MOST_ACROSS[0] && raw.viewAcrossMeters <= MOST_ACROSS[1]
        ? raw.viewAcrossMeters
        : d.viewAcrossMeters,
    otherRobots: {
      heightMeters: number(raw.otherRobots?.heightMeters, d.otherRobots.heightMeters, 1 * INCH, 80 * INCH),
      robots: (Array.isArray(raw.otherRobots?.robots) ? raw.otherRobots.robots : [])
        .slice(0, MOST_OTHER_ROBOTS)
        .map(otherRobot),
    },
    map: MAPS.some((m) => m.id === raw.map) ? raw.map : d.map,
  };
}

function otherRobot(raw) {
  return {
    x: number(raw?.x, 8, 0, 20),
    y: number(raw?.y, 4, 0, 10),
    headingDegrees: number(raw?.headingDegrees, 0, -360, 360),
  };
}

function camera(raw, index) {
  const preset = CAMERA_PRESETS[0];
  return {
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.slice(0, 24) : `camera ${index + 1}`,
    preset: CAMERA_PRESETS.some((p) => p.id === raw?.preset) ? raw.preset : CUSTOM,
    widthPixels: Math.round(number(raw?.widthPixels, preset.widthPixels, 160, 8000)),
    heightPixels: Math.round(number(raw?.heightPixels, preset.heightPixels, 120, 8000)),
    fovDegrees: number(raw?.fovDegrees, preset.fovDegrees, 10, 170),
    fovAcross: raw?.fovAcross === 'horizontal' ? 'horizontal' : 'diagonal',
    forwardMeters: number(raw?.forwardMeters, 0, -40 * INCH, 40 * INCH),
    leftMeters: number(raw?.leftMeters, 0, -40 * INCH, 40 * INCH),
    upMeters: number(raw?.upMeters, 21 * INCH, 0, 80 * INCH),
    yawDegrees: number(raw?.yawDegrees, 0, -360, 360),
    tiltUpDegrees: number(raw?.tiltUpDegrees, 10, -60, 60),
    // The angles Best angles may use for this camera: its yaw (both ends, turning left from the
    // first to the second; may wrap past 180) and its tilt (0 to 30 when empty). Null is no limit.
    yawMin: limit(raw?.yawMin, -360, 360),
    yawMax: limit(raw?.yawMax, -360, 360),
    tiltMin: limit(raw?.tiltMin, -60, 90),
    tiltMax: limit(raw?.tiltMax, -60, 90),
  };
}

function limit(value, low, high) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : null;
}

function number(value, fallback, low, high) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}
