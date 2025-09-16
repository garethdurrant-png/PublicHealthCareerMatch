import { score } from './scoring.js';

export async function runWizard(cfg){
  const root = document.getElementById('app');
  const [qs, roles, sc, map] = await Promise.all([
    fetch(cfg.questionsUrl).then(r=>r.json()),
    fetch(cfg.rolesUrl).then(r=>r.json()),
    fetch(cfg.scoringConfigUrl).then(r=>r.json()),
    fetch(cfg.mappingsUrl).then(r=>r.json())
  ]);

  const steps = qs.questions || qs.steps;
  const state = { criteria:{}, ephf_selected:{}, practice_affinity:{}, comp_level:{} };
  let step = 0;

  const putFlags = (ids, target) => ids.forEach(id => { target[id] = 1; });

  const setAnswer = (q, selectedIds) => {
    const key = q.maps_to || q.id;
    if (key === 'ephf' || key === 'ephf_selected' || key === 'q_ephf') {
      putFlags(selectedIds, state.ephf_selected);
    } else if (key === 'practice_activity' || key === 'practice_affinity' || key === 'q_pa') {
      putFlags(selectedIds, state.practice_affinity);
    } else if (key === 'role_style' || key === 'criteria.role_style' || key === 'q_style') {
      state.criteria.role_style = selectedIds[0] || null;
    } else if (key && key.startsWith('criteria.')) {
      state.criteria[key.split('.')[1]] = selectedIds[0] || null;
    }
  };

  const getRecommendedPAs = () => {
    const selected = Object.keys(state.ephf_selected);
    const rec = new Set();
    selected.forEach(e => (map.ephf_to_pa[e] || []).forEach(pa => rec.add(pa)));
    return Array.from(rec);
  };

  const renderQuestion = () => {
    const q = steps[step];
    const total = steps.length;

    const card = document.createElement('section'); card.className='card';
    card.innerHTML = `
      <div class="progress">Step ${step+1} of ${total}</div>
      <h2>${q.prompt || q.title}</h2>
      <div class="chips"></div>
      <div class="actions">
        ${step>0?'<button class="btn secondary" id="back">Back</button>':''}
        <button class="btn" id="next">Next</button>
      </div>`;

    const chips = card.querySelector('.chips');

    // ----- EASY MODE for Practice Activities -----
    let options = q.options || [];
    let isPAstep = (q.maps_to === 'practice_activity' || q.id === 'q_pa');

    // Build toolbar (search + show-all) for PA step
    let showAll = false, searchTerm = '';
    const toolbar = document.createElement('div');
    if (isPAstep){
      const recIds = getRecommendedPAs();
      if (recIds.length){
        options = options.filter(o => recIds.includes(o.id));
        const hint = document.createElement('div');
        hint.style.cssText='margin-bottom:10px;color:#555;font-size:14px';
        hint.textContent = 'Recommended for your EPHF choices. You can also search or show all.';
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
      opts.forEach(opt=>{
        const c = document.createElement('button');
        c.type='button'; c.className='chip'; c.dataset.id=opt.id; c.textContent=opt.label;
        c.onclick=()=>{
          const isSingle = (q.type==='single'||q.type==='single_select');
          if(isSingle){
            chips.querySelectorAll('.chip').forEach(el=>el.classList.remove('active'));
            c.classList.add('active');
          }else{
            c.classList.toggle('active');
            const active = chips.querySelectorAll('.chip.active').length;
            const maxSel = q.max_select || q.maxSelections;
            if(maxSel && active>maxSel) c.classList.remove('active');
          }
        };
        chips.appendChild(c);
      });
    };

    // First render (possibly filtered)
    renderChips(options);

    // Hook up toolbar
    if (isPAstep && toolbar){
      const search = toolbar.querySelector('#paSearch');
      const toggle = toolbar.querySelector('#toggleAll');
      const full = (q.options || []);

      toggle.onclick = ()=>{
        showAll = !showAll;
        toggle.textContent = showAll ? 'Show recommended' : 'Show all 40';
        renderChips(showAll ? full : (q.options || []).filter(o => getRecommendedPAs().includes(o.id)));
      };

      search.oninput = (e)=>{
        searchTerm = (e.target.value || '').toLowerCase();
        const base = (showAll ? full : (q.options || []).filter(o => getRecommendedPAs().includes(o.id)));
        const filtered = base.filter(o => o.label.toLowerCase().includes(searchTerm));
        renderChips(filtered);
      };
    }
    // --------------------------------------------

    if(step>0) card.querySelector('#back').onclick=()=>{ step--; renderQuestion(); };

    card.querySelector('#next').onclick=()=>{
      const selectedIds=[...chips.querySelectorAll('.chip.active')].map(el=>el.dataset.id);
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
    const list = (roles.roles || []).map(role => ({ role, fit: score(state, role, sc) }))
      .sort((a,b)=>b.fit-a.fit).slice(0,5);

    const card = document.createElement('section'); card.className='card';
    card.innerHTML = `<h2>Your top matches</h2>` + list.map(x=>{
      const pct = Math.max(0, Math.min(1, x.fit)) * 100;
      const ephfOverlap = Object.keys(state.ephf_selected).filter(k => x.role.ephf_weights?.[k]);
      return `
        <div class="result">
          <strong>${x.role.title}</strong>
          <div class="bar"><span style="width:${pct}%; background:linear-gradient(90deg,#111,#666)"></span></div>
          <div style="font-size:14px;color:#444;margin-top:6px">
            Why: overlaps with ${ephfOverlap.map(k=>x.role.ephf_weights_labels?.[k]||k).join(', ') || 'your choices'}.
          </div>
        </div>`;
    }).join('');

    root.replaceChildren(card);
  };

  renderQuestion();
}
