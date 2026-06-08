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

export async function callApi(messages, apiKey, system, provider) {
  if (provider === 'openai') return callOpenAI(messages, apiKey, system);
  return callClaude(messages, apiKey, system);
}
