// PDF to images converter using pdf.js
// Loads pdf.js from CDN to avoid bundling issues

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfjsLib = lib;
      resolve(lib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadPdfDocument(file) {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  return lib.getDocument({ data: arrayBuffer }).promise;
}

// Claude API hard limit: 5 242 880 bytes. base64 inflates ~33% so ~5 000 000 chars is safe.
const MAX_B64 = 5_000_000;

async function canvasToSafeBase64(canvas) {
  for (const q of [0.85, 0.72, 0.60, 0.48]) {
    const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1];
    if (b64.length <= MAX_B64) return b64;
  }
  // Shrink canvas 25%
  const c2 = document.createElement('canvas');
  c2.width = Math.round(canvas.width * 0.75);
  c2.height = Math.round(canvas.height * 0.75);
  c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
  for (const q of [0.80, 0.65]) {
    const b64 = c2.toDataURL('image/jpeg', q).split(',')[1];
    if (b64.length <= MAX_B64) return b64;
  }
  // Last resort: half size
  const c3 = document.createElement('canvas');
  c3.width = Math.round(canvas.width * 0.5);
  c3.height = Math.round(canvas.height * 0.5);
  c3.getContext('2d').drawImage(canvas, 0, 0, c3.width, c3.height);
  return c3.toDataURL('image/jpeg', 0.75).split(',')[1];
}

export async function pdfToImages(file, onProgress) {
  const pdf = await loadPdfDocument(file);
  const totalPages = pdf.numPages;
  return pdfToImagesRange(file, 1, totalPages, onProgress, pdf);
}

export async function getPdfPageCount(file) {
  const pdf = await loadPdfDocument(file);
  return pdf.numPages;
}

export async function pdfToImagesRange(file, fromPage, toPage, onProgress, existingPdf = null) {
  const pdf = existingPdf || await loadPdfDocument(file);
  const totalPages = pdf.numPages;
  const safeFrom = Math.max(1, Math.min(fromPage || 1, totalPages));
  const safeTo = Math.max(safeFrom, Math.min(toPage || totalPages, totalPages));
  const images = [];

  for (let pageNum = safeFrom; pageNum <= safeTo; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const scale = 1.5; // good OCR quality, reasonable file size
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const base64 = await canvasToSafeBase64(canvas);
    images.push({ base64, mediaType: 'image/jpeg', pageNum, totalPages });
    if (onProgress) onProgress(pageNum, safeTo - safeFrom + 1, totalPages);
  }
  return images;
}

export async function imageFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target.result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      if (raw.length <= MAX_B64) { resolve({ base64: raw, mediaType }); return; }
      // Too big — recompress via canvas
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const base64 = await canvasToSafeBase64(canvas);
        resolve({ base64, mediaType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
