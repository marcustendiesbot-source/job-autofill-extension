var TABS = ['fill', 'custom', 'settings'];
var _editingOrigQ = null; // null = add new; string = Q text of entry currently being edited

var DEFAULT_PROFILE_CONTEXT = [
  'Name: [Your Full Name]',
  'Current Role: [Job Title] at [Company] (started [Month Year])',
  'Previous Role: [Job Title] at [Company]',
  'Education: [Degree] from [University] ([Year]); [Other credentials]',
  'Certifications: [List your certifications]',
  'Location: [City, Province/State, Country]',
  'Years of experience: [X] years in [industry/function]',
  'Key skills: [skill1, skill2, skill3]'
].join('\n');

// ── Tab switching ──────────────────────────────────────────────────
function showTab(name) {
  TABS.forEach(function(n) {
    var panel = document.getElementById('p-' + n);
    if (panel) panel.classList.toggle('active', n === name);
  });
  document.querySelectorAll('.nav-item').forEach(function(btn) {
    btn.classList.toggle('on', btn.getAttribute('data-tab') === name);
  });
}

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, ms) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show';
  clearTimeout(window._tt);
  window._tt = setTimeout(function() { el.className = 'toast'; }, ms || 2200);
}

// ── Storage helpers ────────────────────────────────────────────────
function store(key, obj, cb)       { var d={}; d[key]=obj; chrome.storage.local.set(d, cb||function(){}); }
function retrieve(key, cb)         { chrome.storage.local.get(key, function(d){ cb(d[key]||{}); }); }
function retrieveArr(key, cb)      { chrome.storage.local.get(key, function(d){ cb(d[key]||[]); }); }
function storeArr(key, arr, cb)    { var d={}; d[key]=arr; chrome.storage.local.set(d, cb||function(){}); }

// ── Load all saved data ────────────────────────────────────────────
function loadAll() {
  retrieve('stats', function(s) {
    document.getElementById('fillCount').textContent = s.fillCount || 0;
  });
  chrome.storage.local.get('saveFolderName', function(d) {
    updateFolderDisplay(d.saveFolderName || '');
  });
  // AI settings + resume
  chrome.storage.local.get(['aiGuessEnabled', 'apiKey', 'profileContext', 'resumeFileName'], function(s) {
    var tog = document.getElementById('aiGuessToggle');
    if (tog) tog.checked = !!s.aiGuessEnabled;

    var keyInput = document.getElementById('apiKeyInput');
    if (keyInput) keyInput.placeholder = s.apiKey ? '••••••••••••••••' : 'sk-ant-...';

    var profileInput = document.getElementById('profileContextInput');
    if (profileInput) profileInput.value = s.profileContext || DEFAULT_PROFILE_CONTEXT;

    updateResumeDisplay(s.resumeFileName || '');
  });
  loadQA();
}

// ── XSS helper ────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Custom Q&A ─────────────────────────────────────────────────────
function loadQA() {
  retrieveArr('customQA', function(qa) {
    var list     = document.getElementById('qaList');
    var countEl  = document.getElementById('qaCountMsg');
    var statEl   = document.getElementById('qaCount');
    if (statEl)   statEl.textContent  = qa.length;
    if (countEl)  countEl.textContent = qa.length ? '📚 ' + qa.length + ' saved Q&A pair' + (qa.length > 1 ? 's' : '') : '';
    if (!qa.length) {
      list.innerHTML = '<div class="qa-empty">No Q&amp;A yet. Use "🧠 Learn This Page" or add one below!</div>';
      return;
    }
    list.innerHTML = '';
    qa.forEach(function(item, i) {
      var div = document.createElement('div');
      div.className = 'qa-item';
      div.innerHTML =
        '<div class="qa-q">🔑 ' + escHtml(item.q) + '</div>' +
        '<div class="qa-a" style="margin-top:4px">💬 ' + escHtml(item.a.length > 120 ? item.a.substr(0, 120) + '…' : item.a) + '</div>' +
        '<button class="qa-edit-btn" data-idx="' + i + '" title="Edit">✏️</button>' +
        '<button class="qa-del"      data-idx="' + i + '" title="Delete">✕</button>';
      list.appendChild(div);
    });
    list.querySelectorAll('.qa-del').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteQA(parseInt(btn.getAttribute('data-idx'))); });
    });
    list.querySelectorAll('.qa-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { editQA(parseInt(btn.getAttribute('data-idx'))); });
    });
  });
}

