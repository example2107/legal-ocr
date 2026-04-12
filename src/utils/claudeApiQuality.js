import { callApi } from './claudeApiClient';
import { PROMPT_QUALITY_SAFE } from './claudeApiConfig';
import { dehyphenate } from './claudeApiImage';

function extractQualityPages(fullText) {
  const parts = fullText.split(/(\[PAGE:\d+\])/);
  const pages = [];
  let currentText = '';
  let currentMarker = null;

  for (const part of parts) {
    if (/^\[PAGE:\d+\]$/.test(part)) {
      if (currentMarker !== null || currentText.trim()) {
        pages.push({ marker: currentMarker, text: currentText });
      }
      currentText = '';
      currentMarker = part;
    } else {
      currentText += part;
    }
  }

  if (currentMarker !== null || currentText.trim()) {
    pages.push({ marker: currentMarker, text: currentText });
  }

  return pages;
}

function buildCheckedPage(marker, text) {
  return marker ? `\n${marker}\n${text}` : text;
}

async function checkOnePage({ marker, text, fullText, apiKey, provider }) {
  const page = marker || text ? { marker, text } : { marker: null, text: fullText };
  const textForCheck = (page.text || '').replace(/\[PAGE:\d+\]/g, '');

  try {
    const checked = await callApi(
      [{ role: 'user', content: `${PROMPT_QUALITY_SAFE}${textForCheck}` }],
      apiKey,
      null,
      provider,
    );
    if (checked && checked.length > 50) {
      const cleaned = dehyphenate(checked);
      return buildCheckedPage(page.marker, cleaned);
    }
  } catch (error) {
    console.warn('Quality check error:', error);
  }

  return fullText;
}

async function checkPagesIndividually(pages, apiKey, provider, onProgress) {
  const total = pages.length;
  const checkedParts = [];

  for (let index = 0; index < total; index += 1) {
    const { marker, text } = pages[index];
    const pageText = text.trim();

    onProgress({
      stage: 'quality',
      percent: Math.round(75 + ((index + 1) / total) * 12),
      message: total > 1
        ? `Проверка качества: страница ${index + 1} из ${total}...`
        : 'Проверка качества распознавания...',
    });

    if (!pageText) {
      checkedParts.push(buildCheckedPage(marker, text));
      continue;
    }

    try {
      const checked = await callApi(
        [{ role: 'user', content: `${PROMPT_QUALITY_SAFE}${pageText}` }],
        apiKey,
        null,
        provider,
      );
      const result = dehyphenate(checked && checked.length > 30 ? checked : pageText);
      checkedParts.push(buildCheckedPage(marker, result));
    } catch (error) {
      console.warn(`Quality check error page ${index + 1}:`, error);
      checkedParts.push(buildCheckedPage(marker, pageText));
    }
  }

  return checkedParts.join('');
}

export async function runQualityCheck(fullText, apiKey, provider, onProgress) {
  const pages = extractQualityPages(fullText);
  if (pages.length <= 1) {
    const singlePage = pages[0] || { marker: null, text: fullText };
    return checkOnePage({
      marker: singlePage.marker,
      text: singlePage.text,
      fullText,
      apiKey,
      provider,
    });
  }

  return checkPagesIndividually(pages, apiKey, provider, onProgress);
}
