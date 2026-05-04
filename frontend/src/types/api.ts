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

export interface RegenerateRequest {
  session_id: string;
  stone_type: string;
  stone_material: string;
}
