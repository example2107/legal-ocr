import { detectDocumentRectFromBrightnessMap } from './documentImageCrop';

function buildBrightnessMap(width, height, baseValue = 80) {
  return new Float32Array(width * height).fill(baseValue);
}

function paintRect(brightness, width, rect, value) {
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      brightness[y * width + x] = value;
    }
  }
}

describe('documentImageCrop', () => {
  test('detects the main page and ignores a narrow bright neighbor strip', () => {
    const width = 120;
    const height = 160;
    const brightness = buildBrightnessMap(width, height, 95);

    paintRect(brightness, width, { left: 8, top: 6, right: 92, bottom: 154 }, 242);
    paintRect(brightness, width, { left: 101, top: 10, right: 118, bottom: 150 }, 236);

    const rect = detectDocumentRectFromBrightnessMap({ brightness, width, height });

    expect(rect).toBeTruthy();
    expect(rect.left).toBeLessThanOrEqual(12);
    expect(rect.right).toBeLessThan(100);
    expect(rect.width).toBeGreaterThan(75);
    expect(rect.height).toBeGreaterThan(130);
  });

  test('returns null when the image is uniformly bright and cropping is not useful', () => {
    const width = 100;
    const height = 140;
    const brightness = buildBrightnessMap(width, height, 245);

    const rect = detectDocumentRectFromBrightnessMap({ brightness, width, height });
    expect(rect).toBeNull();
  });
});
