export function createModelAdapter({ modelUrl = null, modelName = null, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  return {
    configured: Boolean(modelUrl),
    async complete({ messages, maxTokens = 512 }) {
      if (!modelUrl) return null;
      const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
      const response = await fetchImpl(modelUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: modelName ?? 'local', messages, temperature: 0.1, max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}`);
      const payload = await response.json();
      return payload.choices?.[0]?.message?.content?.trim() || null;
    },
    reviewEnabled: process.env.JUSTICE_REVIEW_MODEL === '1',
  };
}
