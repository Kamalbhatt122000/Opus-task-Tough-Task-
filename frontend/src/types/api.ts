/**
 * TypeScript interfaces for all API response shapes.
 */

export interface ProcessingTime {
  stage1_load: number;
  stage2_detect: number;
  stage3_generate: number;
  stage4_place: number;
  total: number;
}

export interface Metadata {
  filename: string;
  vertices: number;
  faces: number;
  bounding_box_mm: [number, number, number];
  total_cavities: number;
  processing_time_ms: ProcessingTime;
}

export interface Cavity {
  id: number;
  centroid_mm: [number, number, number];
  normal: [number, number, number];
  diameter_mm: number;
  depth_mm: number;
  confidence: number;
  stone_cut: string;
  stone_diameter_mm: number;
  stone_height_mm: number;
}

export interface ProcessResponse {
  session_id: string;
  metadata: Metadata;
  cavities: Cavity[];
  jewellery_mesh_b64: string;
  composite_mesh_b64: string;
  stones_glb_b64: string;
}

export interface SSEEvent {
  stage: number;
  status: 'running' | 'done' | 'error';
  message: string;
  data: ProcessResponse | null;
}

export interface StageProgress {
  stage: number;
  status: 'pending' | 'running' | 'done' | 'error';
  message: string;
}

export type StoneMaterialName = 'Diamond' | 'Ruby' | 'Emerald' | 'Sapphire' | 'Amethyst';
export type StoneCutName = 'round_brilliant' | 'princess' | 'oval' | 'marquise' | 'emerald';
export type JewelleryMaterialName =
  | 'Silver'
  | 'Yellow Gold'
  | 'Rose Gold'
  | 'White Gold'
  | 'Platinum'
  | 'Oxidized';

export interface RegenerateRequest {
  session_id: string;
  stone_type: string;
  stone_material: string;
}

/**
 * A user-placed stone, stored entirely client-side. Position and normal
 * are in the same centered world space as the displayed STL geometry, so
 * a raycast hit on the JewelleryMesh can be saved directly into these
 * fields without any offset math.
 */
export interface ManualStone {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  diameter_mm: number;
  depth_mm: number;
  cut: StoneCutName;
  /** Distance along the surface normal — positive = above, negative = sunk in. */
  liftOffset: number;
}

/**
 * What should happen the next time the user clicks the jewellery mesh.
 *  - 'add'  → create a new manual stone at the click point
 *  - 'move' → relocate stoneId to the click point
 *  -  null  → ignore mesh clicks (default)
 *
 * Both intents are single-shot — once consumed, the action clears.
 */
export type PendingMeshClick =
  | { kind: 'add' }
  | { kind: 'move'; stoneId: string }
  | null;

// ---------- Staged-pipeline response shapes (POST /api/session/...) ----------

export interface Stage1Response {
  session_id: string;
  metadata: {
    filename: string;
    vertices: number;
    faces: number;
    bounding_box_mm: [number, number, number];
  };
  jewellery_mesh_b64: string;
  stage_ms: number;
}

export interface Stage2Response {
  cavities: Cavity[];
  total_cavities: number;
  stage_ms: number;
}

export interface Stage3Response {
  stone_count: number;
  stone_type: string;
  stage_ms: number;
}

export interface Stage4Response {
  composite_mesh_b64: string;
  stones_glb_b64: string;
  stage_ms: number;
  timings: {
    stage1_load: number;
    stage2_detect: number;
    stage3_generate: number;
    stage4_place: number;
  };
}

// ---------- Chat (POST /api/session/{id}/chat) ----------

export type ChatOperation =
  | { type: 'set_size'; factor: number }
  | { type: 'set_cut'; cut: StoneCutName }
  | { type: 'set_material'; material: StoneMaterialName }
  | { type: 'set_color'; color: string }
  | { type: 'set_jewellery_material'; material: JewelleryMaterialName }
  | { type: 'remove_stone'; stone_id: number }
  | { type: 'restore_all' }
  | { type: 'move_stone'; stone_id: number; dx: number; dy: number; dz: number }
  | { type: 'duplicate_stone'; stone_id: number; dx: number; dy: number; dz: number }
  | {
      type: 'add_stone';
      x: number;
      y: number;
      z: number;
      nx?: number;
      ny?: number;
      nz?: number;
      diameter_mm?: number;
      cut?: StoneCutName;
    };

export interface ChatResponse {
  operations: ChatOperation[];
  explanation: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}
