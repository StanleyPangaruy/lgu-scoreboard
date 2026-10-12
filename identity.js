// Station identity logos (pictu/) at the top left, shared by overlay.html and mini.html.
// Which logo shows is worked out from the wall clock, so when both pages are on air their
// logos stay in step instead of crossfading at different moments. Needs logo-cutout.js.
(function () {
  const HOLD_MS = 8000;
  const SIZE = 320; // px the identity logos are scaled to (shown at 160)

  const style = document.createElement('style');
  style.textContent = `
    .ident {
      position: absolute;
      top: 48px;
      left: 48px;
      width: 160px;
      height: 160px;
      transition: opacity 350ms ease;
    }
    .ident.hidden { opacity: 0; }
    .ident img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      transition: opacity 400ms ease;
    }
    .ident img.on { opacity: 1; }
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'ident hidden';
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(box));

  let current = null;
  let timer = null;

  function show() {
    const n = box.children.length;
    if (!n) return;
    const index = Math.floor(Date.now() / HOLD_MS) % n;
    [...box.children].forEach((img, i) => img.classList.toggle('on', i === index));
  }

  window.setIdentity = async function (files) {
    const key = files.join('|');
    if (key === current) return;
    current = key;
    clearTimeout(timer);
    const urls = await Promise.all(files.map((f) => logoCutout('identity/' + encodeURIComponent(f), SIZE)));
    if (current !== key) return;
    box.replaceChildren(...urls.map((url) => {
      const img = new Image();
      img.src = url;
      img.alt = '';
      return img;
    }));
    const tick = () => {
      show();
      timer = setTimeout(tick, HOLD_MS - (Date.now() % HOLD_MS));
    };
    tick();
  };

  window.showIdentity = function (on) {
    box.classList.toggle('hidden', !on);
  };
})();
