/**
 * AR location registry — add new places here, then update targets-manifest.js
 * and run: node scripts/compile-browser.js
 *
 * Each location maps MindAR target index(es) → 3D model.
 */
const LOCATIONS = {
  'poson-lantern': {
    id: 'poson-lantern',
    targetIndices: [0, 1, 2],
    modelSrc: 'assets/models/poson-lantern.glb',
    modelScale: 0.72,
    modelOffset: { x: 0, y: 0.05, z: 0.03 },
    fitMode: 'ground',
  },
  'jendo-building': {
    id: 'jendo-building',
    targetIndices: [3],
    modelSrc: 'assets/models/jendo-building.glb',
    modelScale: 1.0,
    modelOffset: { x: 0, y: 0.08, z: 0.02 },
    fitMode: 'center',
  },
};

export const MODES = {
  all: {
    targetSrc: 'targets.mind',
    experiences: [LOCATIONS['poson-lantern'], LOCATIONS['jendo-building']],
    targetPriority: [3, 0, 1, 2],
    buildingTargetIndex: 3,
  },
  building: {
    targetSrc: 'targets-building.mind',
    experiences: [{ ...LOCATIONS['jendo-building'], targetIndices: [0] }],
    targetPriority: [0],
    buildingTargetIndex: 0,
  },
  poson: {
    targetSrc: 'targets-poson.mind',
    experiences: [{ ...LOCATIONS['poson-lantern'], targetIndices: [0, 1, 2] }],
    targetPriority: [0, 1, 2],
    buildingTargetIndex: -1,
  },
};

export const AR_SETTINGS = {
  posSmooth: 0.14,
  rotSmooth: 0.14,
  calibrateFrames: 10,
  defaultUserZoom: 1,
  minUserZoom: 0.55,
  maxUserZoom: 1.8,
  zoomStep: 0.15,
  defaultUserYOffset: 0,
  minUserYOffset: -0.3,
  maxUserYOffset: 0.3,
  positionStep: 0.06,
  targetLostDelayMs: 400,
  filterMinCF: 0.001,
  filterBeta: 0.01,
  logoActivationDelayMs: 500,
};

export function getMode() {
  const exp = new URLSearchParams(location.search).get('exp');
  return MODES[exp] ? exp : 'all';
}

export function getSetup() {
  const mode = getMode();
  const cfg = MODES[mode];
  return {
    mode,
    targetSrc: cfg.targetSrc,
    experiences: cfg.experiences,
    targetPriority: cfg.targetPriority,
    buildingTargetIndex: cfg.buildingTargetIndex,
  };
}

export function experienceForTarget(experiences, index) {
  return experiences.find((exp) => exp.targetIndices.includes(index)) ?? null;
}

export function targetCount(experiences) {
  return Math.max(...experiences.flatMap((e) => e.targetIndices)) + 1;
}
