// ---- Educator helpers ----
async function jget(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ' not found');
  return r.json();
}

// Build an Educator learning plan using ONLY static JSON (no guessing)
async function buildLearningPlan(state) {
  const maps = await jget('/data/mappings.json');     // {ephf_to_pas:{...}}
  const paIdx = await jget('/data/pa_index.json');    // { pa19: {...}, ... }

  // 1) Candidate PAs from selected EPHFs
  const ephfSel = Object.keys(state.ephf_selected || {});
  const counts = {};
  ephfSel.forEach(e => (maps.ephf_to_pas[e] || []).forEach(pa => {
    counts[pa] = (counts[pa] || 0) + 1;
  }));

  // 2) Include any PA the user explicitly picked
  Object.keys(state.practice_affinity || {}).forEach(pa => {
    counts[pa] = (counts[pa] || 0) + 1;
  });

  // 3) Rank & cap PAs (tweak cap as you like)
  const ranked = Object.entries(counts)
    .sort((a,b) => b[1]-a[1])
    .map(([id,n]) => ({ id, n }))
    .slice(0, 6); // <=6 PAs for a short course

  // 4) Collect profile-specific tasks & curricular items (verbatim)
  const profileId = state.profile; // e.g., "profile1_core_ph"
  const tasks = [];
  const topics = []; // {text, pa, id, profiles}

  ranked.forEach(({id}) => {
    const pa = paIdx[id];
    if (!pa) return;

    // Tasks for chosen profile (exact text)
    (pa.tasks_by_profile?.[profileId] || []).forEach(t => tasks.push({ pa: id, text: t }));

    // Curricular items filtered by chosen profile's checkmark
    const pnum = profileId ? (profileId.match(/(\d)/)?.[1] || '') : '';
    (pa.curricular_guide || []).forEach(it => {
      if (pnum && it.profiles?.[pnum] === true) {
        topics.push({ pa: id, id: it.id, text: it.text });
      }
    });
  });

  // 5) Exact-text de-dup & frequency across PAs
  const freq = new Map();
  topics.forEach(t => {
    const key = t.text.trim();
    const entry = freq.get(key) || { text: key, from: new Set(), ids: [] };
    entry.from.add(t.pa);
    entry.ids.push(t.id);
    freq.set(key, entry);
  });

  const merged = Array.from(freq.values())
    .map(x => ({ text: x.text, pas: Array.from(x.from), ids: x.ids, count: x.from.size }))
    .sort((a,b) => b.count - a.count);

  // 6) Split into Core (in >=2 PAs) & Specialized (1 PA), cap list sizes
  const core = merged.filter(x => x.count >= 2).slice(0, 12);
  const specialized = merged.filter(x => x.count === 1).slice(0, 12);

  return { ephfs: ephfSel, pas: ranked, tasks, core, specialized };
}