function editQA(idx) {
  retrieveArr('customQA', function(qa) {
    var item = qa[idx];
    if (!item) return;
    _editingOrigQ = item.q;
    document.getElementById('newQ').value = item.q;
    document.getElementById('newA').value = item.a;
    showTab('custom');
    toast('✏️ Editing — save to update', 3000);
  });
}

function addQA() {
  var q = document.getElementById('newQ').value.trim();
  var a = document.getElementById('newA').value.trim();
  if (!q) { toast('⚠️ Question is required!', 2500); return; }
  retrieveArr('customQA', function(qa) {
    // If editing, remove the original entry now that save is confirmed.
    if (_editingOrigQ !== null) {
      var oldIdx = qa.findIndex(function(item) { return item.q === _editingOrigQ; });
      if (oldIdx >= 0) qa.splice(oldIdx, 1);
      _editingOrigQ = null;
    }
    var exists = qa.findIndex(function(item) { return item.q.toLowerCase() === q.toLowerCase(); });
    if (exists >= 0) { qa[exists].a = a; } else { qa.push({q: q, a: a}); }
    storeArr('customQA', qa, function() {
      document.getElementById('newQ').value = '';
      document.getElementById('newA').value = '';
      loadQA();
      toast('✅ Q&A saved!');
    });
  });
}

function deleteQA(idx) {
  retrieveArr('customQA', function(qa) {
    qa.splice(idx, 1);
    storeArr('customQA', qa, function() { loadQA(); toast('🗑️ Removed'); });
  });
}

// ── Learn This Page ────────────────────────────────────────────────
function doLearn() {
  retrieveArr('customQA', function(existingQA) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || !tabs[0]) { toast('❌ No active tab found'); return; }
      chrome.tabs.sendMessage(tabs[0].id, {action: 'learn', customQA: existingQA}, function(response) {
        if (chrome.runtime.lastError) { toast('❌ Cannot reach page — try refreshing it', 3000); return; }
        var fields = (response && response.fields) || [];
        showLearnModal(fields);
      });
    });
  });
}

