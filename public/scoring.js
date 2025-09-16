// public/scoring.js
// Tolerant to either `pa_weights` or `practice_activity_weights`.
// Also tolerates `practice_activity` vs `practice` in scoring_config.

export function score(state, role, sc) {
  const weights = sc?.weights || {};
  const w_ephf = Number(weights.ephf ?? 0.6);
  const w_pa   = Number((weights.practice_activity ?? weights.practice) ?? 0.3);

  // ----- EPHF score -----
  const userE = state?.ephf_selected || {};
  const roleE = role?.ephf_weights || {};
  let eSum = 0, eDen = 0;
  for (const [k, wt] of Object.entries(roleE)) {
    const wv = Math.max(0, Number(wt) || 0);
    eDen += wv;
    if (userE[k]) eSum += wv;
  }
  const ephfScore = eDen > 0 ? eSum / eDen : 0;

  // ----- Practice-activity score -----
  const userPA = state?.practice_affinity || {};
  const rolePA = role?.pa_weights || role?.practice_activity_weights || {};
  let pSum = 0, pDen = 0;
  for (const [k, wt] of Object.entries(rolePA)) {
    const wv = Math.max(0, Number(wt) || 0);
    pDen += wv;
    if (userPA[k]) pSum += wv;
  }
  const paScore = pDen > 0 ? pSum / pDen : 0;

  let fit = w_ephf * ephfScore + w_pa * paScore;
  if (!Number.isFinite(fit)) fit = 0;
  return Math.max(0, Math.min(1, fit));
}