// Render the Educator plan (one card)
async function renderEducator(state) {
  const plan = await buildLearningPlan(state);

  // Friendly labels from questions.json
  const q = await jget('/questions.json');
  const ephfMap = {}; (q.questions.find(x=>x.id==='q_ephf')?.options||[]).forEach(o=>ephfMap[o.id]=o.label);
  const paMap   = {}; (q.questions.find(x=>x.id==='q_pa')?.options||[]).forEach(o=>paMap[o.id]=o.label);

  const app = document.querySelector('#app') || document.body;
  app.innerHTML = `
    <div class="card">
      <h2>Program builder (educator)</h2>
      <p><strong>Selected EPHFs:</strong> ${plan.ephfs.map(e=>ephfMap[e]||e).join(', ') || '—'}</p>

      <h3>Recommended practice activities</h3>
      ${plan.pas.length ? `
      <ol>
        ${plan.pas.map(p => `<li>${paMap[p.id] || p.id} <small>(overlaps: ${p.n})</small></li>`).join('')}
      </ol>` : `<p>No PA recommendations yet.</p>`}

      <h3>Profile-specific tasks (verbatim)</h3>
      ${plan.tasks.length ? `<ul>${plan.tasks.map(t => `<li><em>${paMap[t.pa]||t.pa}</em>: ${t.text}</li>`).join('')}</ul>`
                          : `<p>No tasks yet — add PA data in <code>/data/pa_index.json</code>.</p>`}

      <h3>Curricular guide (deduplicated)</h3>
      <p><strong>Core (cross-PA):</strong></p>
      ${plan.core.length ? `<ul>${plan.core.map(i => `<li>${i.text} <small>[${i.pas.join(', ')}]</small></li>`).join('')}</ul>`
                         : `<p>None yet — add more PA entries.</p>`}
      <p><strong>Specialized:</strong></p>
      ${plan.specialized.length ? `<ul>${plan.specialized.map(i => `<li>${i.text} <small>[${i.pas.join(', ')}]</small></li>`).join('')}</ul>`
                                : `<p>None yet — add more PA entries.</p>`}

      <button id="dlcsv">Download CSV</button>
    </div>
  `;

  // Simple CSV export
  document.getElementById('dlcsv')?.addEventListener('click', () => {
    const rows = [
      ['Type','Text','FromPAs'],
      ...plan.core.map(i => ['Core', i.text, i.pas.join(';')]),
      ...plan.specialized.map(i => ['Specialized', i.text, i.pas.join(';')])
    ];
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'curricular_plan.csv'; a.click();
    URL.revokeObjectURL(url);
  });
}

// expose for easy calling from your finish handler
window.__renderEducator = renderEducator;
// public/app.js
import { score } from './scoring.js';

