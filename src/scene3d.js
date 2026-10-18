// The field in 3D, with three.js (loaded from vendor/three/ the first time it is asked for): the
// floor with the coverage map, the walls, the field elements as blocks, tags as thin panels at
// their real height and facing, the robot, each camera's view as a pyramid out a few meters, the
// sight lines and the other robots. The scene is the one `drawScene` draws (see draw.js), with
// the same choices of what to show; field coordinates are used as they are, with z up.

import { CAMERA_COLORS, css, drawMap } from './draw.js';
import { TAG_SIZE_METERS } from './field.js';
import { add, apply } from './math.js';
import { HIDDEN, SEEN } from './visibility.js';

// How far each camera's pyramid reaches, in meters, and how high the robot's box stands.
const PYRAMID_METERS = 3;
const ROBOT_HEIGHT_METERS = 0.3;
const WALL_HEIGHT_METERS = 0.3;
const MAP_PIXELS = 1024;

// A theme color as three.js takes it, and its opacity: colors with an alpha are written rgba().
function themeColor(name) {
  const text = css(name);
  const rgba = text.match(/^rgba?\(([^)]+)\)/);
  if (!rgba) return { color: text, opacity: 1 };
  const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
  return { color: (r << 16) | (g << 8) | b, opacity: a };
}

