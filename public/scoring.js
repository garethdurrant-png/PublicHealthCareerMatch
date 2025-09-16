// public/scoring.js
// Compatible with roles that use either `pa_weights` or `practice_activity_weights`,
// and with scoring_config that uses either `practice_activity` or `practice`.

export function score(state, role, sc) {
  const weights = sc?.weights || {};
  const w_ephf = Number(weights.ephf ?? 0.6);
  const w_pa   = Number((weights.practice_activity ?? weights.practice) ?? 0.3);

  // ----- EPHF score -----
  const userE = state?.ephf_selected || {};
  const roleE = role?.ephf_weights || {}; // expected
  let ephfSum = 0, ephfDen = 0;
  for (const [k, wt] of Object.entries(roleE)) {
    const wv = Math.max(0, Number(wt) || 0);
    ephfDen += wv;
    if (userE[k]) ephfSum += wv;
  }
  const ephfScore = ephfDen > 0 ? ephfSum / ephfDen : 0;

  // ----- Practice-activity score -----
  const userPA = state?.practice_affinity || {};
  const rolePA = role?.pa_weights || role?.practice_activity_weights || {}; // accept either
  let paSum = 0, paDen = 0;
  for (const [k, wt] of Object.entries(rolePA)) {
    const wv = Math.max(0, Number(wt) || 0);
    paDen += wv;
    if (userPA[k]) paSum += wv;
  }
  const paScore = paDen > 0 ? paSum / paDen : 0;

  // Base fit (profile bonus added in app.js)
  let fit = w_ephf * ephfScore + w_pa * paScore;
  if (!Number.isFinite(fit)) fit = 0;
  return Math.max(0, Math.min(1, fit));
}
