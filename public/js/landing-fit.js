const IMG_ASPECT = 1572 / 3408;

function getViewport() {
  const vv = window.visualViewport;
  return {
    w: vv?.width ?? window.innerWidth,
    h: vv?.height ?? window.innerHeight,
  };
}

function fitLanding() {
  const img = document.querySelector('.page-bg-img');
  const spot = document.querySelector('.camera-spot');
  if (!img) return;

  const { w, h } = getViewport();
  if (w < 1 || h < 1) return;

  const vpAspect = w / h;
  const landscape = w > h;
  const ratioDelta = vpAspect - IMG_ASPECT;

  if (landscape) {
    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center center';
    if (spot) spot.style.top = '50%';
    return;
  }

  if (ratioDelta > 0.018) {
    img.style.objectFit = 'fill';
    img.style.objectPosition = 'center center';
    if (spot) spot.style.top = '53%';
    return;
  }

  if (ratioDelta > 0) {
    const focusY = Math.min(52, 42 + ratioDelta * 160);
    img.style.objectFit = 'cover';
    img.style.objectPosition = `center ${focusY}%`;
    if (spot) spot.style.top = `${Math.min(55, 50 + ratioDelta * 70)}%`;
    return;
  }

  img.style.objectFit = 'cover';
  img.style.objectPosition = 'center top';
  if (spot) spot.style.top = '49%';
}

let resizeTimer;
function scheduleFit() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitLanding, 80);
}

fitLanding();
window.addEventListener('resize', scheduleFit);
window.visualViewport?.addEventListener('resize', scheduleFit);
window.addEventListener('orientationchange', () => setTimeout(fitLanding, 150));
document.querySelector('.page-bg-img')?.addEventListener('load', fitLanding);
