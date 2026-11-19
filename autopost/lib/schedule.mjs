// Posting times. The config lists local clock times per weekday; GitHub's cron runs in UTC
// every hour, and this decides whether a time slot is due right now in the configured time zone.

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The wall-clock parts of `date` in `timeZone`.
export function localParts(date, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    day: p.weekday.slice(0, 3).toLowerCase(),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// The slot times for one weekday: config.slots[day] wins over config.slots.default.
export function slotsFor(day, slots) {
  if (!DAYS.includes(day)) throw new Error(`bad weekday ${day}`);
  return slots[day] ?? slots.default ?? [];
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`bad slot time "${hhmm}" (use 24-hour HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// The slot that is due now and not yet used, or null. A slot stays due for catchUpHours after its time,
// because GitHub can start scheduled runs late or skip one when it is busy.
export function dueSlot(now, config, usedSlots) {
  const { ymd, day, minutes } = localParts(now, config.timezone);
  const window = (config.catchUpHours ?? 3) * 60;
  for (const t of slotsFor(day, config.slots)) {
    const at = toMinutes(t);
    const key = `${ymd} ${t}`;
    if (minutes >= at && minutes - at < window && !usedSlots.has(key)) return key;
  }
  return null;
}

// The next few slot times from now, for the plan printout.
export function upcomingSlots(now, config, count = 6) {
  const out = [];
  for (let d = 0; d < 8 && out.length < count; d++) {
    const probe = new Date(now.getTime() + d * 86400000);
    const { ymd, day, minutes } = localParts(probe, config.timezone);
    for (const t of slotsFor(day, config.slots)) {
      if (d === 0 && toMinutes(t) <= localParts(now, config.timezone).minutes) continue;
      out.push(`${day} ${ymd} ${t}`);
      if (out.length >= count) break;
    }
  }
  return out;
}

export function validateSlots(slots) {
  for (const [k, list] of Object.entries(slots)) {
    if (k !== "default" && !DAYS.includes(k)) throw new Error(`config.slots: unknown key "${k}" (use default, sun, mon, tue, wed, thu, fri, sat)`);
    list.forEach(toMinutes);
  }
}
