// Placeholder spots to put the robot on: the season's starting positions, near its main field
// elements, and a few spots any field has.

import { hitsElement, robotOutline } from './coverage.js';
import { placeAt } from './placement.js';

const DEG = Math.PI / 180;

// How far to keep from an element when backing away from it, in meters.
const CLEARANCE = 0.3;

function title(name) {
  return name.toLowerCase();
}

// Moves the robot along its heading, backward (way -1) or forward (way 1), until it stands clear
// of every element, then a little further. Gives up after 6 m and leaves it where it started.
function clear(field, robotSize, pose, way = -1) {
  if (field.elements.length === 0) return pose;
  const heading = pose.headingDegrees * DEG;
  const at = (d) => ({
    x: pose.x + way * d * Math.cos(heading),
    y: pose.y + way * d * Math.sin(heading),
    heading,
  });
  for (let d = 0; d <= 6; d += 0.05) {
    if (!hitsElement(field, robotOutline(at(d), robotSize))) {
      const p = d === 0 ? at(0) : at(d + CLEARANCE);
      return { x: p.x, y: p.y, headingDegrees: pose.headingDegrees };
    }
  }
  return pose;
}

// The spots for a field and a robot of this size (meters): each a label and a pose in meters and
// degrees, every one a place the robot may stand (a spot too tight for this robot is moved to the
// nearest legal place, or left out when there is none).
export function spots(field, robotSize) {
  return legalSpots(field, robotSize, rawSpots(field, robotSize));
}

function legalSpots(field, robotSize, list) {
  const legal = [];
  for (const spot of list) {
    const at = placeAt(field, robotSize, spot.pose);
    if (at) legal.push({ label: spot.label, pose: at });
  }
  return legal;
}

function rawSpots(field, robotSize) {
  const list = [];
  for (const start of field.starts) {
    list.push({
      label: `Start: ${start.alliance} ${title(start.name)}`,
      pose: { x: start.x, y: start.y, headingDegrees: start.headingDegrees },
    });
  }
  for (const place of field.places) {
    const pose = clear(field, robotSize, { x: place.x, y: place.y, headingDegrees: place.headingDegrees });
    list.push({ label: `Near the ${title(place.name)} (${place.alliance})`, pose });
  }
  const halfLength = robotSize.length / 2;
  const halfWidth = robotSize.width / 2;
  const generic = [
    { label: 'Mid-field', pose: { x: field.length / 2, y: field.width / 2, headingDegrees: 0 } },
    {
      label: 'Near a side wall',
      pose: { x: field.length / 4, y: halfWidth + CLEARANCE, headingDegrees: 0 },
    },
    {
      label: 'In a field corner',
      pose: { x: halfLength + CLEARANCE + 0.2, y: halfWidth + CLEARANCE + 0.2, headingDegrees: 45 },
      // Out of the corner, toward mid-field.
      way: 1,
    },
  ];
  for (const spot of generic) {
    list.push({ label: spot.label, pose: clear(field, robotSize, spot.pose, spot.way) });
  }
  return list;
}
