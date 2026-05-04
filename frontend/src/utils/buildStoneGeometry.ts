/**
 * Client-side gemstone geometry generation.
 *
 * Mirrors backend/generator/stone_generator.py so manual stones look the
 * same as the auto-detected ones. Generating in the browser avoids a
 * server round-trip every time the user nudges a slider.
 *
 * Local space convention:
 *   - Girdle ring sits on the z = 0 plane
 *   - Crown (table) extends to +z
 *   - Pavilion (culet) extends to -z
 *
 * Callers orient the stone by aligning its +Z axis to the cavity's
 * outward surface normal.
 */

import * as THREE from 'three';

/** Round Brilliant — 32 girdle facets, 16 table facets, single culet. */
export function buildRoundBrilliantGeometry(
  diameter: number,
  height: number,
): THREE.BufferGeometry {
  const R = Math.max(diameter / 2, 1e-3);
  const tableRatio = 0.57;
  const crownH = height * 0.35;
  const pavH = height * 0.65;
  const nGirdle = 32;
  const nTable = 16;

  const positions: number[] = [];
  const indices: number[] = [];

  // Girdle ring (indices 0..nGirdle-1)
  const gStart = 0;
  for (let i = 0; i < nGirdle; i++) {
    const a = (2 * Math.PI * i) / nGirdle;
    positions.push(R * Math.cos(a), R * Math.sin(a), 0);
  }

  // Table ring (indices nGirdle..nGirdle+nTable-1)
  const tStart = nGirdle;
  const tr = R * tableRatio;
  for (let i = 0; i < nTable; i++) {
    const a = (2 * Math.PI * i) / nTable;
    positions.push(tr * Math.cos(a), tr * Math.sin(a), crownH);
  }

  // Culet (single vertex)
  const culetIdx = nGirdle + nTable;
  positions.push(0, 0, -pavH);

  // Crown facets — every nGirdle/nTable girdle vertices fan to one table vertex
  const gPerT = Math.max(1, Math.floor(nGirdle / nTable));
  for (let i = 0; i < nTable; i++) {
    const t0 = tStart + i;
    const t1 = tStart + ((i + 1) % nTable);
    for (let j = 0; j < gPerT; j++) {
      const g0 = gStart + ((i * gPerT + j) % nGirdle);
      const g1 = gStart + ((i * gPerT + j + 1) % nGirdle);
      indices.push(t0, g0, g1);
      if (j === gPerT - 1) {
        indices.push(t0, g1, t1);
      }
    }
  }

  // Pavilion facets — every girdle edge fans to the culet
  for (let i = 0; i < nGirdle; i++) {
    const g0 = gStart + i;
    const g1 = gStart + ((i + 1) % nGirdle);
    indices.push(g0, culetIdx, g1);
  }

  // Table top (fan triangulation of the table polygon)
  for (let i = 0; i < nTable - 2; i++) {
    indices.push(tStart, tStart + i + 1, tStart + i + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
