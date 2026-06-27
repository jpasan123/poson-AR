import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';
import { AR_SETTINGS, getSetup, experienceForTarget, targetCount } from './ar-config.js';

const setup = getSetup();
const EXPERIENCES = setup.experiences;
const TARGET_PRIORITY = setup.targetPriority;
const BUILDING_INDEX = setup.buildingTargetIndex;

const $ = (id) => document.getElementById(id);
const show = (id) => $(id)?.classList.remove('hidden');
const hide = (id) => $(id)?.classList.add('hidden');

const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _targetScale = new THREE.Vector3();
const _smoothPos = new THREE.Vector3();
const _smoothQuat = new THREE.Quaternion();
const _userOffset = new THREE.Vector3();

function showError(message) {
  hide('loading-screen');
  hide('start-screen');
  $('error-message').textContent = message;
  show('error-screen');
}

function prepareModel(scene) {
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((mat) => {
      if (!mat) return;
      mat.side = THREE.FrontSide;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    });
  });
}

function fitModel(model, modelScale, fitMode = 'ground', fitLift) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
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
      model.position.y += size.y * (fitLift ?? 0.28);
      break;
    case 'center':
    default:
      break;
  }

  let scaleBase;
  if (fitMode === 'facade') {
    scaleBase = Math.max(size.x, size.y * 0.88);
  } else {
    scaleBase = Math.max(size.x, size.y, size.z);
  }
  model.scale.setScalar(modelScale / scaleBase);
}

function setupAnimations(root, clips) {
  if (!clips?.length) return null;

  const mixer = new THREE.AnimationMixer(root);
  const actions = clips.map((clip) => {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    return action;
  });

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
    if (e.target.closest('.ctrl-btn, .zoom-btn, .back-btn, .start-btn, .btn-ar')) return;
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
      userYOffset = exp?.defaultUserYOffset ?? AR_SETTINGS.defaultUserYOffset;
    },
    getYOffset: () => userYOffset,
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

function avgScale(vec) {
  return Math.max((vec.x + vec.y + vec.z) / 3, 0.0001);
}

async function loadExperiences(loader, scaleGroup) {
  const registry = new Map();

  await Promise.all(EXPERIENCES.map(async (exp) => {
    if (registry.has(exp.id)) return;

    const gltf = await loader.loadAsync(exp.modelSrc);
    const holder = new THREE.Group();
    holder.visible = false;
    holder.name = exp.id;

    const model = gltf.scene;
    prepareModel(model);
    fitModel(model, exp.modelScale, exp.fitMode ?? 'ground', exp.fitLift);
    holder.add(model);

    scaleGroup.add(holder);
    registry.set(exp.id, {
      holder,
      anim: setupAnimations(model, gltf.animations),
    });
  }));

  return registry;
}

