/**
 * frontend/js/ai.js
 * AI module — replaces v4.1's direct-to-provider callAI() with backend proxy.
 * All AI calls go through POST /api/ai/generate so API keys stay server-side.
 */
'use strict';

// ── Provider status cache ────────────────────────────────────────────────────
let _providerStatus = null;   // { hasDeepseekKey, providers: {...}, current }
let _providerPollHandle = null;

async function loadProviderStatus() {
  try {
    _providerStatus = await api.ai.providers();
    _updateProviderStatusUI();
  } catch (e) {
    console.warn('[AI] Could not load provider status:', e.message);
  }
  return _providerStatus;
}

function _updateProviderStatusUI() {
  const el     = document.getElementById('providerStatus');
  const txtEl  = document.getElementById('providerStatusText');
  if (!el || !txtEl) return;

  if (!_providerStatus) {
    el.className = 'provider-status offline';
    txtEl.textContent = 'AI offline';
    return;
  }

  const ds  = _providerStatus.providers?.deepseek;
  const oll = _providerStatus.providers?.ollama;
  const hasDs  = ds?.available;
  const hasOll = oll?.available;

  if (hasDs) {
    el.className = 'provider-status online';
    txtEl.textContent = `DeepSeek · ${ds.model || 'deepseek-chat'}`;
  } else if (hasOll) {
    el.className = 'provider-status online';
    txtEl.textContent = `Ollama · ${oll.model || 'llama3'}`;
  } else {
    el.className = 'provider-status error';
    txtEl.textContent = 'No AI provider';
  }
}

function startProviderPolling(intervalMs = 30000) {
  if (_providerPollHandle) return;
  _providerPollHandle = setInterval(loadProviderStatus, intervalMs);
}

// ── isAIReady — sync check ────────────────────────────────────────────────────
function isAIReady() {
  if (!_providerStatus) return false;
  const ds  = _providerStatus.providers?.deepseek;
  const oll = _providerStatus.providers?.ollama;
  return !!(ds?.available || oll?.available);
}

function aiProviderLabel() {
  if (!_providerStatus) return null;
  const ds  = _providerStatus.providers?.deepseek;
  const oll = _providerStatus.providers?.ollama;
  if (ds?.available) return 'DeepSeek';
  if (oll?.available) return 'Ollama';
  return null;
}

// ── callAI — main AI call, used by Orchestrator, steps, continuity etc. ──────
// Signature matches v4.1's callAI(prompt, settings) so existing call-sites work.
// The `settings` param is accepted but ignored — the backend handles provider selection.
async function callAI(prompt, _settings, workspaceId) {
  const wid = workspaceId || DB.getActiveWorkspaceId() || undefined;
  const { text } = await api.ai.generate({
    prompt,
    workspaceId: wid,
    maxTokens:   16384,
  });
  return text;
}

// ── getEffectiveSettings — v4.1 compat shim ──────────────────────────────────
// In v4.1 this merged global AI creds into project settings.
// In the fullstack version we don't store keys in the frontend — just return
// the project's non-AI settings so existing call-sites don't break.
function getEffectiveSettings(project) {
  return project?.settings || {};
}

Object.assign(window, {
  loadProviderStatus,
  startProviderPolling,
  isAIReady,
  aiProviderLabel,
  callAI,
  getEffectiveSettings,
});
