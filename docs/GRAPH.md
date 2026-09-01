# گراف اجتماعی و پیشنهاد نیکسو

لایهٔ Graph روی Friend، Follow، Block، Mute و Restrict موجود است — جایگزین مخاطبین نیست. شکست پیشنهاد Login، چت، تماس یا فایل را متوقف نمی‌کند. **Graph ابزار استخراج دفترچه یا رابطهٔ خصوصی دیگران نیست.**

## روابط

- Friend Request / Accept / Reject / Cancel / Remove در `src/lib/contacts.ts`.
- Follow / Unfollow، حریم Follow، Block (اولویت بالاتر)، Mute، Restrict همان ماژول.
- رویدادهای مهم در `graph.events` نسخه‌دار می‌شوند؛ کش پیشنهاد همان کاربر باطل می‌شود.
- حذف رابطه و Unblock طبق سیاست مخاطبین؛ پیشنهاد از Store زنده ساخته می‌شود نه از یال حذف‌شده.

## پیشنهاد

`GET /api/graph` (نشست). Candidate سپس فیلتر:

- Block / Restrict / Mute
- Hide / Not interested / searchHide
- حساب مشکوک (Follow انبوه در یک ساعت، وضعیت غیر فعال)
- گروه فقط `open` + قابل Discovery؛ کانال فقط `public` + active
- محبوبیت با `log2` سقف‌دار؛ تازگی وزن دارد؛ تنوع نوع در صفحه

شخصی‌سازی (`recPersonalize`) قابل خاموش شدن است؛ گروه/کانال عمومی برای شروع سرد می‌ماند. اعلان پیشنهاد (`recNotify`) پیش‌فرض خاموش است.

دلیل سطح‌بالا: دوستان مشترک، گروه/کانال مشترک، کشف عمومی، محتوای تازه، سازندهٔ تازه — نه ویژگی حساس استنباط‌شده.

## حریم

- خروجی Export فقط نام کاربری دوست/Follow؛ بدون تلفن، ایمیل، دفترچه، موقعیت دقیق.
- Mutual Friends فقط اگر حریم فهرست دوستان اجازه دهد.
- Cache با `userId`؛ تزریق شناسه در کش کاربر دیگر نمایش داده نمی‌شود.
- Contact Discovery و Address Book همچنان Opt-In جدا در مخاطبین.
- AI با intent `recommend` همان `aiSafeRecLines` مجاز را می‌خواند؛ مجوز جدید نمی‌سازد.

## ایمنی و عملیات

- Rate Limit روی feed و mutuals.
- Eval و Rollback مدل فقط `nixo` / `nixo_ops`.
- متریک تجمعی: Query، Empty، Latency P95/P99، Clicks.
- Worker سبک `graph.jobs` داخل Store؛ افق افقی با جداسازی ماژول نه وابستگی به یک Graph DB خاص.

## API

| روش | عمل |
| --- | --- |
| `GET /api/graph` | feed |
| `GET /api/graph?action=health` | سلامت تجمعی |
| `GET /api/graph?action=export` | خروجی صاحب حساب |
| `GET /api/graph?action=eval` | نشت خصوصی (ops) |
| `GET /api/graph?action=mutuals&userId=` | مشترک مجاز |
| `POST` `feedback` / `prefs` / `rollback` | بازخورد، کنترل، Rollback |

جستجو همان ACL گروه/کانال عمومی را نگه می‌دارد؛ پیشنهاد اجتماعی در [`docs/GRAPH.md`](./GRAPH.md) و `/api/graph` است و ایندکس را دور نمی‌زند.
