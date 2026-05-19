// Open the side panel when the extension icon is clicked
if (chrome.sidePanel) {
  if (chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(console.error);
  } else {
    chrome.action.onClicked.addListener(function(tab) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
    });
  }
}

// ── AI Guess relay ─────────────────────────────────────────────────
// Proxies the Anthropic API call from popup (side-panel context can't
// reach api.anthropic.com directly; service workers can).
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action !== 'aiGuess') return false;

  chrome.storage.local.get(['apiKey', 'profileContext'], function(s) {
    if (!s.apiKey) { sendResponse({error: 'NO_API_KEY'}); return; }

    var profile = s.profileContext || '(no profile saved)';
    var jobCtx  = msg.jobContext || {};
    var fields  = msg.fields || [];

    var systemPrompt = [
      'You are filling out a job application form on behalf of the applicant.',
      'Respond ONLY with a valid JSON array. No preamble, no markdown, no explanation.',
      '',
      'Applicant profile:',
      profile,
      '',
      'Job being applied to: ' + (jobCtx.title || 'unknown') + ' at ' + (jobCtx.company || 'unknown'),
      '',
      'Rules:',
      '- For select/radio fields your answer MUST exactly match one of the provided options',
      '- For text/textarea fields be concise and professional',
      '- If you cannot answer from the profile return ""',
      '- Return "" for salary, compensation, "how did you hear" fields',
      '- Never fabricate credentials, dates, or facts not in the profile',
      '',
      'Return a JSON array in exactly this format:',
      '[{"label":"<exact label>","answer":"<your answer>"}]'
    ].join('\n');

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(fields) }]
      })
    })
    .then(function(r) {
      if (!r.ok) return r.text().then(function(t) {
        sendResponse({error: 'API_ERROR', message: r.status + ': ' + t.substring(0, 200)});
      });
      return r.json();
    })
    .then(function(data) {
      if (!data) return;
      var text = (data.content && data.content[0] && data.content[0].text) || '[]';
      // Strip markdown fences if present
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        var guesses = JSON.parse(text);
        sendResponse({guesses: Array.isArray(guesses) ? guesses : []});
      } catch(e) {
        sendResponse({error: 'PARSE_ERROR', message: e.message});
      }
    })
    .catch(function(e) {
      sendResponse({error: 'API_ERROR', message: e.message});
    });
  });

  return true; // keep channel open for async sendResponse
});
