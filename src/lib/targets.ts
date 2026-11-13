// MindAR's compiler converts the selected reference images into a .mind target file.
// Target files are stored as a data URL in localStorage for this single-user MVP.
export async function compileTargets(images: string[], onProgress: (progress: number) => void): Promise<string> {
  if (!images.length) return '';
  const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js');
  const compiler = new Compiler();
  const loadedImages = await Promise.all(images.map((src) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load a reference image.'));
    image.src = src;
  })));
  await compiler.compileImageTargets(loadedImages, (progress: number) => onProgress(Math.round(progress)));
  const data = await compiler.exportData();
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url;
}
