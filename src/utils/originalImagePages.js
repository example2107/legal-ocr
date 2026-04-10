export function getOriginalImageIndexForPage(originalImages, pageNumber) {
  if (!Array.isArray(originalImages) || originalImages.length === 0 || !pageNumber) return -1;
  const exactIndex = originalImages.findIndex((image) => Number(image?.pageNum || 0) === Number(pageNumber));
  if (exactIndex >= 0) return exactIndex;

  const firstPageNumber = Number(originalImages[0]?.pageNum || 1);
  const fallbackIndex = Number(pageNumber) - firstPageNumber;
  if (!Number.isFinite(fallbackIndex)) return -1;
  return Math.max(0, Math.min(originalImages.length - 1, fallbackIndex));
}

export function getOriginalImageForPage(originalImages, pageNumber) {
  const index = getOriginalImageIndexForPage(originalImages, pageNumber);
  return index >= 0 ? originalImages[index] : null;
}
