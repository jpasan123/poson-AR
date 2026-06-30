import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';
import { AR_SETTINGS, getSetup, experienceForTarget, targetCount } from './ar-config.js';

const setup = getSetup();
const EXPERIENCES = setup.experiences;
const TARGET_PRIORITY = setup.targetPriority;
const IS_ANDROID = /android/i.test(navigator.userAgent);

function isLowEndDevice() {
  if (!IS_ANDROID) return false;
  const mem = navigator.deviceMemory;
  if (typeof mem === 'number' && mem <= 3) return true;
  const ua = navigator.userAgent.toLowerCase();
  return /sm-g610|sm-j710|j7 prime|galaxy j7|android [4-5]\./.test(ua);
}

const LOW_END = isLowEndDevice();

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const isLandscape = () => {
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  return w > h;
};

const getViewportSize = () => {
  const container = document.querySelector('#ar-container');
  const vv = window.visualViewport;
  return {
    w: Math.round(vv?.width ?? container?.clientWidth ?? window.innerWidth),
    h: Math.round(vv?.height ?? container?.clientHeight ?? window.innerHeight),
  };
};

const getMarkerOffset = (exp) => {
  if (!exp) return { x: 0, y: 0, z: 0 };
  if (isLandscape() && exp.landscape?.modelOffset) return exp.landscape.modelOffset;
  return exp.modelOffset ?? { x: 0, y: 0, z: 0 };
};

const getDefaultYOffset = (exp) => {
  if (!exp) return AR_SETTINGS.defaultUserYOffset;
  if (isLandscape() && exp.landscape?.defaultUserYOffset != null) {
    return exp.landscape.defaultUserYOffset;
  }
  return exp.defaultUserYOffset ?? AR_SETTINGS.defaultUserYOffset;
};

const $ = (id) => document.getElementById(id);
const show = (id) => $(id)?.classList.remove('hidden');
const hide = (id) => $(id)?.classList.add('hidden');

function setLoadStatus(message) {
  const el = $('load-status');
  if (el) el.textContent = message || '';
}

function prefetchModels(experiences) {
  if (LOW_END) return;
  experiences.forEach((exp) => {
    [exp.modelSrc].filter(Boolean).forEach((href) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'fetch';
      link.href = href;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  });
}

function showError(message) {
  hide('loading-screen');
  hide('start-screen');
  $('error-message').textContent = message;
  show('error-screen');
}

function sanitizeScene(scene) {
  const remove = [];
  scene.traverse((child) => {
    const name = (child.name || '').toLowerCase();
    if (
      name === 'camera'
      || name === 'maincamera'
      || name.endsWith('camera')
      || name === 'light'
      || name.includes('keylight')
      || name.includes('filllight')
      || name.includes('rimlight')
    ) {
      remove.push(child);
    }
  });
  remove.forEach((node) => node.parent?.remove(node));
}

function findLogoMesh(model) {
  let logo = null;
  model.traverse((child) => {
    if ((child.name || '').startsWith('tripo_node')) logo = child;
  });
  return logo;
}

function getTowerBounds(model) {
  const box = new THREE.Box3();
  model.traverse((child) => {
    if (!child.isMesh) return;
    const name = (child.name || '').toLowerCase();
    if (name.startsWith('tripo_node') || name.includes('camera') || name.includes('light')) return;
    box.union(new THREE.Box3().setFromObject(child));
  });
  return box;
}

function applyLogoMapFlip(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mat) => {
    if (!mat?.map) return;
    mat.map.wrapS = THREE.RepeatWrapping;
    mat.map.repeat.x = -1;
    mat.map.offset.x = 1;
    mat.map.needsUpdate = true;
  });
}

function logoPlaneSize(map) {
  const img = map?.image;
  if (img?.width && img?.height) {
    const aspect = img.width / img.height;
    const height = 0.38;
    return { w: height * aspect, h: height };
  }
  return { w: 1.1, h: 0.38 };
}

