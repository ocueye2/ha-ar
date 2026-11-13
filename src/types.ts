export type EntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
};
export type ControlType = 'toggle' | 'brightness' | 'temperature' | 'climate' | 'cover' | 'media';
export type ARDevice = {
  id: string;
  name: string;
  entityId: string;
  imageData: string;
  controls: ControlType[];
  targetIndex: number;
};
export type AppConfig = { hassUrl: string; devices: ARDevice[]; compiledTarget?: string };
