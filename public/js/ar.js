import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';
import { AR_SETTINGS, getSetup, experienceForTarget, targetCount } from './ar-config.js';

const setup = getSetup();
const EXPERIENCES = setup.experiences;
const TARGET_PRIORITY = setup.targetPriority;
const FACADE_INDICES = new Set(setup.facadeTargetIndices);

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

function getFitBox(model, fitBounds) {
  model.updateMatrixWorld(true);

  if (fitBounds !== 'mesh') {
    return new THREE.Box3().setFromObject(model);
  }

  const box = new THREE.Box3();
  let found = false;
  model.traverse((child) => {
    if (!child.isMesh) return;

    const name = (child.name || '').toLowerCase();
    if (name.includes('camera') || name.includes('light')) return;

    const meshBox = new THREE.Box3().setFromObject(child);
    if (meshBox.isEmpty()) return;

    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    if (meshCenter.y < -1.0) return;

    box.union(meshBox);
    found = true;
  });

  return found ? box : new THREE.Box3().setFromObject(model);
}

function fitModel(model, modelScale, fitMode = 'ground', fitLift, fitBounds) {
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
    scaleBase = Math.max(size.x, size.y * 0.88);
  } else {
    scaleBase = Math.max(size.x, size.y, size.z);
  }
  model.scale.setScalar(modelScale / Math.max(scaleBase, 0.0001));
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

async function loadExperiences(loader) {
  const registry = new Map();

  await Promise.all(EXPERIENCES.map(async (exp) => {
    if (registry.has(exp.id)) return;

    const gltf = await loader.loadAsync(exp.modelSrc);
    const holder = new THREE.Group();
    holder.visible = false;
    holder.name = exp.id;

    const model = gltf.scene;
    prepareModel(model);
    fitModel(model, exp.modelScale, exp.fitMode ?? 'ground', exp.fitLift, exp.fitBounds);
    holder.add(model);

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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
  let renderLoop = null;
  let arRunning = false;
  let orientationBusy = false;
  let lastLandscape = isLandscape();

  const glbReady = loadExperiences(new GLTFLoader())
    .then((registry) => {
      expRegistry = registry;
      return registry;
    })
    .catch((err) => {
      console.error(err);
      showError('3D model failed to load.');
      throw err;
    });

  const getVideo = () => document.querySelector('#ar-container video');
  const cameraControls = createCameraControls(getVideo);


  const detachAllHolders = () => {
    if (!expRegistry) return;
    expRegistry.forEach((entry) => {
      if (entry.holder.parent) entry.holder.parent.remove(entry.holder);
      entry.holder.visible = false;
      entry.anim?.pause();
    });
    activeRegistry = null;
  };

  const applyUserTransform = (slot) => {
    if (!slot) return;
    slot.attachRig.position.set(0, position.getYOffset(), 0);
    slot.attachRig.scale.setScalar(zoom.getZoom());
  };

  const mountToSlot = (slot, expId) => {
    if (!expRegistry || !slot) return false;
    const entry = expRegistry.get(expId);
    if (!entry) return false;

    detachAllHolders();
    slot.attachRig.add(entry.holder);
    entry.holder.visible = true;
    entry.anim?.play();
    activeRegistry = entry;
    applyUserTransform(slot);
    return true;
  };

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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
      detachAllHolders();
      found.clear();
      clearTimeout(hideTimer);
      clearTimeout(logoDelayTimer);
      activeSlot = null;
      activeRegistry = null;

      await mindar.stop();
      await new Promise((r) => setTimeout(r, 120));

      resizeAR();
      applyMarkerOffsets();

      await mindar.start();
      resizeAR();

      const video = getVideo();
      if (video) {
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
        return;
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

  const setActive = (slot) => {
    if (!slot?.experience) {
      activeSlot = null;
      detachAllHolders();
      hide('ar-controls');
      return;
    }

    if (activeSlot?.experience?.id !== slot.experience.id) {
      zoom.resetFor(slot.experience);
      position.resetFor(slot.experience);
    }

    activeSlot = slot;
    if (!mountToSlot(slot, slot.experience.id)) {
      glbReady.then(() => {
        if (activeSlot === slot) mountToSlot(slot, slot.experience.id);
      });
    }
    show('ar-controls');
  };

  const isLogoTarget = (index) => !FACADE_INDICES.has(index);

  const hasFacadeFound = () => slots.some(
    (s) => FACADE_INDICES.has(s.targetIndex) && found.has(s),
  );

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

      if (FACADE_INDICES.has(slot.targetIndex)) {
        clearTimeout(logoDelayTimer);
        pickActive();
        return;
      }

      if (setup.mode === 'all' && isLogoTarget(slot.targetIndex)) {
        clearTimeout(logoDelayTimer);
        logoDelayTimer = setTimeout(() => {
          if (!hasFacadeFound()) pickActive();
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

  function updateActiveRig() {
    if (activeSlot) applyUserTransform(activeSlot);
  }

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
      const video = getVideo();
      if (video) {
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
        updateActiveRig();
        const delta = Math.min(clock.getDelta(), 0.032);
        if (activeRegistry?.anim) activeRegistry.anim.update(delta);
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(renderLoop);
    }

    glbReady.then(() => {
      if (activeSlot) mountToSlot(activeSlot, activeSlot.experience.id);
    });
  };

  glbReady.catch(() => {});
}

$('back-btn').onclick = () => { window.location.href = 'index.html'; };

initAR().catch((err) => {
  showError('Please refresh and try again.');
  console.error(err);
});