function createLogoMaterial(srcMat) {
  if (!srcMat) {
    return new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, depthWrite: true });
  }
  const mat = new THREE.MeshStandardMaterial({
    map: srcMat.map,
    normalMap: srcMat.normalMap,
    metalnessMap: srcMat.metalnessMap,
    roughnessMap: srcMat.roughnessMap,
    color: srcMat.color ?? new THREE.Color(0xffffff),
    metalness: srcMat.metalness ?? 0,
    roughness: srcMat.roughness ?? 0.8,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  if (mat.map) {
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.anisotropy = 4;
    mat.map.needsUpdate = true;
  }
  return mat;
}

function mountLogoOnTower(model, logo, exp) {
  if (!logo) return;

  const rot = exp.logoRotation ?? { x: 0, y: Math.PI / 2, z: 0 };
  logo.rotation.set(rot.x, rot.y, rot.z);
  logo.position.set(0, 0, 0);
  logo.scale.x = Math.abs(logo.scale.x || 1);
  logo.scale.y = Math.abs(logo.scale.y || 1);
  logo.scale.z = Math.abs(logo.scale.z || 1);
  if (exp.logoFlipX) {
    if (LOW_END) applyLogoMapFlip(logo);
    else logo.scale.x = -Math.abs(logo.scale.x || 1);
  }
  logo.frustumCulled = false;
  logo.visible = true;

  const mats = Array.isArray(logo.material) ? logo.material : [logo.material];
  mats.forEach((mat) => {
    if (!mat) return;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = true;
    mat.transparent = false;
    if (mat.map) {
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.map.needsUpdate = true;
    }
    mat.needsUpdate = true;
  });

  const offset = exp.logoOffset ?? { x: -0.22, y: 1.95, z: 0.14 };
  const finial = model.getObjectByName('Finial_Ball');

  if (finial) {
    const anchor = new THREE.Group();
    anchor.name = 'logo-anchor';
    anchor.position.set(offset.x, offset.y, offset.z);
    anchor.add(logo);
    finial.add(anchor);
    model.updateMatrixWorld(true);
    console.info('[AR] Logo mounted on finial');
    return;
  }

  model.updateMatrixWorld(true);
  const towerBox = getTowerBounds(model);
  if (towerBox.isEmpty()) {
    model.add(logo);
    return;
  }

  const worldPos = new THREE.Vector3(
    towerBox.getCenter(new THREE.Vector3()).x + offset.x,
    towerBox.max.y + (exp.logoWorldLift ?? 0.15),
    towerBox.getCenter(new THREE.Vector3()).z + offset.z,
  );
  model.worldToLocal(worldPos);
  logo.position.copy(worldPos);
  model.add(logo);
  model.updateMatrixWorld(true);
  console.info('[AR] Logo mounted at tower top');
}

function detachLogoForFitting(model) {
  const logo = findLogoMesh(model);
  if (!logo) return null;
  logo.parent?.remove(logo);
  return logo;
}

function stabilizeTowerPivot(model) {
  ['Main_Pivot', 'LanternRoot'].forEach((name) => {
    const pivot = model.getObjectByName(name);
    if (!pivot) return;
    pivot.rotation.set(0, 0, 0);
    pivot.quaternion.identity();
    pivot.updateMatrixWorld(true);
  });
}

function preNormalizeModel(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 10) {
    model.scale.setScalar(1 / maxDim);
    model.updateMatrixWorld(true);
  }
}

function lightenMaterials(scene) {
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const name = (child.name || '').toLowerCase();
    const isGlow = name.includes('glow') || name.includes('amber') || name.includes('lantern');

    const convert = (mat) => {
      if (!mat || mat.isMeshBasicMaterial) return mat;
      const opts = {
        map: mat.map,
        color: mat.color,
        side: mat.side ?? THREE.FrontSide,
        transparent: mat.transparent,
        opacity: mat.opacity ?? 1,
      };
      let next;
      if (isGlow && mat.emissive) {
        next = new THREE.MeshLambertMaterial({
          ...opts,
          emissive: mat.emissive,
          emissiveIntensity: mat.emissiveIntensity ?? 1,
        });
      } else {
        next = new THREE.MeshBasicMaterial(opts);
      }
      mat.normalMap?.dispose?.();
      mat.roughnessMap?.dispose?.();
      mat.metalnessMap?.dispose?.();
      mat.aoMap?.dispose?.();
      mat.dispose?.();
      return next;
    };

    if (Array.isArray(child.material)) {
      child.material = child.material.map(convert);
    } else {
      child.material = convert(child.material);
    }
  });
}

