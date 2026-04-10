import { buildPatchedPageImage, canRenderPatchPlanPreview, mapPdfRectToImageRect } from './documentPageCompositor';

describe('documentPageCompositor', () => {
  const pageImage = {
    base64: 'stub',
    mediaType: 'image/jpeg',
    pdfWidth: 595,
    pdfHeight: 842,
    renderWidth: 1190,
    renderHeight: 1684,
  };

  const patchPlan = {
    pageNumber: 7,
    region: {
      paddedRect: {
        left: 100,
        top: 200,
        right: 180,
        bottom: 220,
      },
    },
    operations: [{ type: 'clear-rect' }],
  };

  test('accepts preview only when image and patch geometry are available', () => {
    expect(canRenderPatchPlanPreview(pageImage, patchPlan)).toBe(true);
    expect(canRenderPatchPlanPreview(null, patchPlan)).toBe(false);
    expect(canRenderPatchPlanPreview(pageImage, { ...patchPlan, operations: [] })).toBe(false);
    expect(canRenderPatchPlanPreview(pageImage, { ...patchPlan, region: null })).toBe(false);
  });

  test('maps pdf rect into rendered image coordinates', () => {
    expect(mapPdfRectToImageRect(pageImage, patchPlan.region.paddedRect)).toEqual({
      left: 200,
      top: 400,
      right: 360,
      bottom: 440,
      width: 160,
      height: 40,
    });
  });

  test('clamps mapped rect to image bounds', () => {
    expect(mapPdfRectToImageRect(pageImage, {
      left: -5,
      top: 830,
      right: 620,
      bottom: 860,
    })).toEqual({
      left: 0,
      top: 1660,
      right: 1190,
      bottom: 1684,
      width: 1190,
      height: 24,
    });
  });

  test('returns null for invalid or empty mapped geometry', () => {
    expect(mapPdfRectToImageRect(pageImage, null)).toBeNull();
    expect(mapPdfRectToImageRect(pageImage, {
      left: 20,
      top: 20,
      right: 20,
      bottom: 25,
    })).toBeNull();
    expect(mapPdfRectToImageRect({
      ...pageImage,
      pdfWidth: 0,
    }, patchPlan.region.paddedRect)).toBeNull();
  });

  test('builds a viewer-ready patched page image from preview result', () => {
    const patchedImage = buildPatchedPageImage(pageImage, {
      pageNumber: 7,
      imageRect: { left: 10, top: 20, width: 30, height: 12 },
      dataUrl: 'data:image/png;base64,cGF0Y2hlZA==',
    });

    expect(patchedImage).toMatchObject({
      base64: 'cGF0Y2hlZA==',
      mediaType: 'image/png',
      patched: true,
      patchedFromPageNumber: 7,
      patchedRect: { left: 10, top: 20, width: 30, height: 12 },
      pdfWidth: 595,
      renderHeight: 1684,
    });
  });
});
