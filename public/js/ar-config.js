/**
 * AR location registry — add new places here, then update targets-manifest.js
 * and run: node scripts/compile-browser.js
 */
const LOCATIONS = {
  'poson-lantern': {
    id: 'poson-lantern',
    targetIndices: [0, 1, 2],
    modelSrc: 'assets/models/poson-lantern.glb',
    modelScale: 0.72,
    modelOffset: { x: 0, y: 0.05, z: 0.03 },
    fitMode: 'ground',
    defaultUserZoom: 1,
    defaultUserYOffset: 0,
    landscape: {
      modelOffset: { x: 0, y: 0.04, z: 0.03 },
      defaultUserYOffset: 0,
    },
  },
  'jendo-building': {
    id: 'jendo-building',
    targetIndices: [3],
    modelSrc: 'assets/models/jendo-building.glb',
    modelScale: 0.84,
    modelOffset: { x: 0, y: 0.06, z: 0.03 },
    fitMode: 'facade',
    fitLift: 0.38,
    defaultUserZoom: 1,
    defaultUserYOffset: 0,
    landscape: {
      modelOffset: { x: 0, y: 0.04, z: 0.03 },
      defaultUserYOffset: 0,
    },
  },
  'bay-12-place': {
    id: 'bay-12-place',
    targetIndices: [4, 5],
    modelSrc: 'assets/models/bay-12-place.glb',
    modelScale: 0.78,
    modelOffset: { x: 0, y: 0.08, z: 0.03 },
    fitMode: 'center',
    fitBounds: 'mesh',
    defaultUserZoom: 1,
    defaultUserYOffset: 0.06,
    landscape: {
      modelOffset: { x: 0, y: 0.08, z: 0.03 },
      defaultUserYOffset: 0.06,
    },
  },
};

export const MODES = {
  all: {
    targetSrc: 'targets.mind',
    experiences: [
      LOCATIONS['poson-lantern'],
      LOCATIONS['jendo-building'],
      LOCATIONS['bay-12-place'],
    ],
    targetPriority: [4, 5, 3, 0, 1, 2],
    facadeTargetIndices: [3, 4, 5],
  },
  building: {
    targetSrc: 'targets-building.mind',
    experiences: [{ ...LOCATIONS['jendo-building'], targetIndices: [0] }],
    targetPriority: [0],
    facadeTargetIndices: [0],
  },
  bay12: {
    targetSrc: 'targets-bay12.mind',
    experiences: [{ ...LOCATIONS['bay-12-place'], targetIndices: [0, 1] }],
    targetPriority: [0, 1],
    facadeTargetIndices: [0, 1],
  },
  poson: {
    targetSrc: 'targets-poson.mind',
    experiences: [{ ...LOCATIONS['poson-lantern'], targetIndices: [0, 1, 2] }],
    targetPriority: [0, 1, 2],
    facadeTargetIndices: [],
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
  maxUserYOffset: 0.35,
  positionStep: 0.06,
  targetLostDelayMs: 400,
  filterMinCF: 0.0005,
  filterBeta: 0.008,
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
    facadeTargetIndices: cfg.facadeTargetIndices,
  };
}

export function experienceForTarget(experiences, index) {
  return experiences.find((exp) => exp.targetIndices.includes(index)) ?? null;
}

export function targetCount(experiences) {
  return Math.max(...experiences.flatMap((e) => e.targetIndices)) + 1;
}
