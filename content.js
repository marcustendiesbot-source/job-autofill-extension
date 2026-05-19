// content.js — Q&A-only fill engine + floating button + job description extractor

// ── Shared label extractor (thorough, handles modern ATS DOM patterns) ──
function _extractLabel(el) {
  var t;

  // 1. label[for="id"]
  if (el.id) {
    try {
      var lfor = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
      if (lfor) { t = lfor.textContent.replace(/[*✱✦]/g, '').trim(); if (t) return t; }
    } catch(e) {}
  }

  // 2. aria-label
  t = el.getAttribute('aria-label'); if (t && (t = t.trim())) return t;

  // 3. aria-labelledby (space-separated list of ids)
  var alby = el.getAttribute('aria-labelledby');
  if (alby) {
    t = alby.split(/\s+/).map(function(id) {
      var e = document.getElementById(id); return e ? e.textContent.trim() : '';
    }).filter(Boolean).join(' ');
    if (t) return t;
  }

  // 4. title attribute
  t = el.getAttribute('title'); if (t && (t = t.trim())) return t;

  // 5. data-label / data-field-label / data-automation-label variants
  t = el.getAttribute('data-label') ||
      el.getAttribute('data-field-label') ||
      el.getAttribute('data-automation-label') ||
      el.getAttribute('data-placeholder');
  if (t && (t = t.trim())) return t;

  // 6. placeholder (last resort for inputs)
  if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();

  // 7. Wrapping <label>
  var wrap = el.closest('label');
  if (wrap) { t = wrap.textContent.replace(/[*✱✦]/g, '').trim(); if (t) return t; }

  // 8. Up to 3 preceding siblings that look like a label
  var sib = el.previousElementSibling;
  for (var s = 0; s < 3 && sib; s++, sib = sib.previousElementSibling) {
    var tag = sib.tagName;
    var cls = (sib.className || '').toLowerCase();
    if (tag === 'LABEL' || tag === 'LEGEND' ||
        /label|title|question|heading|caption/.test(cls)) {
      t = sib.textContent.replace(/[*✱✦]/g, '').trim();
      if (t && t.length > 1 && t.length < 200) return t;
    }
  }

  // 9. Nearest container that has a label-like child
  //    (covers most ATS field wrappers)
  var container = el.closest(
    '[class*="field"],[class*="form-group"],[class*="form-row"],[class*="form-item"],' +
    '[class*="control"],[class*="question"],[class*="input-wrap"],[class*="input-group"],' +
    '[data-field],[data-qa],[data-testid]'
  );
  if (container) {
    var lc = container.querySelector(
      'label,legend,[class*="label"],[class*="title"],[class*="question"],[class*="caption"]'
    );
    if (lc && !lc.contains(el)) {
      t = lc.textContent.replace(/[*✱✦]/g, '').trim();
      if (t && t.length > 1 && t.length < 200) return t;
    }
  }

  // 10. Walk up 5 parent levels, look for a label-like direct sibling of the input's branch
  var branch = el;
  var parent = el.parentElement;
  for (var d = 0; d < 5 && parent; d++, branch = parent, parent = parent.parentElement) {
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c === branch || c.contains(branch)) continue; // skip the branch with our input
      var ctag = c.tagName, ccls = (c.className || '').toLowerCase();
      if (ctag === 'LABEL' || ctag === 'LEGEND' ||
          /label|title|question|heading/.test(ccls)) {
        t = c.textContent.replace(/[*✱✦]/g, '').trim();
        if (t && t.length > 1 && t.length < 200) return t;
      }
      // Table-layout forms (e.g. Avature/RBC): label text lives in an adjacent <td>/<th>
      if ((ctag === 'TD' || ctag === 'TH') && !c.querySelector('input,textarea,select,button,[contenteditable]')) {
        t = c.textContent.replace(/[*✱✦]/g, '').trim();
        if (t && t.length > 1 && t.length < 200) return t;
      }
      // Short-text inline elements adjacent to a field are almost always its label
      // (catches e.g. <a>Terms and Conditions</a> next to a consent checkbox)
      if (ctag === 'A' || ctag === 'SPAN' || ctag === 'P' || ctag === 'STRONG') {
        if (!c.querySelector('input,textarea,select,button')) {
          t = c.textContent.replace(/[*✱✦]/g, '').trim();
          if (t && t.length > 1 && t.length < 80) return t;
        }
      }
    }
  }

  // 11. name / id as last resort (humanise it)
  return (el.name || el.id || '').replace(/[-_\[\].]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lowercase version used by the fill engine
function _lbl(el) { return _extractLabel(el).toLowerCase(); }

// Word tokenizer: splits on whitespace, slashes, and parentheses; strips leading/trailing non-alphanumeric.
// Handles "veteran/military" → ["veteran","military"], "(first" → ["first"], "location(s)" → ["location","s"],
// "member(s)" → ["member","s"], "nations," → ["nations"].
function _wt(text) {
  return text.split(/[\s\/\(\)]+/).map(function(w) { return w.replace(/^\W+|\W+$/g, ''); }).filter(Boolean);
}

// Option synonym normalizer — maps common word variants to a canonical form so the
// fill engine treats equivalent answers as identical regardless of which platform's
// wording is stored vs shown. Apply to both the stored answer and the page option
// before comparing: _normOpt(stored) === _normOpt(option) → match.
var _OPT_NORMS = {
  // Gender identity
  'man': 'male', 'male': 'male', 'men': 'male',
  'woman': 'female', 'female': 'female', 'women': 'female',
  // Decline / prefer-not-to-say variants (EEO, self-ID questions)
  'prefer not to say': 'decline',
  'prefer not to answer': 'decline',
  'prefer not to disclose': 'decline',
  'i do not wish to self-identify': 'decline',
  'do not wish to self-identify': 'decline',
  'i prefer not to self-identify': 'decline',
  'decline to state': 'decline',
  'choose not to disclose': 'decline',
  'i choose not to answer': 'decline',
  'i decline to self-identify': 'decline'
};
function _normOpt(s) { return _OPT_NORMS[s] || s; }

// ── Module-level state for AI fill pass ───────────────────────────
var __autofill_unfilled__  = [];    // fields not filled by Q&A pass; holds DOM refs
var __autofill_ai_filled__ = [];    // fields filled by AI pass; holds {el, label, answer}
// NOTE: window.__autofill_resume_uploaded__ is intentionally on window (not var)
// so it persists across message handler calls within the same tab session.
// Set to true after a successful resume upload; prevents duplicate uploads on
// subsequent fill passes on later pages of the same application.

// ── Find the group-level question label for a set of radio inputs ─────
// Looks up the DOM past individual option labels to find the question text.
function _findRadioGroupLabel(radios) {
  var first = radios[0];

  // aria-labelledby on any radio in the group
  for (var i = 0; i < radios.length; i++) {
    var alby = radios[i].getAttribute('aria-labelledby');
    if (alby) {
      var le = document.getElementById(alby);
      if (le) { var t = le.textContent.replace(/[*✱✦]/g, '').trim(); if (t) return t; }
    }
  }

  // Find lowest common ancestor that contains all radios
  var parent = first.parentElement;
  while (parent && parent !== document.body) {
    var all = true;
    for (var j = 0; j < radios.length; j++) {
      if (!parent.contains(radios[j])) { all = false; break; }
    }
    if (all) break;
    parent = parent.parentElement;
  }
  if (!parent || parent === document.body) return _extractLabel(first);

  // Find a label-like child of the common parent that does NOT contain any radio input
  var kids = parent.querySelectorAll(
    'label,legend,p,[class*="label"],[class*="title"],[class*="question"],[class*="heading"],h1,h2,h3,h4,h5,h6'
  );
  for (var k = 0; k < kids.length; k++) {
    var c = kids[k];
    if (c.querySelector('input[type=radio],input[type=checkbox]')) continue;
    var ct = c.textContent.replace(/[*✱✦]/g, '').trim();
    if (ct && ct.length > 2 && ct.length < 200) return ct;
  }

  // Walk up siblings of the common parent
  var branch = parent, up = parent.parentElement;
  for (var d = 0; d < 4 && up; d++, branch = up, up = up.parentElement) {
    for (var sib = up.firstElementChild; sib; sib = sib.nextElementSibling) {
      if (sib === branch || sib.contains(branch)) continue;
      var stag = sib.tagName, scls = (sib.className || '').toLowerCase();
      if (stag === 'LABEL' || stag === 'LEGEND' ||
          /label|title|question|heading/.test(scls) || /^H[1-6]$/.test(stag)) {
        var st = sib.textContent.replace(/[*✱✦]/g, '').trim();
        if (st && st.length > 2 && st.length < 200) return st;
      }
    }
  }

  return _extractLabel(first);
}

// ── Set value with React/Vue event dispatch ───────────────────────
function _setV(el, val) {
  if (!el || (!val && val !== '')) return false;
  try {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, val); else el.value = val;
    ['input', 'change', 'blur'].forEach(function(ev) { el.dispatchEvent(new Event(ev, {bubbles: true})); });
    el.style.boxShadow = '0 0 0 2px rgba(74,255,180,0.5)';
    setTimeout(function() { el.style.boxShadow = ''; }, 2000);
    return true;
  } catch(e) { return false; }
}

