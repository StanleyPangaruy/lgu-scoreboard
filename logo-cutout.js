// Team logos are square images on a white background. This removes the white that touches
// the image's edges (flood fill from the border), so the seal sits directly on the scorebug.
// White *inside* the seal — rings, lettering bands — is kept because it is not connected to
// the outer edge. Images that already have a transparent background are left as they are.
// Large images are scaled down once here, so huge source files never reach the compositor.
// Results are cached per file and size; on any failure the original image is used.
(function () {
  const SIZE = 640;          // default working size; full size keeps thin outer rings unbroken
  const BG_MIN = 222;        // a pixel is background-white if R, G and B are all >= this
  const EDGE_MIN = 170;      // light pixels touching the background fade out from here up
  const cache = new Map();

  async function process(img, size) {
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (scale < 1) {
      const bitmap = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } else {
      ctx.drawImage(img, 0, 0);
    }
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;

    const corners = [0, w - 1, (h - 1) * w, h * w - 1];
    if (corners.some((i) => px[i * 4 + 3] < 255)) return canvas.toDataURL('image/png');

    const lightness = (i) => Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    const isBg = (i) => px[i * 4 + 3] < 16 || lightness(i) >= BG_MIN;

    const bg = new Uint8Array(w * h);
    const stack = [];
    const seed = (i) => {
      if (!bg[i] && isBg(i)) {
        bg[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < w * (h - 1)) seed(i + w);
    }

    for (let i = 0; i < w * h; i++) {
      if (bg[i]) {
        px[i * 4 + 3] = 0;
        continue;
      }
      // Soften the anti-aliased rim where the seal meets the removed white.
      const x = i % w;
      const touchesBg =
        (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) ||
        (i >= w && bg[i - w]) || (i < w * (h - 1) && bg[i + w]);
      const l = lightness(i);
      if (touchesBg && l > EDGE_MIN) {
        const keep = (BG_MIN - l) / (BG_MIN - EDGE_MIN);
        px[i * 4 + 3] = Math.round(px[i * 4 + 3] * Math.max(0, Math.min(1, keep)));
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  }

  window.logoCutout = function (src, size = SIZE) {
    const key = src + '@' + size;
    if (!cache.has(key)) {
      cache.set(key, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => process(img, size).then(resolve, () => resolve(src));
        img.onerror = () => resolve(src);
        img.src = src;
      }));
    }
    return cache.get(key);
  };

  // Sets an <img> to the cut-out logo, ignoring results that arrive after the team changed.
  window.setLogo = function (imgEl, src, onDone) {
    if (imgEl.dataset.want === src) return;
    imgEl.dataset.want = src;
    if (!src) {
      imgEl.removeAttribute('src');
      if (onDone) onDone(false);
      return;
    }
    window.logoCutout(src).then((url) => {
      if (imgEl.dataset.want !== src) return;
      imgEl.src = url;
      if (onDone) onDone(true);
    });
  };
})();
