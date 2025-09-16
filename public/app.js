import { score } from './scoring.js';

export async function runWizard(cfg){
  const root = document.getElementById('app');
  const [qs, roles, sc] = await Promise.all([
    fetch(cfg.questionsUrl).then(r=>r.json()),
    fetch(cfg.rolesUrl).then(r=>r.json()),
    fetch(cfg.scoringConfigUrl).then(r=>r.json())
  ]);

  const state = {
    criteria:{},
    ephf_selected:{},
    practice_affinity:{},
    comp_level:{} // placeholder for later competencies
  };
  let step = 0;

  const setAnswer = (q, selectedIds) => {
    const putFlags = (ids, target) => ids.forEach(id => { target[id] = 1; });
    const key = q.maps_to;

    if (key === 'ephf' || key === 'ephf_selected') {
      putFlags(selectedIds, state.ephf_selected);
    } else if (key === 'practice_activity' || key === 'practice_affinity') {
      putFlags(selectedIds, state.practice_affinity);
    } else if (key === 'role_style' || key === 'criteria.role_style') {
      state.criteria.role_style = selectedIds[0] || null;
    } else if (key && key.startsWith('criteria.')) {
      state.criteria[key.split('.')[1]] = selectedIds[0] || null;
    } else if (key === 'competency_growth') {
      putFlags(selectedIds, state.comp_level);
    }
  };

  const renderQuestion = () => {
    const q = (qs.questions || qs.steps)[step];
    const total = (qs.questions || qs.steps).length;

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
    (q.options || []).forEach(opt=>{
      const c = document.createElement('button');
      c.type='button'; c.className='chip'; c.dataset.id=opt.id; c.textContent=opt.label;
      c.onclick=()=>{
        if((q.type==='single'||q.type==='single_select')){
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
