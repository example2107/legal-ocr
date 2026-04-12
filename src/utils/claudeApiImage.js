import { autoCropDocumentImage } from './documentImageCrop';

export function dehyphenate(text) {
  return text
    .replace(/([А-яЁёa-zA-Z])-\r?\n([а-яёa-z])/g, '$1$2')
    .replace(/([А-яЁёa-zA-Z])- ([а-яёa-z])/g, '$1$2');
}

export async function compressImage(base64, mediaType) {
  const croppedImage = await autoCropDocumentImage({ base64, mediaType });
  const sourceBase64 = croppedImage.base64 || base64;
  const sourceMediaType = croppedImage.mediaType || mediaType || 'image/jpeg';
  const sizeKb = (sourceBase64.length * 3) / 4 / 1024;

  if (sizeKb <= 3800) {
    return {
      base64: sourceBase64,
      mediaType: sourceMediaType,
      cropRect: croppedImage.cropRect,
      cropped: croppedImage.cropped,
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 2400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve({
        base64: canvas.toDataURL('image/jpeg', 0.80).split(',')[1],
        mediaType: 'image/jpeg',
        cropRect: croppedImage.cropRect,
        cropped: croppedImage.cropped,
      });
    };
    img.src = `data:${sourceMediaType};base64,${sourceBase64}`;
  });
}
