# Mandarin Quiz

A small, self-hosted quiz tool. You write no quiz content yourself - you
hand your lesson material to any free AI chatbot with a ready-made prompt,
paste the JSON it gives back into this app, and share a 6-digit code with
your students. They type their name (no account) and take the quiz -
correct streaks earn an on-screen animation, and finishing earns a fun
title based on how that quiz went. You see every result on one page.

There is no paid AI API anywhere in this app. The chatbot step happens on
whatever free chatbot website you already use, in your own browser tab.

---

## What you need before you start

- **Node.js** version 18 or newer. Check with `node -v` in a terminal.
  If you don't have it, download it from https://nodejs.org (the "LTS"
  button is the right one).
- A terminal / command prompt. On Windows that's Command Prompt or
  PowerShell; on Mac it's Terminal.

You do **not** need to know how to code to follow these steps - just
copy and paste the commands.

---

## Step 1 - Extract and open the folder

Unzip `mandarin-quiz-app.zip` wherever you like, then open a terminal
inside that folder.

- **Mac**: right-click the folder → "New Terminal at Folder" (or open
  Terminal and type `cd ` followed by dragging the folder in).
- **Windows**: open the folder in File Explorer, click the address bar,
  type `cmd`, press Enter.

## Step 2 - Install the app's dependencies

```
npm install
```

This downloads the small set of libraries the server uses (Express,
etc.) into a `node_modules` folder. It only needs to be done once.

## Step 3 - Set up your database (Supabase) and your passcode

This app stores everything - quizzes, questions, and results - in a
free Supabase Postgres database. There are no user accounts: one
shared passcode unlocks the teacher dashboard (you choose it), and
students just type their name, same as walking into a classroom.

1. Go to https://supabase.com, sign up free, and create a new project.
2. Once it's ready, open the **SQL Editor** in the left sidebar,
   click **New query**, paste in the entire contents of
   `supabase/schema.sql` from this folder, and click **Run**. This
   creates the tables the app needs - you only do this once.
3. In the sidebar, go to **Project Settings -> API**. You'll need two
   values from that page: the **Project URL**, and the
   **service_role** key (not the "anon" key - the service_role one,
   which is secret and should never be shared or committed to git).
4. Copy `.env.example` to a new file named `.env` in this folder, and
   fill in the three values:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
TEACHER_PASSCODE=your-own-passcode-here
PORT=3000
```

`TEACHER_PASSCODE` can be anything - it's just a shared secret between
you and your browser, since this is a personal tool for one teacher.

## Step 4 - Run it

```
npm start
```

You should see:

```
Mandarin quiz app running at http://localhost:3000
```

Open that address in your browser. Leave this terminal window running
- closing it stops the app. To stop it on purpose, click into the
terminal and press `Ctrl+C`.

That's it for running it on your own computer, for yourself. The
sections below cover writing quizzes and, optionally, putting the app
on the internet so students can reach it from their own devices.

---

## Writing a quiz (no typing questions by hand)

1. In the app, choose **I'm the teacher**, enter your passcode.
2. Click **New quiz**. The page shows a ready-made prompt.
3. Pick the **HSK level** your students are at - it's inserted into
   the prompt automatically, so the chatbot keeps vocabulary near
   that level instead of guessing.
4. Click **Copy prompt**, paste it into any free AI chatbot
   (ChatGPT, Gemini, Grok, or Claude's own free tier all work).
5. Where the prompt says "Paste your lesson material here", replace
   that line with your actual lesson content - vocabulary list,
   reading passage, grammar notes, whatever you're teaching.
6. Send it. The chatbot should reply with only a JSON object.
7. Copy that JSON reply and paste it into the box on the **New quiz**
   page, then click **Create quiz**.

If the chatbot adds any extra text before or after the JSON (some
do, despite being asked not to), delete everything except the part
starting at `{` and ending at the matching `}` before pasting it in.

The app checks the JSON as you submit it and tells you exactly what's
wrong if something doesn't match (e.g. a typo'd answer that doesn't
match any option). The most common thing to watch for is a stray
straight `"` character left inside a question or option - usually
from the chatbot quoting something in English mid-sentence - which
breaks the JSON entirely. The prompt tells the chatbot not to do
that, but if you ever see a "not valid JSON" error, that's almost
always the cause; either ask the chatbot to redo it, or open the
reply in a text editor and remove the stray quote by hand.

