// levels.js
//
// The student-facing level system. XP is cumulative across every
// quiz a student ever submits (see db.js: addXp is called once per
// submit, adding that attempt's xpScore to the student's running
// total). This file just turns a raw xp_total number into a level
// name and progress toward the next one.
//
// Edit LEVELS freely - rename the tiers, add more, change the
// thresholds. Keep them in ascending minXp order. The names below
// are placeholders themed around the old Chinese imperial exam ranks
// (fitting for a Mandarin app) - swap in whatever you like.

const LEVELS = [
  { name: '童生 Beginner', minXp: 0 },
  { name: '秀才 Scholar', minXp: 100 },
  { name: '举人 Graduate', minXp: 300 },
  { name: '进士 Master', minXp: 700 },
  { name: '状元 Grandmaster', minXp: 1500 },
];

function computeLevel(xpTotal) {
  const xp = Math.max(0, Number(xpTotal) || 0);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) index = i;
  }
  const current = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  const progress = next
    ? Math.min(1, (xp - current.minXp) / (next.minXp - current.minXp))
    : 1;
  return {
    name: current.name,
    index,
    minXp: current.minXp,
    nextName: next ? next.name : null,
    nextMinXp: next ? next.minXp : null,
    progress, // 0-1 fraction toward the next tier, 1 if already at the top
  };
}

module.exports = { LEVELS, computeLevel };
