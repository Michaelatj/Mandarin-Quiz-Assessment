# Mandarin Quiz

A small, self-hosted quiz tool. You write no quiz content yourself - you
hand your lesson material to any free AI chatbot with a ready-made prompt,
paste the JSON it gives back into this app, and share a 6-digit code with
your students. They type their name (no email, no account) and take the
quiz. You see every result on one page.

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

## Step 3 - Set your passcode

The app has one setting you must choose: the passcode that unlocks
your teacher dashboard. It is not an email/password account - just a
shared secret between you and your browser, since this is a personal
tool for one teacher.

1. Copy `.env.example` to a new file named `.env` in the same folder.
2. Open `.env` in any text editor and change `TEACHER_PASSCODE` to
   something only you know.

```
TEACHER_PASSCODE=your-own-passcode-here
PORT=3000
```

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

### Time limit and speed bonus

Also on the results page: a **time limit per question (seconds)**
field, 0 by default (off). Set it to something like 20 or 30 and two
things happen for anyone who joins afterward:

- A countdown appears above each question. If it hits zero, the app
  moves on to the next question automatically - answered or not.
- Answering correctly within the limit now earns a small bonus on top
  of that question's normal points - up to +50% for an instant
  answer, tapering down to +0% right at the limit. This is on top of
  the usual score, not swapped in for it, so a fast student's total
  can end up higher than the quiz's max - that's intended, it's what
  makes it feel like a score to chase rather than just a grade. The
  "show meaning" half-credit penalty still applies on top of this if
  they used it.

Like the other settings, this can be changed any time and only
affects students who join afterward.

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

Come back to that quiz's page any time to see everyone's score. Click
**Review** on any response to see question-by-question right/wrong,
and to grade short-answer questions by hand.

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
4. Add an environment variable `TEACHER_PASSCODE` with your passcode
   in Render's dashboard (don't upload your `.env` file - Render's
   free tier already gives you a place to set this safely).
5. Render gives you a public URL - that's what you share.

**Railway.app** (free trial credit, then usage-based)
Same idea: connect the repo, set `TEACHER_PASSCODE` as an environment
variable, deploy.

### A limitation worth knowing about free hosting

This app stores quizzes and results in one file (`data/db.json`) on
whatever server it's running on - there's no separate database to set
up. That's what makes it simple to run, but on **some** free hosts
(notably Render's free tier), the filesystem resets on every restart
or redeploy, which would erase your data. Ways around this:

- Simplest: run the app on a machine you control and leave it on
  (an old laptop, a Raspberry Pi, a low-cost always-on VPS).
- On Render: use a paid instance with a persistent disk, or a host
  that offers a free persistent volume (Railway and Fly.io both have
  small free volumes at the time of writing - check their current
  free-tier terms, since these change).
- If you outgrow the single-file approach entirely, swapping in a
  free hosted database (like Supabase's free Postgres tier) is a
  bigger but doable change to `db.js`.

For a single class, running it locally during class time or on a
spare always-on machine is usually the easiest path.

---

## Choosing a theme

The palette icon in the top-right corner switches between 4 cozy dark
themes. Each one changes more than just the accent color - the corner
rounding, borders, heading typeface, and the shape of the seal badge
on scores all shift too, so they genuinely feel different rather than
being the same layout recolored:

- **Ink & Seal** (default) - espresso surfaces, seal-stamp red, a
  round stamp, a Chinese serif for headings.
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

**"Failed to load resource: 405" on `/api/teacher/login`, or the login
page doesn't work at all.**
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

**The passcode in `.env` doesn't seem to work.**
Make sure you copied `.env.example` to a file literally named `.env`
(not `.env.example` still, and not `.env.txt`), that it sits in the
same folder as `server.js`, and that you restarted `npm start` after
editing it - the app only reads `.env` when it starts up. Editing
`.env.example` itself does nothing; the app never reads that file,
it's only there as a template to copy from.

---

## A note on data

Everything - every quiz and every student response - lives in
`data/db.json` in this folder. There's no cloud account involved, no
analytics, nothing phoning home. Back that file up yourself if you
care about keeping old results (just copy it somewhere safe).
