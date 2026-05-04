/**
 * PBR material presets for each stone material type.
 * Used with Three.js MeshPhysicalMaterial.
 */

import type { StoneMaterialName } from '../types/api';

export interface MaterialPreset {
  color: string;
  transmission: number;
  ior: number;
  roughness: number;
  metalness: number;
  thickness: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  attenuationColor?: string;
  attenuationDistance?: number;
}

export const MATERIAL_PRESETS: Record<StoneMaterialName, MaterialPreset> = {
  Diamond: {
    color: '#E8F4FF',
    transmission: 1.0,
    ior: 2.418,
    roughness: 0.0,
    metalness: 0.0,
    thickness: 2.0,
    envMapIntensity: 3.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationColor: '#ffffff',
    attenuationDistance: 5,
  },
  Ruby: {
    color: '#9B1C1C',
    transmission: 0.6,
    ior: 1.770,
    roughness: 0.0,
    metalness: 0.0,
    thickness: 2.0,
    envMapIntensity: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationColor: '#ff2020',
    attenuationDistance: 3,
  },
  Emerald: {
    color: '#064E3B',
    transmission: 0.6,
    ior: 1.580,
    roughness: 0.0,
    metalness: 0.0,
    thickness: 2.0,
    envMapIntensity: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationColor: '#00ff88',
    attenuationDistance: 3,
  },
  Sapphire: {
    color: '#1E3A8A',
    transmission: 0.7,
    ior: 1.770,
    roughness: 0.0,
    metalness: 0.0,
    thickness: 2.0,
    envMapIntensity: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationColor: '#2050ff',
    attenuationDistance: 3,
  },
  Amethyst: {
    color: '#6B21A8',
    transmission: 0.7,
    ior: 1.540,
    roughness: 0.0,
    metalness: 0.0,
    thickness: 2.0,
    envMapIntensity: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationColor: '#aa40ff',
    attenuationDistance: 3,
  },
};

export const STONE_MATERIAL_NAMES: StoneMaterialName[] = [
  'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Amethyst',
];

export const STONE_CUTS = [
  { value: 'round_brilliant', label: 'Round Brilliant' },
  { value: 'princess', label: 'Princess' },
  { value: 'oval', label: 'Oval' },
  { value: 'marquise', label: 'Marquise' },
  { value: 'emerald', label: 'Emerald' },
];
