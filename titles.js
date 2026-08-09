// titles.js
//
// A fun label for how a student did on ONE quiz - not a persistent
// account level (there's no account to persist it on). Computed
// fresh every time from that attempt's own accuracyScore and
// longestStreak, right when it's submitted (see server.js).
//
// Edit TITLES freely - rename them, add more, change the thresholds.
// Keep them in ascending minAccuracy order; requiresFlawlessStreak
// only matters on the top entry (see computeTitle below).

const TITLES = [
  { name: '童生 Beginner', minAccuracy: 0 },
  { name: '秀才 Apprentice', minAccuracy: 50 },
  { name: '举人 Rising Talent', minAccuracy: 75 },
  { name: '探花 Star Student', minAccuracy: 90 },
  // The top title additionally requires a "flawless streak" - every
  // single question answered correctly in a row, not just a high
  // score - so acing a quiz by getting lucky after a couple of misses
  // doesn't earn the same title as a genuine clean run.
  { name: '状元 Grand Champion', minAccuracy: 100, requiresFlawlessStreak: true },
];

function computeTitle(accuracyScore, longestStreak, totalQuestions) {
  let title = TITLES[0];
  for (const t of TITLES) {
    if (accuracyScore < t.minAccuracy) continue;
    if (t.requiresFlawlessStreak && longestStreak < totalQuestions) continue;
    title = t;
  }
  return title.name;
}

module.exports = { TITLES, computeTitle };
