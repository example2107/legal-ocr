import { PROVIDERS } from './claudeApiConfig';

async function callClaude(messages, apiKey, system) {
  const body = { model: PROVIDERS.claude.model, max_tokens: 64000, messages };
  if (system) body.system = system;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Ошибка Claude API: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

function toOpenAiMessages(messages, system) {
  const openAiMessages = [];
  if (system) {
    openAiMessages.push({ role: 'system', content: system });
  }

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      openAiMessages.push({ role: message.role, content: message.content });
      continue;
    }

    const parts = message.content.map((part) => {
      if (part.type === 'image') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${part.source.media_type};base64,${part.source.data}`,
          },
        };
      }
      return { type: 'text', text: part.text };
    });
    openAiMessages.push({ role: message.role, content: parts });
  }

  return openAiMessages;
}

function logOpenAiError(rawError, openAiMessages, response) {
  const imageParts = openAiMessages.flatMap((message) => (
    Array.isArray(message.content)
      ? message.content.filter((part) => part?.type === 'image_url')
      : []
  ));

  console.error('OpenAI request failed', {
    status: response.status,
    statusText: response.statusText,
    model: PROVIDERS.openai.model,
    messageCount: openAiMessages.length,
    imageCount: imageParts.length,
    imageUrlLengths: imageParts.map((part) => part?.image_url?.url?.length || 0),
    payloadSize: JSON.stringify({
      model: PROVIDERS.openai.model,
      max_completion_tokens: 64000,
      messages: openAiMessages,
    }).length,
    rawErrorPreview: rawError.slice(0, 1000),
  });
}

async function callOpenAI(messages, apiKey, system) {
  const openAiMessages = toOpenAiMessages(messages, system);
  const payload = {
    model: PROVIDERS.openai.model,
    max_completion_tokens: 64000,
    messages: openAiMessages,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const rawError = await response.text().catch(() => '');
    let parsedError = {};
    try {
      parsedError = rawError ? JSON.parse(rawError) : {};
    } catch {}

    logOpenAiError(rawError, openAiMessages, response);
    throw new Error(parsedError.error?.message || rawError || `Ошибка OpenAI API: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function toGeminiParts(messages, system) {
  const parts = [];
  if (system) {
    parts.push({ text: `${system}\n\n` });
  }

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      parts.push({ text: message.content });
      continue;
    }

    for (const part of message.content) {
      if (part.type === 'image') {
        parts.push({ inlineData: { mimeType: part.source.media_type, data: part.source.data } });
      } else if (part.type === 'text') {
        parts.push({ text: part.text });
      }
    }
  }

  return parts;
}

async function callGemini(messages, apiKey, system) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: toGeminiParts(messages, system) }] }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Ошибка Gemini API: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

export async function callApi(messages, apiKey, system, provider) {
  if (provider === 'openai') return callOpenAI(messages, apiKey, system);
  if (provider === 'gemini') return callGemini(messages, apiKey, system);
  return callClaude(messages, apiKey, system);
}