function showLearnModal(fields) {
  var modal    = document.getElementById('learnModal');
  var fieldsEl = document.getElementById('learnFields');
  var emptyEl  = document.getElementById('learnEmpty');
  var saveBtn  = document.getElementById('btnSaveLearn');
  var statusEl = document.getElementById('learnStatus');
  var header   = document.getElementById('learnModalTitle');

  // Reset title in case showAIReviewModal changed it
  if (header) header.textContent = '🧠 Learn This Page';

  modal.style.display = 'block';

  if (!fields.length) {
    fieldsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    saveBtn.style.display = 'none';
    statusEl.textContent = '';
    return;
  }

  emptyEl.style.display = 'none';
  saveBtn.style.display = 'block';
  statusEl.textContent = '📋 Found ' + fields.length + ' field' + (fields.length > 1 ? 's' : '') + ' not in your Q&A. Add answers below:';

  fieldsEl.innerHTML = '';
  fields.forEach(function(f, i) {
    var div = document.createElement('div');
    div.className = 'learn-field';
    var inputHtml;
    var typeLabel = f.type;
    if (f.type === 'textarea') {
      inputHtml = '<textarea id="lf_' + i + '" placeholder="Your answer..." rows="3"></textarea>';
      typeLabel = 'long text';
    } else if (f.type === 'select' && f.options && f.options.length) {
      var opts = f.options.map(function(o) { return '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>'; }).join('');
      inputHtml = '<select id="lf_' + i + '"><option value="">Select your answer...</option>' + opts + '</select>';
      typeLabel = 'dropdown';
    } else if (f.type === 'radio' && f.options && f.options.length) {
      var optHtml = f.options.map(function(o) {
        return '<label class="learn-radio-opt"><input type="radio" name="lf_grp_' + i + '" value="' + escHtml(o) + '"> ' + escHtml(o) + '</label>';
      }).join('');
      inputHtml = '<div class="learn-radio-group" id="lf_' + i + '">' + optHtml + '</div>';
      typeLabel = 'multiple choice';
    } else if (f.type === 'checkbox') {
      inputHtml = '<label class="learn-radio-opt"><input type="checkbox" id="lf_' + i + '" value="yes"> Yes / I agree</label>';
      typeLabel = 'checkbox';
    } else {
      inputHtml = '<input id="lf_' + i + '" placeholder="Your answer...">';
      typeLabel = 'text';
    }
    div.innerHTML =
      '<div class="learn-field-label">' + escHtml(f.label) + '<span class="learn-field-type">(' + typeLabel + ')</span></div>' +
      inputHtml +
      '<button class="skip-btn" data-idx="' + i + '">Skip this field</button>';
    div.querySelector('.skip-btn').addEventListener('click', function() {
      div.style.opacity = '0.4';
      div.setAttribute('data-skip', '1');
    });
    fieldsEl.appendChild(div);
  });

  saveBtn.onclick = function() {
    retrieveArr('customQA', function(qa) {
      var added = 0;
      fields.forEach(function(f, i) {
        var fieldDiv = fieldsEl.children[i];
        if (fieldDiv && fieldDiv.getAttribute('data-skip')) return;
        var answer = '';
        if (f.type === 'radio' && f.options && f.options.length) {
          var grpEl = document.getElementById('lf_' + i);
          if (grpEl) {
            var checked = grpEl.querySelector('input[type=radio]:checked');
            answer = checked ? checked.value.trim() : '';
          }
        } else if (f.type === 'checkbox') {
          var cbEl = document.getElementById('lf_' + i);
          answer = (cbEl && cbEl.checked) ? 'Yes' : '';
        } else {
          var input = document.getElementById('lf_' + i);
          answer = input ? input.value.trim() : '';
        }
        // Allow blank answers (e.g. middle name, address line 2 = intentionally empty)
        var exists = qa.findIndex(function(item) { return item.q.toLowerCase() === f.label.toLowerCase(); });
        if (exists >= 0) { qa[exists].a = answer; } else { qa.push({q: f.label, a: answer}); }
        added++;
      });
      storeArr('customQA', qa, function() {
        modal.style.display = 'none';
        loadQA();
        toast('🧠 Learned ' + added + ' new answer' + (added !== 1 ? 's' : '') + '!', 3000);
        showTab('custom');
      });
    });
  };
}

// ── AI Review Modal ────────────────────────────────────────────────
// Reuses the learnModal DOM, pre-populated with AI-guessed answers for review.
function showAIReviewModal(aiFields) {
  var modal    = document.getElementById('learnModal');
  var fieldsEl = document.getElementById('learnFields');
  var emptyEl  = document.getElementById('learnEmpty');
  var saveBtn  = document.getElementById('btnSaveLearn');
  var statusEl = document.getElementById('learnStatus');
  var header   = document.getElementById('learnModalTitle');

  if (header) header.textContent = '🤖 Review AI-Guessed Answers';

  modal.style.display = 'block';
  emptyEl.style.display = 'none';
  saveBtn.style.display = 'block';
  statusEl.textContent =
    '🤖 AI filled ' + aiFields.length + ' field' + (aiFields.length > 1 ? 's' : '') +
    '. Review and save the ones that are correct:';

  fieldsEl.innerHTML = '';
  aiFields.forEach(function(f, i) {
    var div = document.createElement('div');
    div.className = 'learn-field';

    var inputHtml;
    if (f.type === 'textarea') {
      inputHtml = '<textarea id="lf_' + i + '" rows="3">' + escHtml(f.answer) + '</textarea>';
    } else if (f.type === 'select' && f.options && f.options.length) {
      var opts = f.options.map(function(o) {
        var sel = o === f.answer ? ' selected' : '';
        return '<option value="' + escHtml(o) + '"' + sel + '>' + escHtml(o) + '</option>';
      }).join('');
      inputHtml = '<select id="lf_' + i + '"><option value="">— skip —</option>' + opts + '</select>';
    } else {
      inputHtml = '<input id="lf_' + i + '" value="' + escHtml(f.answer) + '">';
    }

    div.innerHTML =
      '<div class="learn-field-label">' + escHtml(f.label) +
        '<span class="learn-field-type">(' + f.type + ')</span>' +
        '<span style="color:#ffb432;margin-left:6px;font-size:9px;">AI suggested</span>' +
      '</div>' +
      inputHtml +
      '<button class="skip-btn" data-idx="' + i + '">Skip — don\'t save this one</button>';

    div.querySelector('.skip-btn').addEventListener('click', function() {
      div.style.opacity = '0.4';
      div.setAttribute('data-skip', '1');
    });
    fieldsEl.appendChild(div);
  });

  saveBtn.onclick = function() {
    retrieveArr('customQA', function(qa) {
      var saved = 0;
      aiFields.forEach(function(f, i) {
        var fieldDiv = fieldsEl.children[i];
        if (fieldDiv && fieldDiv.getAttribute('data-skip')) return;
        var input = document.getElementById('lf_' + i);
        if (input === null) return;
        var answer = input.value.trim();
        var exists = qa.findIndex(function(item) {
          return item.q.toLowerCase() === f.label.toLowerCase();
        });
        if (exists >= 0) { qa[exists].a = answer; }
        else             { qa.push({q: f.label, a: answer}); }
        saved++;
      });
      storeArr('customQA', qa, function() {
        modal.style.display = 'none';
        loadQA();
        toast('🧠 Saved ' + saved + ' answer' + (saved !== 1 ? 's' : '') + ' to Q&A bank!', 3000);
        document.getElementById('statusTxt').textContent = saved + ' AI answers saved to Q&A';
        if (header) header.textContent = '🧠 Learn This Page';
      });
    });
  };
}

