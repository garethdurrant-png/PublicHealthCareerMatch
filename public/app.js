// public/app.js
import { score } from './scoring.js';

export async function runWizard(cfg){
  const root = document.getElementById('app');
  const debug = new URLSearchParams(location.search).has('debug');

  // Helper: safe JSON loader with console + on-page diagnostics
  const loadJson = async (url, fallbackName) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${fallbackName} ${r.status}`);
      const data = await r.json();
      console.log(`[OK] loaded ${fallbackName}`, data);
      return data;
    } catch (e) {
      console.error(`[ERR] load ${fallbackName}:`, e);
      return null;
    }
  };

  const qs    = await loadJson(cfg.questionsUrl,      'questions.json');
  const roles = await loadJson(cfg.rolesUrl,          'roles.json');
  const sc    = await loadJson(cfg.scoringConfigUrl,  'scoring_config.json');
  const map   = await loadJson(cfg.mappingsUrl || 'mappings.json', 'mappings.json') || { ephf_to_pa: {} };

  const steps = Array.isArray(qs) ? qs : (qs && (qs.questions || qs.steps)) || [];

  if (!steps.length) {
    const msg = 'No questions found.';
    if (debug) {
      root.innerHTML = `
        <h2>${msg}</h2>
        <p><strong>Diagnostics (enable/disable with ?debug=1):</strong></p>
        <pre style="white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px">
questionsUrl: ${cfg.questionsUrl}
Loaded qs type: ${qs ? typeof qs : 'null'}
qs keys: ${qs && typeof qs === 'object' ? Object.keys(qs).join(', ') : '(none)'}
qs.questions length: ${qs && qs.questions && Array.isArray(qs.questions) ? qs.questions.length : 'n/a'}
        </pre>`;
    } else {
      root.textContent = msg + ' (Tip: add ?debug=1 to the URL for details)';
    }
    return;
  }

  const state = { criteria:{}, ephf_selected:{}, practice_affinity:{}, comp_level:{} };
  let step = 0;

  const putFlags = (ids, target) => ids.forEach(id => { if (id) target[id] = 1; });

  const setAnswer = (q, selectedIds) => {
    const key = q.maps_to || q.id;
    if (key === 'ephf' || key === 'ephf_selected' || key === 'q_ephf') {
      putFlags(selectedIds, state.ephf_selected);
    } else if (key === 'practice_activity' || key === 'practice_affinity' || key === 'q_pa') {
      putFlags(selectedIds, state.practice_affinity);
    } else if (key === 'profile' || key === 'q_profile') {
      state.criteria.profile = selectedIds[0] || null;
    } else if (key && key.startsWith('criteria.')) {
      state.criteria[key.split('.')[1]] = selectedIds[0] || null;
    }
  };

  const getRecommendedPAs = () => {
    const selected = Object.keys(state.ephf_selected);
    const rec = new Set();
    selected.forEach(e => (map.ephf_to_pa?.[e] || []).forEach(pa => rec.add(pa)));
    return Array.from(rec);
  };

  const renderQuestion = () => {
    const q = steps[step];
    const total = steps.length;

    const card = document.createElement('section'); card.className='card';
    card.innerHTML = `
      <div class="progress">Step ${step+1} of ${total}</div>
      <h2>${q.prompt || q.title || 'Question'}</h2>
      <div class="chips"></div>
      <div class="actions">
        ${step>0?'<button class="btn secondary" id="back">Back</button>':''}
        <button class="btn" id="next">Next</button>
      </div>`;
    const chips = card.querySelector('.chips');

    // Easy-mode PA filtering
    let options = q.options || [];
    const isPAstep = (q.maps_to === 'practice_activity' || q.id === 'q_pa');

    let showAll = false;
    const toolbar = document.createElement('div');
    if (isPAstep){
      const recIds = getRecommendedPAs();
      if (recIds.length){
        options = options.filter(o => recIds.includes(o.id));

        const hint = document.createElement('div');
        hint.style.cssText='margin-bottom:10px;color:#555;font-size:14px';
        hint.textContent = 'Recommended for your EPHF choices. You can search or show all.';
        card.insertBefore(hint, chips);

        toolbar.innerHTML = `
          <input id="paSearch" placeholder="Search practice activities…" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin:6px 0 4px 0">
          <button class="btn secondary" id="toggleAll">Show all 40</button>
        `;
        card.insertBefore(toolbar, chips);
      }
    }

    const renderChips = (opts) => {
      chips.replaceChildren();
      (opts || []).forEach(opt=>{
        const c = document.createElement('button');
        c.type='button';
        c.className='chip';
        c.dataset.id = opt.id ?? opt.value;
        c.textContent = opt.label ?? opt.text ?? String(opt.id ?? opt.value);
        c.onclick = () => {
          const isSingle = (q.type==='single'||q.type==='single_select');
          if(isSingle){
            chips.querySelectorAll('.chip').forEach(el=>el.classList.remove('active'));
            c.classList.add('active');
          } else {
            c.classList.toggle('active');
            const active = chips.querySelectorAll('.chip.active').length;
            const maxSel = q.max_select || q.maxSelections;
            if(maxSel && active>maxSel) c.classList.remove('active');
          }
        };
        chips.appendChild(c);
      });
    };

    renderChips(options);

    if (isPAstep && toolbar){
      const search = toolbar.querySelector('#paSearch');
      const toggle = toolbar.querySelector('#toggleAll');
      const full = (q.options || []);
      const recIds = getRecommendedPAs();

      toggle.onclick = ()=>{
        showAll = !showAll;
        toggle.textContent = showAll ? 'Show recommended' : 'Show all 40';
        renderChips(showAll ? full : full.filter(o => recIds.includes(o.id)));
      };

      search.oninput = (e)=>{
        const term = (e.target.value || '').toLowerCase();
        const base = (showAll ? full : full.filter(o => recIds.includes(o.id)));
        renderChips(base.filter(o => (o.label||'').toLowerCase().includes(term)));
      };
    }

    if(step>0) card.querySelector('#back').onclick = ()=>{ step--; renderQuestion(); };

    card.querySelector('#next').onclick = ()=>{
      const selectedIds = [...chips.querySelectorAll('.chip.active')].map(el=>el.dataset.id);
      const required = q.required === true;
      const isSingle = (q.type==='single'||q.type==='single_select');
      if(isSingle && selectedIds.length===0) return alert('Please choose one.');
      if(!isSingle && required && selectedIds.length===0) return alert('Please choose at least one.');
      setAnswer(q, selectedIds);
      step++;
      step < total ? renderQuestion() : renderResults();
    };

    root.replaceChildren(card);
  };

  const renderResults = () => {
    const usedWeights = (state.practice_affinity && Object.keys(state.practice_affinity).length)
      ? sc?.weights || {}
      : (sc?.skip_weights || sc?.weights || {});

    const list = (roles?.roles || []).map(role => {
      let fit = score(state, role, sc || {weights:{}, skip_weights:{}}); // base score
      if (role.profiles && state.criteria.profile) {
        fit += (usedWeights.profile || 0) * (role.profiles.includes(state.criteria.profile) ? 1 : 0);
      }
      return { role, fit };
    }).sort((a,b)=>b.fit-a.fit).slice(0,5);

    const card = document.createElement('section'); card.className='card';
    card.innerHTML = `<h2>Your top matches</h2>` + list.map(x=>{
      const pct = Math.max(0, Math.min(1, x.fit)) * 100;
      const ephfOverlap = Object.keys(state.ephf_selected).filter(k => x.role.ephf_weights?.[k]);
      return `
        <div class="result">
          <strong>${x.role.title}</strong>
          <div class="bar"><span style="width:${pct}%; background:linear-gradient(90deg,#111,#666)"></span></div>
          <div style="font-size:14px;color:#444;margin-top:6px">
            Why: overlaps with ${ephfOverlap.map(k=>x.role.ephf_weights_labels?.[k]||k).join(', ') || 'your choices'}${
              state.criteria.profile && x.role.profiles?.includes(state.criteria.profile) ? ' • matches your profile' : ''
            }.
          </div>
        </div>`;
    }).join('');

    root.replaceChildren(card);
  };

  renderQuestion();
}
