export function score(user, role, sc){
  const use = Object.keys(user.practice_affinity || {}).length
    ? sc.weights
    : (sc.skip_weights || sc.weights);

  const w = use;
  const dot = (a,b)=>Object.entries(a||{}).reduce((s,[k,v])=>s + (v||0)*((b&&b[k])||0),0);

  const ephf = dot(user.ephf_selected, role.ephf_weights);
  const prac = dot(user.practice_affinity, role.practice_activity_weights);

  // simple competency readiness placeholder
  const comp = (() => {
    const req = role.competency_requirements || {};
    const ids = Object.keys(req);
    if (!ids.length) return 0;
    let sum = 0;
    for (const id of ids){
      const have = (user.comp_level?.[id] ?? 0);
      const need = req[id] || 1;
      sum += Math.min(have/need, 1);
    }
    return sum/ids.length;
  })();

  const ctx = role.context?.role_style?.includes(user.criteria.role_style) ? 1 : 0;

  return w.ephf*ephf + w.practice*prac + w.competency*comp + w.context_bonus*ctx;
}