// ── Smart select matching ─────────────────────────────────────────
function _setS(el, val) {
  if (!el || !val) return false;
  var opts = Array.from(el.options);
  var vl = val.toLowerCase();
  var vlNorm = _normOpt(vl);
  var optTexts = opts.map(function(o) { return o.text; });
  // Exact / synonym match first, then starts-with — avoids "female".includes("male") false hit.
  var m = opts.find(function(o) {
    var t = o.text.toLowerCase();
    return t === vl || o.value.toLowerCase() === vl || _normOpt(t) === vlNorm;
  });
  if (!m) {
    m = opts.find(function(o) {
      var t = o.text.toLowerCase();
      return t.startsWith(vl) || vl.startsWith(t);
    });
  }
  if (m) {
    console.log('[AutoFill _setS HIT] answer="' + val + '" matched option="' + m.text + '"');
    el.value = m.value; el.dispatchEvent(new Event('change', {bubbles: true})); return true;
  }
  // Dice word-overlap fallback — handles cross-platform option wording differences,
  // e.g. "Master's Degree" matching Workday "(Master's Degree (±18 years))" or RBC "Master Degree".
  // Threshold > 0.5 prevents loose word matches (e.g. "career" alone won't score > 0.5).
  var ansWords = vl.replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
  var diceWinner = null, diceScore = 0;
  if (ansWords.length) {
    opts.forEach(function(o) {
      var optWords = o.text.toLowerCase().replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
      if (!optWords.length) return;
      var inter = ansWords.filter(function(w) { return optWords.indexOf(w) >= 0; }).length;
      var score = (2 * inter) / (ansWords.length + optWords.length);
      if (score > diceScore) { diceScore = score; diceWinner = o; }
    });
  }
  if (diceWinner && diceScore > 0.5) {
    console.log('[AutoFill _setS DICE] answer="' + val + '" matched option="' + diceWinner.text + '" score=' + diceScore.toFixed(2));
    el.value = diceWinner.value; el.dispatchEvent(new Event('change', {bubbles: true})); return true;
  }
  console.log('[AutoFill _setS MISS] answer="' + val + '" — options were: [' + optTexts.join(' | ') + ']');
  return false;
}

// ── Module-level Q&A matching (used by fill engine and AI pass) ───
// matchQA: Dice coefficient matching with word-boundary gate, ? truncation,
// short-Q fallback, stop-word guard, numeric guard, NEARMISS logging.
// lbl can be any case — lowercased internally.
function matchQA(lbl, customQA) {
  lbl = lbl.toLowerCase();
  var STOP = {what:1,your:1,are:1,is:1,do:1,you:1,the:1,have:1,been:1,
              will:1,can:1,for:1,any:1,this:1,that:1,with:1,from:1,
              has:1,was:1,were:1,not:1,but:1,and:1,our:1,did:1,ever:1};
  var lblw = _wt(lbl).filter(function(w) { return w.length > 3 || /^\d+$/.test(w); });
  var qmarkIdx = lbl.indexOf('?');
  var lblShort = qmarkIdx >= 0 ? lbl.substring(0, qmarkIdx) : lbl;
  var lblContent = _wt(lblShort)
    .filter(function(w) { return w.length > 3 || /^\d+$/.test(w); })
    .filter(function(w) { return !STOP[w]; });
  var best = null, bestScore = -1;

  customQA.forEach(function(qa) {
    var qLower = qa.q.toLowerCase();
    var qi2 = qLower.indexOf('?');
    var qShortForGate = qi2 >= 0 ? qLower.substring(0, qi2) : qLower;
    var qw = _wt(qShortForGate).filter(function(w) { return w.length > 3 || /^\d+$/.test(w); });
    if (!qw.length) {
      var shortQ = qShortForGate.trim();
      if (shortQ) {
        var idx = lbl.indexOf(shortQ);
        while (idx >= 0) {
          var before = idx === 0 || /\W/.test(lbl[idx - 1]);
          var after  = idx + shortQ.length >= lbl.length || /\W/.test(lbl[idx + shortQ.length]);
          if (before && after && 1 > bestScore) { bestScore = 1; best = qa; break; }
          idx = lbl.indexOf(shortQ, idx + 1);
        }
      }
      return;
    }
    // Forward gate: >40% of Q words must appear in full label starting at a word boundary.
    var fwdMatch = qw.filter(function(w) {
      var idx = lbl.indexOf(w);
      while (idx >= 0) {
        if (idx === 0 || /\W/.test(lbl[idx - 1])) return true;
        idx = lbl.indexOf(w, idx + 1);
      }
      return false;
    }).length;
    if (fwdMatch === 0 || fwdMatch / qw.length <= 0.4) return;
    // Numeric check: if both sides have number tokens they must overlap
    var qNums  = qw.filter(function(w) { return /^\d+$/.test(w); });
    var lblNums = lblw.filter(function(w) { return /^\d+$/.test(w); });
    if (qNums.length && lblNums.length &&
        !qNums.some(function(n) { return lblNums.indexOf(n) >= 0; })) return;
    // Dice coefficient on truncated Q vs truncated label
    var qContent = _wt(qShortForGate).filter(function(w) { return (w.length > 3 || /^\d+$/.test(w)) && !STOP[w]; });
    var score;
    if (qContent.length && lblContent.length) {
      // Prefix-aware intersection: "veteran" matches "veterans", "child" matches "children".
      var inter = qContent.filter(function(w) {
        return lblContent.some(function(lw) {
          return lw === w ||
            (lw.length > w.length && lw.startsWith(w)) ||
            (w.length > lw.length && w.startsWith(lw));
        });
      }).length;
      score = (2 * inter) / (qContent.length + lblContent.length);
    } else if (!qContent.length && lblContent.length) {
      score = 0;
    } else {
      score = fwdMatch / qw.length;
    }
    if (score > bestScore) { bestScore = score; best = qa; }
  });

  if (bestScore <= 0.5 && best) {
    console.log('[AutoFill matchQA NEARMISS] label="' + lbl.substring(0,60) + '" bestScore=' + bestScore.toFixed(3) + ' nearQ="' + best.q.substring(0,60) + '"');
  }
  return bestScore > 0.5 ? best : null;
}

