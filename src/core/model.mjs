export function createModelAdapter({ modelUrl = null, modelName = null, fetchImpl = fetch } = {}) {
  return {
    configured: Boolean(modelUrl),
    async complete({ messages }) {
      if (!modelUrl) return null;
      const response = await fetchImpl(modelUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName ?? 'local', messages, temperature: 0.1 }),
      });
      if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}`);
      const payload = await response.json();
      return payload.choices?.[0]?.message?.content?.trim() || null;
    },
  };
}