// ── Main fill orchestrator (Steps A → B → C → D) ──────────────────
async function doFill() {
  var statusEl = document.getElementById('statusTxt');
  function setStatus(txt) { if (statusEl) statusEl.textContent = txt; }

  chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
    if (!tabs || !tabs[0]) { toast('❌ No active tab found'); return; }
    var tab = tabs[0];

    // ── STEP A: Resume Upload ───────────────────────────────────────
    var resumeHandle = await new Promise(function(res) { _getResumeHandle(res); });

    if (resumeHandle) {
      setStatus('📎 Looking for resume upload field...');
      try {
        var perm = await resumeHandle.requestPermission({ mode: 'read' });
        if (perm === 'granted') {
          var file = await resumeHandle.getFile();
          var buffer = await file.arrayBuffer();
          var uploadResult = await new Promise(function(res) {
            chrome.tabs.sendMessage(tab.id, {
              action:   'doResumeUpload',
              buffer:   buffer,
              filename: file.name,
              mimeType: file.type || 'application/pdf'
            }, res);
          });

          if (uploadResult && uploadResult.success) {
            setStatus('📎 Resume uploaded — waiting for page to populate...');
            await new Promise(function(res) {
              chrome.tabs.sendMessage(tab.id, {action: 'waitForSettle'}, res);
            });
            setStatus('✅ Page settled — starting Q&A fill...');
          } else {
            var reason = (uploadResult && uploadResult.reason) || 'unknown';
            if (reason === 'NO_INPUT_FOUND') {
              setStatus('ℹ️ No resume upload field on this page — skipping');
            } else if (reason === 'ALREADY_UPLOADED') {
              setStatus('ℹ️ Resume already uploaded this session — skipping');
            } else {
              setStatus('⚠️ Resume upload failed: ' + reason);
            }
          }
        } else {
          setStatus('⚠️ Resume permission denied — skipping upload');
        }
      } catch(e) {
        setStatus('⚠️ Resume error: ' + e.message);
      }
    }

    // ── STEP B: Q&A Fill Pass ───────────────────────────────────────
    var customQA = await new Promise(function(res) { retrieveArr('customQA', res); });

    if (!customQA.length) {
      toast('⚠️ No Q&A saved yet — use Learn This Page first!', 3000);
      showTab('custom');
      return;
    }

    setStatus('⚡ Filling from Q&A bank...');

    var fillResult = await new Promise(function(res) {
      chrome.tabs.sendMessage(tab.id, {action: 'fill', data: {customQA: customQA}}, res);
    });

    if (chrome.runtime.lastError || !fillResult) {
      toast('❌ Cannot reach page — try refreshing it', 3000);
      return;
    }

    var qaCount      = fillResult.count || 0;
    var unfilledSnap = fillResult.unfilled || [];

    retrieve('stats', function(st) {
      st.fillCount = (st.fillCount || 0) + 1;
      store('stats', st);
      document.getElementById('fillCount').textContent = st.fillCount;
    });

    setStatus('✅ ' + qaCount + ' fields filled from Q&A');

    if (!unfilledSnap.length) {
      toast('⚡ Filled ' + qaCount + ' fields — page complete!', 3000);
      return;
    }

    // ── STEP C: AI Guess Pass ───────────────────────────────────────
    var aiSettings = await new Promise(function(res) {
      chrome.storage.local.get(['aiGuessEnabled', 'apiKey'], res);
    });

    if (!aiSettings.aiGuessEnabled || !aiSettings.apiKey) {
      toast('⚡ Filled ' + qaCount + ' fields (' + unfilledSnap.length + ' unmatched — enable AI Guess in Settings)', 4000);
      return;
    }

    setStatus('🤖 Sending ' + unfilledSnap.length + ' unmatched fields to AI...');

    var jobContext = await new Promise(function(res) {
      chrome.tabs.sendMessage(tab.id, {action: 'getJobDescription'}, function(r) {
        res(r || {});
      });
    });

    var aiResult = await new Promise(function(res) {
      chrome.runtime.sendMessage({
        action:     'aiGuess',
        fields:     unfilledSnap,
        jobContext: {
          title:   jobContext.title   || '',
          company: jobContext.company || '',
          url:     tab.url || ''
        }
      }, res);
    });

    if (!aiResult || aiResult.error) {
      var errMsg = !aiResult                       ? 'No response from background'
                 : aiResult.error === 'NO_API_KEY' ? 'No API key saved'
                 : (aiResult.message || aiResult.error);
      setStatus('⚠️ AI Guess failed: ' + errMsg);
      toast('⚡ ' + qaCount + ' Q&A filled · AI Guess failed: ' + errMsg, 4000);
      return;
    }

    var nonEmpty = (aiResult.guesses || []).filter(function(g) {
      return g.answer && g.answer.trim();
    });

    if (!nonEmpty.length) {
      setStatus('✅ ' + qaCount + ' Q&A filled · AI had no answers for remaining fields');
      toast('⚡ ' + qaCount + ' fields filled (AI found nothing new)', 3000);
      return;
    }

    var applyResult = await new Promise(function(res) {
      chrome.tabs.sendMessage(tab.id, {action: 'applyGuesses', guesses: nonEmpty}, res);
    });

    var aiCount  = (applyResult && applyResult.count)    || 0;
    var aiFields = (applyResult && applyResult.aiFields) || [];

    setStatus('⚡ ' + qaCount + ' Q&A · 🤖 ' + aiCount + ' AI · review amber fields');
    toast('⚡ ' + qaCount + ' + 🤖 ' + aiCount + ' filled — review amber fields below!', 3500);

    // ── STEP D: Open Review Modal ───────────────────────────────────
    if (aiFields.length) {
      setTimeout(function() { showAIReviewModal(aiFields); }, 400);
    }
  });
}

