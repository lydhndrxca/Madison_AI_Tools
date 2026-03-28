// All mask fills use fully opaque red. The canvas element's CSS opacity (0.7)
// provides the visual semi-transparency, so overlapping regions look uniform.
const MASK_COLOR = "rgba(255, 60, 60, 1)";

export function drawStroke(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  prevPos: { x: number; y: number } | null,
  brushSize: number,
  mode: "brush" | "eraser",
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  const radius = brushSize / 2;
  ctx.fillStyle = mode === "eraser" ? "rgba(0,0,0,1)" : MASK_COLOR;
  if (prevPos) {
    const dx = x - prevPos.x;
    const dy = y - prevPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(2, radius * 0.3);
    const steps = Math.ceil(dist / step);
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      ctx.beginPath();
      ctx.arc(prevPos.x + dx * t, prevPos.y + dy * t, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function clearMask(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function maskHasContent(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] > 0) return true;
  }
  return false;
}

export function fillRect(
  canvas: HTMLCanvasElement,
  x: number, y: number, w: number, h: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = MASK_COLOR;
  ctx.fillRect(x, y, w, h);
}

export function fillPolygon(
  canvas: HTMLCanvasElement,
  points: { x: number; y: number }[],
): void {
  if (points.length < 3) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = MASK_COLOR;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
}

export function resizeMask(canvas: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * Paint a grayscale mask image onto the mask canvas.
 * White pixels in the mask become MASK_COLOR on the canvas.
 */
export function applyMaskImage(
  canvas: HTMLCanvasElement,
  maskDataUrl: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no 2d ctx")); return; }

      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tmpCtx = tmp.getContext("2d");
      if (!tmpCtx) { reject(new Error("no tmp ctx")); return; }

      tmpCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const maskPixels = tmpCtx.getImageData(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = "source-over";
      const existing = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = parseInt(MASK_COLOR.match(/\d+/g)![0]);
      const g = parseInt(MASK_COLOR.match(/\d+/g)![1]);
      const b = parseInt(MASK_COLOR.match(/\d+/g)![2]);

      for (let i = 0; i < maskPixels.data.length; i += 4) {
        const brightness = maskPixels.data[i];
        if (brightness > 128) {
          existing.data[i] = r;
          existing.data[i + 1] = g;
          existing.data[i + 2] = b;
          existing.data[i + 3] = 255;
        }
      }
      ctx.putImageData(existing, 0, 0);
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load mask image"));
    img.src = maskDataUrl;
  });
}

export function exportMaskComposite(
  maskCanvas: HTMLCanvasElement,
  imageSrc: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = maskCanvas.width;
    const h = maskCanvas.height;
    const comp = document.createElement("canvas");
    comp.width = w;
    comp.height = h;
    const ctx = comp.getContext("2d");
    if (!ctx) { reject(new Error("no 2d ctx")); return; }

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) { reject(new Error("no mask ctx")); return; }
      const maskData = maskCtx.getImageData(0, 0, w, h);
      const compData = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i + 3] > 20) {
          const a = 0.6;
          compData.data[i] = Math.round(compData.data[i] * (1 - a));
          compData.data[i + 1] = Math.round(compData.data[i + 1] * (1 - a) + 255 * a);
          compData.data[i + 2] = Math.round(compData.data[i + 2] * (1 - a));
        }
      }
      ctx.putImageData(compData, 0, 0);
      const dataUrl = comp.toDataURL("image/png");
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}
