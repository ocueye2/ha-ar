// Reference photos are stored in localStorage, which browsers cap at about
// 5 MB per site. A phone camera photo is megabytes as a data URL, so one or
// two devices blew the quota and saving threw QuotaExceededError.
// Shrink each photo to 640px on the long edge as JPEG before storing: still
// plenty of detail for MindAR tracking, roughly 50-120 KB instead of MBs,
// and the compiled target file shrinks too.
export const MAX_REFERENCE_EDGE = 640;
export const REFERENCE_JPEG_QUALITY = 0.82;

// Pure resize math, factored out of downscaleImage so it can be tested
// without a DOM: scale the long edge down to MAX_REFERENCE_EDGE, never
// upscale, and never round a dimension down to zero.
export function scaledDimensions(width: number, height: number): [number, number] {
  const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const [w, h] = scaledDimensions(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not process the image.');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', REFERENCE_JPEG_QUALITY));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Could not process the image.'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load that image.'));
    };
    img.src = url;
  });
}