// ── Export / Import / Clear ────────────────────────────────────────
function exportData() {
  retrieveArr('customQA', function(qa) {
    // Only export customQA — never apiKey, profileContext, or handles
    var blob = new Blob([JSON.stringify({customQA: qa}, null, 2)], {type: 'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'autofill-qa-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('📤 Exported!');
  });
}

function importData(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var d = JSON.parse(ev.target.result);
      if (d.customQA) storeArr('customQA', d.customQA);
      setTimeout(loadAll, 200);
      toast('📥 Imported!');
    } catch(err) { toast('❌ Invalid file', 3000); }
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('Clear ALL saved Q&A and settings? This cannot be undone.')) return;
  chrome.storage.local.clear(function() { loadAll(); toast('🗑️ All data cleared'); });
}

// ── Platform detection ─────────────────────────────────────────────
var ATS_PLATFORMS = [
  {name:'Dayforce',        re:/dayforcehcm\.com/},
  {name:'Greenhouse',      re:/greenhouse\.io/},
  {name:'Lever',           re:/lever\.co/},
  {name:'Workday',         re:/workday\.com|myworkdayjobs\.com/},
  {name:'iCIMS',           re:/icims\.com/},
  {name:'BambooHR',        re:/bamboohr\.com/},
  {name:'Taleo',           re:/taleo\.net/},
  {name:'Jobvite',         re:/jobvite\.com/},
  {name:'SmartRecruiters', re:/smartrecruiters\.com/},
  {name:'Ashby',           re:/ashbyhq\.com/},
  {name:'LinkedIn',        re:/linkedin\.com/},
  {name:'Indeed',          re:/indeed\.com/},
  {name:'Glassdoor',       re:/glassdoor\.com/},
  {name:'Workable',        re:/workable\.com/},
  {name:'Rippling',        re:/rippling\.com/},
];

