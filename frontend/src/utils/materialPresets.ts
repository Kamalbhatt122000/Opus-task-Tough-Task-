/**
 * PBR material presets for each stone material type.
 * Used with Three.js MeshPhysicalMaterial.
 */

import type { StoneMaterialName, JewelleryMaterialName } from '../types/api';

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

/**
 * PBR presets for the jewellery body (the STL mesh itself, not the stones).
 * Tuned for `MeshPhysicalMaterial`: high metalness for metals, very low
 * for the oxidized/painted finish.
 */
export interface JewelleryPreset {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
}

export const JEWELLERY_PRESETS: Record<JewelleryMaterialName, JewelleryPreset> = {
  'Silver': {
    color: '#C0C0C0',
    metalness: 0.95,
    roughness: 0.15,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    envMapIntensity: 2.0,
  },
  'Yellow Gold': {
    color: '#F5C76A',
    metalness: 1.0,
    roughness: 0.18,
    clearcoat: 0.4,
    clearcoatRoughness: 0.1,
    envMapIntensity: 2.0,
  },
  'Rose Gold': {
    color: '#E0A99A',
    metalness: 1.0,
    roughness: 0.2,
    clearcoat: 0.4,
    clearcoatRoughness: 0.12,
    envMapIntensity: 2.0,
  },
  'White Gold': {
    color: '#E8E6E3',
    metalness: 0.95,
    roughness: 0.12,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    envMapIntensity: 2.2,
  },
  'Platinum': {
    color: '#D6D7D8',
    metalness: 1.0,
    roughness: 0.1,
    clearcoat: 0.7,
    clearcoatRoughness: 0.05,
    envMapIntensity: 2.4,
  },
  'Oxidized': {
    color: '#1F1F22',
    metalness: 0.4,
    roughness: 0.7,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.8,
  },
};

export const JEWELLERY_MATERIAL_NAMES: JewelleryMaterialName[] = [
  'Silver', 'Yellow Gold', 'Rose Gold', 'White Gold', 'Platinum', 'Oxidized',
];

export const STONE_CUTS = [
  { value: 'round_brilliant', label: 'Round Brilliant' },
  { value: 'princess', label: 'Princess' },
  { value: 'oval', label: 'Oval' },
  { value: 'marquise', label: 'Marquise' },
  { value: 'emerald', label: 'Emerald' },
];
