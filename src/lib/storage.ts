import type { AppConfig } from '../types';
const KEY = 'ha-ar-config-v1';
export const defaultConfig: AppConfig = { hassUrl: '', devices: [] };
export function loadConfig(): AppConfig {
  try { return { ...defaultConfig, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaultConfig; }
}
export function saveConfig(config: AppConfig) { localStorage.setItem(KEY, JSON.stringify(config)); }
