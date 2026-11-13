// Colour helpers for lights. Home Assistant reports a light's colour
// capability in attributes.supported_color_modes (e.g. ['brightness',
// 'color_temp', 'hs']) and its current colour in hs_color / rgb_color /
// xy_color. Only show colour controls when the light actually supports a
// colour mode; brightness-only and colour-temp-only lights keep the
// existing brightness + warm-white controls.
export type LightAttrs = Record<string, unknown>;

const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];

export function lightSupportsColor(attrs: LightAttrs): boolean {
  const modes = attrs.supported_color_modes;
  if (Array.isArray(modes)) return modes.some((m) => COLOR_MODES.includes(String(m)));
  // Older integrations may not report modes; fall back to a reported colour.
  return Array.isArray(attrs.hs_color) || Array.isArray(attrs.rgb_color) || Array.isArray(attrs.xy_color);
}

export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// h 0-360, s 0-100, full value. Standard HSV conversion.
export function hsToRgb(h: number, s: number): [number, number, number] {
  const sv = s / 100;
  const c = sv;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHs(rgb: [number, number, number]): [number, number] {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : (d / max) * 100;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s)];
}

export function hexToHs(hex: string): [number, number] {
  return rgbToHs(hexToRgb(hex));
}

// The picker's current value, from the light's reported colour.
export function currentColorHex(attrs: LightAttrs): string {
  if (Array.isArray(attrs.rgb_color) && attrs.rgb_color.length >= 3) {
    return rgbToHex([Number(attrs.rgb_color[0]), Number(attrs.rgb_color[1]), Number(attrs.rgb_color[2])]);
  }
  if (Array.isArray(attrs.hs_color) && attrs.hs_color.length >= 2) {
    return rgbToHex(hsToRgb(Number(attrs.hs_color[0]), Number(attrs.hs_color[1])));
  }
  return '#ffffff';
}

// light.turn_on data for a picked colour, in the light's own colour mode
// when known so Home Assistant does not have to convert it. xy-only lights
// get hs_color; Home Assistant converts that for them.
export function colorServiceData(hex: string, attrs: LightAttrs): Record<string, unknown> {
  const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes.map(String) : [];
  if (modes.includes('rgb') || modes.includes('rgbw') || modes.includes('rgbww')) {
    return { rgb_color: [...hexToRgb(hex)] };
  }
  return { hs_color: [...hexToHs(hex)] };
}
