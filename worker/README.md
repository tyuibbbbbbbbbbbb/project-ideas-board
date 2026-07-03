# Project Ideas Worker

זהו ה"מתווך" המאובטח בין האתר הסטטי (GitHub Pages) לבין מסד הנתונים
שנשמר כקבצי JSON בריפו הפרטי `project-ideas-data` בגיטהאב.

הוא רץ על **Cloudflare Workers** (חינמי לחלוטין ל-100,000 בקשות ביום),
ומחזיק בסוד שני דברים שאסור שיהיו חשופים בקוד הציבורי של האתר:
1. **GitHub Token** - מפתח כתיבה לריפו `project-ideas-data` בלבד.
2. **JWT Secret** - מחרוזת סודית לחתימת "כרטיסי כניסה" (sessions) של משתמשים.

## שלב 1: יצירת חשבון Cloudflare (חינמי, חד פעמי)

גשו ל-<https://dash.cloudflare.com/sign-up> והירשמו (אימייל + סיסמה, לא צריך כרטיס אשראי).

## שלב 2: יצירת GitHub Token מוגבל (רק לריפו הנתונים)

1. גשו ל-<https://github.com/settings/tokens?type=beta> (Fine-grained tokens)
2. **Generate new token**
3. Repository access -> **Only select repositories** -> `project-ideas-data`
4. Permissions -> **Contents** -> **Read and write**
5. צרו את הטוקן והעתיקו אותו (מוצג פעם אחת בלבד!)

## שלב 3: התחברות ופריסה עם Wrangler

בתיקיית `worker/` (בתוך התיקייה הזו):

```
npx wrangler login
```

ייפתח דפדפן לאישור החיבור לחשבון ה-Cloudflare שלכם.

לאחר מכן הגדירו את הסוד (יתבקש להזין ערך):

```
npx wrangler secret put GITHUB_TOKEN
```

הדביקו את הטוקן משלב 2 (חייב להיות עם הרשאת **Contents: Read and write** על הריפו `project-ideas-data`).

לבסוף פרסו:

```
npx wrangler deploy
```

בסיום תקבלו כתובת ציבורית כמו:
`https://project-ideas-worker.<your-subdomain>.workers.dev`

## שלב 4: חיבור האתר ל-Worker

פתחו את `../config.js` בתיקיית האתר הראשית והחליפו את `WORKER_URL`
בכתובת שקיבלתם. לאחר מכן `git push` לריפו של האתר - האתר יתחיל לעבוד.

## מבנה הנתונים

בריפו `project-ideas-data`:
- `data/users.json` - רשימת משתמשים (שם, שם משתמש, אימייל, hash+salt של סיסמה, רעיונות שמורים)
- `data/ideas.json` - כל הרעיונות (כותרת, תיאור, הצבעות, סטטוס, מי אימץ)

כל שינוי (הרשמה, הצבעה, אימוץ) יוצר **commit חדש** בריפו הזה - כלומר יש היסטוריה מלאה של כל שינוי במערכת, ממש כמו קוד.