// isKnown: matchQA + reverse gate. Used by scanUnknownFields to hide already-known fields.
// Returns boolean.
function isKnown(lbl, customQA) {
  var customKeys = (customQA || []).map(function(qa) { return qa.q.toLowerCase(); });
  var lower = lbl.toLowerCase();
  var STOP = {what:1,your:1,are:1,is:1,do:1,you:1,the:1,have:1,been:1,
              will:1,can:1,for:1,any:1,this:1,that:1,with:1,from:1,
              has:1,was:1,were:1,not:1,but:1,and:1,our:1,did:1,ever:1};
  var lblw = _wt(lower).filter(function(w) { return w.length > 3 || /^\d+$/.test(w); });
  var qmarkIdx = lower.indexOf('?');
  var lblShort = qmarkIdx >= 0 ? lower.substring(0, qmarkIdx) : lower;
  var lblContent = _wt(lblShort)
    .filter(function(w) { return w.length > 3 || /^\d+$/.test(w); })
    .filter(function(w) { return !STOP[w]; });
  var bestScore = -1, bestKey = null;

  customKeys.forEach(function(k) {
    var qw = _wt(k).filter(function(w) { return w.length > 3 || /^\d+$/.test(w); });
    if (!qw.length) {
      var idx2 = lower.indexOf(k);
      while (idx2 >= 0) {
        var before2 = idx2 === 0 || /\W/.test(lower[idx2 - 1]);
        var after2  = idx2 + k.length >= lower.length || /\W/.test(lower[idx2 + k.length]);
        if (before2 && after2) { bestScore = 1; bestKey = k; break; }
        idx2 = lower.indexOf(k, idx2 + 1);
      }
      return;
    }
    // Forward gate
    var fwdMatch = qw.filter(function(w) {
      var idx = lower.indexOf(w);
      while (idx >= 0) {
        if (idx === 0 || /\W/.test(lower[idx - 1])) return true;
        idx = lower.indexOf(w, idx + 1);
      }
      return false;
    }).length;
    var fwdOk = fwdMatch > 0 && fwdMatch / qw.length > 0.4;
    // Reverse gate: >40% of label words appear in Q — handles short labels like "Email"
    // against verbose stored Q "What is your email address?"
    var revMatch = lblw.filter(function(w) {
      var idx = k.indexOf(w);
      while (idx >= 0) {
        if (idx === 0 || /\W/.test(k[idx - 1])) return true;
        idx = k.indexOf(w, idx + 1);
      }
      return false;
    }).length;
    var revOk = lblw.length > 0 && revMatch > 0 && revMatch / lblw.length > 0.4;
    if (!fwdOk && !revOk) return;
    var qNums  = qw.filter(function(w) { return /^\d+$/.test(w); });
    var lblNums = lblw.filter(function(w) { return /^\d+$/.test(w); });
    if (qNums.length && lblNums.length &&
        !qNums.some(function(n) { return lblNums.indexOf(n) >= 0; })) return;
    var qi2 = k.indexOf('?');
    var qShort = qi2 >= 0 ? k.substring(0, qi2) : k;
    var qContent = _wt(qShort).filter(function(w) { return (w.length > 3 || /^\d+$/.test(w)) && !STOP[w]; });
    var score;
    if (qContent.length && lblContent.length) {
      var inter = qContent.filter(function(w) {
        return lblContent.some(function(lw) {
          return lw === w ||
            (lw.length > w.length && lw.startsWith(w)) ||
            (w.length > lw.length && w.startsWith(lw));
        });
      }).length;
      score = (2 * inter) / (qContent.length + lblContent.length);
    } else if (!qContent.length && lblContent.length) {
      score = 0;
    } else {
      score = fwdMatch > 0 ? fwdMatch / qw.length : revMatch / lblw.length;
    }
    if (score > bestScore) { bestScore = score; bestKey = k; }
  });

  var known = bestScore > 0.5;
  if (!known) {
    console.log('[AutoFill isKnown MISS] label="' + lbl + '" bestScore=' + bestScore.toFixed(3) +
      ' lblContent=[' + lblContent.join(',') + '] lblw=[' + lblw.join(',') + ']');
    customKeys.forEach(function(k) {
      var qw = _wt(k).filter(function(w) { return w.length > 3 || /^\d+$/.test(w); });
      if (!qw.length) return;
      var fwdMatch = qw.filter(function(w) { return lower.indexOf(w) >= 0; }).length;
      var revMatch = lblw.filter(function(w) { return k.indexOf(w) >= 0; }).length;
      var fwdOk = fwdMatch > 0 && fwdMatch / qw.length > 0.4;
      var revOk = lblw.length > 0 && revMatch > 0 && revMatch / lblw.length > 0.4;
      if (!fwdOk && !revOk) return;
      var qi2 = k.indexOf('?');
      var qShort = qi2 >= 0 ? k.substring(0, qi2) : k;
      var qContent = _wt(qShort).filter(function(w) { return (w.length > 3 || /^\d+$/.test(w)) && !STOP[w]; });
      var score;
      if (qContent.length && lblContent.length) {
        var inter = qContent.filter(function(w) { return lblContent.indexOf(w) >= 0; }).length;
        score = (2 * inter) / (qContent.length + lblContent.length);
      } else {
        score = fwdMatch > 0 ? fwdMatch / qw.length : revMatch / lblw.length;
      }
      if (score > 0) {
        console.log('  candidate q="' + k.substring(0,60) + '" fwd=' + (fwdMatch/qw.length).toFixed(2) +
          ' rev=' + (revMatch/(lblw.length||1)).toFixed(2) + ' dice=' + score.toFixed(3));
      }
    });
  } else {
    console.log('[AutoFill isKnown HIT] label="' + lbl + '" score=' + bestScore.toFixed(3) + ' matchedQ="' + bestKey + '"');
  }
  return known;
}