Every question is multiple choice with 4 options, written in Hanzi
with pinyin next to it, like 汉字 (hànzì), except where the question
type itself calls for English (see below). The English translation
of Hanzi content lives in a separate field the student can choose to
reveal with a **Show meaning** switch while taking the quiz (see
below) - that keeps the quiz itself immersive while still giving
students an escape hatch if they're stuck.

### The three question types the prompt asks for

- **Fill in the blank** - a Hanzi sentence with `___` where a word or
  phrase is missing; all 4 options are candidate Hanzi + pinyin.
- **Guess the Hanzi** - the question is in plain English (e.g. "doing
  homework"), and the 4 options are Hanzi + pinyin - the student
  picks the right one.
- **What does it mean** - the question is Hanzi + pinyin, and the 4
  options are English - this is the one place options are English,
  since the question is specifically testing comprehension of the
  Hanzi shown.

### Editing the prompt yourself

You don't need to come back and ask for prompt changes - it's a
plain text file: **`public/js/prompt.js`**. Open it in any text
editor, edit the text inside the backticks, save, and refresh your
browser. Nothing else needs to change or restart. The one thing to
preserve is the token `{{HSK_LEVEL}}` somewhere in the text - the
HSK dropdown on the New quiz page swaps it for whichever level you
pick right before you copy the prompt. If you remove the token, the
prompt still works fine, it just always shows whatever level you
typed in its place instead of updating live.

### The "show meaning" toggle

While taking a quiz, students see a small switch above each question:
**Show meaning - correct answers earn half credit while it's on**.
Off by default. If a student turns it on, the English translation of
the question and each option appears - and any question they answer
correctly while it's on is only worth half its points. It resets to
off at the start of every new quiz attempt, and can be flipped on or
off freely question to question; whatever it's set to at the moment
they pick an answer is what counts for that question. Their final
score, and yours on the results page, reflect the halving
automatically - no extra grading step needed. This only has
something to reveal on fill-in-the-blank and guess-the-Hanzi
questions, since "what does it mean" questions already show English
in their options.

### Hiding pinyin

On any quiz's results page there's a **Hide pinyin from students**
switch. Turn it on and every student who joins from then on sees
Hanzi only, no pinyin - useful once a class is ready to read without
the crutch. You (the teacher) always see full pinyin on the results
page regardless of this setting, since it's only stripped from what
students see. It can be flipped at any time, including for a quiz
students are already using.

### Time limit, streaks, and the two scores

Also on the results page: a **total time limit for the whole quiz
(seconds)** field, 0 by default (off). Set it to something like 120
and one countdown starts the moment a student joins and runs for
their entire attempt - not per question. If it hits zero, whatever
they've answered so far is submitted automatically.

While taking the quiz, each answer is checked instantly (not just at
the end), so a student sees right away whether they got it right, and
a row of consecutive correct answers triggers a small on-screen streak
animation - a fun nudge, nothing that affects grading.

Because "fast and streaky" and "accurate" are different things worth
measuring differently, each attempt now gets two numbers instead of
one:

- **Accuracy score (0-100)** - correct answers out of total, exactly
  comparable across students and quizzes. This is the one to use for
  a gradebook. Never affected by speed, streaks, or the timer.
- **XP score** - uncapped and playful. Correct answers earn their
  normal points, plus up to +50% for answering early (only when the
  timer is on), plus up to +50% more the longer a streak runs. This
  is the number meant to be chased, not compared - a fast student's
  XP can end up well above the quiz's raw point total, on purpose.

The "show meaning" half-credit penalty still applies to both numbers
if a student used it. Like the other settings, the time limit can be
changed at any time and only affects students who join afterward.

### Titles - a fun label for how THIS quiz went

There are no accounts in this app, so nothing carries over between
quizzes - instead, right when a student submits, they get a fun
**title** computed fresh from that one attempt's accuracy and streak.
It's shown big on their results screen with an entrance animation (and
a bigger, glowing version for a genuinely flawless run), and as a
small badge next to their name on your results page.

The titles themselves live in `titles.js` at the root of this
project, deliberately kept in one small, easy-to-find file:

```js
const TITLES = [
  { name: '童生 Beginner', minAccuracy: 0 },
  { name: '秀才 Apprentice', minAccuracy: 50 },
  { name: '举人 Rising Talent', minAccuracy: 75 },
  { name: '探花 Star Student', minAccuracy: 90 },
  { name: '状元 Grand Champion', minAccuracy: 100, requiresFlawlessStreak: true },
];
```