function detectPlatform() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs || !tabs[0]) return;
    var url = tabs[0].url || '';
    for (var i = 0; i < ATS_PLATFORMS.length; i++) {
      if (ATS_PLATFORMS[i].re.test(url)) {
        var badge  = document.getElementById('platformBadge');
        var status = document.getElementById('statusTxt');
        if (badge)  { badge.textContent = ATS_PLATFORMS[i].name; badge.style.display = 'inline'; }
        if (status) status.textContent = 'Detected: ' + ATS_PLATFORMS[i].name;
        return;
      }
    }
  });
}

// ── IndexedDB helpers for FileSystem handles ───────────────────────
function _openIDB(cb) {
  var req = indexedDB.open('autofill-db', 1);
  req.onupgradeneeded = function(e) { e.target.result.createObjectStore('handles'); };
  req.onsuccess = function(e) { cb(e.target.result); };
  req.onerror   = function()  { cb(null); };
}

function _saveFolderHandle(handle, cb) {
  _openIDB(function(db) {
    if (!db) { cb && cb(false); return; }
    var tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'saveFolder');
    tx.oncomplete = function() { cb && cb(true); };
    tx.onerror    = function() { cb && cb(false); };
  });
}
function _getFolderHandle(cb) {
  _openIDB(function(db) {
    if (!db) { cb(null); return; }
    var tx  = db.transaction('handles', 'readonly');
    var req = tx.objectStore('handles').get('saveFolder');
    req.onsuccess = function(e) { cb(e.target.result || null); };
    req.onerror   = function()  { cb(null); };
  });
}

function _saveResumeHandle(handle, cb) {
  _openIDB(function(db) {
    if (!db) { cb && cb(false); return; }
    var tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'resumeFile');
    tx.oncomplete = function() { cb && cb(true); };
    tx.onerror    = function() { cb && cb(false); };
  });
}
function _getResumeHandle(cb) {
  _openIDB(function(db) {
    if (!db) { cb(null); return; }
    var tx  = db.transaction('handles', 'readonly');
    var req = tx.objectStore('handles').get('resumeFile');
    req.onsuccess = function(e) { cb(e.target.result || null); };
    req.onerror   = function()  { cb(null); };
  });
}

// ── Folder display ─────────────────────────────────────────────────
function updateFolderDisplay(name) {
  var el = document.getElementById('folderDisplay');
  if (!el) return;
  if (name) { el.textContent = '📁 ' + name; el.style.color = '#4affb4'; }
  else      { el.textContent = 'No folder selected'; el.style.color = '#6b6b8a'; }
}

// ── Resume display ─────────────────────────────────────────────────
function updateResumeDisplay(name) {
  var el = document.getElementById('resumeDisplay');
  if (!el) return;
  if (name) { el.textContent = '📎 ' + name; el.style.color = '#4affb4'; }
  else      { el.textContent = 'No resume selected'; el.style.color = '#6b6b8a'; }
}

// ── Choose save folder ─────────────────────────────────────────────
async function chooseFolder() {
  try {
    var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _saveFolderHandle(handle, function(ok) {
      if (!ok) { toast('❌ Could not store folder', 3000); return; }
      chrome.storage.local.set({ saveFolderName: handle.name }, function() {
        updateFolderDisplay(handle.name);
        toast('📁 Folder set: ' + handle.name);
      });
    });
  } catch(e) {
    if (e.name !== 'AbortError') toast('❌ Folder access failed', 3000);
  }
}

// ── Choose resume file ─────────────────────────────────────────────
async function chooseResume() {
  try {
    var handles = await window.showOpenFilePicker({
      types: [{
        description: 'Resume / CV',
        accept: {
          'application/pdf': ['.pdf'],
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/msword': ['.doc']
        }
      }],
      multiple: false
    });
    var handle = handles[0];
    _saveResumeHandle(handle, function(ok) {
      if (!ok) { toast('❌ Could not store resume handle', 3000); return; }
      chrome.storage.local.set({ resumeFileName: handle.name }, function() {
        updateResumeDisplay(handle.name);
        toast('📎 Resume set: ' + handle.name);
      });
    });
  } catch(e) {
    if (e.name !== 'AbortError') toast('❌ File access failed', 3000);
  }
}

