# לוח הרעיונות - Project Ideas Board

אתר שבו כל אחד יכול לפרסם רעיון לפרויקט שהוא לא יכול/רוצה לפתח בעצמו,
ומפתחים אחרים יכולים לגלוש, להצביע (לייק/דיסלייק) ולאמץ ("יאללה עלי!") רעיונות.

- רעיונות ממוינים לפי ניקוד (לייקים פחות דיסלייקים) - הכי מוצבע למעלה.
- רעיון עם יותר מ-10 דיסלייקים עובר אוטומטית לסטטוס "בבדיקה".
- כשמישהו לוקח רעיון, הכרטיס משנה צבע (ירוק) ומוצג "נלקח ע"י ...".
- הרשמה עם שם מלא, שם משתמש בפורום ואימייל.

הכל בנוי כאתר סטטי (HTML/CSS/JS) שמתחבר ישירות ל-**Firebase** (חינמי):
- Firebase Authentication (אימייל+סיסמה)
- Firestore (מסד נתונים)
- Firebase Hosting (אחסון האתר, חינמי)

## שלב 1: יצירת פרויקט Firebase (חד פעמי, כ-5 דקות)

1. גשו ל-<https://console.firebase.google.com/> והתחברו עם חשבון Google.
2. לחצו "Add project" ותנו שם, למשל `projects-ideas-board`.
3. אחרי היצירה: בתפריט הצד -> **Build > Authentication** -> Get started ->
   הפעילו את ספק ההתחברות **Email/Password**.
4. בתפריט הצד -> **Build > Firestore Database** -> Create database ->
   בחרו "Start in production mode" (הכללים כבר מוכנים בקובץ `firestore.rules`).
5. בתפריט הצד -> **Project settings** (גלגל שיניים) -> למטה בעמוד "Your apps" ->
   לחצו על סמל ה-Web `</>` -> תנו שם לאפליקציה -> העתיקו את אובייקט ה-`firebaseConfig`.

## שלב 2: הזנת ההגדרות בפרויקט

פתחו את הקובץ `firebase-config.js` והחליפו את הערכים (`YOUR_API_KEY` וכו')
בערכים שהעתקתם משלב 1.

## שלב 3: הרצה מקומית (לבדיקה)

```
npm run dev
```

ואז פתחו בדפדפן: <http://localhost:5500>

## שלב 4: פריסה לאינטרנט (חינם, Firebase Hosting)

```
npx firebase-tools login
npx firebase-tools init hosting
```

בשלב ה-`init` תבחרו:
- "Use an existing project" -> את הפרויקט שיצרתם בשלב 1
- Public directory: `.` (נקודה, התיקייה הנוכחית)
- Configure as single-page app: `No`
- אל תדרסו את `index.html` הקיים אם נשאלים

לאחר מכן פרסו:

```
npx firebase-tools deploy
```

בסיום תקבלו קישור ציבורי בסגנון `https://<project-id>.web.app` - זה האתר שלכם, חינם.

## מבנה הפרויקט

| קובץ | תיאור |
|---|---|
| `index.html` | מבנה הדף (כותרת, טפסים, כרטיסי רעיונות) |
| `style.css` | עיצוב (ערכת נושא כהה עם זהב) |
| `firebase-config.js` | הגדרות חיבור ל-Firebase (יש למלא) |
| `app.js` | כל הלוגיקה - הרשמה/התחברות, פרסום רעיון, הצבעה, אימוץ |
| `firestore.rules` | כללי אבטחה של מסד הנתונים |
| `firebase.json` | הגדרות Hosting |

## רעיונות להרחבה עתידית

- מסך ניהול (Admin) לצפייה ברעיונות במצב "בבדיקה" והחלטה אם להחזיר/למחוק.
- תגובות על רעיונות.
- התראות למפרסם כשמישהו מאמץ את הרעיון שלו.