// ── Q&A-only fill engine ──────────────────────────────────────────
// Uses callback(count, done) because Workday combobox filling is async.
// done is a Set of filled DOM elements — passed to collectUnfilledFields.
function runFill(data, callback) {
  var count = 0;
  var done = new Set();

  if (!data.customQA || !data.customQA.length) { callback(0, done); return; }

  // ── 1. Standard inputs / textareas / selects (radios handled below) ──
  // Skips Workday-style hidden UUID inputs: no id, no name, button[aria-haspopup] in same container.
  Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file])' +
    ':not([type=radio]):not([type=checkbox]):not(.rcmpaginatedselectinput),textarea,select'
  )).forEach(function(el) {
    if (done.has(el)) return;
    if (el.tagName === 'INPUT' && !el.id && !el.name) {
      var ff = el.closest('[data-automation-id^="formField"]');
      if (ff && ff.querySelector('button[aria-haspopup]')) return;
    }
    var lbl = _lbl(el); if (!lbl) return;
    var qa = matchQA(lbl, data.customQA);
    if (el.tagName === 'SELECT') {
      console.log('[AutoFill SELECT] label="' + lbl + '" matchedQ=' + (qa ? '"' + qa.q + '" → answer="' + qa.a + '"' : 'NONE'));
    }
    if (qa) {
      var ok = el.tagName === 'SELECT' ? _setS(el, qa.a) : _setV(el, qa.a);
      if (ok) { count++; done.add(el); }
    }
  });

  // ── 2. Radio groups — group by name, find group label, click match ──
  var radioByName = {};
  Array.from(document.querySelectorAll('input[type=radio]')).forEach(function(r) {
    var key = r.name || ('__' + r.id);
    if (!radioByName[key]) radioByName[key] = [];
    radioByName[key].push(r);
  });

  Object.keys(radioByName).forEach(function(name) {
    var radios = radioByName[name];
    var groupLbl = '';

    var group = radios[0].closest('fieldset,[role="radiogroup"],[role="group"]');
    if (group) {
      var legend = group.querySelector('legend');
      if (legend) groupLbl = legend.textContent.replace(/[*✱✦]/g, '').trim();
      if (!groupLbl) { var al = group.getAttribute('aria-label'); if (al) groupLbl = al.trim(); }
      if (!groupLbl) {
        var alby = group.getAttribute('aria-labelledby');
        if (alby) { var le = document.getElementById(alby); if (le) groupLbl = le.textContent.trim(); }
      }
    }
    if (!groupLbl) groupLbl = _findRadioGroupLabel(radios);
    if (!groupLbl) return;

    var qa = matchQA(groupLbl.toLowerCase(), data.customQA);
    console.log('[AutoFill RADIO] groupLbl="' + groupLbl + '" matchedQ=' + (qa ? '"' + qa.q + '" → answer="' + qa.a + '"' : 'NONE'));
    if (!qa) return;

    var ansLower = qa.a.toLowerCase().trim();
    var radioOptLbls = [];
    var matched = false;
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      var optLbl = '';
      if (r.id) {
        try {
          var lf = document.querySelector('label[for="' + r.id.replace(/"/g, '\\"') + '"]');
          if (lf) optLbl = lf.textContent.replace(/[*✱✦]/g, '').trim().toLowerCase();
        } catch(e) {}
      }
      if (!optLbl) { var wp = r.closest('label'); if (wp) optLbl = wp.textContent.replace(/[*✱✦]/g, '').trim().toLowerCase(); }
      if (!optLbl) optLbl = (r.value || '').toLowerCase();
      radioOptLbls.push(optLbl);
      if (optLbl && (optLbl === ansLower || optLbl.startsWith(ansLower) || ansLower.startsWith(optLbl))) {
        matched = true;
        if (!r.checked) {
          r.checked = true;
          ['click', 'change'].forEach(function(ev) { r.dispatchEvent(new Event(ev, {bubbles: true})); });
          r.style.outline = '2px solid rgba(74,255,180,0.8)';
          setTimeout(function() { r.style.outline = ''; }, 2000);
          count++;
        }
        console.log('[AutoFill RADIO HIT] answer="' + qa.a + '" matched option="' + optLbl + '"');
        break;
      }
    }
    if (!matched) {
      console.log('[AutoFill RADIO MISS] answer="' + qa.a + '" — options were: [' + radioOptLbls.join(' | ') + ']');
    }
  });

  // ── 3. Contenteditable / role=textbox ─────────────────────────────
  Array.from(document.querySelectorAll(
    '[contenteditable="true"],[role="textbox"],[role="combobox"],[role="spinbutton"]'
  )).forEach(function(el) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (done.has(el)) return;
    var lbl = _lbl(el); if (!lbl) return;
    var qa = matchQA(lbl, data.customQA);
    if (qa) {
      try {
        el.focus();
        el.textContent = qa.a;
        ['input', 'change', 'blur'].forEach(function(ev) { el.dispatchEvent(new Event(ev, {bubbles: true})); });
        el.style.boxShadow = '0 0 0 2px rgba(74,255,180,0.5)';
        setTimeout(function() { el.style.boxShadow = ''; }, 2000);
        done.add(el);
        count++;
      } catch(e) {}
    }
  });

  // ── 4. Workday-style combobox dropdowns ────────────────────────────
  var comboFFs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]')).filter(function(ff) {
    return !!ff.querySelector('button[aria-haspopup="listbox"]');
  });

  var ci = 0;
  function fillNextCombo() {
    if (ci >= comboFFs.length) { fillNextSAP(); return; }
    var ff = comboFFs[ci++];
    var labelEl = ff.querySelector('label') || ff.querySelector('legend');
    if (!labelEl) { console.log('[AutoFill COMBO] no label el — skipping'); fillNextCombo(); return; }
    var lbl = labelEl.textContent.replace(/[*✱✦]/g, '').trim().toLowerCase();
    var qa = matchQA(lbl, data.customQA);
    console.log('[AutoFill COMBO] label="' + lbl.substring(0,60) + '" matchedQ=' + (qa ? '"' + qa.q.substring(0,40) + '" → "' + qa.a + '"' : 'NONE'));
    if (!qa) { fillNextCombo(); return; }
    // Skip if already filled (hidden input has a UUID value)
    var hiddenInp = ff.querySelector('input');
    if (hiddenInp && hiddenInp.value) { console.log('[AutoFill COMBO] already filled — skipping'); fillNextCombo(); return; }

    var btn = ff.querySelector('button[aria-haspopup="listbox"]');
    btn.click();
    setTimeout(function() {
      var ansLower = qa.a.toLowerCase().trim();
      var listboxId = btn.getAttribute('aria-controls');
      var listboxEl = listboxId ? document.getElementById(listboxId) : null;
      if (!listboxEl) {
        var allLbs = document.querySelectorAll('[role="listbox"]');
        for (var li = 0; li < allLbs.length; li++) {
          var lbStyle = window.getComputedStyle(allLbs[li]);
          if (lbStyle.display !== 'none' && lbStyle.visibility !== 'hidden' && lbStyle.opacity !== '0') {
            listboxEl = allLbs[li]; break;
          }
        }
      }
      var options = listboxEl ? Array.from(listboxEl.querySelectorAll('[role=option]')) : [];
      var matched = false;
      var exactOpt = null, partialOpt = null, diceOpt = null, diceOptScore = 0;
      var ansNorm = _normOpt(ansLower);
      var ansWords = ansLower.replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
      for (var j = 0; j < options.length; j++) {
        var optText = options[j].textContent.trim().toLowerCase();
        if (optText === ansLower || _normOpt(optText) === ansNorm) { exactOpt = options[j]; break; }
        if (!partialOpt && (optText.startsWith(ansLower) || ansLower.startsWith(optText))) {
          partialOpt = options[j];
        }
        if (ansWords.length) {
          var optWords = optText.replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
          if (optWords.length) {
            var inter = ansWords.filter(function(w) { return optWords.indexOf(w) >= 0; }).length;
            var score = (2 * inter) / (ansWords.length + optWords.length);
            if (score > diceOptScore) { diceOptScore = score; diceOpt = options[j]; }
          }
        }
      }
      var winner = exactOpt || partialOpt || (diceOptScore > 0.5 ? diceOpt : null);
      if (winner) {
        console.log('[AutoFill COMBO HIT] answer="' + qa.a + '" matched option="' + winner.textContent.trim() + '"');
        winner.click(); count++; matched = true;
      } else {
        console.log('[AutoFill COMBO MISS] answer="' + qa.a + '" — options were: [' + options.map(function(o){return o.textContent.trim();}).join(' | ') + ']');
      }
      if (!matched) {
        ['mousedown','mouseup','click'].forEach(function(ev) {
          document.body.dispatchEvent(new MouseEvent(ev, {bubbles: true, cancelable: true}));
        });
      }
      setTimeout(fillNextCombo, 200);
    }, 300);
  }

  // ── 5. SAP SuccessFactors rcmpaginatedselect dropdowns ──────────────
  var sapInps = Array.from(document.querySelectorAll('input.rcmpaginatedselectinput')).filter(function(inp) {
    if (!inp.id) return false;
    if (inp.value && inp.value.trim()) return false;
    return !!document.getElementById(inp.id.replace('_input', '_selectButton'));
  });

  var si = 0;
  function fillNextSAP() {
    if (si >= sapInps.length) { callback(count, done); return; }
    var inp = sapInps[si++];
    var lbl = _lbl(inp); if (!lbl) { fillNextSAP(); return; }
    var qa = matchQA(lbl, data.customQA);
    console.log('[AutoFill SAP] label="' + lbl + '" matchedQ=' + (qa ? '"' + qa.q + '" → "' + qa.a + '"' : 'NONE'));
    if (!qa || qa.a === '') { fillNextSAP(); return; }

    var btn = document.getElementById(inp.id.replace('_input', '_selectButton'));
    if (!btn) { fillNextSAP(); return; }
    btn.click();
    setTimeout(function() {
      var ansLower = qa.a.toLowerCase().trim();
      var options = Array.from(document.querySelectorAll('[role="option"]'));
      var exactOpt = null, partialOpt = null, diceOpt = null, diceOptScore = 0;
      var ansNorm = _normOpt(ansLower);
      var ansWords = ansLower.replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
      for (var j = 0; j < options.length; j++) {
        var optText = options[j].textContent.trim().toLowerCase();
        if (optText === ansLower || _normOpt(optText) === ansNorm) { exactOpt = options[j]; break; }
        if (!partialOpt && (optText.startsWith(ansLower) || ansLower.startsWith(optText))) {
          partialOpt = options[j];
        }
        if (ansWords.length) {
          var optWords = optText.replace(/['']/g, '').split(/\W+/).filter(function(w) { return w.length > 2; });
          if (optWords.length) {
            var inter = ansWords.filter(function(w) { return optWords.indexOf(w) >= 0; }).length;
            var score = (2 * inter) / (ansWords.length + optWords.length);
            if (score > diceOptScore) { diceOptScore = score; diceOpt = options[j]; }
          }
        }
      }
      var winner = exactOpt || partialOpt || (diceOptScore > 0.5 ? diceOpt : null);
      if (winner) {
        winner.click();
        count++;
        console.log('[AutoFill SAP HIT] label="' + lbl + '" answer="' + qa.a + '" matched="' + winner.textContent.trim() + '"');
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
        console.log('[AutoFill SAP MISS] label="' + lbl + '" answer="' + qa.a + '"');
      }
      setTimeout(fillNextSAP, 200);
    }, 200);
  }

  if (comboFFs.length > 0) {
    fillNextCombo();
  } else {
    fillNextSAP();
  }
}