// Loads three.js and builds a view on a canvas. Rejects when the files or WebGL are not there.
// `onPress(event)` is told of each press on the canvas before the orbit controls see it: when it
// returns true the press is a drag of a robot, and the controls stay out of it until the pointer
// is let go.
export async function createView3d(canvas, { onPress } = {}) {
  const THREE = await import('../vendor/three/three.module.min.js');
  const { OrbitControls } = await import('../vendor/three/OrbitControls.js');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-4, -8, 12);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.up.set(0, 0, 1);
  // Listening before the controls do, so a press on a robot can switch them off first.
  canvas.addEventListener('pointerdown', (event) => {
    if (onPress && onPress(event)) controls.enabled = false;
  });
  const orbitAgain = () => {
    controls.enabled = true;
  };
  canvas.addEventListener('pointerup', orbitAgain);
  canvas.addEventListener('pointercancel', orbitAgain);
  canvas.addEventListener('lostpointercapture', orbitAgain);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1;
  controls.maxDistance = 60;

  const raycaster = new THREE.Raycaster();
  const pickable = []; // the robots' meshes, each marked with which robot it is
  let fixed = new THREE.Group(); // the floor, walls and elements: only when the field or its look changes
  let moving = new THREE.Group(); // tags, robots, cameras and lines
  scene.add(fixed, moving);
  let fixedKey = '';
  let fixedCoverage = null;
  let last = null;
  const textures = new Map();

  function paint() {
    if (!last) return;
    renderer.setClearColor(css('--surface'), 1);
    renderer.render(scene, camera);
  }
  controls.addEventListener('change', paint);

  function reset() {
    const field = last && last.field;
    const length = field ? field.length : 16;
    const width = field ? field.width : 8;
    // Back from the middle of the field and above, far enough that all of it is in view.
    const away = Math.max(length * 0.95, 10);
    controls.target.set(length / 2, width / 2, 0);
    camera.position.set(length / 2, width / 2 - away * 0.57, away * 0.82);
    controls.update();
    paint();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    paint();
  }

  function clear(group) {
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) [].concat(object.material).forEach((m) => m.dispose());
    });
    group.clear();
  }

  function paintMaterial(name, options = {}) {
    const { color, opacity } = themeColor(name);
    const transparent = opacity < 1 || options.opacity !== undefined;
    return new THREE.MeshLambertMaterial({ color, transparent, opacity: options.opacity ?? opacity, ...options.extra });
  }

  function lines(points, color, dashed = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.12 })
      : new THREE.LineBasicMaterial({ color });
    const object = new THREE.LineSegments(geometry, material);
    if (dashed) object.computeLineDistances();
    return object;
  }

  // The floor: the carpet and, when shown, the coverage map, painted on a canvas.
  function floor(field, scene3) {
    const height = Math.round((MAP_PIXELS * field.width) / field.length);
    const paper = document.createElement('canvas');
    paper.width = MAP_PIXELS;
    paper.height = height;
    const ctx = paper.getContext('2d');
    const s = MAP_PIXELS / field.length;
    ctx.fillStyle = css('--carpet');
    ctx.fillRect(0, 0, MAP_PIXELS, height);
    if (scene3.coverage && scene3.show.map) {
      const view = { scale: s, toCanvas: (x, y) => [x * s, (field.width - y) * s] };
      drawMap(ctx, view, scene3.coverage, scene3.map, scene3.errorScale, scene3.show.blend);
    }
    ctx.strokeStyle = css('--line');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MAP_PIXELS / 2, 0);
    ctx.lineTo(MAP_PIXELS / 2, height);
    ctx.stroke();
    const map = new THREE.CanvasTexture(paper);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(field.length, field.width),
      new THREE.MeshBasicMaterial({ map }),
    );
    mesh.position.set(field.length / 2, field.width / 2, 0);
    return mesh;
  }

  function walls(field) {
    const group = new THREE.Group();
    const t = 0.12;
    const parts = [
      [field.length / 2, -t / 2, field.length + 2 * t, t],
      [field.length / 2, field.width + t / 2, field.length + 2 * t, t],
      [-t / 2, field.width / 2, t, field.width],
      [field.length + t / 2, field.width / 2, t, field.width],
    ];
    for (const [x, y, w, d] of parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, WALL_HEIGHT_METERS), paintMaterial('--wall'));
      mesh.position.set(x, y, WALL_HEIGHT_METERS / 2);
      group.add(mesh);
    }
    // The alliance walls' colors, as the top view draws them.
    for (const [x, name] of [
      [-t - 0.05, '--blue'],
      [field.length + t + 0.05, '--red'],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, field.width, 0.05), paintMaterial(name));
      bar.position.set(x, field.width / 2, 0.025);
      group.add(bar);
    }
    return group;
  }

  // Each block of each element, from its outline between its bottom and its top.
  function elements(field) {
    const group = new THREE.Group();
    for (const element of field.elements) {
      for (const block of element.blocks) {
        const shape = new THREE.Shape(block.outline.map(([x, y]) => new THREE.Vector2(x, y)));
        const height = block.topMeters - block.bottomMeters;
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        const raised = block.bottomMeters > 0.3;
        const mesh = new THREE.Mesh(geometry, paintMaterial(raised ? '--element-raised' : '--element'));
        mesh.position.z = block.bottomMeters;
        group.add(mesh);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: themeColor('--element-edge').color }),
        );
        edges.position.z = block.bottomMeters;
        group.add(edges);
      }
    }
    return group;
  }

  function texture(key, make) {
    if (!textures.has(key)) {
      const paper = make();
      const t = new THREE.CanvasTexture(paper);
      t.colorSpace = THREE.SRGBColorSpace;
      textures.set(key, t);
    }
    return textures.get(key);
  }

  // A tag's face: a dark border round a light square (green when a camera sees it).
  function tagFace(seen) {
    const inner = seen ? css('--tag-seen') : '#f4f5f6';
    return texture(`face|${seen}|${inner}`, () => {
      const paper = document.createElement('canvas');
      paper.width = 64;
      paper.height = 64;
      const ctx = paper.getContext('2d');
      ctx.fillStyle = '#14181d';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = inner;
      ctx.fillRect(10, 10, 44, 44);
      ctx.fillStyle = '#14181d';
      ctx.fillRect(22, 22, 20, 20);
      return paper;
    });
  }

  // Text that always faces the viewer: a tag's number, a camera's name.
  function label(text, color, size) {
    const back = css('--label-back');
    const map = texture(`label|${text}|${color}|${back}`, () => {
      const paper = document.createElement('canvas');
      paper.width = 256;
      paper.height = 96;
      const ctx = paper.getContext('2d');
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, 256, 96);
      ctx.font = '600 56px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, 128, 50);
      return paper;
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
    sprite.scale.set(size, (size * 96) / 256, 1);
    return sprite;
  }

  function tags(scene3, seenBy) {
    const group = new THREE.Group();
    const thickness = 0.012;
    for (const tag of scene3.field.tags) {
      const dark = new THREE.MeshLambertMaterial({ color: 0x14181d });
      const face = new THREE.MeshBasicMaterial({ map: tagFace(seenBy.has(tag.id)) });
      // The box's faces run +x, -x, +y, -y, +z, -z: the tag's +x is the face that is read.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, TAG_SIZE_METERS, TAG_SIZE_METERS), [
        face,
        dark,
        dark,
        dark,
        dark,
        dark,
      ]);
      const r = tag.rotation;
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().set(r[0][0], r[0][1], r[0][2], 0, r[1][0], r[1][1], r[1][2], 0, r[2][0], r[2][1], r[2][2], 0, 0, 0, 0, 1),
      );
      const [x, y, z] = tag.position;
      mesh.position.set(x - (tag.normal[0] * thickness) / 2, y - (tag.normal[1] * thickness) / 2, z - (tag.normal[2] * thickness) / 2);
      group.add(mesh);
      if (scene3.show.tagNumbers) {
        const text = label(String(tag.id), css('--text'), 0.5);
        text.position.set(x + tag.normal[0] * 0.35, y + tag.normal[1] * 0.35, z + 0.22);
        group.add(text);
      }
    }
    return group;
  }

  function robot(scene3) {
    const { pose, robotSize } = scene3;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(robotSize.length, robotSize.width, ROBOT_HEIGHT_METERS),
      paintMaterial('--accent', { opacity: 0.85 }),
    );
    group.add(body);
    group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry),
        new THREE.LineBasicMaterial({ color: themeColor('--robot-edge').color }),
      ),
    );
    // A light strip along the front, so its heading reads.
    const front = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, robotSize.width, ROBOT_HEIGHT_METERS + 0.02),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    front.position.x = robotSize.length / 2;
    group.add(front);
    group.position.set(pose.x, pose.y, ROBOT_HEIGHT_METERS / 2);
    group.rotation.z = pose.heading;
    group.userData.robot = -1;
    pickable.push(group);
    return group;
  }

  // The part of each camera's view over the robot, flat on the robot's top: a quiet tint in the
  // camera's color, or the warning color for a view that crosses it further than allowed.
  function overlaps(scene3) {
    const group = new THREE.Group();
    scene3.overlaps.forEach((overlap, i) => {
      if (overlap.polygon.length < 3) return;
      const warn = overlap.style === 'warn';
      const color = warn ? themeColor('--warn').color : CAMERA_COLORS[i % 8];
      const shape = new THREE.Shape(overlap.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: warn ? 0.8 : 0.45, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.position.z = ROBOT_HEIGHT_METERS + 0.03;
      group.add(mesh);
    });
    return group;
  }

  function otherRobots(scene3) {
    const group = new THREE.Group();
    scene3.others.forEach((other, i) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2 * other.halfLength, 2 * other.halfWidth, other.height),
        paintMaterial('--other-robot', { opacity: 0.85 }),
      );
      mesh.position.set(other.x, other.y, other.height / 2);
      mesh.rotation.z = other.heading;
      mesh.userData.robot = i;
      pickable.push(mesh);
      group.add(mesh);
      // The one picked has an outline in the accent color, and a stripe along its front.
      const edgeColor = themeColor(i === scene3.selectedOther ? '--accent' : '--other-robot-edge').color;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: edgeColor })));
      const front = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 2 * other.halfWidth, other.height + 0.02),
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
      );
      front.position.x = other.halfLength;
      mesh.add(front);
    });
    return group;
  }

  // One camera: its marker, its view as a pyramid of edges, and its sight lines.
  function cameraParts(scene3, view, index, group) {
    const color = CAMERA_COLORS[index % 8];
    const [cx, cy, cz] = view.located.position;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(index === scene3.selected ? 0.07 : 0.05, 16, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    marker.position.set(cx, cy, cz);
    group.add(marker);
    if (scene3.show.views) {
      const k = view.located.intrinsics;
      const r = view.located.rotation;
      const reach = Math.min(PYRAMID_METERS, scene3.sightMeters);
      const wide = Math.tan((k.halfWidthDegrees * Math.PI) / 180);
      const high = Math.tan((k.halfHeightDegrees * Math.PI) / 180);
      const apex = [cx, cy, cz];
      const far = [
        [1, wide, high],
        [1, -wide, high],
        [1, -wide, -high],
        [1, wide, -high],
      ].map((d) => {
        const length = Math.hypot(...d);
        return add(apex, apply(r, d.map((c) => (c / length) * reach)));
      });
      const edges = [];
      far.forEach((corner, i) => {
        edges.push(apex, corner, corner, far[(i + 1) % 4]);
      });
      group.add(lines(edges, color));
      const middle = far[0].map((_, i) => (far[0][i] + far[2][i]) / 2);
      const name = label(view.name, color, 0.7);
      name.position.set(middle[0], middle[1], middle[2] + 0.2);
      group.add(name);
    }
    const seen = [];
    const hidden = [];
    for (const result of view.results) {
      const target = [result.tag.position[0], result.tag.position[1], result.tag.position[2]];
      if (result.status === SEEN) seen.push([cx, cy, cz], target);
      else if (result.status === HIDDEN) hidden.push([cx, cy, cz], target);
    }
    if (scene3.show.seenLines && seen.length > 0) group.add(lines(seen, color));
    if (scene3.show.hiddenLines && hidden.length > 0) group.add(lines(hidden, color, true));
  }

  // Draws the scene (the same `scene` as drawScene's).
  function render(scene3) {
    last = scene3;
    const field = scene3.field;
    const key = [
      field.year,
      scene3.show.elements,
      scene3.show.map && scene3.coverage ? scene3.map : 'none',
      scene3.errorScale.poor,
      scene3.show.blend,
      ['--carpet', '--wall', '--element', '--element-raised', '--element-edge', '--accent', '--blue', '--red', '--line'].map(css).join('|'),
    ].join('/');
    const first = fixedKey === '';
    if (key !== fixedKey || scene3.coverage !== fixedCoverage) {
      fixedCoverage = scene3.coverage;
      scene.remove(fixed);
      clear(fixed);
      fixed = new THREE.Group();
      fixed.add(floor(field, scene3), walls(field));
      if (scene3.show.elements) fixed.add(elements(field));
      scene.add(fixed);
      fixedKey = key;
    }
    scene.remove(moving);
    clear(moving);
    pickable.length = 0;
    moving = new THREE.Group();
    const seenBy = new Set();
    for (const view of scene3.cameras) {
      for (const result of view.results) if (result.status === SEEN) seenBy.add(result.id);
    }
    moving.add(tags(scene3, seenBy), robot(scene3));
    if (scene3.show.views) moving.add(overlaps(scene3));
    if (scene3.show.others) moving.add(otherRobots(scene3));
    scene3.cameras.forEach((view, i) => cameraParts(scene3, view, i, moving));
    scene.add(moving);
    if (first) reset();
    else paint();
  }

  // Where the pointer's ray meets a horizontal plane (the floor, by default), as [x, y], or null.
  function floorPoint(clientX, clientY, z = 0) {
    setRay(clientX, clientY);
    const at = new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), at) ? [at.x, at.y] : null;
  }

  function setRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera({ x, y }, camera);
  }

  // The robot under the pointer, as { robot, z }: -1 for the main one, 0 and up for the others, and
  // the height of the point hit. Null when the pointer is on no robot.
  function pick(clientX, clientY) {
    setRay(clientX, clientY);
    const [hit] = raycaster.intersectObjects(pickable, true);
    if (!hit) return null;
    let object = hit.object;
    while (object && object.userData.robot === undefined) object = object.parent;
    return object ? { robot: object.userData.robot, z: hit.point.z } : null;
  }

  resize();
  return { render, resize, reset, pick, floorPoint };
}
