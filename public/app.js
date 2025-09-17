/* Program Builder (Educator / Learner) – vanilla JS
 * Uses: /questions.json, /data/mappings.json, /data/pa_index.json
 * Assumes questions.json now includes an "audience" step (educator|learner).
 */

(function () {
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    if (!Array.isArray(children)) children = [children];
    children.filter(Boolean).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  };

  const state = {
    step: 0,
    audience: null,          // 'educator' | 'learner'
    ephf_selected: [],       // ['ephf01', ...]
    pa_selected: [],         // ['pa19', ...]
    show_all_pas: false,
  };

  const data = {
    questions: null,
    mappings: null,   // { ephf_labels, pa_labels, ephf_to_pas }
    pa_index: null,   // { pa01: {title, curricular_rows:[{n,text,checkmarks},...]}, ... }
  };

  // --------- fetch all data ----------
  async function boot() {
    const [q, m, pai] = await Promise.all([
      fetch(`/questions.json?${Date.now()}`).then(r => r.json()),
      fetch(`/data/mappings.json?${Date.now()}`).then(r => r.json()),
      fetch(`/data/pa_index.json?${Date.now()}`).then(r => r.json()),
    ]);
    data.questions = q;
    data.mappings = m || {};
    data.pa_index = pai || {};

    // derive labels if mapping file misses them
    if (!data.mappings.pa_labels) {
      data.mappings.pa_labels = {};
      Object.entries(data.pa_index).forEach(([id, obj]) => data.mappings.pa_labels[id] = obj.title || id);
    }

    render();
  }

  // --------- utils ----------
  const slug = (s) => (s || "").toLowerCase().replace(/[\s\n\r]+/g, " ").trim();
  const uniqBy = (arr, keyFn) => {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  };

  function recommendPAs(ephfs) {
    const map = data.mappings?.ephf_to_pas || {};
    const counts = {};
    ephfs.forEach(id => {
      (map[id] || []).forEach(pa => {
        counts[pa] = (counts[pa] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
      .map(([id,score]) => ({ id, score }));
  }

  function allPAList() {
    return Object.keys(data.pa_index)
      .sort((a,b)=>Number(a.slice(2))-Number(b.slice(2)))
      .map(id => ({ id, score: 0 }));
  }

  // Build learning plan from selected PAs
  function buildPlan(selectedPAs) {
    const dedupe = new Map(); // key = normalized text
    for (const pa of selectedPAs) {
      const entry = data.pa_index[pa];
      if (!entry) continue;
      for (const row of (entry.curricular_rows || [])) {
        const key = slug(row.text);
        const cur = dedupe.get(key);
        if (!cur) {
          dedupe.set(key, {
            text: row.text,
            checkmarks: row.checkmarks || 0,
            n_list: [row.n],
            pas: [pa],
          });
        } else {
          cur.checkmarks = Math.max(cur.checkmarks, row.checkmarks || 0);
          if (!cur.pas.includes(pa)) cur.pas.push(pa);
          if (!cur.n_list.includes(row.n)) cur.n_list.push(row.n);
        }
      }
    }
    const allRows = Array.from(dedupe.values());
    const core = allRows.filter(r => r.checkmarks >= 5).sort((a,b)=>a.text.localeCompare(b.text));
    const specialized = allRows.filter(r => r.checkmarks < 5).sort((a,b)=>a.text.localeCompare(b.text));
    return { core, specialized, total: allRows.length };
  }

  function paTitle(id) {
    return data.mappings?.pa_labels?.[id] || data.pa_index?.[id]?.title || id;
  }
  function ephfLabel(id) {
    return data.mappings?.ephf_labels?.[id] || id;
  }

  // CSV export
  function downloadCSV(plan, selectedPAs) {
    const rows = [
      ["type","pa_ids","checkmarks","text"]
    ];
    plan.core.forEach(r => rows.push(["core", r.pas.join("|"), r.checkmarks, r.text]));
    plan.specialized.forEach(r => rows.push(["specialized", r.pas.join("|"), r.checkmarks, r.text]));
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "learning_plan.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- RENDER ----------
  function render() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    // Header
    const header = el("div", {class:"card"}, [
      el("h1", {}, "Program builder"),
      el("div", {class:"muted"}, "Build a learning plan aligned to WHO EPHFs and practice activities.")
    ]);
    root.appendChild(header);

    // Step body
    if (state.step === 0) {
      renderAudience(root);
    } else if (state.step === 1) {
      renderEPHFs(root);
    } else if (state.step === 2) {
      renderPASelect(root);
    } else {
      renderResults(root);
    }
  }

  function renderAudience(root) {
    const card = el("div", {class:"card"});
    card.appendChild(el("h2", {}, "Who are you building this for?"));
    const row = el("div", {class:"row"});
    const choices = [
      {id:"educator", label:"Educator / program lead"},
      {id:"learner", label:"Learner / student (beta)"},
    ];
    choices.forEach(c => {
      const p = el("div", {class:"pill" + (state.audience===c.id?' selected':''), onclick: () => { state.audience=c.id; render(); }}, c.label);
      row.appendChild(p);
    });
    card.appendChild(row);

    card.appendChild(el("div", {class:"actions"}, [
      el("button", {class:"ghost", onclick: ()=>{ /* nothing */ }}, "Back"),
      el("button", {onclick: ()=>{ if(!state.audience) return alert("Please choose one."); state.step=1; render(); }}, "Next")
    ]));
    root.appendChild(card);
  }

  function renderEPHFs(root) {
    const card = el("div", {class:"card"});
    card.appendChild(el("div", {class:"muted"}, `Step 1 of 3`));
    card.appendChild(el("h2", {}, "Which EPHFs best describe your focus? (Pick up to 3)"));

    const ephfOptions = Object.keys(data.mappings?.ephf_labels || {}).sort();
    const row = el("div", {class:"row"});
    ephfOptions.forEach(id => {
      const pill = el("div", {
        class: "pill" + (state.ephf_selected.includes(id) ? " selected": ""),
        onclick: () => {
          const i = state.ephf_selected.indexOf(id);
          if (i>=0) state.ephf_selected.splice(i,1);
          else {
            if (state.ephf_selected.length>=3) return alert("Pick up to 3 EPHFs.");
            state.ephf_selected.push(id);
          }
          render();
        }
      }, ephfLabel(id));
      row.appendChild(pill);
    });
    card.appendChild(row);

    card.appendChild(el("div", {class:"actions"}, [
      el("button", {class:"ghost", onclick: ()=>{ state.step=0; render(); }}, "Back"),
      el("button", {onclick: ()=>{
        if (state.ephf_selected.length===0) return alert("Please choose at least one EPHF.");
        state.step = 2; render();
      }}, "Next")
    ]));
    root.appendChild(card);
  }

  function renderPASelect(root) {
    const card = el("div", {class:"card"});
    card.appendChild(el("div", {class:"muted"}, `Step 2 of 3`));
    card.appendChild(el("h2", {}, "Which practice activities do you want to include? (Pick up to 6)"));

    const rec = recommendPAs(state.ephf_selected);
    const recIds = rec.map(r=>r.id);
    const list = state.show_all_pas ? allPAList() : rec;

    const search = el("input", {type:"search", placeholder:"Search practice activities...", oninput: (e)=>{
      const q = slug(e.target.value);
      Array.from(container.children).forEach(chip => {
        const id = chip.dataset.id;
        const title = slug(paTitle(id));
        chip.style.display = title.includes(q) ? "" : "none";
      });
    }});
    card.appendChild(search);

    const toolbar = el("div", {class:"toolbar"}, [
      el("div", {class:"muted"}, state.show_all_pas ? "Showing all 40 PAs" : "Recommended for your EPHFs"),
      el("div", {class:"actions"}, [
        el("button", {class:"ghost", onclick:()=>{ state.show_all_pas = !state.show_all_pas; render(); }},
          state.show_all_pas ? "Show recommendations" : "Show all 40")
      ])
    ]);
    card.appendChild(toolbar);

    const container = el("div", {class:"row"});
    list.forEach(({id,score}) => {
      const pill = el("div", {
        class:"pill" + (state.pa_selected.includes(id)?" selected":""),
        "data-id": id,
        onclick: () => {
          const i = state.pa_selected.indexOf(id);
          if (i>=0) state.pa_selected.splice(i,1);
          else {
            if (state.pa_selected.length>=6) return alert("Pick up to 6 practice activities.");
            state.pa_selected.push(id);
          }
          render();
        }
      }, [
        paTitle(id),
        !state.show_all_pas && score>0 ? el("span",{class:"badge"}, `overlaps: ${score}`) : null
      ]);
      container.appendChild(pill);
    });
    card.appendChild(container);

    const picked = state.pa_selected.map(id=>paTitle(id)).join(", ") || "None yet";
    card.appendChild(el("div", {class:"muted", style:"margin-top:10px"}, `Selected: ${picked}`));

    card.appendChild(el("div", {class:"actions"}, [
      el("button", {class:"ghost", onclick: ()=>{ state.step=1; render(); }}, "Back"),
      el("button", {onclick: ()=>{
        if (state.pa_selected.length===0) return alert("Please choose at least one practice activity.");
        state.step = 3; render();
      }}, "Finish")
    ]));

    root.appendChild(card);
  }

  function renderResults(root) {
    const plan = buildPlan(state.pa_selected);

    const card = el("div", {class:"card"});
    card.appendChild(el("h2", {}, "Your learning plan"));
    card.appendChild(el("div", {class:"kv"}, [
      el("div", {class:"muted"}, "Audience"),
      el("div", {}, state.audience || "—"),

      el("div", {class:"muted"}, "Selected EPHFs"),
      el("div", {}, state.ephf_selected.map(ephfLabel).join(", ")),

      el("div", {class:"muted"}, "Selected PAs"),
      el("div", {}, state.pa_selected.map(id => paTitle(id)).join("; ")),
    ]));

    card.appendChild(el("div", {class:"hr"}));

    // Recommended PAs (in case user wants to iterate)
    const rec = recommendPAs(state.ephf_selected);
    card.appendChild(el("h3", {}, "Recommended practice activities"));
    const ulRec = el("ul");
    rec.slice(0, 10).forEach(r => {
      const li = el("li", {}, [
        paTitle(r.id),
        el("span",{class:"muted"}, ` — overlaps: ${r.score}`),
        state.pa_selected.includes(r.id) ? el("span",{class:"badge"},"selected") : null
      ]);
      ulRec.appendChild(li);
    });
    card.appendChild(el("div",{class:"list"}, ulRec));

    card.appendChild(el("div", {class:"hr"}));

    // Profile-specific tasks placeholder (we’ll populate when tasks JSON is ready)
    card.appendChild(el("h3", {}, "Profile-specific tasks"));
    card.appendChild(el("div", {class:"muted"}, "No tasks yet — add PA tasks data to /data/pa_index.json to populate this section."));

    card.appendChild(el("div", {class:"hr"}));

    // Curricular guide (deduplicated)
    card.appendChild(el("h3", {}, `Curricular guide (deduplicated)`));
    card.appendChild(el("div", {class:"muted"}, `Total items: ${plan.total}. Split below into core vs specialized.`));

    const twoCols = el("div", {class:"row"});
    // Core
    const coreBox = el("div", {class:"card", style:"flex:1; background:#fafafa; border-color:#eee;"});
    coreBox.appendChild(el("h4", {}, `Core (ticks=5) — ${plan.core.length}`));
    const ulCore = el("ul");
    plan.core.slice(0, 30).forEach(r => {
      ulCore.appendChild(el("li", {}, [
        r.text,
        el("span", {class:"muted"}, ` — from ${r.pas.join(", ")}`)
      ]));
    });
    coreBox.appendChild(ulCore);
    if (plan.core.length > 30) coreBox.appendChild(el("div",{class:"muted"}, `+${plan.core.length-30} more`));

    // Specialized
    const specBox = el("div", {class:"card", style:"flex:1; background:#fafafa; border-color:#eee;"});
    specBox.appendChild(el("h4", {}, `Specialized (ticks 1–4) — ${plan.specialized.length}`));
    const ulSpec = el("ul");
    plan.specialized.slice(0, 30).forEach(r => {
      ulSpec.appendChild(el("li", {}, [
        r.text,
        el("span", {class:"muted"}, ` — ticks:${r.checkmarks}, from ${r.pas.join(", ")}`)
      ]));
    });
    specBox.appendChild(ulSpec);
    if (plan.specialized.length > 30) specBox.appendChild(el("div",{class:"muted"}, `+${plan.specialized.length-30} more`));

    twoCols.appendChild(coreBox);
    twoCols.appendChild(specBox);
    card.appendChild(twoCols);

    card.appendChild(el("div", {class:"actions"}, [
      el("button", {class:"ghost", onclick: ()=>{ state.step=2; render(); }}, "Back"),
      el("button", {onclick: ()=> downloadCSV(plan, state.pa_selected)}, "Download CSV")
    ]));

    root.appendChild(card);
  }

  // go
  boot();
})();