// ── Scan for unknown fields (Learn This Page) ─────────────────────
function scanUnknownFields(customQA, callback) {
  function cleanLabel(el) {
    return _extractLabel(el).replace(/\s+/g, ' ').trim();
  }

  var unfilled = [], seen = new Set();

  function push(lbl, type, opts) {
    if (!lbl || lbl.length < 2) return;
    var key = lbl.toLowerCase().trim();
    if (seen.has(key) || isKnown(key, customQA)) return;
    seen.add(key);
    unfilled.push({label: lbl, type: type, options: opts || []});
  }

  // ── 1. Standard inputs, textareas, selects ──────────────────────
  Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button])' +
    ':not([type=file]):not([type=checkbox]):not([type=radio]),' +
    'textarea, select'
  )).forEach(function(el) {
    if (el.tagName === 'INPUT' && !el.id && !el.name) {
      var ff = el.closest('[data-automation-id^="formField"]');
      if (ff && ff.querySelector('button[aria-haspopup]')) return;
    }
    var lbl = cleanLabel(el);
    var type = el.tagName === 'INPUT' ? (el.type || 'text') : el.tagName.toLowerCase();
    var opts = el.tagName === 'SELECT'
      ? Array.from(el.options).map(function(o) { return o.text.trim(); })
          .filter(function(t) { return t && !/^(select|choose|--|please select)/i.test(t); })
      : [];
    push(lbl, type, opts);
  });

  // ── 2. Radio / checkbox groups (fieldset + legend, role=radiogroup) ──
  Array.from(document.querySelectorAll(
    'fieldset, [role="radiogroup"], [role="group"]'
  )).forEach(function(group) {
    var radios = group.querySelectorAll('input[type=radio],input[type=checkbox]');
    if (!radios.length) return;

    var lbl = '';
    var legend = group.querySelector('legend');
    if (legend) lbl = legend.textContent.replace(/[*✱✦]/g, '').trim();
    if (!lbl) {
      var al = group.getAttribute('aria-label'); if (al) lbl = al.trim();
    }
    if (!lbl) {
      var alby = group.getAttribute('aria-labelledby');
      if (alby) { var le = document.getElementById(alby); if (le) lbl = le.textContent.trim(); }
    }
    if (!lbl) {
      var p = group.parentElement;
      if (p) {
        var lc = p.querySelector('label,legend,[class*="label"],[class*="title"],[class*="question"]');
        if (lc && !lc.contains(group)) lbl = lc.textContent.replace(/[*✱✦]/g, '').trim();
      }
    }

    var opts = Array.from(radios).map(function(r) {
      if (r.id) {
        try {
          var l = document.querySelector('label[for="' + r.id.replace(/"/g, '\\"') + '"]');
          if (l) return l.textContent.trim();
        } catch(e) {}
      }
      var wp = r.closest('label'); if (wp) return wp.textContent.trim();
      var sib = r.nextSibling;
      while (sib) {
        if (sib.nodeType === 3 && sib.textContent.trim()) return sib.textContent.trim();
        if (sib.nodeType === 1) return sib.textContent.trim();
        sib = sib.nextSibling;
      }
      return r.value || '';
    }).map(function(t) { return t.replace(/[*✱✦]/g, '').trim(); }).filter(Boolean);

    push(lbl, 'radio', opts);
  });

  // ── 3. Standalone radio groups (not in fieldset / role=radiogroup) ──
  var radioGroupsByName = {};
  Array.from(document.querySelectorAll('input[type=radio]')).forEach(function(r) {
    if (r.closest('fieldset,[role="radiogroup"],[role="group"]')) return;
    var key = r.name || ('__nk_' + r.id);
    if (!radioGroupsByName[key]) radioGroupsByName[key] = [];
    radioGroupsByName[key].push(r);
  });
  Object.keys(radioGroupsByName).forEach(function(name) {
    var radios = radioGroupsByName[name];
    var lbl = _findRadioGroupLabel(radios);
    var opts = radios.map(function(r) {
      if (r.id) {
        try {
          var l = document.querySelector('label[for="' + r.id.replace(/"/g, '\\"') + '"]');
          if (l) return l.textContent.replace(/[*✱✦]/g, '').trim();
        } catch(e) {}
      }
      var wp = r.closest('label'); if (wp) return wp.textContent.replace(/[*✱✦]/g, '').trim();
      var sib = r.nextSibling;
      while (sib) {
        if (sib.nodeType === 3 && sib.textContent.trim()) return sib.textContent.trim();
        if (sib.nodeType === 1) return sib.textContent.trim();
        sib = sib.nextSibling;
      }
      return r.value || '';
    }).map(function(t) { return t.replace(/[*✱✦]/g, '').trim(); }).filter(Boolean);
    push(lbl, 'radio', opts);
  });

  // ── 4. Standalone checkboxes (not in groups) ─────────────────────
  Array.from(document.querySelectorAll('input[type=checkbox]')).forEach(function(el) {
    if (el.closest('fieldset,[role="radiogroup"],[role="group"]')) return;
    var lbl = cleanLabel(el);
    push(lbl, 'checkbox', []);
  });

  // ── 5. contenteditable / role=textbox / role=combobox ───────────
  Array.from(document.querySelectorAll(
    '[contenteditable="true"],[role="textbox"],[role="combobox"],[role="spinbutton"]'
  )).forEach(function(el) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    var lbl = cleanLabel(el);
    push(lbl, 'text', []);
  });

  // ── 6. Workday-style combobox dropdowns (async — opens each sequentially) ──
  var comboFFs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]')).filter(function(ff) {
    return !!ff.querySelector('button[aria-haspopup="listbox"]');
  });

  // Close any dropdowns left open before scanning.
  ['mousedown','mouseup','click'].forEach(function(ev) {
    document.body.dispatchEvent(new MouseEvent(ev, {bubbles: true, cancelable: true}));
  });

  var ci = 0;
  function scanNextCombo() {
    if (ci >= comboFFs.length) { callback(unfilled); return; }
    var ff = comboFFs[ci++];
    var btn = ff.querySelector('button[aria-haspopup="listbox"]');
    if (!btn) { scanNextCombo(); return; }
    var labelEl = ff.querySelector('label') || ff.querySelector('legend');
    if (!labelEl) { scanNextCombo(); return; }
    var lbl = labelEl.textContent.replace(/[*✱✦]/g, '').trim();
    if (!lbl) { scanNextCombo(); return; }

    btn.click();
    setTimeout(function() {
      var listboxId = btn.getAttribute('aria-controls');
      var listboxEl = listboxId ? document.getElementById(listboxId) : null;
      if (!listboxEl) {
        var allLbs = document.querySelectorAll('[role="listbox"]');
        for (var li = 0; li < allLbs.length; li++) {
          var lbStyle = window.getComputedStyle(allLbs[li]);
          if (lbStyle.display !== 'none' && lbStyle.visibility !== 'hidden' && lbStyle.opacity !== '0') {
            listboxEl = allLbs[li]; break;
          }
        }
      }
      var opts = [];
      if (listboxEl) {
        opts = Array.from(listboxEl.querySelectorAll('[role=option]'))
          .map(function(o) { return o.textContent.trim(); })
          .filter(function(t) { return t && !/^(Select One|--|please select)/i.test(t); });
      }
      ['mousedown','mouseup','click'].forEach(function(ev) {
        document.body.dispatchEvent(new MouseEvent(ev, {bubbles: true, cancelable: true}));
      });
      push(lbl, 'select', opts);
      setTimeout(scanNextCombo, 150);
    }, 150);
  }

  if (comboFFs.length > 0) {
    scanNextCombo();
  } else {
    callback(unfilled);
  }
}

