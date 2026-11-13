// Tests for src/lib/color.ts — the colour helpers behind the light control
// panel: support gating, hex/rgb/hs conversions, the picker's seeded value,
// and the light.turn_on data sent in the light's own colour mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lightSupportsColor,
  rgbToHex,
  hexToRgb,
  hsToRgb,
  rgbToHs,
  hexToHs,
  currentColorHex,
  colorServiceData,
} from '../src/lib/color.ts';

test('lightSupportsColor: each colour mode counts', () => {
  for (const mode of ['hs', 'rgb', 'rgbw', 'rgbww', 'xy']) {
    assert.equal(lightSupportsColor({ supported_color_modes: [mode] }), true, mode);
  }
});

test('lightSupportsColor: brightness / colour-temp only does not count', () => {
  assert.equal(lightSupportsColor({ supported_color_modes: ['brightness'] }), false);
  assert.equal(lightSupportsColor({ supported_color_modes: ['color_temp'] }), false);
  assert.equal(lightSupportsColor({ supported_color_modes: ['brightness', 'color_temp'] }), false);
  assert.equal(lightSupportsColor({ supported_color_modes: [] }), false);
  assert.equal(lightSupportsColor({}), false);
});

test('lightSupportsColor: falls back to a reported colour when modes are missing', () => {
  assert.equal(lightSupportsColor({ hs_color: [0, 100] }), true);
  assert.equal(lightSupportsColor({ rgb_color: [255, 0, 0] }), true);
  assert.equal(lightSupportsColor({ xy_color: [0.5, 0.5] }), true);
  assert.equal(lightSupportsColor({ brightness: 128 }), false);
});

test('rgbToHex / hexToRgb round-trip', () => {
  assert.equal(rgbToHex([255, 0, 0]), '#ff0000');
  assert.equal(rgbToHex([0, 0, 0]), '#000000');
  assert.equal(rgbToHex([255, 255, 255]), '#ffffff');
  assert.equal(rgbToHex([18, 52, 86]), '#123456');
  assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#123456'), [18, 52, 86]);
  assert.deepEqual(hexToRgb('123456'), [18, 52, 86]);
  assert.deepEqual(hexToRgb(rgbToHex([12, 34, 56])), [12, 34, 56]);
});

test('rgbToHex clamps out-of-range channels', () => {
  assert.equal(rgbToHex([300, -5, 128]), '#ff0080');
});

test('hsToRgb: primaries and white', () => {
  assert.deepEqual(hsToRgb(0, 100), [255, 0, 0]);
  assert.deepEqual(hsToRgb(120, 100), [0, 255, 0]);
  assert.deepEqual(hsToRgb(240, 100), [0, 0, 255]);
  assert.deepEqual(hsToRgb(60, 100), [255, 255, 0]);
  assert.deepEqual(hsToRgb(0, 0), [255, 255, 255]);
});

test('rgbToHs: primaries and white', () => {
  assert.deepEqual(rgbToHs([255, 0, 0]), [0, 100]);
  assert.deepEqual(rgbToHs([0, 255, 0]), [120, 100]);
  assert.deepEqual(rgbToHs([0, 0, 255]), [240, 100]);
  assert.deepEqual(rgbToHs([255, 255, 255]), [0, 0]);
});

test('hs and rgb round-trip', () => {
  // Only colours whose hue/saturation survive integer rounding round-trip
  // exactly; [18, 52, 86], for example, does not (s rounds 79.07 to 79).
  for (const rgb of [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 128, 0],
    [0, 128, 255],
    [255, 0, 128],
    [255, 255, 0],
    [0, 255, 255],
  ] as [number, number, number][]) {
    assert.deepEqual(hsToRgb(...rgbToHs(rgb)), rgb);
  }
});

test('hexToHs', () => {
  assert.deepEqual(hexToHs('#ff0000'), [0, 100]);
  assert.deepEqual(hexToHs('#00ff00'), [120, 100]);
});

test('currentColorHex prefers rgb_color, then hs_color, then white', () => {
  assert.equal(currentColorHex({ rgb_color: [255, 0, 0], hs_color: [120, 100] }), '#ff0000');
  assert.equal(currentColorHex({ hs_color: [120, 100] }), '#00ff00');
  assert.equal(currentColorHex({}), '#ffffff');
  assert.equal(currentColorHex({ rgb_color: [255] }), '#ffffff');
});

test('colorServiceData sends rgb_color for rgb-family modes', () => {
  for (const mode of ['rgb', 'rgbw', 'rgbww']) {
    assert.deepEqual(colorServiceData('#ff0000', { supported_color_modes: [mode] }), {
      rgb_color: [255, 0, 0],
    });
  }
});

test('colorServiceData sends hs_color for hs, xy-only, and unknown modes', () => {
  assert.deepEqual(colorServiceData('#ff0000', { supported_color_modes: ['hs'] }), {
    hs_color: [0, 100],
  });
  assert.deepEqual(colorServiceData('#00ff00', { supported_color_modes: ['xy'] }), {
    hs_color: [120, 100],
  });
  assert.deepEqual(colorServiceData('#ff0000', {}), { hs_color: [0, 100] });
  assert.deepEqual(colorServiceData('#ff0000', { supported_color_modes: ['brightness'] }), {
    hs_color: [0, 100],
  });
});