Rename these, add more, or change the thresholds freely - just keep
them in ascending `minAccuracy` order. The top entry's
`requiresFlawlessStreak: true` means a perfect accuracy score alone
isn't enough for that title - the student's longest streak also has
to equal the total number of questions, i.e. every single question
answered correctly in one unbroken run, not just a high score reached
after a couple of misses. Add `requiresFlawlessStreak: true` to any
other tier too if you want the same rule to apply there. Restart
`npm start` after editing for the change to take effect.

### Retakes and shuffling

Two more things happen automatically, no setting needed:

- **Every join reshuffles the quiz** - question order, and which 4
  of a question's options get shown, are re-randomized fresh each
  time someone starts it. A student retaking the same quiz, or two
  students taking it side by side, won't see the same order or the
  same wrong answers next to the right one.
- This is also why the prompt asks the AI for 5-6 options per
  question instead of exactly 4 - the app always shows 4 (the
  correct one plus 3 random distractors from whatever pool the AI
  wrote), so there's a real pool to rotate through.

By default students can retake a quiz as many times as they like -
just rejoin with the same code and name. If you'd rather each
student only get one shot, there's an **Allow retakes** switch on the
results page; turn it off and a second attempt under the same name
(matched case-insensitively) gets turned away with a message telling
them to check with you.

### The quiz format, if you want to write one by hand

```json
{
  "title": "Lesson 3 Checkup",
  "description": "Colors and small numbers",
  "questions": [
    {
      "type": "multiple_choice",
      "question": "红色 (hóngsè) 是什么颜色？",
      "questionMeaning": "What color is 红色?",
      "options": [
        "红色 (hóngsè)",
        "蓝色 (lánsè)",
        "绿色 (lǜsè)",
        "黄色 (huángsè)",
        "紫色 (zǐsè)",
        "黑色 (hēisè)"
      ],
      "optionMeanings": ["Red", "Blue", "Green", "Yellow", "Purple", "Black"],
      "answer": "红色 (hóngsè)",
      "explanation": "红 means red"
    }
  ]
}
```

- Every question is `"type": "multiple_choice"` with at least 4
  `options` - 5 or 6 is better, since the app only ever shows the
  student 4 at a time (the correct one plus 3 random others) and
  needs a pool to pick from.
- `answer` must be copied exactly, character for character, from one
  of the `options`.
- `questionMeaning` and `optionMeanings` are optional - if you leave
  them out, the "show meaning" toggle simply has nothing to reveal
  for that question. If you include `optionMeanings`, it must be the
  same length as `options`, in the same order.
- `explanation` is optional - shown nowhere yet, but handy if you
  want a record of why an answer is correct.
- Never put a plain `"` character inside a text value - see the note
  above. `'` (single quote) is fine anywhere.

---

## Sharing a quiz and reading results

After you create a quiz, its page shows a 6-digit **join code**. Give
that code to your students (write it on the board, put it in a group
chat, whatever you already use). They go to the site, choose
**I'm a student**, enter the code and their name, and take the quiz.

Come back to that quiz's page any time to see everyone's score - each
student's title for that quiz shows next to their name. Click
**Review** on any response to see question-by-question right/wrong.

---

## Hosting it somewhere your students can reach

Running it on your own laptop only works if your students are on the
same network, or if you leave your laptop on and reachable, which is
usually impractical. For real classroom use, put it on a small free
web host instead. Any Node.js host works; two straightforward options:

**Render.com** (free web service tier)
1. Push this folder to a GitHub repository (Render deploys from Git).
2. On Render, create a new "Web Service", point it at that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. In Render's dashboard, add the same three environment variables
   from your `.env` file - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `TEACHER_PASSCODE` (don't upload your `.env` file itself; Render's
   dashboard is the safe place to set secrets).
5. Render gives you a public URL - that's what you share.

**Railway.app** (free trial credit, then usage-based)
Same idea: connect the repo, set the same three environment
variables, deploy.

**Vercel**
Vercel runs Node apps as serverless functions rather than a
traditional always-on server, so this needs one small difference from
the two options above: `vercel.json` in this repo already tells
Vercel to treat `server.js` as one function handling every route, and
`server.js` itself only calls `app.listen()` when run directly (your
own machine, Render, Railway) - Vercel instead imports the exported
Express app and invokes it per request. Nothing else about the app
changes.

