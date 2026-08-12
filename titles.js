// titles.js
//
// A fun label for how a student did on ONE quiz - not a persistent
// account level (there's no account to persist it on). Computed
// fresh every time from that attempt's own accuracyScore and
// longestStreak, right when it's submitted or reviewed (see
// server.js) - so editing this file changes how every past attempt
// displays too, not just new ones.
//
// Edit TITLES freely - rename them, change the pinyin/meaning/icon,
// add more tiers, change the thresholds. Keep them in ascending
// minAccuracy order; requiresFlawlessStreak only matters on the top
// entry (see computeTitle below). `icon` must be one of the keys in
// public/js/icons.js's ICONS object - the student and teacher UI
// both render it directly.

const TITLES = [
  { name: '童生', pinyin: 'tóngshēng', meaning: 'Beginner', icon: 'sprout', minAccuracy: 0 },
  { name: '秀才', pinyin: 'xiùcái', meaning: 'Apprentice', icon: 'book', minAccuracy: 50 },
  { name: '举人', pinyin: 'jǔrén', meaning: 'Rising Talent', icon: 'star', minAccuracy: 75 },
  { name: '探花', pinyin: 'tànhuā', meaning: 'Star Student', icon: 'medal', minAccuracy: 90 },
  // The top title additionally requires a "flawless streak" - every
  // single question answered correctly in a row, not just a high
  // score - so acing a quiz by getting lucky after a couple of misses
  // doesn't earn the same title as a genuine clean run.
  { name: '状元', pinyin: 'zhuàngyuán', meaning: 'Grand Champion', icon: 'crown', minAccuracy: 100, requiresFlawlessStreak: true },
];

// Returns the full tier object ({ name, pinyin, meaning, icon, ... }),
// not just a string - callers that only want the DB-storage string
// use title.name directly (see server.js).
function computeTitle(accuracyScore, longestStreak, totalQuestions) {
  let title = TITLES[0];
  for (const t of TITLES) {
    if (accuracyScore < t.minAccuracy) continue;
    if (t.requiresFlawlessStreak && longestStreak < totalQuestions) continue;
    title = t;
  }
  return title;
}

module.exports = { TITLES, computeTitle };