async function initAR() {
  preventPageZoom();

  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Use Safari or Chrome on your phone.');
    return;
  }

  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    showError('HTTPS required.');
    return;
  }

  hide('loading-screen');
  show('start-screen');

  const slotCount = targetCount(EXPERIENCES);
  let mindar;
  try {
    mindar = new MindARThree({
      container: document.querySelector('#ar-container'),
      imageTargetSrc: setup.targetSrc,
      maxTrack: slotCount,
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const displayRig = new THREE.Group();
  displayRig.visible = false;
  scene.add(displayRig);

  const offsetRig = new THREE.Group();
  displayRig.add(offsetRig);

  const scaleGroup = new THREE.Group();
  offsetRig.add(scaleGroup);

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const exp = experienceForTarget(EXPERIENCES, i);
    const anchor = mindar.addAnchor(i);
    const marker = new THREE.Object3D();
    const off = exp?.modelOffset ?? { x: 0, y: 0, z: 0 };
    marker.position.set(off.x, off.y, off.z);
    anchor.group.add(marker);
    slots.push({ anchor, marker, targetIndex: i, experience: exp });
  }

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(1, 3, 2);
  scene.add(key);

  let activeSlot = null;
  let activeRegistry = null;
  const zoom = createZoomControl();
  const position = createPositionControl();
  let expRegistry = null;
  let hideTimer = null;
  let logoDelayTimer = null;
  const found = new Set();
  let lockedWorldScale = null;
  let calibrateCount = 0;
  let calibrateSum = 0;
  let renderLoop = null;

  const glbReady = loadExperiences(new GLTFLoader(), scaleGroup)
    .then((registry) => {
      expRegistry = registry;
      return registry;
    })
    .catch((err) => {
      console.error(err);
      showError('3D model failed to load.');
      throw err;
    });

  const resetCalibration = () => {
    lockedWorldScale = null;
    calibrateCount = 0;
    calibrateSum = 0;
  };

  const readMarkerPose = (marker) => {
    marker.updateWorldMatrix(true, false);
    marker.getWorldPosition(_targetPos);
    marker.getWorldQuaternion(_targetQuat);
    marker.getWorldScale(_targetScale);
  };

  const showExperience = (expId) => {
    if (!expRegistry) return;
    expRegistry.forEach((entry, id) => {
      const on = id === expId;
      entry.holder.visible = on;
      if (on) entry.anim?.play();
      else entry.anim?.pause();
    });
    activeRegistry = expRegistry.get(expId) ?? null;
  };

  const setActive = (slot) => {
    const prevExpId = activeSlot?.experience?.id;

    if (!slot?.experience) {
      activeSlot = null;
      displayRig.visible = false;
      expRegistry?.forEach((entry) => entry.anim?.pause());
      hide('ar-controls');
      return;
    }

    if (prevExpId !== slot.experience.id) {
      resetCalibration();
      zoom.resetFor(slot.experience);
      position.resetFor(slot.experience);
    }

    activeSlot = slot;
    showExperience(slot.experience.id);
    displayRig.visible = true;
    readMarkerPose(slot.marker);
    _smoothPos.copy(_targetPos);
    _smoothQuat.copy(_targetQuat);
    displayRig.position.copy(_smoothPos);
    displayRig.quaternion.copy(_smoothQuat);
    show('ar-controls');
  };

  const isLogoTarget = (index) => {
    if (BUILDING_INDEX < 0) return true;
    return index !== BUILDING_INDEX;
  };

  const pickActive = () => {
    for (const idx of TARGET_PRIORITY) {
      const slot = slots.find((s) => s.targetIndex === idx && found.has(s));
      if (slot) {
        setActive(slot);
        return;
      }
    }
    setActive(null);
  };

  slots.forEach((slot) => {
    slot.anchor.onTargetFound = () => {
      clearTimeout(hideTimer);
      found.add(slot);

      if (BUILDING_INDEX >= 0 && slot.targetIndex === BUILDING_INDEX) {
        clearTimeout(logoDelayTimer);
        pickActive();
        return;
      }

      if (setup.mode === 'all' && isLogoTarget(slot.targetIndex)) {
        clearTimeout(logoDelayTimer);
        logoDelayTimer = setTimeout(() => {
          if (!found.has(slots.find((s) => s.targetIndex === BUILDING_INDEX))) {
            pickActive();
          }
        }, AR_SETTINGS.logoActivationDelayMs);
        return;
      }

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

  bindButton($('zoom-in'), () => zoom.zoomIn());
  bindButton($('zoom-out'), () => zoom.zoomOut());
  bindButton($('zoom-reset'), () => {
    if (activeSlot?.experience) {
      zoom.resetFor(activeSlot.experience);
      position.resetFor(activeSlot.experience);
    }
  });
  bindButton($('move-up'), () => position.moveUp());
  bindButton($('move-down'), () => position.moveDown());

  function updateDisplayRig() {
    if (!activeSlot || !displayRig.visible) return;

    readMarkerPose(activeSlot.marker);

    if (lockedWorldScale == null) {
      calibrateSum += avgScale(_targetScale);
      calibrateCount += 1;
      if (calibrateCount >= AR_SETTINGS.calibrateFrames) {
        lockedWorldScale = calibrateSum / calibrateCount;
      }
      _smoothPos.copy(_targetPos);
      _smoothQuat.copy(_targetQuat);
    } else {
      _smoothPos.lerp(_targetPos, AR_SETTINGS.posSmooth);
      _smoothQuat.slerp(_targetQuat, AR_SETTINGS.rotSmooth);
    }

    _userOffset.set(0, position.getYOffset(), 0);

    offsetRig.position.copy(_userOffset);
    displayRig.position.copy(_smoothPos);
    displayRig.quaternion.copy(_smoothQuat);

    const base = lockedWorldScale ?? (calibrateSum / Math.max(calibrateCount, 1));
    displayRig.scale.setScalar(base * zoom.getZoom());
  }

  const startBtn = $('start-btn');
  startBtn.onclick = async () => {
    hide('start-screen');
    try {
      await mindar.start();
      const video = document.querySelector('#ar-container video');
      if (video) {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.muted = true;
        await video.play().catch(() => {});
      }
    } catch (err) {
      showError('Allow camera and try again.');
      console.error(err);
      return;
    }

    if (!renderLoop) {
      const clock = new THREE.Clock();
      renderLoop = () => {
        updateDisplayRig();
        const delta = Math.min(clock.getDelta(), 0.032);
        if (displayRig.visible && activeRegistry?.anim) {
          activeRegistry.anim.update(delta);
        }
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(renderLoop);
    }

    glbReady.then(() => {
      if (activeSlot) showExperience(activeSlot.experience.id);
    });
  };

  glbReady.catch(() => {});
}

$('back-btn').onclick = () => { window.location.href = 'index.html'; };

initAR().catch((err) => {
  showError('Please refresh and try again.');
  console.error(err);
});