function simplifyLogoMesh(logo) {
  const verts = logo.geometry?.attributes?.position?.count ?? 0;
  if (!logo.isMesh || verts < 5000) return logo;

  const srcMat = Array.isArray(logo.material) ? logo.material[0] : logo.material;
  const map = srcMat?.map ?? null;
  const { w, h } = logoPlaneSize(map);
  const mat = createLogoMaterial(srcMat);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plane.name = logo.name;
  plane.rotation.copy(logo.rotation);
  plane.scale.copy(logo.scale);
  plane.scale.x = Math.abs(plane.scale.x);
  plane.scale.y = Math.abs(plane.scale.y);
  plane.scale.z = Math.abs(plane.scale.z);
  plane.frustumCulled = false;
  logo.geometry?.dispose?.();
  srcMat?.dispose?.();
  console.info('[AR] Logo simplified for low-end GPU:', verts, 'verts -> plane');
  return plane;
}

function optimizeModelForDevice(model, logoMesh) {
  if (!LOW_END) return logoMesh;
  let logo = logoMesh;
  if (logo) logo = simplifyLogoMesh(logo);
  lightenMaterials(model);
  return logo;
}

function prepareModel(scene) {
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    child.visible = true;
    child.matrixAutoUpdate = true;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((mat) => {
      if (!mat) return;
      mat.side = THREE.FrontSide;
      mat.depthTest = true;
      mat.depthWrite = true;
      mat.needsUpdate = true;

      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = LOW_END ? 1 : 4;
        mat.map.needsUpdate = true;
      }
      if (mat.emissiveMap) {
        mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.emissiveMap.needsUpdate = true;
      }
      if (mat.normalMap) mat.normalMap.colorSpace = THREE.LinearSRGBColorSpace;
      if (mat.roughnessMap) mat.roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
      if (mat.metalnessMap) mat.metalnessMap.colorSpace = THREE.LinearSRGBColorSpace;
    });
  });
}

