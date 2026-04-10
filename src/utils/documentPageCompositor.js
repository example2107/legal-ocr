function roundMetric(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(3)) : null;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUrl || ''));
  if (!match) return null;
  return {
    mediaType: match[1] || 'image/png',
    base64: match[2] || '',
  };
}

export function canRenderPatchPlanPreview(pageImage, patchPlan) {
  return Boolean(
    pageImage?.base64
    && patchPlan?.pageNumber
    && patchPlan?.region?.paddedRect
    && patchPlan?.operations?.length
  );
}

export function mapPdfRectToImageRect(pageImage, rect) {
  if (!pageImage || !rect) return null;
  const scaleX = Number(pageImage.renderWidth || 0) / Number(pageImage.pdfWidth || 0);
  const scaleY = Number(pageImage.renderHeight || 0) / Number(pageImage.pdfHeight || 0);
  if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
    return null;
  }

  const left = Number(rect.left);
  const top = Number(rect.top);
  const right = Number(rect.right);
  const bottom = Number(rect.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;

  const rawLeft = left * scaleX;
  const rawTop = top * scaleY;
  const rawRight = right * scaleX;
  const rawBottom = bottom * scaleY;
  const imageWidth = Number(pageImage.renderWidth || 0);
  const imageHeight = Number(pageImage.renderHeight || 0);

  const boundedLeft = Math.max(0, Math.min(imageWidth, rawLeft));
  const boundedTop = Math.max(0, Math.min(imageHeight, rawTop));
  const boundedRight = Math.max(0, Math.min(imageWidth, rawRight));
  const boundedBottom = Math.max(0, Math.min(imageHeight, rawBottom));
  const width = boundedRight - boundedLeft;
  const height = boundedBottom - boundedTop;
  if (width <= 0 || height <= 0) return null;

  return {
    left: roundMetric(boundedLeft),
    top: roundMetric(boundedTop),
    right: roundMetric(boundedRight),
    bottom: roundMetric(boundedBottom),
    width: roundMetric(width),
    height: roundMetric(height),
  };
}

function loadImageFromPageImage(pageImage) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение страницы для preview.'));
    image.src = `data:${pageImage.mediaType || 'image/jpeg'};base64,${pageImage.base64}`;
  });
}

function sampleBackgroundColor(ctx, rect) {
  try {
    const sampleX = Math.max(0, Math.floor(rect.left) - 2);
    const sampleY = Math.max(0, Math.floor(rect.top));
    const sampleW = Math.max(1, Math.min(6, Math.floor(rect.width || 1)));
    const sampleH = Math.max(1, Math.min(6, Math.floor(rect.height || 1)));
    const { data } = ctx.getImageData(sampleX, sampleY, sampleW, sampleH);
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
    if (count === 0) return 'rgba(255,255,255,0.96)';
    return `rgba(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}, 0.96)`;
  } catch {
    return 'rgba(255,255,255,0.96)';
  }
}

function drawReplacementText(ctx, rect, text) {
  const fontSize = Math.max(10, Math.floor((rect.height || 16) * 0.82));
  ctx.font = `${fontSize}px "Times New Roman", serif`;
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const baseline = rect.top + Math.max(fontSize, (rect.height || fontSize) * 0.82);
  const maxWidth = Math.max(1, (rect.width || 1) - 4);
  ctx.fillText(text, rect.left + 2, baseline, maxWidth);
}

export async function renderPatchPlanPreview({ pageImage, patchPlan } = {}) {
  if (!canRenderPatchPlanPreview(pageImage, patchPlan)) {
    throw new Error('Недостаточно данных для preview локальной замены.');
  }

  const targetRect = mapPdfRectToImageRect(pageImage, patchPlan.region.paddedRect);
  if (!targetRect) {
    throw new Error('Не удалось перевести координаты PDF в координаты изображения.');
  }

  const image = await loadImageFromPageImage(pageImage);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, image.width, image.height);

  ctx.fillStyle = sampleBackgroundColor(ctx, targetRect);
  ctx.fillRect(targetRect.left, targetRect.top, targetRect.width, targetRect.height);
  drawReplacementText(ctx, targetRect, patchPlan.replacementText || '');

  return {
    pageNumber: patchPlan.pageNumber,
    imageRect: targetRect,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

export function buildPatchedPageImage(pageImage, previewState) {
  if (!pageImage?.base64 || !previewState?.dataUrl) return null;
  const parsed = parseDataUrl(previewState.dataUrl);
  if (!parsed?.base64) return null;

  return {
    ...pageImage,
    base64: parsed.base64,
    mediaType: parsed.mediaType || pageImage.mediaType || 'image/png',
    patched: true,
    patchedFromPageNumber: previewState.pageNumber || pageImage.pageNum || null,
    patchedRect: previewState.imageRect || null,
  };
}

export async function renderPatchEntriesOnImages({ originalImages = [], patchEntries = [] } = {}) {
  if (!Array.isArray(originalImages) || originalImages.length === 0) {
    return [];
  }

  const patchedByPage = {};
  const sortedPatches = [...(patchEntries || [])].sort((a, b) => (
    a.pageNumber - b.pageNumber
    || String(a.appliedAt || '').localeCompare(String(b.appliedAt || ''))
  ));

  for (const patch of sortedPatches) {
    const pageNumber = Number(patch?.pageNumber || patch?.patchPlan?.pageNumber || 0);
    if (!pageNumber) continue;
    const sourceImage = patchedByPage[pageNumber]
      || originalImages.find((image) => Number(image?.pageNum || 0) === pageNumber)
      || null;
    if (!canRenderPatchPlanPreview(sourceImage, patch.patchPlan)) continue;

    const previewState = await renderPatchPlanPreview({
      pageImage: sourceImage,
      patchPlan: patch.patchPlan,
    });
    const patchedImage = buildPatchedPageImage(sourceImage, previewState);
    if (patchedImage) {
      patchedByPage[pageNumber] = patchedImage;
    }
  }

  return originalImages.map((image) => patchedByPage[Number(image?.pageNum || 0)] || image);
}
