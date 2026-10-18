// Small vector and matrix helpers. A vector is an [x, y, z] array; a 3x3 matrix is an array of rows.

export const DEG = Math.PI / 180;

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function norm(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

// The matrix times a vector.
export function apply(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// The transposed matrix times a vector: for a rotation, the inverse rotation.
export function applyTransposed(m, v) {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

export function multiply(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

// A rotation matrix from a unit quaternion, as WPILib's layouts give tag rotations.
export function quaternionToMatrix(w, x, y, z) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

// WPILib's Rotation3d(roll, pitch, yaw) in radians: turned about z by yaw, then the turned y by
// pitch, then the turned x by roll. Positive pitch points the x axis down.
export function rotationFromRollPitchYaw(roll, pitch, yaw) {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rz = [
    [cy, -sy, 0],
    [sy, cy, 0],
    [0, 0, 1],
  ];
  const ry = [
    [cp, 0, sp],
    [0, 1, 0],
    [-sp, 0, cp],
  ];
  const rx = [
    [1, 0, 0],
    [0, cr, -sr],
    [0, sr, cr],
  ];
  return multiply(rz, multiply(ry, rx));
}

// An angle in radians wrapped into (-pi, pi], as WPILib's Rotation2d keeps it.
export function wrap(radians) {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

// The inverse of a square matrix by Gauss-Jordan elimination with partial pivoting.
export function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => {
    const wide = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) wide[j] = row[j];
    wide[n + i] = 1;
    return wide;
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    const swap = a[col];
    a[col] = a[pivot];
    a[pivot] = swap;
    const d = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col];
      if (f !== 0) {
        for (let j = 0; j < 2 * n; j++) a[row][j] -= f * a[col][j];
      }
    }
  }
  return a.map((row) => row.slice(n));
}

// The two eigenvalues of a symmetric 2x2 matrix [[xx, xy], [xy, yy]], larger first.
export function eigen2(xx, xy, yy) {
  const mean = (xx + yy) / 2;
  const r = Math.hypot((xx - yy) / 2, xy);
  return [mean + r, Math.max(0, mean - r)];
}