async function loadModelAsset(src, onProgress) {
  const attempts = IS_ANDROID ? 3 : 1;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          src,
          (gltf) => {
            console.info('[AR] Loaded GLB:', src);
            resolve({ scene: gltf.scene, animations: gltf.animations ?? [] });
          },
          (event) => {
            if (!onProgress || !event.total) return;
            onProgress(event.loaded / event.total);
          },
          (err) => reject(err),
        );
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[AR] Load attempt ${attempt}/${attempts} failed:`, src, err);
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
  }
  throw lastErr;
}

async function loadModelForExperience(exp, onProgress) {
  return loadModelAsset(exp.modelSrc, onProgress);
}

async function buildExperience(exp, slot, onProgress) {
  const asset = await loadModelForExperience(exp, onProgress);
  const holder = new THREE.Group();
  holder.visible = false;
  holder.name = exp.id;

  const model = asset.scene;
  sanitizeScene(model);
  stabilizeTowerPivot(model);
  let logoMesh = detachLogoForFitting(model);
  preNormalizeModel(model);
  prepareModel(model);
  logoMesh = optimizeModelForDevice(model, logoMesh);
  fitModel(
    model,
    exp.modelScale,
    exp.fitMode ?? 'ground',
    exp.fitLift,
    exp.fitBounds,
    exp.fitHeightFactor,
  );
  mountLogoOnTower(model, logoMesh, exp);
  holder.add(model);

  if (slot) slot.attachRig.add(holder);

  const anim = exp.playAnimation === false
    ? null
    : setupAnimations(model, asset.animations, exp.animationExclude ?? []);

  return { holder, anim };
}

function getFitBox(model, fitBounds) {
  model.updateMatrixWorld(true);

  if (fitBounds !== 'mesh') {
    const box = new THREE.Box3();
    model.traverse((child) => {
      if (!child.isMesh) return;
      const name = (child.name || '').toLowerCase();
      if (name.startsWith('tripo_node')) return;
      box.union(new THREE.Box3().setFromObject(child));
    });
    return box.isEmpty() ? new THREE.Box3().setFromObject(model) : box;
  }

  const box = new THREE.Box3();
  let found = false;
  model.traverse((child) => {
    if (!child.isMesh) return;

    const name = (child.name || '').toLowerCase();
    if (name.includes('camera') || name.includes('light')) return;
    if (name.startsWith('tripo_node')) return;

    const meshBox = new THREE.Box3().setFromObject(child);
    if (meshBox.isEmpty()) return;

    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    if (meshCenter.y < -1.0) return;

    box.union(meshBox);
    found = true;
  });

  return found ? box : new THREE.Box3().setFromObject(model);
}

function fitModel(model, modelScale, fitMode = 'ground', fitLift, fitBounds, fitHeightFactor) {
  const box = getFitBox(model, fitBounds);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (size.length() < 0.0001) {
    model.scale.setScalar(modelScale);
    return;
  }

  model.position.sub(center);

  switch (fitMode) {
    case 'ground':
      model.position.y += size.y * 0.5;
      break;
    case 'facade':
      model.position.y += size.y * (fitLift ?? 0.40);
      break;
    case 'center':
    default:
      break;
  }

  let scaleBase;
  if (fitMode === 'facade' || fitMode === 'center') {
    scaleBase = Math.max(size.x, size.y * (fitHeightFactor ?? 0.88));
  } else {
    scaleBase = Math.max(size.x, size.y, size.z);
  }
  model.scale.setScalar(modelScale / Math.max(scaleBase, 0.0001));
}

function setupAnimations(root, clips, excludeTracks = []) {
  if (!clips?.length) return null;

  const mixer = new THREE.AnimationMixer(root);
  const actions = [];

  clips.forEach((clip) => {
    const tracks = clip.tracks.filter(
      (track) => !excludeTracks.some((key) => track.name.includes(key)),
    );
    if (!tracks.length) return;

    const filtered = tracks.length === clip.tracks.length
      ? clip
      : new THREE.AnimationClip(clip.name, clip.duration, tracks);
    const action = mixer.clipAction(filtered);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    actions.push(action);
  });

  if (!actions.length) return null;

  return {
    update(delta) { mixer.update(delta); },
    play() { actions.forEach((a) => { a.paused = false; a.play(); }); },
    pause() { actions.forEach((a) => { a.paused = true; }); },
  };
}

function preventPageZoom() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
  });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    if (e.target.closest('.ctrl-btn, .zoom-btn, .back-btn, .start-btn, .btn-ar, .cam-btn')) return;
    if (Date.now() - lastTouchEnd < 300) e.preventDefault();
    lastTouchEnd = Date.now();
  }, { passive: false });
}

function createZoomControl() {
  let userZoom = AR_SETTINGS.defaultUserZoom;
  const clamp = (v) => THREE.MathUtils.clamp(v, AR_SETTINGS.minUserZoom, AR_SETTINGS.maxUserZoom);

  return {
    zoomIn: () => { userZoom = clamp(userZoom + AR_SETTINGS.zoomStep); },
    zoomOut: () => { userZoom = clamp(userZoom - AR_SETTINGS.zoomStep); },
    resetFor(exp) {
      userZoom = exp?.defaultUserZoom ?? AR_SETTINGS.defaultUserZoom;
    },
    getZoom: () => userZoom,
  };
}

function createPositionControl() {
  let userYOffset = AR_SETTINGS.defaultUserYOffset;
  const clamp = (v) => THREE.MathUtils.clamp(v, AR_SETTINGS.minUserYOffset, AR_SETTINGS.maxUserYOffset);

  return {
    moveUp: () => { userYOffset = clamp(userYOffset + AR_SETTINGS.positionStep); },
    moveDown: () => { userYOffset = clamp(userYOffset - AR_SETTINGS.positionStep); },
    resetFor(exp) {
      userYOffset = getDefaultYOffset(exp);
    },
    getYOffset: () => userYOffset,
  };
}

function createCameraControls(getVideo) {
  let torchOn = false;
  let brightenOn = false;
  let camZoom = AR_SETTINGS.minCameraZoom;
  let videoTrack = null;

  const refreshTrack = () => {
    const video = getVideo();
    const stream = video?.srcObject;
    videoTrack = stream?.getVideoTracks?.()?.[0] ?? null;
    return videoTrack;
  };

  const applyVideoStyle = () => {
    const video = getVideo();
    if (!video) return;
    video.style.transform = camZoom !== 1 ? `scale(${camZoom})` : '';
    video.style.transformOrigin = 'center center';
    video.style.filter = brightenOn ? 'brightness(1.45) contrast(1.08)' : '';
  };

  const toggleTorch = async () => {
    refreshTrack();
    if (!videoTrack) return null;
    torchOn = !torchOn;
    const attempts = [
      { advanced: [{ torch: torchOn }] },
      { torch: torchOn },
    ];
    for (const constraints of attempts) {
      try {
        await videoTrack.applyConstraints(constraints);
        return torchOn;
      } catch { /* try next */ }
    }
    torchOn = false;
    return null;
  };

  const toggleBrighten = () => {
    brightenOn = !brightenOn;
    applyVideoStyle();
    return brightenOn;
  };

  const camZoomIn = () => {
    camZoom = Math.min(camZoom + AR_SETTINGS.cameraZoomStep, AR_SETTINGS.maxCameraZoom);
    applyVideoStyle();
  };

  const camZoomOut = () => {
    camZoom = Math.max(camZoom - AR_SETTINGS.cameraZoomStep, AR_SETTINGS.minCameraZoom);
    applyVideoStyle();
  };

  return {
    refreshTrack,
    toggleTorch,
    toggleBrighten,
    camZoomIn,
    camZoomOut,
    isTorchOn: () => torchOn,
    isBrightenOn: () => brightenOn,
  };
}

function bindButton(el, handler) {
  if (!el) return;
  let busy = false;
  const run = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    handler();
    setTimeout(() => { busy = false; }, 220);
  };
  el.addEventListener('pointerup', run, { passive: false });
  el.addEventListener('touchend', run, { passive: false });
}

function configureRenderer(renderer) {
  const maxDpr = LOW_END ? 1 : (IS_ANDROID ? 1.5 : 1.5);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.sortObjects = true;
  if (IS_ANDROID) {
    renderer.powerPreference = LOW_END ? 'default' : 'high-performance';
  }
  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '2';
  canvas.style.pointerEvents = 'none';
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    setLoadStatus('GPU busy — refresh and try again.');
    console.warn('[AR] WebGL context lost');
  }, false);
}

async function loadExperiences(slots, onProgress) {
  const registry = new Map();
  const slotByExp = new Map();
  slots.forEach((slot) => {
    const id = slot.experience?.id;
    if (id && !slotByExp.has(id)) slotByExp.set(id, slot);
  });

  for (const exp of EXPERIENCES) {
    if (registry.has(exp.id)) continue;
    try {
      const entry = await buildExperience(exp, slotByExp.get(exp.id), (pct) => {
        onProgress?.(exp.id, pct);
      });
      registry.set(exp.id, entry);
      if (IS_ANDROID) await new Promise((r) => setTimeout(r, 50));
    } catch (err) {
      console.error(`[AR] Failed to load model for ${exp.id}:`, err);
    }
  }

  return registry;
}

async function initAR() {
  preventPageZoom();

  if (!hasWebGL()) {
    showError('This phone does not support 3D (WebGL). Try Chrome or a newer phone.');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showError(IS_ANDROID ? 'Use Chrome on your Android phone.' : 'Use Safari or Chrome on your phone.');
    return;
  }

  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    showError('HTTPS required.');
    return;
  }

  prefetchModels(EXPERIENCES);

  const slotCount = targetCount(EXPERIENCES);
  const maxTrack = setup.mode === 'all' ? 2 : Math.min(slotCount, 3);
  let mindar;
  try {
    mindar = new MindARThree({
      container: document.querySelector('#ar-container'),
      imageTargetSrc: setup.targetSrc,
      maxTrack,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      filterMinCF: AR_SETTINGS.filterMinCF,
      filterBeta: AR_SETTINGS.filterBeta,
    });
  } catch (err) {
    showError('AR failed to load.');
    console.error(err);
    return;
  }

  const { renderer, scene, camera } = mindar;
  configureRenderer(renderer);

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const exp = experienceForTarget(EXPERIENCES, i);
    const anchor = mindar.addAnchor(i);
    const marker = new THREE.Object3D();
    const attachRig = new THREE.Group();
    attachRig.name = 'attach-rig';
    const off = getMarkerOffset(exp);
    marker.position.set(off.x, off.y, off.z);
    marker.add(attachRig);
    anchor.group.add(marker);
    slots.push({ anchor, marker, attachRig, targetIndex: i, experience: exp });
  }

  scene.add(new THREE.AmbientLight(0xffffff, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(1, 3, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-2, 1, -1);
  scene.add(fill);

  let activeSlot = null;
  let activeRegistry = null;
  const zoom = createZoomControl();
  const position = createPositionControl();
  let expRegistry = new Map();
  let hideTimer = null;
  const found = new Set();
  const loadingExps = new Set();
  let renderLoop = null;
  let arRunning = false;
  let orientationBusy = false;
  let lastLandscape = isLandscape();
  let pendingActiveSlot = null;

  const getVideo = () => document.querySelector('#ar-container video');
  const cameraControls = createCameraControls(getVideo);

  const applyUserTransform = (slot) => {
    if (!slot) return;
    slot.attachRig.position.set(0, position.getYOffset(), 0);
    slot.attachRig.scale.setScalar(zoom.getZoom());
  };

  const hideAllHolders = () => {
    if (!expRegistry) return;
    expRegistry.forEach((entry) => {
      entry.holder.visible = false;
      entry.anim?.pause();
    });
    activeRegistry = null;
  };

  const showExperience = (expId) => {
    if (!expRegistry) return false;
    const entry = expRegistry.get(expId);
    if (!entry) return false;

    expRegistry.forEach((item) => {
      const on = item === entry;
      item.holder.visible = on;
      item.holder.traverse((child) => { child.visible = on; });
      if (on) item.anim?.play();
      else item.anim?.pause();
    });
    activeRegistry = entry;
    return true;
  };

  const slotByExp = new Map();
  slots.forEach((slot) => {
    const id = slot.experience?.id;
    if (id && !slotByExp.has(id)) slotByExp.set(id, slot);
  });

  const ensureExperienceLoaded = async (expId) => {
    if (expRegistry.has(expId)) return true;
    if (loadingExps.has(expId)) return false;
    const exp = EXPERIENCES.find((e) => e.id === expId);
    if (!exp) return false;

    loadingExps.add(expId);
    setLoadStatus('Loading 3D model… 0%');
    try {
      const entry = await buildExperience(exp, slotByExp.get(expId), (pct) => {
        setLoadStatus(`Loading 3D model… ${Math.round(pct * 100)}%`);
      });
      expRegistry.set(expId, entry);
      setLoadStatus('');
      return true;
    } catch (err) {
      console.error(`[AR] Load failed for ${expId}:`, err);
      setLoadStatus('Model failed to load. Check Wi‑Fi and refresh.');
      return false;
    } finally {
      loadingExps.delete(expId);
    }
  };

  const mountToSlot = async (slot, expId) => {
    if (!slot) return false;
    if (!expRegistry.has(expId)) {
      pendingActiveSlot = slot;
      const ok = await ensureExperienceLoaded(expId);
      if (!ok) return false;
      pendingActiveSlot = null;
    }

    const entry = expRegistry.get(expId);
    if (!entry) return false;

    if (entry.holder.parent !== slot.attachRig) {
      slot.attachRig.add(entry.holder);
    }

    showExperience(expId);
    applyUserTransform(slot);
    setLoadStatus('');
    return true;
  };

  const ensureActiveVisible = async () => {
    if (!activeSlot?.experience || !found.has(activeSlot)) return;
    await mountToSlot(activeSlot, activeSlot.experience.id);
    if (activeRegistry?.holder) {
      activeRegistry.holder.visible = true;
      activeRegistry.holder.traverse((child) => { child.visible = true; });
    }
  };

  const showStartWhenReady = async () => {
    if (IS_ANDROID && setup.mode !== 'all') {
      setLoadStatus('Loading 3D model… 0%');
      try {
        expRegistry = await loadExperiences(slots, (expId, pct) => {
          setLoadStatus(`Loading 3D model… ${Math.round(pct * 100)}%`);
        });
        if (expRegistry.size === 0) {
          setLoadStatus('Model failed to load. Check Wi‑Fi and refresh.');
          return;
        }
      } catch (err) {
        console.error('Model load failed:', err);
        setLoadStatus('Model failed to load. Check Wi‑Fi and refresh.');
        return;
      }
    }
    hide('loading-screen');
    show('start-screen');
    setLoadStatus(IS_ANDROID ? 'Ready — tap to start' : '');
  };

  if (IS_ANDROID && setup.mode !== 'all') {
    show('loading-screen');
    const titleEl = document.querySelector('#loading-screen .loader-title');
    if (titleEl) titleEl.textContent = 'Loading 3D model…';
  } else {
    hide('loading-screen');
    show('start-screen');
  }
  setLoadStatus(IS_ANDROID ? 'Loading 3D model…' : 'Loading 3D model…');

  const modelReady = IS_ANDROID
    ? showStartWhenReady()
    : loadExperiences(slots, (expId, pct) => {
        setLoadStatus(`Loading 3D model… ${Math.round(pct * 100)}%`);
      }).then((registry) => {
        expRegistry = registry;
        setLoadStatus('');
        if (pendingActiveSlot) {
          const slot = pendingActiveSlot;
          pendingActiveSlot = null;
          activeSlot = slot;
          return mountToSlot(slot, slot.experience.id).then(() => {
            ensureActiveVisible();
            show('ar-controls');
          });
        }
        return registry;
      }).catch((err) => {
        console.error('Model load failed:', err);
        setLoadStatus('Model failed to load. Refresh and try again.');
      });

  const applyMarkerOffsets = () => {
    slots.forEach((slot) => {
      const off = getMarkerOffset(slot.experience);
      slot.marker.position.set(off.x, off.y, off.z);
    });
  };

  const resizeAR = () => {
    const container = document.querySelector('#ar-container');
    if (!container) return;

    const { w, h } = getViewportSize();
    if (w < 1 || h < 1) return;

    document.documentElement.style.height = `${h}px`;
    document.body.style.height = `${h}px`;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_ANDROID ? 1.25 : 1.5));
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const video = container.querySelector('video');
    if (video) {
      video.style.position = 'absolute';
      video.style.inset = '0';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
    }
  };

  const restartAR = async () => {
    if (!arRunning || orientationBusy) return;
    orientationBusy = true;

    try {
      hideAllHolders();
      found.clear();
      clearTimeout(hideTimer);
      activeSlot = null;

      await mindar.stop();
      await new Promise((r) => setTimeout(r, 120));

      resizeAR();
      applyMarkerOffsets();

      await mindar.start();
      resizeAR();

      const video = getVideo();
      if (video) {
        video.style.zIndex = '1';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.muted = true;
        await video.play().catch(() => {});
        cameraControls.refreshTrack();
      }
    } catch (err) {
      console.error('AR orientation restart failed:', err);
    } finally {
      orientationBusy = false;
    }
  };

  let resizeTimer = null;
  const onViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      const nowLandscape = isLandscape();
      const flipped = nowLandscape !== lastLandscape;
      lastLandscape = nowLandscape;

      resizeAR();
      applyMarkerOffsets();

      if (arRunning && flipped) {
        if (activeSlot?.experience) {
          zoom.resetFor(activeSlot.experience);
          position.resetFor(activeSlot.experience);
          applyUserTransform(activeSlot);
        }
        await restartAR();
      }
    }, 500);
  };

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  screen.orientation?.addEventListener?.('change', onViewportChange);

  const containerEl = document.querySelector('#ar-container');
  if (containerEl && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => onViewportChange());
    ro.observe(containerEl);
  }

  try { screen.orientation?.unlock?.(); } catch { /* ignore */ }

  const setActive = async (slot) => {
    if (!slot?.experience) {
      activeSlot = null;
      hideAllHolders();
      hide('ar-controls');
      return;
    }

    if (activeSlot?.experience?.id !== slot.experience.id) {
      zoom.resetFor(slot.experience);
      position.resetFor(slot.experience);
    }

    activeSlot = slot;
    const mounted = await mountToSlot(slot, slot.experience.id);
    if (mounted) show('ar-controls');
  };

  const pickActive = () => {
    for (const idx of TARGET_PRIORITY) {
      const slot = slots.find((s) => s.targetIndex === idx && found.has(s));
      if (slot) {
        void setActive(slot);
        return;
      }
    }
    void setActive(null);
  };

  slots.forEach((slot) => {
    slot.anchor.onTargetFound = () => {
      clearTimeout(hideTimer);
      found.add(slot);
      window.dispatchEvent(new CustomEvent('ar:target_found', {
        detail: { expId: slot.experience?.id || '', targetIndex: slot.targetIndex },
      }));
      pickActive();
    };
    slot.anchor.onTargetLost = () => {
      found.delete(slot);
      if (activeSlot === slot) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!found.has(slot)) pickActive();
        }, AR_SETTINGS.targetLostDelayMs);
      }
    };
  });

  bindButton($('zoom-in'), () => {
    zoom.zoomIn();
    applyUserTransform(activeSlot);
  });
  bindButton($('zoom-out'), () => {
    zoom.zoomOut();
    applyUserTransform(activeSlot);
  });
  bindButton($('zoom-reset'), () => {
    if (activeSlot?.experience) {
      zoom.resetFor(activeSlot.experience);
      position.resetFor(activeSlot.experience);
      applyUserTransform(activeSlot);
    }
  });
  bindButton($('move-up'), () => {
    position.moveUp();
    applyUserTransform(activeSlot);
  });
  bindButton($('move-down'), () => {
    position.moveDown();
    applyUserTransform(activeSlot);
  });

  bindButton($('torch-btn'), async () => {
    const on = await cameraControls.toggleTorch();
    $('torch-btn')?.classList.toggle('active', on === true);
  });
  bindButton($('bright-btn'), () => {
    const on = cameraControls.toggleBrighten();
    $('bright-btn')?.classList.toggle('active', on);
  });
  bindButton($('cam-zoom-in'), () => cameraControls.camZoomIn());
  bindButton($('cam-zoom-out'), () => cameraControls.camZoomOut());

  const startBtn = $('start-btn');

  startBtn.onclick = async () => {
    hide('start-screen');
    try {
      await mindar.start();
      arRunning = true;
      lastLandscape = isLandscape();
      resizeAR();
      applyMarkerOffsets();
      show('camera-controls');
      window.dispatchEvent(new CustomEvent('ar:started', { detail: { mode: setup.mode } }));
      const video = getVideo();
      if (video) {
        video.style.zIndex = '1';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.muted = true;
        await video.play().catch(() => {});
        cameraControls.refreshTrack();
      }
    } catch (err) {
      showError('Allow camera and try again.');
      console.error(err);
      return;
    }

    if (!renderLoop) {
      const clock = new THREE.Clock();
      renderLoop = () => {
        const delta = Math.min(clock.getDelta(), 0.032);
        if (activeRegistry?.anim && activeRegistry.holder.visible) {
          activeRegistry.anim.update(delta);
        }
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(renderLoop);
    }
  };

  modelReady.catch(() => {});
}

$('back-btn').onclick = () => { window.location.href = 'index.html'; };

initAR().catch((err) => {
  showError('Please refresh and try again.');
  console.error(err);
});
