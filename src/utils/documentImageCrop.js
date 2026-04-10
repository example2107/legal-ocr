function toGray(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function buildBrightnessMap(imageData, width, height) {
  const brightness = new Float32Array(width * height);
  for (let i = 0, px = 0; i < imageData.length; i += 4, px += 1) {
    brightness[px] = toGray(imageData[i], imageData[i + 1], imageData[i + 2]);
  }
  return brightness;
}

function sampleBorderBrightness(brightness, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    samples.push(brightness[x]);
    samples.push(brightness[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y += step) {
    samples.push(brightness[y * width]);
    samples.push(brightness[y * width + (width - 1)]);
  }
  return median(samples);
}

function smoothMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          count += mask[(y + dy) * width + (x + dx)];
        }
      }
      next[y * width + x] = count >= 5 ? 1 : 0;
    }
  }
  return next;
}

function buildBrightMask(brightness, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < brightness.length; i += 1) {
    mask[i] = brightness[i] >= threshold ? 1 : 0;
  }
  return smoothMask(smoothMask(mask, width, height), width, height);
}

function findComponents(mask, brightness, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const queueX = [];
  const queueY = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (!mask[startIndex] || visited[startIndex]) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      let brightnessSum = 0;

      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      visited[startIndex] = 1;

      for (let cursor = 0; cursor < queueX.length; cursor += 1) {
        const cx = queueX[cursor];
        const cy = queueY[cursor];
        const index = cy * width + cx;
        area += 1;
        brightnessSum += brightness[index];
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighborIndex = ny * width + nx;
          if (!mask[neighborIndex] || visited[neighborIndex]) continue;
          visited[neighborIndex] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }

      components.push({
        area,
        avgBrightness: brightnessSum / Math.max(1, area),
        left: minX,
        top: minY,
        right: maxX + 1,
        bottom: maxY + 1,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      });
    }
  }

  return components;
}

function scoreComponent(component, width, height, borderBrightness) {
  const imageArea = width * height;
  const bboxArea = component.width * component.height;
  const areaRatio = component.area / imageArea;
  const fillRatio = component.area / Math.max(1, bboxArea);
  const aspectRatio = component.width / Math.max(1, component.height);
  const brightnessDelta = component.avgBrightness - borderBrightness;

  if (areaRatio < 0.12) return -Infinity;
  if (fillRatio < 0.5) return -Infinity;
  if (aspectRatio < 0.35 || aspectRatio > 1.45) return -Infinity;
  if (brightnessDelta < 10) return -Infinity;

  const portraitBonus = aspectRatio >= 0.55 && aspectRatio <= 0.9 ? 0.08 : 0;
  return areaRatio + fillRatio * 0.25 + (brightnessDelta / 255) * 0.35 + portraitBonus;
}

export function detectDocumentRectFromBrightnessMap({ brightness, width, height } = {}) {
  if (!brightness || !width || !height) return null;

  const borderBrightness = sampleBorderBrightness(brightness, width, height);
  const threshold = Math.max(185, Math.min(245, borderBrightness + 18));
  const mask = buildBrightMask(brightness, width, height, threshold);
  const components = findComponents(mask, brightness, width, height);
  if (!components.length) return null;

  const ranked = components
    .map((component) => ({
      component,
      score: scoreComponent(component, width, height, borderBrightness),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const savingsRatio = 1 - ((best.component.width * best.component.height) / (width * height));
  if (savingsRatio < 0.02) return null;

  const marginX = Math.max(2, Math.round(best.component.width * 0.015));
  const marginY = Math.max(2, Math.round(best.component.height * 0.015));

  return {
    left: Math.max(0, best.component.left - marginX),
    top: Math.max(0, best.component.top - marginY),
    right: Math.min(width, best.component.right + marginX),
    bottom: Math.min(height, best.component.bottom + marginY),
    width: Math.min(width, best.component.right + marginX) - Math.max(0, best.component.left - marginX),
    height: Math.min(height, best.component.bottom + marginY) - Math.max(0, best.component.top - marginY),
    confidence: Number(best.score.toFixed(3)),
    borderBrightness: Number(borderBrightness.toFixed(2)),
    threshold,
  };
}

async function loadImage(base64, mediaType) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение для автообрезки.'));
    image.src = `data:${mediaType || 'image/jpeg'};base64,${base64}`;
  });
}

function buildAnalysisCanvas(image) {
  const maxDim = 900;
  const ratio = Math.min(1, maxDim / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'blur(4px)';
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, width, height, scaleX: image.width / width, scaleY: image.height / height };
}

export async function autoCropDocumentImage({ base64, mediaType } = {}) {
  if (!base64) return { base64, mediaType: mediaType || 'image/jpeg', cropped: false, cropRect: null };

  try {
    const image = await loadImage(base64, mediaType);
    const { canvas, width, height, scaleX, scaleY } = buildAnalysisCanvas(image);
    const imageData = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const brightness = buildBrightnessMap(imageData, width, height);
    const detectedRect = detectDocumentRectFromBrightnessMap({ brightness, width, height });

    if (!detectedRect || detectedRect.confidence < 0.55) {
      return { base64, mediaType: mediaType || 'image/jpeg', cropped: false, cropRect: null };
    }

    const sourceRect = {
      left: Math.round(detectedRect.left * scaleX),
      top: Math.round(detectedRect.top * scaleY),
      width: Math.round(detectedRect.width * scaleX),
      height: Math.round(detectedRect.height * scaleY),
    };
    if (sourceRect.width <= 0 || sourceRect.height <= 0) {
      return { base64, mediaType: mediaType || 'image/jpeg', cropped: false, cropRect: null };
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sourceRect.width;
    cropCanvas.height = sourceRect.height;
    cropCanvas.getContext('2d').drawImage(
      image,
      sourceRect.left,
      sourceRect.top,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      sourceRect.width,
      sourceRect.height
    );

    return {
      base64: cropCanvas.toDataURL('image/jpeg', 0.92).split(',')[1],
      mediaType: 'image/jpeg',
      cropped: true,
      cropRect: {
        ...sourceRect,
        confidence: detectedRect.confidence,
      },
    };
  } catch {
    return { base64, mediaType: mediaType || 'image/jpeg', cropped: false, cropRect: null };
  }
}