export async function runWizard(cfg){
  const root = document.getElementById('app');
  const debug = new URLSearchParams(location.search).has('debug');

  // Fallback questions so the wizard renders while we debug fetch
  const FALLBACK_QS = {
    "questions": [
      {
        "id": "q_ephf",
        "type": "multiselect",
        "max_select": 3,
        "required": true,
        "prompt": "Which public-health functions feel most meaningful? (Pick up to 3)",
        "maps_to": "ephf",
        "options": [
          { "id": "ephf01", "label": "Public health surveillance and monitoring" },
          { "id": "ephf02", "label": "Public health emergency management" },
          { "id": "ephf03", "label": "Public health stewardship" },
          { "id": "ephf04", "label": "Multisectoral planning, financing and management for public health" },
          { "id": "ephf05", "label": "Health protection" },
          { "id": "ephf06", "label": "Disease prevention and early detection" },
          { "id": "ephf07", "label": "Health promotion" },
          { "id": "ephf08", "label": "Community engagement and social participation" },
          { "id": "ephf09", "label": "Public health workforce development" },
          { "id": "ephf10", "label": "Health service quality and equity" },
          { "id": "ephf11", "label": "Public health research, evaluation and knowledge" },
          { "id": "ephf12", "label": "Access to and utilization of health products, supplies, equipment and technologies" }
        ]
      },
      {
        "id": "q_profile",
        "type": "single",
        "required": true,
        "prompt": "Which illustrative profile best fits your current (or intended) role?",
        "maps_to": "profile",
        "options": [
          { "id": "profile1_core_ph", "label": "Core public health personnel (1)" },
          { "id": "profile2_health_care", "label": "Health and care workers (2)" },
          { "id": "profile3_allied", "label": "Occupations allied to health (3)" },
          { "id": "profile4_senior_specialist", "label": "Senior specialists (4)" },
          { "id": "profile5_policy_authority", "label": "Policy authorities (5)" }
        ]
      },
      {
        "id": "q_pa",
        "type": "multiselect",
        "max_select": 3,
        "required": false,
        "prompt": "Which practice activities sound appealing? (Pick up to 3)",
        "maps_to": "practice_activity",
        "options": [
          { "id": "pa01", "label": "Establishing and maintaining public health governance mechanisms" },
          { "id": "pa02", "label": "Establishing and maintaining mechanisms for community engagement and social participation" },
          { "id": "pa03", "label": "Setting public health strategies" },
          { "id": "pa04", "label": "Developing and operationalizing policy with public health impact" },
          { "id": "pa05", "label": "Developing and operationalizing legislative and regulatory frameworks with public health impact" },
          { "id": "pa06", "label": "Optimizing resource allocations within multisectoral financing mechanisms" },
          { "id": "pa07", "label": "Optimizing the workforce for the delivery of the EPHFs" },
          { "id": "pa08", "label": "Managing the supply chain" },
          { "id": "pa09", "label": "Quality assurance of public health infrastructure" },
          { "id": "pa10", "label": "Establishing and updating public health information and informatics systems" },
          { "id": "pa11", "label": "Establishing and updating public health intelligence systems" },
          { "id": "pa12", "label": "Planning investigations for public health" },
          { "id": "pa13", "label": "Designing and adapting instruments, tools and methods for data collection" },
          { "id": "pa14", "label": "Gathering qualitative and quantitative data for investigations for public health" },
          { "id": "pa15", "label": "Conducting risk assessments and emergency preparedness assessments" },
          { "id": "pa16", "label": "Maintaining continuous data surveillance and monitoring mechanisms" },
          { "id": "pa17", "label": "Conducting a rapid risk assessment" },
          { "id": "pa18", "label": "Conducting a public health situation analysis" },
          { "id": "pa19", "label": "Analysing and interpreting data, information and evidence" },
          { "id": "pa20", "label": "Communicating intelligence to decision-makers" },
          { "id": "pa21", "label": "Risk communication and community engagement" },
          { "id": "pa22", "label": "Planning public health programmes and services" },
          { "id": "pa23", "label": "Developing a stakeholder engagement strategy" },
          { "id": "pa24", "label": "Collaborating with stakeholders" },
          { "id": "pa25", "label": "Executing public health programmes and services" },
          { "id": "pa26", "label": "Advocacy for public health" },
          { "id": "pa27", "label": "Providing information and resources to improve community health and well-being" },
          { "id": "pa28", "label": "Developing and delivering public health campaigns" },
          { "id": "pa29", "label": "Monitoring, evaluation and reporting" },
          { "id": "pa30", "label": "Continuous quality improvement of programmes and services" },
          { "id": "pa31", "label": "Managing financial resources for public health programmes and services" },
          { "id": "pa32", "label": "Managing physical resources for public health programmes and services" },
          { "id": "pa33", "label": "Managing public health infrastructure" },
          { "id": "pa34", "label": "Managing personnel for the delivery of public health programmes and services" },
          { "id": "pa35", "label": "Providing education and training programmes for the public health workforce" },
          { "id": "pa36", "label": "Planning for risk management and emergency management actions" },
          { "id": "pa37", "label": "Implementing risk management and emergency preparedness actions" },
          { "id": "pa38", "label": "Coordinating emergency response" },
          { "id": "pa39", "label": "Providing health services as part of emergency response" },
          { "id": "pa40", "label": "Coordinating service continuity and equitable recovery" }
        ]
      }
    ]
  };

  // Try multiple URLs in order. Show exact error text if fetch/parse fails.
  const loadJsonMulti = async (urls, label, fallback=null) => {
    for (const url of urls){
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const status = r.status;
        const txt = await r.text();
        if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
        try { return JSON.parse(txt); }
        catch (e) { throw new Error(`Parse error: ${e.message}\nFirst 200 chars:\n${txt.slice(0,200)}`); }
      } catch (err) {
        if (debug) {
          console.error(`[${label}] ${String(err)}`);
          const box = document.createElement('pre');
          box.style.cssText = 'white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px;margin:10px 0';
          box.textContent = `Failed ${label} from ${urls[0]} -> trying next.\n${String(err)}`;
          (document.querySelector('#diag') || document.body).appendChild(box);
        }
      }
    }
    return fallback;
  };

  // Candidates for each file (root-relative, then relative, then cache-busted)
  const qs    = await loadJsonMulti([cfg.questionsUrl, './questions.json', '/questions.json?bust='+Date.now()], 'questions.json', FALLBACK_QS);
  const roles = await loadJsonMulti([cfg.rolesUrl, './roles.json', '/roles.json?bust='+Date.now()], 'roles.json', {roles: []});
  const sc    = await loadJsonMulti([cfg.scoringConfigUrl, './scoring_config.json', '/scoring_config.json?bust='+Date.now()], 'scoring_config.json', {weights:{}, skip_weights:{}});
  const map   = await loadJsonMulti([cfg.mappingsUrl || '/mappings.json', './mappings.json', '/mappings.json?bust='+Date.now()], 'mappings.json', {ephf_to_pa:{}});

  if (debug) {
    const d = document.createElement('div'); d.id='diag';
    d.innerHTML = `<h2>Diagnostics</h2>`;
    document.body.prepend(d);
    const add = (name, obj) => {
      const p = document.createElement('pre');
      p.style.cssText = 'white-space:pre-wrap;border:1px solid #eee;padding:10px;border-radius:8px';
      p.textContent = `${name}: ${obj ? 'ok' : 'null'} ${obj && obj.questions ? `(questions=${obj.questions.length})` : ''}`;
      d.appendChild(p);
    };
    add('qs', qs); add('roles', roles); add('sc', sc); add('map', map);
  }

  const steps = Array.isArray(qs) ? qs : (qs.questions || qs.steps || []);
  if (!steps.length){
    root.textContent = 'No questions found even after fallback.';
    return;
  }

  // ---------- Wizard state ----------
  const state = { criteria:{}, ephf_selected:{}, practice_affinity:{}, comp_level:{} };
  let step = 0;
  const putFlags = (ids, target) => ids.forEach(id => { if (id) target[id] = 1; });
  const setAnswer = (q, selectedIds) => {
    const key = q.maps_to || q.id;
    if (key === 'ephf' || key === 'ephf_selected' || key === 'q_ephf') putFlags(selectedIds, state.ephf_selected);
    else if (key === 'practice_activity' || key === 'practice_affinity' || key === 'q_pa') putFlags(selectedIds, state.practice_affinity);
    else if (key === 'profile' || key === 'q_profile') state.criteria.profile = selectedIds[0] || null;
    else if (key && key.startsWith('criteria.')) state.criteria[key.split('.')[1]] = selectedIds[0] || null;
  };

  const getRecommendedPAs = () => {
    const rec = new Set();
    Object.keys(state.ephf_selected).forEach(e => (map.ephf_to_pa?.[e] || []).forEach(pa => rec.add(pa)));
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

    // Easy-mode PA
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
          if(isSingle){ chips.querySelectorAll('.chip').forEach(el=>el.classList.remove('active')); c.classList.add('active'); }
          else {
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
      toggle.onclick = ()=>{ showAll = !showAll; toggle.textContent = showAll ? 'Show recommended' : 'Show all 40';
        renderChips(showAll ? full : full.filter(o => recIds.includes(o.id))); };
      search.oninput = (e)=>{ const term=(e.target.value||'').toLowerCase();
        const base = (showAll ? full : full.filter(o => recIds.includes(o.id)));
        renderChips(base.filter(o => (o.label||'').toLowerCase().includes(term))); };
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
  // --- Educator branch (early exit) ---
  const urlMode = new URLSearchParams(location.search).get('mode');
  if ((state?.mode === 'educator') || (urlMode === 'educator')) {
    window.__renderEducator?.(state);  // defined by the helpers you added earlier
    return; // stop; don't render learner "top matches"
  }
  // --- end educator branch ---

    const usedWeights = (state.practice_affinity && Object.keys(state.practice_affinity).length)
      ? (sc?.weights || {})
      : (sc?.skip_weights || sc?.weights || {});

    const list = (roles?.roles || []).map(role => {
      let fit = score(state, role, sc || {weights:{}, skip_weights:{}});
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
          <strong>${x.role.title || x.role.label || x.role.id}</strong>
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
