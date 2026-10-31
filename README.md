# הלימודים שלי 📚

אפליקציה לאייפון שמסדרת את כל הלימודים במקום אחד:
**מבחנים · סיכומים וחומר · שעות למידה · משימות** — עם חיבור ל-**Google Classroom** וייבוא מ-**וובטופ**.

זו אפליקציית ווב (PWA): מתקינים אותה מספארי למסך הבית, והיא נפתחת כמו אפליקציה רגילה, במסך מלא, וגם בלי אינטרנט.
אין שרת ואין חשבון. כל הנתונים נשמרים רק בטלפון שלך.

## מה יש בפנים

| לשונית | מה עושים שם |
|---|---|
| **בית** | ספירה לאחור למבחנים הקרובים, משימות להיום, שעות הלמידה היום ובשבוע, מטרה שבועית ורצף ימים |
| **מבחנים** | לוח מבחנים. לכל מבחן יש רשימת חומר עם סימון "עוד לא / בתהליך / שולט/ת" ואחוז מוכנות, הערות, ציון וממוצע, והוספה ליומן עם תזכורות |
| **משימות** | שיעורי בית ומטלות לפי "באיחור / היום / מחר / השבוע" |
| **למידה** | טיימר (סטופר או פומודורו), הוספת זמן ידנית, גרף שבועי ופילוח לפי מקצוע |
| **חומר** | סיכומים, צילומי מחברת ודפי עבודה (מצלמה או קבצים/PDF), קישורים, חיפוש, סינון לפי מקצוע ונעיצה |

לכל מקצוע יש גם עמוד משלו: המבחנים, המשימות, החומר, שעות הלמידה והממוצע שלו.

## להעלות לאוויר (פעם אחת)

הריפו פרטי, ו-GitHub Pages חינמי רק לריפו ציבורי. יש שתי אפשרויות:

**א. GitHub Pages (הכי פשוט)**
1. ב-GitHub: ‏**Settings → General → Danger Zone → Change visibility → Public**.
   מה שנחשף זה רק הקוד. הנתונים שלך לא נמצאים בריפו.
2. ‏**Settings → Pages**. תחת *Build and deployment* בוחרים **Deploy from a branch**, ואז את הענף (`main` אחרי מיזוג, או הענף הזה) ואת התיקייה **/ (root)**, ולוחצים **Save**.
3. אחרי כדקה האפליקציה זמינה בכתובת: `https://ofertheking.github.io/school-app/`

**ב. להשאיר את הריפו פרטי:** מחברים אותו ל-[Netlify](https://app.netlify.com/) או ל-[Cloudflare Pages](https://pages.cloudflare.com/) (חינם). אין build, וה-publish directory הוא תיקיית השורש.

## התקנה באייפון

1. פותחים את הכתובת ב**ספארי**.
2. לוחצים על כפתור השיתוף ⬆️, בוחרים **"הוספה למסך הבית"** ואז **"הוספה"**.
3. מעכשיו פותחים מהאייקון.

## Google Classroom

1. ב-[Google Cloud Console](https://console.cloud.google.com/) יוצרים פרויקט ומפעילים את **Google Classroom API**.
2. ב-**OAuth consent screen** בוחרים External, ומוסיפים את עצמך תחת **Test users**.
3. ב-**Credentials** יוצרים **OAuth client ID** מסוג **Web application**:
   - Authorized JavaScript origins: `https://ofertheking.github.io`
   - Authorized redirect URIs: `https://ofertheking.github.io/school-app/`
4. באפליקציה: **הגדרות → Google Classroom**, מדביקים את ה-Client ID ולוחצים **התחברות וסנכרון**.

הסנכרון מביא את הכיתות (והופך אותן למקצועות), את המטלות עם תאריכי ההגשה, ואת מה שכבר הוגש מסמן כבוצע. מטלה שבשם שלה יש "מבחן", "בוחן" או "בגרות" נכנסת ללוח המבחנים, וחומרי לימוד נכנסים ללשונית חומר.
ההרשאות לקריאה בלבד, וכלום לא נשלח לשום שרת חוץ מגוגל.

> ⚠️ בחשבון של בית ספר (Google Workspace for Education), ובמיוחד לתלמידים מתחת לגיל 18, מנהל המערכת יכול לחסום אפליקציות חיצוניות. אם מופיעה שגיאת הרשאה, צריך לבקש מרכז/ת המחשוב לאשר את ה-Client ID.

## וובטופ

לוובטופ (SmartSchool) אין API פתוח לאפליקציות, אז הייבוא נעשה בהעתק-הדבק:
1. בוובטופ פותחים את **לוח מבחנים** (או שיעורי בית), מסמנים את הטבלה ומעתיקים.
2. באפליקציה: **הגדרות → וובטופ → ייבוא**, מדביקים ולוחצים **זיהוי**.
3. האפליקציה מזהה תאריכים (`12/11`, `12.11.2026` וכו׳), מקצועות וסוג (מבחן, בוחן, בגרות, עבודה). אפשר לתקן לפני השמירה.

## גיבוי

**הגדרות → ייצוא גיבוי** יוצר קובץ JSON עם כל הנתונים, כולל התמונות. אפשר לשמור אותו ב-iCloud Drive ולשחזר בכל מכשיר.

---

### Tech notes (English)

- Static PWA, vanilla ES modules, no build step and no dependencies. Serve the repo root as-is.
- Data lives in IndexedDB (state JSON + image/PDF blobs), with a localStorage fallback. `navigator.storage.persist()` is requested.
- `sw.js` caches the shell for offline use and generates `.ics` files on the device (`cal.ics?d=…`), so iOS opens them in the Calendar app.
- Google Classroom uses the OAuth 2.0 implicit flow with a full-page redirect, because popups are unreliable in iOS standalone mode. Scopes are read-only.
- Bump `CACHE` in `sw.js` whenever you change files, so installed copies update.
