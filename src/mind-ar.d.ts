declare module 'mind-ar/dist/mindar-image.prod.js' {
  export class Compiler {
    compileImageTargets(images: HTMLImageElement[], onProgress?: (progress: number) => void): Promise<unknown>;
    exportData(): Promise<ArrayBuffer>;
  }
}

declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  export class MindARThree {
    constructor(options: { container: HTMLElement; imageTargetSrc: string; maxTrack?: number; uiLoading?: string; uiScanning?: string; uiError?: string });
    addAnchor(targetIndex: number): any;
    start(): Promise<void>;
    stop(): void;
  }
}