// ── Job description extractor ─────────────────────────────────────
function getJobDescription() {
  var h1 = document.querySelector('h1');
  var title = h1 ? h1.textContent.trim() : document.title;
  title = title.replace(/\s*[\|\-–—]\s*[^|\-–—]+$/, '').trim() || document.title;

  var ATS_BLOCKLIST = [
    'dayforce', 'workday', 'greenhouse', 'lever', 'icims', 'bamboohr',
    'taleo', 'jobvite', 'smartrecruiters', 'ashby', 'linkedin', 'indeed',
    'glassdoor', 'workable', 'rippling', 'successfactors', 'breezy',
    'recruitee', 'pinpoint', 'teamtailor', 'jazz', 'avature', 'oracle',
    'sap', 'cornerstone', 'myworkday', 'dayforcehcm'
  ];
  function _isATS(s) {
    var sl = (s || '').toLowerCase();
    return ATS_BLOCKLIST.some(function(n) { return sl.indexOf(n) >= 0; });
  }

  var company = '';

  // 1. Next.js __NEXT_DATA__ — Dayforce and other Next.js job portals
  var nextDataEl = document.querySelector('script#__NEXT_DATA__');
  if (nextDataEl) {
    try {
      var ndText = nextDataEl.textContent;
      var ndm = ndText.match(/"candidateCorrespondenceClientName"\s*:\s*"([^"]{2,80})"/);
      if (ndm && !_isATS(ndm[1])) company = ndm[1];
      if (!company) {
        var ndm2 = ndText.match(/"(?:clientName|employerName|orgName|companyName|organizationName)"\s*:\s*"([^"]{2,80})"/);
        if (ndm2 && !_isATS(ndm2[1])) company = ndm2[1];
      }
    } catch(e) {}
  }

  // 2. JSON-LD hiringOrganization
  if (!company) {
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var li = 0; li < ldScripts.length && !company; li++) {
      try {
        var ld = JSON.parse(ldScripts[li].textContent);
        if (ld.hiringOrganization && ld.hiringOrganization.name) {
          var ldName = ld.hiringOrganization.name.trim();
          if (!_isATS(ldName)) company = ldName;
        }
      } catch(e) {}
    }
  }

  // 3. og:site_name
  if (!company) {
    var ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite) {
      var ogVal = (ogSite.getAttribute('content') || '').trim();
      if (ogVal && !_isATS(ogVal)) company = ogVal;
    }
  }

  // 4. Company logo alt text
  if (!company) {
    var imgs = document.querySelectorAll('img[alt]');
    for (var ii = 0; ii < imgs.length && !company; ii++) {
      var alt = (imgs[ii].getAttribute('alt') || '').trim();
      if (!alt || alt.length < 2 || alt.length > 80 || _isATS(alt)) continue;
      var altL = alt.toLowerCase();
      if (altL.indexOf('logo') >= 0) {
        var stripped = alt.replace(/\s*logo\s*/i, '').trim();
        if (stripped.length > 1) company = stripped;
      } else {
        if (imgs[ii].closest('header,nav,[class*="header"],[class*="brand"],[class*="logo"]')) {
          company = alt;
        }
      }
    }
  }

  // 5. Common DOM selectors
  if (!company) {
    var compSelectors = [
      '[class*="company-name"]', '[class*="companyName"]',
      '[class*="employer-name"]', '[class*="employerName"]',
      '[class*="organization-name"]', '[class*="organizationName"]',
      '[data-automation="job-detail-company"]', '[data-company-name]',
      '.jobs-unified-top-card__company-name',
      '[class*="job-company"]', '[class*="jobCompany"]',
      '[class*="hiring-company"]', '[class*="hiringCompany"]'
    ];
    for (var cs = 0; cs < compSelectors.length && !company; cs++) {
      var cel = document.querySelector(compSelectors[cs]);
      if (cel) {
        var ct = cel.textContent.trim();
        if (ct && ct.length > 1 && ct.length < 100 && !_isATS(ct)) company = ct;
      }
    }
  }

  // 6. Page <title>
  if (!company) {
    var titleM = document.title.match(/[\|\-–—]\s*([^|\-–—]{2,60})\s*$/);
    if (titleM) {
      var titleCandidate = titleM[1].trim();
      if (!_isATS(titleCandidate)) company = titleCandidate;
    }
  }

  company = company.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().substring(0, 50);

  var selectors = [
    '[class*="job-description"]', '[id*="job-description"]',
    '[class*="jobDescription"]',  '[id*="jobDescription"]',
    '[class*="job-details"]',     '[id*="job-details"]',
    '[class*="jobDetails"]',      '[id*="jobDetails"]',
    '[class*="job-desc"]',        '[id*="job-desc"]',
    '[data-automation="jobAdDetails"]', '[data-testid*="job-description"]',
    '[class*="description__text"]', '[class*="jobs-description"]',
    '[class*="main-panel"]', '[class*="js_views"]',
    'section.content', 'main', 'article'
  ];

  var MIN_DESC_CHARS = 200;
  var descEl = null;
  for (var i = 0; i < selectors.length; i++) {
    var cand = document.querySelector(selectors[i]);
    if (cand && (cand.innerText || cand.textContent || '').trim().length >= MIN_DESC_CHARS) {
      descEl = cand; break;
    }
  }

  var descText = '';

  // Workable: concatenate named content sections
  var wParts = [];
  ['job-description', 'job-requirements', 'job-benefits'].forEach(function(ui) {
    var el = document.querySelector('[data-ui="' + ui + '"]');
    if (el) { var t = (el.innerText || el.textContent || '').trim(); if (t.length >= 100) wParts.push(t); }
  });
  if (wParts.length > 0) descText = wParts.join('\n\n');

  // Multi-article fallback (Taleo)
  if (!descEl && !descText) {
    var richArts = Array.from(document.querySelectorAll('article')).filter(function(a) {
      return ((a.innerText || a.textContent || '').trim().length >= 150);
    });
    if (richArts.length >= 2) {
      descText = richArts.map(function(a) {
        return (a.innerText || a.textContent || '').trim();
      }).join('\n\n');
    } else if (richArts.length === 1) {
      descEl = richArts[0];
    }
  }

  if (!descText) {
    if (descEl) {
      descText = descEl.innerText || descEl.textContent || '';
    } else {
      var body = document.body.cloneNode(true);
      body.querySelectorAll('script,style,noscript,nav,header,footer,[role="navigation"],[role="banner"]').forEach(function(el) { el.remove(); });
      descText = body.innerText || body.textContent || '';
    }
  }

  descText = descText.replace(/\n{3,}/g, '\n\n').trim();

  return {title: title, company: company, descText: descText};
}

