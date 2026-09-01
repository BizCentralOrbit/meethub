# MeetHub Setup Guide

A free, self-hosted unified meeting dashboard that pulls all your Google Calendar and Outlook/Teams calendars into one view.

**Cost: $0** (Vercel free tier handles everything)

---

## Prerequisites

- A free [Vercel](https://vercel.com) account (sign up with GitHub)
- A free [GitHub](https://github.com) account
- Node.js 18+ installed locally (for testing; optional)

---

## Step 1: Get Your ICS Calendar URLs

### Google Calendar (for each Google account)

1. Go to [Google Calendar](https://calendar.google.com)
2. Click the gear icon → **Settings**
3. In the left sidebar, click the calendar you want to add
4. Scroll down to **"Secret address in iCal format"**
5. Copy that URL — it looks like:
   ```
   https://calendar.google.com/calendar/ical/XXXXX/basic.ics
   ```
6. Repeat for each Google account (sign in to each account separately)

> **Important:** Use the "Secret address", not the public one. The secret address includes all your events including private ones.

### Outlook / Microsoft 365 / Teams (for each account)

1. Go to [Outlook Web](https://outlook.office.com/calendar)
2. Click the gear icon → **View all Outlook settings**
3. Go to **Calendar** → **Shared calendars**
4. Under **"Publish a calendar"**, select your calendar and choose **"Can view all details"**
5. Click **Publish**
6. Copy the **ICS** link (not the HTML one) — it looks like:
   ```
   https://outlook.office365.com/owa/calendar/XXXXX/calendar.ics
   ```
7. Repeat for each Microsoft/Teams account

---

## Step 2: Deploy to Vercel (Free)

### Option A: One-Click Deploy (Easiest)

1. Push this `meethub` folder to a new GitHub repo:
   ```bash
   cd meethub
   git init
   git add .
   git commit -m "Initial MeetHub setup"
   gh repo create meethub --private --push
   ```
   Or manually create a private repo on GitHub and push.

2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your `meethub` GitHub repo
4. In the **Environment Variables** section, add your calendars:

   | Variable | Value |
   |----------|-------|
   | `CALENDAR_1_URL` | Your first ICS URL |
   | `CALENDAR_1_NAME` | `Client A (Google)` |
   | `CALENDAR_1_COLOR` | `#3B82F6` |
   | `CALENDAR_1_TIMEZONE` | `America/New_York` |
   | `CALENDAR_2_URL` | Your second ICS URL |
   | `CALENDAR_2_NAME` | `Client B (Teams)` |
   | `CALENDAR_2_COLOR` | `#10B981` |
   | `CALENDAR_2_TIMEZONE` | `Europe/London` |
   | ... | (repeat for each calendar) |
   | `APP_PASSWORD` | (optional) A password to protect your dashboard |

5. Click **Deploy**
6. Your dashboard is live at `https://meethub-XXXX.vercel.app`

### Option B: Vercel CLI

```bash
cd meethub
npm install
npm install -g vercel
vercel login
vercel --prod
```

Then add environment variables in the Vercel dashboard: **Project Settings → Environment Variables**.

---

## Step 3: Add to Your Phone (PWA)

### iPhone/iPad
1. Open your MeetHub URL in Safari
2. Tap the Share button (box with arrow)
3. Tap **"Add to Home Screen"**
4. Name it "MeetHub" and tap Add

### Android
1. Open your MeetHub URL in Chrome
2. Tap the three-dot menu
3. Tap **"Add to Home screen"** or **"Install app"**

Now MeetHub works like a native app on your phone!

---

## Step 4: Enable Meeting Alerts

1. Open MeetHub in your browser
2. Click the 🔔 button in the top right
3. Allow notifications when prompted
4. You'll get alerts at **15 min, 5 min, and 1 min** before each meeting
5. Click the notification to directly join the meeting

> Note: Notifications only work when MeetHub is open in a browser tab (or installed as PWA).

---

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALENDAR_N_URL` | Yes | ICS feed URL |
| `CALENDAR_N_NAME` | No | Display name (default: "Calendar N") |
| `CALENDAR_N_COLOR` | No | Hex color code (default: #3B82F6) |
| `CALENDAR_N_TIMEZONE` | No | IANA timezone (default: UTC) |
| `APP_PASSWORD` | No | Password-protect your dashboard |

Where `N` is 1 through 10 (supports up to 10 calendars).

### Color Suggestions

| Color | Hex | Good for |
|-------|-----|----------|
| Blue | `#3B82F6` | Primary client |
| Green | `#10B981` | Secondary client |
| Purple | `#8B5CF6` | Internal meetings |
| Orange | `#F59E0B` | Client C |
| Red | `#EF4444` | Urgent/Priority |
| Teal | `#14B8A6` | Client D |
| Pink | `#EC4899` | Personal |
| Indigo | `#6366F1` | Client E |

### Timezone Examples

| Region | IANA Timezone |
|--------|---------------|
| India | `Asia/Kolkata` |
| US East | `America/New_York` |
| US West | `America/Los_Angeles` |
| UK | `Europe/London` |
| Germany | `Europe/Berlin` |
| Japan | `Asia/Tokyo` |
| Australia | `Australia/Sydney` |
| UAE | `Asia/Dubai` |
| Singapore | `Asia/Singapore` |

---

## Adding/Removing Calendars

1. Go to your Vercel dashboard → Project → Settings → Environment Variables
2. Add/edit/remove `CALENDAR_N_*` variables
3. Redeploy (or it auto-redeploys on next push)

---

## Security Notes

- Your ICS URLs are stored as Vercel environment variables (encrypted at rest)
- The optional `APP_PASSWORD` prevents anyone from viewing your dashboard
- The GitHub repo should be **private** (it doesn't contain secrets, but good practice)
- ICS URLs are secret — don't share them publicly

---

## Troubleshooting

**"No calendars configured"** → Add `CALENDAR_1_URL` environment variable in Vercel

**Events not showing** → Verify your ICS URL works by pasting it directly in a browser (it should download an .ics file)

**Outlook ICS not working** → Make sure you selected "Can view all details" when publishing, and copied the ICS link (not HTML)

**Stale data** → The API caches for 5 minutes. Click the 🔄 button to force refresh.

**Notifications not working** → Make sure you clicked 🔔 and allowed browser notifications. Doesn't work in incognito mode.