1. Push this folder to a GitHub repository, then import it in Vercel
   ("Add New -> Project").
2. In the project's **Settings -> Environment Variables**, add
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `TEACHER_PASSCODE`.
3. **Important**: Vercel scopes environment variables per environment
   (Production / Preview / Development) separately. If you're testing
   on a branch deploy (a URL with `-git-<branch>-` in it, like a
   preview build), make sure each variable is enabled for **Preview**
   too, not just Production - the checkbox for this is right where
   you add each variable. A variable set for Production only won't
   exist in a preview deployment, which will fail the same way as
   having no `.env` at all.
4. Redeploy after adding/changing environment variables - like `.env`
   locally, a running deployment doesn't pick up new variables until
   it restarts.

### About persistence

Because everything lives in Supabase's Postgres rather than a file on
the host's own disk, this app has none of the "free host wipes the
filesystem on restart" problem a simpler setup would have - your
quizzes and results all survive redeploys, restarts, and switching
hosts entirely, since none of it lives on the web host at all. The
only thing to keep safe is your `.env` file (specifically the
Supabase service-role key and your teacher passcode) - anyone with
the service-role key could read or write your database directly, so
treat it like a password and never commit it to a public repo.

---

## Choosing a theme

The palette icon in the top-right corner switches between 5 themes.
Each one changes more than just the accent color - the corner
rounding, borders, heading typeface, and the shape of the seal badge
on scores all shift too, so they genuinely feel different rather than
being the same layout recolored:

- **Rice Paper** (default) - a light editorial theme: cream and
  white surfaces, a warm caramel accent, minimal-radius corners and a
  Playfair Display headline face. Closer to a printed magazine page
  than the other four.
- **Ink & Seal** - espresso surfaces, seal-stamp red, a round stamp,
  a Chinese serif for headings.
- **Tea House** - cocoa and amber, dashed "paper edge" borders, a
  literary serif, gently rounded corners.
- **Midnight Jade** - near-black green and jade, sharp architectural
  corners, a geometric sans, a tablet-shaped badge.
- **Plum Lantern** - aubergine and rose, very soft pill-shaped
  corners, an elegant high-contrast serif, a faint lantern glow
  around the score badge.

Your choice is remembered in that browser, no restart needed.

---

## Troubleshooting

**"Failed to load resource: 405" on `/api/login`, or the login page
doesn't work at all.**
This almost always means the app is being opened the wrong way - for
example through a VS Code "Live Server" extension (usually on port
`5500`), or by double-clicking `index.html` directly. Those only serve
static files; they can't run the login/quiz logic, which lives in the
Node.js server. Close that and instead run the app the way Step 4
describes: `npm start` in a terminal, then open the address it prints
(`http://localhost:3000`). If you're editing the code, restart
`npm start` after changes - there's no separate live-reload step.

**"EADDRINUSE" or "port already in use" when running `npm start`.**
An earlier copy of the server is still running in another terminal
window (or was left running in the background). Close that terminal,
or stop the process, then try again.

**The server prints "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
and exits immediately.**
Your `.env` file is missing, misnamed, or missing one of those two
values. Make sure you copied `.env.example` to a file literally named
`.env` (not `.env.example` still, and not `.env.txt`), that it sits in
the same folder as `server.js`, and that the values are copied from
your Supabase project's **Project Settings -> API** page (the
**service_role** key specifically, not the "anon" key).

**The server prints "Missing TEACHER_PASSCODE" and exits immediately.**
Same idea - add a `TEACHER_PASSCODE` line to your `.env` file, any
passcode you choose, then restart `npm start`.

**The teacher passcode doesn't seem to work.**
Make sure you restarted `npm start` (or redeployed, if hosted) after
editing `.env` - it's only read on startup, not live.

**Logging in, joining a quiz, or creating a quiz returns "Something
went wrong on the server."**
This means the request reached the server but the database call
failed - almost always because `supabase/schema.sql` hasn't been run
in your Supabase project's SQL editor yet, or the URL/key in `.env`
don't match the project you ran it in. Check the server's terminal
output for the actual error underneath that message.

---

## A note on data

Everything - every quiz and every student response - lives in your
own Supabase project's Postgres database, not on whatever server
happens to be running the app. There's no analytics and nothing else
phoning home, and no student ever has to hand over a password since
there are no accounts at all. Back up your data by using Supabase's
own backup/export tools on your project, same as you would for any
Postgres database.