// ── Cross-frame iframe relay ──────────────────────────────────────
var _RELAY_TAG = '__autofill_relay_v1__';
var _RELAY_TIMEOUT_MS = 2500;

function _relayToIframes(action, payload, callback) {
  var iframes = document.querySelectorAll('iframe');
  if (!iframes.length) { callback([]); return; }

  var pending = iframes.length;
  var results = [];
  var timeout;

  function finish() {
    clearTimeout(timeout);
    window.removeEventListener('message', onMsg);
    callback(results);
  }

  function onMsg(event) {
    var d = event.data;
    if (!d || d._tag !== _RELAY_TAG || d.action !== action || !d.result) return;
    results.push(d.result);
    pending--;
    if (pending <= 0) finish();
  }

  window.addEventListener('message', onMsg);
  timeout = setTimeout(finish, _RELAY_TIMEOUT_MS);

  Array.from(iframes).forEach(function(iframe) {
    try {
      iframe.contentWindow.postMessage({ _tag: _RELAY_TAG, action: action, payload: payload }, '*');
    } catch(e) {
      pending--;
      if (pending <= 0) finish();
    }
  });
}

// Iframe-side listener: handle relayed commands when running inside a cross-origin iframe.
if (window !== window.top) {
  window.addEventListener('message', function(event) {
    var d = event.data;
    if (!d || d._tag !== _RELAY_TAG) return;
    if (d.action === 'fill') {
      runFill(d.payload, function(count) {
        try { event.source.postMessage({ _tag: _RELAY_TAG, action: 'fill', result: { count: count } }, '*'); } catch(e) {}
      });
    } else if (d.action === 'learn') {
      scanUnknownFields(d.payload, function(fields) {
        try { event.source.postMessage({ _tag: _RELAY_TAG, action: 'learn', result: { fields: fields } }, '*'); } catch(e) {}
      });
    }
  });
}

// ── Resume upload helpers ─────────────────────────────────────────

// Waits for the DOM to settle after resume upload (ATS auto-population).
// Uses MutationObserver: 800ms quiet = settled, 8s hard cap, 1.5s fallback if no mutations.
function waitForPageSettle(callback) {
  var timer = null;
  var maxWait = setTimeout(function() {
    obs.disconnect();
    callback();
  }, 8000);

  var obs = new MutationObserver(function() {
    clearTimeout(timer);
    timer = setTimeout(function() {
      obs.disconnect();
      clearTimeout(maxWait);
      callback();
    }, 800);
  });

  obs.observe(document.body, { childList: true, subtree: true, attributes: true });

  // If no DOM changes at all within 1.5s, assume already settled
  timer = setTimeout(function() {
    obs.disconnect();
    clearTimeout(maxWait);
    callback();
  }, 1500);
}

// Scored resume input detection — evaluates every file input and returns
// the highest-confidence candidate for the resume field, or null.
// Prevents injecting the resume into cover letter / photo / supporting-docs fields.
function _findResumeInput() {
  var inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (!inputs.length) return null;

  function scoreInput(el) {
    var score = 0;
    var attrs = [
      el.name        || '',
      el.id          || '',
      el.getAttribute('aria-label')            || '',
      el.getAttribute('data-automation-id')    || '',
      el.getAttribute('data-testid')           || '',
      el.getAttribute('placeholder')           || '',
      _extractLabel(el)
    ].join(' ').toLowerCase();

    var accept = (el.accept || '').toLowerCase();

    if (/\bresume\b/.test(attrs))    score += 10;
    if (/\bcv\b/.test(attrs))        score += 10;
    if (/curriculum/.test(attrs))    score += 8;
    if (/\.pdf/.test(accept))        score += 4;
    if (/\.docx?/.test(accept))      score += 3;
    if (accept && !/image/.test(accept)) score += 1;

    if (/cover.?letter/.test(attrs)) score -= 6;
    if (/photo|image|picture|avatar|logo/.test(attrs)) score -= 8;
    if (/supporting|additional|other|attachment/.test(attrs)) score -= 4;
    if (/image/.test(accept))        score -= 6;

    return score;
  }

  var best = null, bestScore = 0;
  inputs.forEach(function(el) {
    var s = scoreInput(el);
    if (s > bestScore) { bestScore = s; best = el; }
  });

  if (bestScore >= 4) return best;
  if (bestScore >= 1 && inputs.length === 1) return best;
  return null;
}

// ── AI pass helpers ───────────────────────────────────────────────

// Collects all unfilled text/select fields after Q&A pass.
// filledEls is the done Set from runFill (can be null — value check covers most cases).
// Stores result in __autofill_unfilled__ and returns it.
function collectUnfilledFields(filledEls) {
  var SKIP_LABEL = /salary|compensation|pay rate|hourly rate|how did you hear|how did you find|referral source/i;

  var result = [];
  var seen = new Set();

  var els = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button])' +
    ':not([type=file]):not([type=password]),' +
    'textarea, select'
  ));

  els.forEach(function(el) {
    if (filledEls && filledEls.has(el)) return;
    if (el.value && el.value.trim()) return;
    // Skip radio/checkbox — they always have a value attribute set
    if (el.type === 'radio' || el.type === 'checkbox') return;

    var lbl = _extractLabel(el);
    if (!lbl || lbl.length < 2) return;
    if (SKIP_LABEL.test(lbl)) return;

    var key = lbl.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);

    var opts = [];
    if (el.tagName === 'SELECT') {
      opts = Array.from(el.options)
        .map(function(o) { return o.text.trim(); })
        .filter(function(t) { return t && !/^(select|choose|--|please)/i.test(t); });
    }

    result.push({
      label:   lbl,
      type:    el.tagName === 'SELECT' ? 'select'
             : el.tagName === 'TEXTAREA' ? 'textarea'
             : (el.type || 'text'),
      options: opts,
      el:      el   // DOM ref — NOT sent to API, used by applyAIGuesses
    });
  });

  __autofill_unfilled__ = result;
  return result;
}