// ── Save job post as .txt ──────────────────────────────────────────
function generateJobPostTxt(title, company, url, descText, date) {
  var sep = '='.repeat(60);
  return sep + '\n' +
    title + '\n' +
    (company ? 'Company: ' + company + '\n' : '') +
    sep + '\n' +
    'Saved : ' + date + '\n' +
    'URL   : ' + url  + '\n' +
    sep + '\n\n' +
    descText + '\n';
}

async function saveJobPost() {
  chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
    if (!tabs || !tabs[0]) { toast('❌ No active tab found'); return; }
    var tabUrl = tabs[0].url || '';

    chrome.tabs.sendMessage(tabs[0].id, {action: 'getJobDescription'}, async function(resp) {
      if (chrome.runtime.lastError || !resp) {
        toast('❌ Cannot reach page — try refreshing', 3000); return;
      }
      var title    = (resp.title || 'Job Post').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().substring(0, 80);
      var company  = (resp.company || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().substring(0, 50);
      var date     = new Date().toISOString().split('T')[0];
      var filename = (company ? company + '-' : '') + title + '-' + date + '.txt';
      var content  = generateJobPostTxt(resp.title || 'Job Post', resp.company || '', tabUrl, resp.descText || '', date);

      _getFolderHandle(async function(handle) {
        if (!handle) {
          toast('⚠️ Choose a save folder in Settings first', 3500);
          showTab('settings'); return;
        }
        try {
          var perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') { toast('❌ Folder permission denied', 3000); return; }
          var fileHandle = await handle.getFileHandle(filename, { create: true });
          var writable   = await fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
          toast('📄 Saved: ' + filename, 3000);
        } catch(e) {
          toast('❌ Save failed: ' + (e.message || e), 3500);
        }
      });
    });
  });
}

// ── Wire up all event listeners ────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Nav
  document.querySelectorAll('.nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() { showTab(btn.getAttribute('data-tab')); });
  });

  // Fill tab
  document.getElementById('btnFill').addEventListener('click', doFill);
  document.getElementById('btnLearn').addEventListener('click', doLearn);
  document.getElementById('btnSaveJobPost').addEventListener('click', saveJobPost);

  // Learn modal
  document.getElementById('closeLearn').addEventListener('click', function() {
    document.getElementById('learnModal').style.display = 'none';
  });

  // Q&A tab
  document.getElementById('btnAddQA').addEventListener('click', addQA);

  // Settings — folder
  document.getElementById('btnChooseFolder').addEventListener('click', chooseFolder);

  // Settings — resume
  document.getElementById('btnChooseResume').addEventListener('click', chooseResume);

  // Settings — AI Guess
  document.getElementById('aiGuessToggle').addEventListener('change', function() {
    chrome.storage.local.set({ aiGuessEnabled: this.checked });
    var warning = document.getElementById('aiGuessWarning');
    if (this.checked) {
      chrome.storage.local.get('apiKey', function(s) {
        if (warning) warning.style.display = s.apiKey ? 'none' : 'block';
      });
    } else {
      if (warning) warning.style.display = 'none';
    }
  });

  document.getElementById('btnSaveApiKey').addEventListener('click', function() {
    var val = document.getElementById('apiKeyInput').value.trim();
    if (!val) { toast('⚠️ Enter an API key first', 2500); return; }
    chrome.storage.local.set({ apiKey: val }, function() {
      document.getElementById('apiKeyInput').value = '';
      document.getElementById('apiKeyInput').placeholder = '••••••••••••••••';
      document.getElementById('aiGuessWarning').style.display = 'none';
      toast('✅ API key saved');
    });
  });

  document.getElementById('btnSaveProfile').addEventListener('click', function() {
    var val = document.getElementById('profileContextInput').value.trim();
    chrome.storage.local.set({ profileContext: val }, function() {
      toast('✅ Profile saved');
    });
  });

  // Settings — data
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', function() { document.getElementById('impFile').click(); });
  document.getElementById('impFile').addEventListener('change', importData);
  document.getElementById('btnClear').addEventListener('click', clearAll);

  loadAll();
  detectPlatform();
});
