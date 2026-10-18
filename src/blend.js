// Blending the coverage map: the value at each point of a finer raster than the grid, interpolated
// between the grid's points, so the map reads as smooth where it is measured. The values are
// blended, and only afterward turned into colors. Cells with nothing to show do not bleed: a cell
// with no room for the robot, or with no measurement, keeps its own square, and is not blended
// into its neighbors, nor they into it.

// How many raster points to a grid cell, each way.
export const BLEND_FACTOR = 8;

// What a raster point shows: nothing (no room for the robot), "no measurement", or a value.
export const BLANK = 0;
export const UNMEASURED = 1;
export const VALUE = 2;

// The kind of a cell's values: null for a cell with no room, Infinity for no measurement.
function kindOf(cell, map) {
  if (!cell) return BLANK;
  return cell[map] === Infinity ? UNMEASURED : VALUE;
}

// The raster for one map: `grid` has the grid's `columns` and `rows`, `cells` the values of each
// cell (row by row, from the lowest y), and the result has `width` by `height` points, `kinds` and
// `values`, in the same order: the first row is the lowest y.
export function blendCells(grid, cells, map, factor = BLEND_FACTOR) {
  const { columns, rows } = grid;
  const width = columns * factor;
  const height = rows * factor;
  const kinds = new Uint8Array(width * height);
  const values = new Float32Array(width * height);
  // A cell's value when it is a measured one, else null (also past the grid's edge).
  const measured = (column, row) => {
    if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
    const cell = cells[row * columns + column];
    return kindOf(cell, map) === VALUE ? cell[map] : null;
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const at = py * width + px;
      // Where the point is in cells, with the cells' centers on whole numbers.
      const gx = (px + 0.5) / factor;
      const gy = (py + 0.5) / factor;
      const own = kindOf(cells[Math.floor(gy) * columns + Math.floor(gx)], map);
      kinds[at] = own;
      if (own !== VALUE) continue;
      const fx = gx - 0.5;
      const fy = gy - 0.5;
      const c0 = Math.floor(fx);
      const r0 = Math.floor(fy);
      const tx = fx - c0;
      const ty = fy - r0;
      let sum = 0;
      let weight = 0;
      for (const [dc, dr, w] of [
        [0, 0, (1 - tx) * (1 - ty)],
        [1, 0, tx * (1 - ty)],
        [0, 1, (1 - tx) * ty],
        [1, 1, tx * ty],
      ]) {
        const v = measured(c0 + dc, r0 + dr);
        if (v === null) continue;
        sum += w * v;
        weight += w;
      }
      values[at] = sum / weight;
    }
  }
  return { width, height, kinds, values };
}
