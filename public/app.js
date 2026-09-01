// ============================================
// MeetHub - Unified Meeting Dashboard
// ============================================

(function () {
  'use strict';

  // --- State ---
  let allEvents = [];
  let calendars = [];
  let activeCalendars = new Set();
  let calendarInstance = null;
  let notificationsEnabled = false;
  let notifiedEvents = new Set();
  let refreshTimer = null;

  // --- Config ---
  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const ALERT_MINUTES = [15, 5, 1]; // notify at 15, 5, 1 min before
  const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // --- Auth ---
  function getAuthParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get('auth') || localStorage.getItem('meethub_auth') || '';
  }

  // --- API ---
  async function fetchEvents() {
    const auth = getAuthParam();
    const headers = {};
    if (auth) headers['X-MeetHub-Auth'] = auth;

    const res = await fetch('/api/events' + (auth ? `?auth=${encodeURIComponent(auth)}` : ''), { headers });

    if (res.status === 401) {
      const pwd = prompt('Enter MeetHub password:');
      if (pwd) {
        localStorage.setItem('meethub_auth', pwd);
        return fetchEvents();
      }
      throw new Error('Unauthorized');
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // --- Time Helpers ---
  function formatTime(dateStr, timezone) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  }

  function formatDate(dateStr, timezone) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    });
  }

  function formatDateTimeFull(dateStr, timezone) {
    return new Date(dateStr).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  }

  function timeUntil(dateStr) {
    const diff = new Date(dateStr) - new Date();
    if (diff < 0) return 'Now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs < 24) return `in ${hrs}h ${remMins}m`;
    const days = Math.floor(hrs / 24);
    return `in ${days}d`;
  }

  function isHappeningNow(event) {
    const now = new Date();
    return new Date(event.start) <= now && event.end && new Date(event.end) > now;
  }

  function getMinutesUntil(dateStr) {
    return (new Date(dateStr) - new Date()) / 60000;
  }

  // --- Platform Icons ---
  function platformIcon(platform) {
    switch (platform) {
      case 'google-meet': return '📹';
      case 'teams': return '🟣';
      case 'zoom': return '🔵';
      default: return '🔗';
    }
  }

  function platformLabel(platform) {
    switch (platform) {
      case 'google-meet': return 'Google Meet';
      case 'teams': return 'Teams';
      case 'zoom': return 'Zoom';
      default: return 'Join';
    }
  }

  // --- Render: Upcoming Bar ---
  function renderUpcoming() {
    const container = document.getElementById('upcoming-list');
    const now = new Date();
    const upcoming = allEvents
      .filter(e => activeCalendars.has(e.calendarId))
      .filter(e => {
        const start = new Date(e.start);
        const end = e.end ? new Date(e.end) : null;
        // Show if happening now or starting within next 24h
        return (end && end > now && start <= now) || (start > now && start - now < 24 * 60 * 60 * 1000);
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 8);

    if (upcoming.length === 0) {
      container.innerHTML = '<p class="muted">No upcoming meetings in the next 24 hours 🎉</p>';
      return;
    }

    container.innerHTML = upcoming.map(event => {
      const happeningNow = isHappeningNow(event);
      const timeLabel = happeningNow ? '🟢 Happening Now' : `${formatTime(event.start, LOCAL_TZ)} · ${timeUntil(event.start)}`;
      const joinBtn = event.joinLink
        ? `<a href="${event.joinLink}" target="_blank" rel="noopener" class="btn btn-join upcoming-join-btn ${event.joinPlatform || ''}" onclick="event.stopPropagation()">${platformIcon(event.joinPlatform)} Join</a>`
        : '';

      return `
        <div class="upcoming-card ${happeningNow ? 'happening-now' : ''}"
             style="border-left-color: ${event.calendarColor}"
             onclick="window.MeetHub.showEventModal('${event.id}')">
          <div class="upcoming-time">${timeLabel}</div>
          <div class="upcoming-title">${escapeHtml(event.title)}</div>
          <div class="upcoming-meta">
            <span class="upcoming-client-badge" style="background: ${event.calendarColor}">${escapeHtml(event.calendarName)}</span>
            ${joinBtn}
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Render: Filter Chips ---
  function renderFilters() {
    const container = document.getElementById('calendar-filters');
    container.innerHTML = calendars.map(cal => {
      const isActive = activeCalendars.has(cal.id);
      return `
        <div class="filter-chip ${isActive ? 'active' : 'inactive'}"
             style="color: ${cal.color}"
             onclick="window.MeetHub.toggleCalendar('${cal.id}')">
          <span class="filter-dot" style="background: ${cal.color}"></span>
          ${escapeHtml(cal.name)}
          <span class="filter-count">${cal.eventCount}</span>
        </div>
      `;
    }).join('');
  }

  // --- Render: Calendar ---
  function initCalendar() {
    const calEl = document.getElementById('calendar');
    calendarInstance = new FullCalendar.Calendar(calEl, {
      initialView: window.innerWidth < 768 ? 'listWeek' : 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
      },
      nowIndicator: true,
      allDaySlot: true,
      slotMinTime: '06:00:00',
      slotMaxTime: '23:00:00',
      expandRows: true,
      stickyHeaderDates: true,
      dayMaxEvents: 3,
      eventTimeFormat: {
        hour: 'numeric',
        minute: '2-digit',
        meridiem: 'short',
      },
      events: getFilteredCalendarEvents(),
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        const eventId = info.event.extendedProps.eventId;
        window.MeetHub.showEventModal(eventId);
      },
      eventDidMount: function (info) {
        // Add tooltip title
        info.el.title = `${info.event.title} (${info.event.extendedProps.calendarName})`;
      },
      windowResize: function () {
        if (window.innerWidth < 768) {
          calendarInstance.changeView('listWeek');
        }
      },
    });
    calendarInstance.render();
  }

  function getFilteredCalendarEvents() {
    return allEvents
      .filter(e => activeCalendars.has(e.calendarId))
      .map(e => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        color: e.calendarColor,
        textColor: '#ffffff',
        extendedProps: {
          eventId: e.id,
          calendarName: e.calendarName,
          joinLink: e.joinLink,
          joinPlatform: e.joinPlatform,
        },
      }));
  }

  function refreshCalendarEvents() {
    if (!calendarInstance) return;
    calendarInstance.removeAllEvents();
    calendarInstance.addEventSource(getFilteredCalendarEvents());
  }

  // --- Event Modal ---
  window.MeetHub = window.MeetHub || {};

  window.MeetHub.showEventModal = function (eventId) {
    const event = allEvents.find(e => e.id === eventId);
    if (!event) return;

    const modal = document.getElementById('event-modal');
    const body = document.getElementById('modal-body');

    // Build timezone grid
    const tzSet = new Set([LOCAL_TZ, event.calendarTimezone]);
    const tzBlocks = [...tzSet].map(tz => `
      <div class="tz-block">
        <div class="tz-label">${tz.split('/').pop().replace(/_/g, ' ')}</div>
        <div class="tz-time">${formatDateTimeFull(event.start, tz)}</div>
      </div>
    `).join('');

    // Duration
    let duration = '';
    if (event.end) {
      const mins = Math.round((new Date(event.end) - new Date(event.start)) / 60000);
      if (mins < 60) duration = `${mins} min`;
      else duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }

    // Join button
    const joinBtn = event.joinLink
      ? `<a href="${event.joinLink}" target="_blank" rel="noopener" class="btn btn-join modal-join-btn ${event.joinPlatform || ''}">
           ${platformIcon(event.joinPlatform)} Join ${platformLabel(event.joinPlatform)}
         </a>`
      : '';

    body.innerHTML = `
      <div class="modal-event-title" style="border-left: 4px solid ${event.calendarColor}; padding-left: 12px;">
        ${escapeHtml(event.title)}
      </div>

      <div class="modal-detail">
        <span class="modal-detail-icon">📅</span>
        <span class="modal-detail-text">
          <strong>${formatDate(event.start, LOCAL_TZ)}</strong> · ${formatTime(event.start, LOCAL_TZ)} – ${event.end ? formatTime(event.end, LOCAL_TZ) : '?'}
          ${duration ? `<br><span class="muted">${duration}</span>` : ''}
        </span>
      </div>

      <div class="modal-timezone-grid">${tzBlocks}</div>

      <div class="modal-detail">
        <span class="modal-detail-icon">📋</span>
        <span class="modal-detail-text">
          <span class="upcoming-client-badge" style="background: ${event.calendarColor}">${escapeHtml(event.calendarName)}</span>
        </span>
      </div>

      ${event.location ? `
        <div class="modal-detail">
          <span class="modal-detail-icon">📍</span>
          <span class="modal-detail-text">${escapeHtml(event.location)}</span>
        </div>
      ` : ''}

      ${event.organizer ? `
        <div class="modal-detail">
          <span class="modal-detail-icon">👤</span>
          <span class="modal-detail-text">${escapeHtml(event.organizer)}</span>
        </div>
      ` : ''}

      ${event.description ? `
        <div class="modal-detail">
          <span class="modal-detail-icon">📝</span>
          <span class="modal-detail-text" style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(event.description)}</span>
        </div>
      ` : ''}

      ${joinBtn}
    `;

    modal.classList.remove('hidden');
  };

  window.MeetHub.toggleCalendar = function (calId) {
    if (activeCalendars.has(calId)) {
      activeCalendars.delete(calId);
    } else {
      activeCalendars.add(calId);
    }
    renderFilters();
    renderUpcoming();
    refreshCalendarEvents();
  };

  // Close modal
  document.getElementById('event-modal').addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) {
      this.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.getElementById('event-modal').classList.add('hidden');
    }
  });

  // --- Notifications ---
  async function enableNotifications() {
    if (!('Notification' in window)) {
      alert('Notifications not supported in this browser');
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      notificationsEnabled = true;
      document.getElementById('btn-notifications').textContent = '🔔✓';
      startNotificationChecker();
    }
  }

  function startNotificationChecker() {
    setInterval(checkUpcomingNotifications, 30000); // check every 30s
  }

  function checkUpcomingNotifications() {
    if (!notificationsEnabled) return;
    const now = new Date();

    allEvents
      .filter(e => activeCalendars.has(e.calendarId))
      .forEach(event => {
        const minsUntil = getMinutesUntil(event.start);
        ALERT_MINUTES.forEach(alertMin => {
          const key = `${event.id}-${alertMin}`;
          if (minsUntil > 0 && minsUntil <= alertMin + 0.5 && minsUntil > alertMin - 0.5 && !notifiedEvents.has(key)) {
            notifiedEvents.add(key);
            const body = `${event.calendarName} · ${formatTime(event.start, LOCAL_TZ)}`;
            const n = new Notification(`${alertMin === 1 ? '⚠️' : '⏰'} ${event.title} in ${alertMin} min`, {
              body,
              icon: '/icons/icon-192.png',
              tag: key,
              requireInteraction: alertMin <= 5,
            });
            if (event.joinLink) {
              n.onclick = () => {
                window.open(event.joinLink, '_blank');
                n.close();
              };
            }
          }
        });
      });
  }

  // --- Refresh ---
  async function refresh() {
    try {
      const data = await fetchEvents();
      allEvents = data.events || [];
      calendars = data.calendars || [];

      // Initialize active calendars on first load
      if (activeCalendars.size === 0) {
        calendars.forEach(c => activeCalendars.add(c.id));
      }

      renderFilters();
      renderUpcoming();

      if (calendarInstance) {
        refreshCalendarEvents();
      } else {
        initCalendar();
      }

      document.getElementById('last-sync').textContent =
        `Synced ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

      if (data.error) {
        console.warn('API warning:', data.error);
      }
    } catch (err) {
      console.error('Failed to refresh:', err);
      document.getElementById('upcoming-list').innerHTML =
        `<p class="muted">⚠️ Failed to load: ${escapeHtml(err.message)}</p>`;
    }
  }

  // --- Utility ---
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Init ---
  async function init() {
    const loading = document.getElementById('loading');

    // Refresh button
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      document.getElementById('btn-refresh').textContent = '⏳';
      await refresh();
      document.getElementById('btn-refresh').textContent = '🔄';
    });

    // Notifications button
    document.getElementById('btn-notifications').addEventListener('click', enableNotifications);

    // Initial load
    await refresh();
    loading.classList.add('hidden');

    // Auto-refresh
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL);

    // Update upcoming bar every minute
    setInterval(renderUpcoming, 60000);

    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (e) {
        console.log('SW registration skipped:', e.message);
      }
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
