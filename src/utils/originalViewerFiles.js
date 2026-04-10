import { imageFileToBase64, pdfToImages } from './pdfUtils';

export async function loadOriginalViewerFiles(files = []) {
  const selectedFiles = Array.from(files || []);
  const allImages = [];

  for (const file of selectedFiles) {
    if (file.type === 'application/pdf') {
      const pages = await pdfToImages(file, () => {});
      allImages.push(...pages);
    } else {
      allImages.push(await imageFileToBase64(file));
    }
  }

  return allImages;
}