// Applies AI-guessed answers to unfilled fields.
// Fills matched fields with amber highlight + "AI ✦" badge.
// Stores filled records in __autofill_ai_filled__.
function applyAIGuesses(guesses) {
  var count = 0;
  __autofill_ai_filled__ = [];

  guesses.forEach(function(g) {
    if (!g.answer || !g.answer.trim()) return;

    var match = null;
    var gLbl = g.label.toLowerCase().trim();

    // Pass 1: exact label match
    for (var i = 0; i < __autofill_unfilled__.length; i++) {
      if (__autofill_unfilled__[i].label.toLowerCase().trim() === gLbl) {
        match = __autofill_unfilled__[i]; break;
      }
    }
    // Pass 2: matchQA-style fuzzy
    if (!match) {
      for (var j = 0; j < __autofill_unfilled__.length; j++) {
        var f = __autofill_unfilled__[j];
        if (matchQA(f.label, [{q: g.label, a: g.answer}])) {
          match = f; break;
        }
      }
    }

    if (!match || !match.el) return;

    var ok = match.el.tagName === 'SELECT'
      ? _setS(match.el, g.answer)
      : _setV(match.el, g.answer);

    if (!ok) return;

    // Override the green highlight from _setV/_setS with amber
    match.el.style.boxShadow = '0 0 0 2px rgba(255,180,50,0.75)';

    _addAIBadge(match.el);
    count++;

    __autofill_ai_filled__.push({
      el:      match.el,
      label:   match.label,
      answer:  g.answer,
      type:    match.type,
      options: match.options
    });
  });

  return count;
}

// Adds an amber "AI ✦" badge next to an AI-filled field.
// Removes the badge (and amber highlight) when the user focuses or changes the field.
function _addAIBadge(el) {
  var existing = el.parentElement &&
    el.parentElement.querySelector('.__autofill_ai_badge__');
  if (existing) existing.parentElement.removeChild(existing);

  var badge = document.createElement('div');
  badge.className = '__autofill_ai_badge__';
  badge.textContent = 'AI ✦';
  badge.style.cssText = [
    'position:absolute',
    'top:-8px',
    'right:4px',
    'background:rgba(255,180,50,0.92)',
    'color:#000',
    'font-size:9px',
    'font-weight:700',
    'padding:1px 5px',
    'border-radius:8px',
    'font-family:monospace',
    'pointer-events:none',
    'z-index:99999',
    'line-height:1.6'
  ].join(';');

  var parent = el.parentElement;
  if (parent) {
    if (window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(badge);
  }

  function cleanup() {
    el.style.boxShadow = '';
    if (badge.parentElement) badge.parentElement.removeChild(badge);
    el.removeEventListener('focus',  cleanup);
    el.removeEventListener('change', cleanup);
    // Remove from __autofill_ai_filled__ so it doesn't appear in review modal
    __autofill_ai_filled__ = __autofill_ai_filled__.filter(function(f) {
      return f.el !== el;
    });
  }
  el.addEventListener('focus',  cleanup);
  el.addEventListener('change', cleanup);
}

// Returns a serialisable snapshot of __autofill_ai_filled__ (DOM elements stripped).
function getAIFilledSnapshot() {
  return __autofill_ai_filled__.map(function(f) {
    return { label: f.label, answer: f.answer, type: f.type, options: f.options };
  });
}

// ── Message listener ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {

  if (msg.action === 'fill') {
    runFill(msg.data, function(mainCount, doneSet) {
      if (window !== window.top) { sendResponse({count: mainCount}); return; }
      _relayToIframes('fill', msg.data, function(iframeResults) {
        var total = mainCount;
        iframeResults.forEach(function(r) { total += (r.count || 0); });
        var unfilled = collectUnfilledFields(doneSet);
        sendResponse({
          count:         total,
          unfilledCount: unfilled.length,
          unfilled:      unfilled.map(function(f) {
            return { label: f.label, type: f.type, options: f.options };
          })
        });
      });
    });

  } else if (msg.action === 'doResumeUpload') {
    if (window.__autofill_resume_uploaded__) {
      sendResponse({success: false, reason: 'ALREADY_UPLOADED'});
      return true;
    }
    try {
      var file = new File(
        [new Uint8Array(msg.buffer)],
        msg.filename,
        { type: msg.mimeType || 'application/pdf' }
      );
      var inp = _findResumeInput();
      if (!inp) { sendResponse({success: false, reason: 'NO_INPUT_FOUND'}); return true; }
      var dt = new DataTransfer();
      dt.items.add(file);
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', {bubbles: true}));
      inp.dispatchEvent(new Event('input',  {bubbles: true}));
      window.__autofill_resume_uploaded__ = true;
      sendResponse({success: true});
    } catch(e) {
      sendResponse({success: false, reason: e.message});
    }

  } else if (msg.action === 'waitForSettle') {
    waitForPageSettle(function() { sendResponse({settled: true}); });

  } else if (msg.action === 'applyGuesses') {
    var cnt = applyAIGuesses(msg.guesses || []);
    sendResponse({ count: cnt, aiFields: getAIFilledSnapshot() });

  } else if (msg.action === 'getAIFields') {
    sendResponse({ aiFields: getAIFilledSnapshot() });

  } else if (msg.action === 'learn') {
    scanUnknownFields(msg.customQA, function(mainFields) {
      if (window !== window.top) { sendResponse({fields: mainFields}); return; }
      _relayToIframes('learn', msg.customQA, function(iframeResults) {
        var allFields = mainFields;
        iframeResults.forEach(function(r) { allFields = allFields.concat(r.fields || []); });
        sendResponse({fields: allFields});
      });
    });

  } else if (msg.action === 'getJobDescription') {
    // Only respond from the top frame — with all_frames:true the content script
    // also runs in iframes, which respond first with empty data and win the race.
    if (window === window.top) sendResponse(getJobDescription());
  }

  return true;
});

// ── Floating button ───────────────────────────────────────────────
var JOB_SITE_PATTERNS = [
  /greenhouse\.io/, /lever\.co/, /workday\.com/, /myworkdayjobs\.com/,
  /dayforcehcm\.com/, /icims\.com/, /bamboohr\.com/, /taleo\.net/,
  /jobvite\.com/, /smartrecruiters\.com/, /ashbyhq\.com/, /ultipro\./,
  /linkedin\.com\/jobs/, /indeed\.com/, /glassdoor\.com/, /workable\.com/,
  /rippling\.com/, /recruiting\./, /\/careers\//, /\/jobs\//, /\/apply/,
  /successfactors\.com/, /breezy\.hr/, /recruitee\.com/, /pinpointhq\.com/,
  /teamtailor\.com/, /jobscore\.com/, /jazz\.co/
];

function isJobSite() {
  return JOB_SITE_PATTERNS.some(function(p) { return p.test(location.href); });
}

function addIndicator() {
  if (!isJobSite()) return;
  if (document.getElementById('autofill-indicator')) return;
  var el = document.createElement('div');
  el.id = 'autofill-indicator';
  el.textContent = '⚡ AutoFill Ready';
  el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#7c6aff,#9c6aff);color:white;padding:8px 14px;border-radius:20px;font-family:monospace;font-size:11px;font-weight:500;box-shadow:0 4px 15px rgba(124,106,255,0.4);z-index:99999;cursor:pointer;transition:all 0.2s;opacity:0.9;';
  el.onmouseenter = function() { el.style.transform = 'translateY(-2px)'; };
  el.onmouseleave = function() { el.style.transform = ''; };
  el.onclick = function() {
    el.textContent = '⚡ Filling...';
    chrome.storage.local.get('customQA', function(s) {
      runFill({customQA: s.customQA || []}, function(n) {
        el.textContent = n > 0 ? ('✅ Filled ' + n + ' fields!') : 'ℹ️ No fields found';
        setTimeout(function() { el.textContent = '⚡ AutoFill Ready'; }, 3000);
      });
    });
  };
  document.body.appendChild(el);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addIndicator);
} else {
  addIndicator();
}

var _obs = new MutationObserver(function() {
  if (!document.getElementById('autofill-indicator') && document.body) addIndicator();
});
_obs.observe(document.body || document.documentElement, {childList: true, subtree: true});
