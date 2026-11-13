import type { AppConfig } from '../types';
const KEY = 'ha-ar-config-v1';
export const defaultConfig: AppConfig = { hassUrl: '', devices: [] };
export function loadConfig(): AppConfig {
  try { return { ...defaultConfig, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaultConfig; }
}
export function saveConfig(config: AppConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch (e) {
    // Browsers cap localStorage at about 5 MB per site, and the config holds
    // every reference photo plus the compiled target file. Surface that
    // plainly instead of a bare QuotaExceededError.
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new Error('Storage is full: this browser only allows about 5 MB for this site. Delete an old device to make room — new photos are shrunk before saving.');
    }
    throw e;
  }
}
