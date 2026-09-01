const ical = require('node-ical');

// Parse calendar configs from environment variables
function getCalendarConfigs() {
  const calendars = [];
  for (let i = 1; i <= 10; i++) {
    const url = process.env[`CALENDAR_${i}_URL`];
    if (url && url.trim()) {
      calendars.push({
        id: `cal-${i}`,
        url: url.trim(),
        name: process.env[`CALENDAR_${i}_NAME`] || `Calendar ${i}`,
        color: process.env[`CALENDAR_${i}_COLOR`] || '#3B82F6',
        timezone: process.env[`CALENDAR_${i}_TIMEZONE`] || 'UTC',
      });
    }
  }
  return calendars;
}

// Extract meeting join link from event
function extractJoinLink(event) {
  const fields = [
    event.location || '',
    event.description || '',
    event.url?.val || event.url || '',
  ].join(' ');

  // Google Meet
  const meetMatch = fields.match(/https:\/\/meet\.google\.com\/[a-z\-]+/i);
  if (meetMatch) return { url: meetMatch[0], platform: 'google-meet' };

  // Microsoft Teams
  const teamsMatch = fields.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<"')]+/i);
  if (teamsMatch) return { url: teamsMatch[0], platform: 'teams' };

  // Zoom
  const zoomMatch = fields.match(/https:\/\/[\w.]*zoom\.us\/j\/[^\s<"')]+/i);
  if (zoomMatch) return { url: zoomMatch[0], platform: 'zoom' };

  // Generic URL fallback from location
  if (event.location && /^https?:\/\//.test(event.location.trim())) {
    return { url: event.location.trim(), platform: 'link' };
  }

  return null;
}

// Parse a single ICS feed
async function parseICSFeed(calConfig) {
  try {
    const data = await ical.async.fromURL(calConfig.url);
    const events = [];
    const now = new Date();
    const pastLimit = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const futureLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead

    for (const [, event] of Object.entries(data)) {
      if (event.type !== 'VEVENT') continue;

      const start = event.start ? new Date(event.start) : null;
      const end = event.end ? new Date(event.end) : null;

      if (!start || isNaN(start.getTime())) continue;

      // Handle recurring events - expand occurrences
      let occurrences = [];
      if (event.rrule) {
        try {
          const dates = event.rrule.between(pastLimit, futureLimit, true);
          const duration = end ? end.getTime() - start.getTime() : 3600000;

          // Fix rrule timezone double-conversion:
          // node-ical correctly parses event.start to UTC, but the rrule library
          // may apply the timezone offset again (especially with Windows TZ IDs
          // like "India Standard Time"). Detect by comparing time-of-day.
          let tzFixMs = 0;
          if (dates.length > 0 && start) {
            const startTOD = start.getUTCHours() * 3600000 + start.getUTCMinutes() * 60000 + start.getUTCSeconds() * 1000;
            const d0 = new Date(dates[0]);
            const rruleTOD = d0.getUTCHours() * 3600000 + d0.getUTCMinutes() * 60000 + d0.getUTCSeconds() * 1000;
            let diff = startTOD - rruleTOD;
            if (diff > 12 * 3600000) diff -= 24 * 3600000;
            if (diff < -12 * 3600000) diff += 24 * 3600000;
            if (diff !== 0) {
              console.log(`[RRULE TZ FIX] "${event.summary}" — correcting by ${diff / 3600000}h`);
              tzFixMs = diff;
            }
          }

          // Build exdates set (excluded/cancelled occurrences)
          const exdates = new Set();
          if (event.exdate) {
            const exArr = (event.exdate instanceof Date)
              ? [event.exdate]
              : Array.isArray(event.exdate)
                ? event.exdate
                : Object.values(event.exdate);
            exArr.forEach(d => {
              const dt = new Date(d);
              if (!isNaN(dt.getTime())) exdates.add(dt.toDateString());
            });
          }

          occurrences = dates
            .filter(d => !exdates.has(new Date(new Date(d).getTime() + tzFixMs).toDateString()))
            .map(d => ({
              start: new Date(new Date(d).getTime() + tzFixMs),
              end: new Date(new Date(d).getTime() + tzFixMs + duration),
            }));

          console.log(`[RRULE] "${event.summary}" — found ${dates.length} dates, after exdate filter: ${occurrences.length}, tzFix: ${tzFixMs / 3600000}h`);
        } catch (e) {
          console.error(`[RRULE ERROR] "${event.summary}":`, e.message);
          // Fallback: if rrule parsing fails, show original occurrence if in range
          if (start >= pastLimit && start <= futureLimit) {
            occurrences = [{ start, end }];
          }
        }
      } else if (event.recurrences) {
        // node-ical sometimes pre-expands recurrences instead of giving rrule
        const duration = end ? end.getTime() - start.getTime() : 3600000;
        for (const [, recEvent] of Object.entries(event.recurrences)) {
          const rStart = recEvent.start ? new Date(recEvent.start) : null;
          if (!rStart || isNaN(rStart.getTime())) continue;
          if (rStart >= pastLimit && rStart <= futureLimit) {
            occurrences.push({
              start: rStart,
              end: new Date(rStart.getTime() + duration),
            });
          }
        }
        // Also include the original if in range
        if (start >= pastLimit && start <= futureLimit) {
          occurrences.push({ start, end });
        }
        console.log(`[RECURRENCES] "${event.summary}" — found ${occurrences.length} expanded occurrences`);
      } else {
        // Non-recurring: filter by date range
        if (start < pastLimit || start > futureLimit) continue;
        occurrences = [{ start, end }];
      }

      const joinLink = extractJoinLink(event);

      for (const occ of occurrences) {
        events.push({
          id: `${calConfig.id}-${event.uid}-${occ.start.getTime()}`,
          title: event.summary || '(No title)',
          start: occ.start.toISOString(),
          end: occ.end ? occ.end.toISOString() : null,
          allDay: !!(event.datetype === 'date'),
          location: event.location || null,
          description: (event.description || '').substring(0, 500),
          calendarId: calConfig.id,
          calendarName: calConfig.name,
          calendarColor: calConfig.color,
          calendarTimezone: calConfig.timezone,
          joinLink: joinLink ? joinLink.url : null,
          joinPlatform: joinLink ? joinLink.platform : null,
          organizer: event.organizer?.params?.CN || event.organizer?.val || null,
          status: event.status || null,
        });
      }
    }
    return events;
  } catch (err) {
    console.error(`Failed to fetch calendar "${calConfig.name}":`, err.message);
    return [];
  }
}

module.exports = async function handler(req, res) {
  // Optional password protection
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const authHeader = req.headers['x-meethub-auth'] || '';
    const queryAuth = req.query?.auth || '';
    if (authHeader !== appPassword && queryAuth !== appPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-MeetHub-Auth');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const configs = getCalendarConfigs();

    if (configs.length === 0) {
      return res.status(200).json({
        events: [],
        calendars: [],
        error: 'No calendars configured. Add CALENDAR_*_URL environment variables.',
      });
    }

    // Fetch all feeds in parallel
    const results = await Promise.all(configs.map(c => parseICSFeed(c)));
    const allEvents = results.flat();

    // Sort by start time
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

    const calendars = configs.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      timezone: c.timezone,
      eventCount: allEvents.filter(e => e.calendarId === c.id).length,
    }));

    return res.status(200).json({
      events: allEvents,
      calendars,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Failed to fetch calendars' });
  }
};
