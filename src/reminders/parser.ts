/**
 * Natural language parser for reminder creation
 *
 * Parses human-readable reminder requests into structured reminder inputs.
 * Supports patterns like:
 * - "remind me to X at TIME"
 * - "remind me to X every DAY at TIME"
 * - "remind me to X when I mention Y"
 * - "remind me to X before Y"
 */

import type { CreateReminderInput, ReminderPriority, ReminderTrigger } from "./types.js";

/**
 * Result of parsing a natural language reminder request
 */
export interface ParsedReminder {
  /** The action/task to be reminded about */
  action: string;

  /** Parsed trigger information */
  trigger: ReminderTrigger;

  /** Extracted priority (if specified) */
  priority: ReminderPriority;

  /** Original input text */
  originalText: string;

  /** Confidence level of the parse (0-1) */
  confidence: number;
}

/**
 * Parse result with potential error
 */
export type ParseResult =
  | { success: true; reminder: ParsedReminder }
  | { success: false; error: string; partialAction?: string };

/**
 * Day name to cron day number mapping
 */
const DAY_TO_CRON: Record<string, string> = {
  sunday: "0",
  sun: "0",
  monday: "1",
  mon: "1",
  tuesday: "2",
  tue: "2",
  wednesday: "3",
  wed: "3",
  thursday: "4",
  thu: "4",
  friday: "5",
  fri: "5",
  saturday: "6",
  sat: "6",
  weekday: "1-5",
  weekdays: "1-5",
  weekend: "0,6",
  weekends: "0,6",
};

/**
 * Common time of day mappings
 */
const TIME_OF_DAY: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 9, minute: 0 },
  noon: { hour: 12, minute: 0 },
  midday: { hour: 12, minute: 0 },
  afternoon: { hour: 14, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 21, minute: 0 },
  midnight: { hour: 0, minute: 0 },
};

/**
 * Parse a natural language reminder request
 *
 * @param input - The natural language input (e.g., "remind me to call mom at 3pm")
 * @param baseDate - Reference date for relative time calculations (defaults to now)
 * @returns Parse result with structured reminder or error
 */
export function parseReminderRequest(input: string, baseDate: Date = new Date()): ParseResult {
  const normalizedInput = input.toLowerCase().trim();

  // Check for priority keywords
  const priority = extractPriority(normalizedInput);

  // Try different parsing strategies in order of specificity

  // 1. Context-triggered reminders ("when I mention X", "when discussing X")
  const contextResult = parseContextTrigger(normalizedInput, input, priority);
  if (contextResult.success) return contextResult;

  // 2. Recurring reminders ("every day", "every Monday", "weekly")
  const recurringResult = parseRecurringTrigger(normalizedInput, input, priority);
  if (recurringResult.success) return recurringResult;

  // 3. Relative time reminders ("before standup", "after lunch")
  const relativeResult = parseRelativeTimeTrigger(normalizedInput, input, priority, baseDate);
  if (relativeResult.success) return relativeResult;

  // 4. Absolute time reminders ("at 3pm", "tomorrow at 9am", "on January 20th")
  const scheduledResult = parseScheduledTrigger(normalizedInput, input, priority, baseDate);
  if (scheduledResult.success) return scheduledResult;

  // 5. Fallback: extract action and suggest user clarify timing
  const action = extractAction(normalizedInput, input);
  if (action) {
    return {
      success: false,
      error: "Could not determine when to remind you. Please specify a time, day, or context.",
      partialAction: action,
    };
  }

  return {
    success: false,
    error:
      "Could not parse reminder request. Try: 'remind me to X at TIME' or 'remind me to X every DAY'",
  };
}

/**
 * Extract priority from input text
 */
function extractPriority(input: string): ReminderPriority {
  if (/\b(urgent|urgently|asap|important|critical)\b/i.test(input)) {
    return "urgent";
  }
  if (/\b(low priority|low-priority|whenever|eventually|someday)\b/i.test(input)) {
    return "low";
  }
  return "normal";
}

/**
 * Extract the action/task from the reminder text, preserving original case
 *
 * @param normalizedInput - Lowercase version of input for pattern matching
 * @param originalInput - Original input to extract from (optional, defaults to normalizedInput)
 */
function extractAction(normalizedInput: string, originalInput?: string): string | null {
  // Work with normalized for pattern matching
  let processed = normalizedInput;

  // Remove common prefixes
  const prefixPattern =
    /^(please\s+)?(?:remind\s+me\s+(?:to\s+)?|don't\s+forget\s+(?:to\s+)?|remember\s+(?:to\s+)?)/i;
  processed = processed.replace(prefixPattern, "");

  // Remove timing/trigger phrases (will be parsed separately)
  // More precise pattern to only remove timing at the end
  const timingPatterns = [
    /\s+today\s+at\s+.*$/i, // Must come before general "at" pattern
    /\s+at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|midnight|noon|morning|evening|afternoon|night)$/i,
    /\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?.*$/i,
    /\s+on\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?.*$/i,
    /\s+every\s+.*$/i,
    /\s+when\s+.*$/i,
    /\s+before\s+.*$/i,
    /\s+after\s+.*$/i,
    /\s+in\s+\d+\s+(?:minute|minutes|min|mins|hour|hours|hr|hrs|day|days).*$/i,
    /\s+tomorrow(?:\s+at\s+.*)?$/i,
    /\s+tonight$/i,
    /\s+next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week).*$/i,
  ];

  for (const pattern of timingPatterns) {
    processed = processed.replace(pattern, "");
  }

  // Remove priority keywords
  processed = processed
    .replace(
      /\s*\b(urgent|urgently|asap|important|critical|low priority|low-priority|whenever|eventually|someday)\b\s*/gi,
      " ",
    )
    .trim();

  if (processed.length === 0) return null;

  // If we have original input, extract the same substring with original case
  if (originalInput) {
    // Find where the action starts and ends in the original
    const normalizedStart = normalizedInput.indexOf(processed);
    if (normalizedStart !== -1) {
      return originalInput.substring(normalizedStart, normalizedStart + processed.length).trim();
    }
  }

  return processed;
}

/**
 * Parse context-triggered reminders
 *
 * Patterns:
 * - "remind me about X when I mention Y"
 * - "remind me about X when discussing Y"
 * - "remind me to X when I talk about Y"
 */
function parseContextTrigger(
  normalizedInput: string,
  originalInput: string,
  priority: ReminderPriority,
): ParseResult {
  // Pattern: "when I mention/discuss/talk about X"
  const contextPatterns = [
    /when\s+(?:i\s+)?mention(?:ing)?\s+(.+?)$/i,
    /when\s+(?:i\s+)?discuss(?:ing)?\s+(.+?)$/i,
    /when\s+(?:i\s+)?talk(?:ing)?\s+about\s+(.+?)$/i,
    /when\s+(?:i\s+)?(?:am\s+)?review(?:ing)?\s+(.+?)$/i,
    /when\s+(?:i\s+)?(?:am\s+)?work(?:ing)?\s+on\s+(.+?)$/i,
  ];

  for (const pattern of contextPatterns) {
    const match = normalizedInput.match(pattern);
    if (match) {
      const contextKeywords = match[1].trim();
      // Extract action by removing the context trigger phrase
      const actionText = normalizedInput.replace(pattern, "").trim();
      // Find matching position in original (up to where the trigger phrase starts)
      const triggerStartIdx = originalInput.toLowerCase().indexOf(match[0]);
      const action = extractAction(
        actionText,
        triggerStartIdx > 0 ? originalInput.substring(0, triggerStartIdx) : originalInput,
      );

      if (action && contextKeywords) {
        return {
          success: true,
          reminder: {
            action,
            trigger: { type: "context", pattern: contextKeywords },
            priority,
            originalText: originalInput,
            confidence: 0.9,
          },
        };
      }
    }
  }

  return { success: false, error: "" };
}

/**
 * Parse recurring reminders
 *
 * Patterns:
 * - "every day at TIME"
 * - "every Monday at TIME"
 * - "every morning"
 * - "weekly on DAY"
 * - "daily"
 */
function parseRecurringTrigger(
  normalizedInput: string,
  originalInput: string,
  priority: ReminderPriority,
): ParseResult {
  // Check for "every" patterns
  const everyMatch = normalizedInput.match(
    /every\s+(day|morning|evening|night|afternoon|weekday|weekend|week|month|(\w+day))\s*(?:at\s+)?(.+)?$/i,
  );

  if (everyMatch) {
    const frequency = everyMatch[1].toLowerCase();
    const timeSpec = everyMatch[3]?.trim();
    const actionPart = normalizedInput.replace(/every\s+.+$/i, "").trim();
    const action = extractAction(actionPart, originalInput);

    if (!action) {
      return { success: false, error: "Could not extract reminder action" };
    }

    // Parse time component
    const time = parseTimeSpec(timeSpec) || TIME_OF_DAY[frequency] || { hour: 9, minute: 0 };

    // Generate cron expression
    let cron: string;

    if (frequency === "day" || frequency === "daily") {
      cron = `${time.minute} ${time.hour} * * *`;
    } else if (frequency === "weekday" || frequency === "weekdays") {
      cron = `${time.minute} ${time.hour} * * 1-5`;
    } else if (frequency === "weekend" || frequency === "weekends") {
      cron = `${time.minute} ${time.hour} * * 0,6`;
    } else if (frequency === "week" || frequency === "weekly") {
      cron = `${time.minute} ${time.hour} * * 1`; // Default to Monday
    } else if (frequency === "month" || frequency === "monthly") {
      cron = `${time.minute} ${time.hour} 1 * *`; // First of month
    } else if (frequency in TIME_OF_DAY) {
      // "every morning", "every evening", etc.
      const tod = TIME_OF_DAY[frequency];
      cron = `${tod.minute} ${tod.hour} * * *`;
    } else if (DAY_TO_CRON[frequency]) {
      // "every Monday", "every Friday", etc.
      cron = `${time.minute} ${time.hour} * * ${DAY_TO_CRON[frequency]}`;
    } else {
      return { success: false, error: `Unknown frequency: ${frequency}` };
    }

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "recurring", cron },
        priority,
        originalText: originalInput,
        confidence: 0.85,
      },
    };
  }

  // Check for "daily/weekly/monthly" shorthand
  const shorthandMatch = normalizedInput.match(/\b(daily|weekly|monthly)\b/i);
  if (shorthandMatch) {
    const frequency = shorthandMatch[1].toLowerCase();
    const timeMatch = normalizedInput.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    const time = timeMatch ? parseTimeSpec(timeMatch[1]) : { hour: 9, minute: 0 };
    const actionPart = normalizedInput.replace(/\b(daily|weekly|monthly)\b/i, "").trim();
    const action = extractAction(actionPart, originalInput);

    if (!action || !time) {
      return { success: false, error: "Could not parse recurring reminder" };
    }

    let cron: string;
    if (frequency === "daily") {
      cron = `${time.minute} ${time.hour} * * *`;
    } else if (frequency === "weekly") {
      cron = `${time.minute} ${time.hour} * * 1`;
    } else {
      cron = `${time.minute} ${time.hour} 1 * *`;
    }

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "recurring", cron },
        priority,
        originalText: originalInput,
        confidence: 0.8,
      },
    };
  }

  // Check for specific days with "and" combinations
  // e.g., "every Monday and Wednesday at 9am"
  const multiDayMatch = normalizedInput.match(
    /every\s+((?:\w+day\s*(?:,|and)\s*)+\w+day)\s*(?:at\s+)?(.+)?$/i,
  );
  if (multiDayMatch) {
    const daysText = multiDayMatch[1].toLowerCase();
    const timeSpec = multiDayMatch[2]?.trim();
    const actionPart = normalizedInput.replace(/every\s+.+$/i, "").trim();
    const action = extractAction(actionPart, originalInput);

    if (!action) {
      return { success: false, error: "Could not extract reminder action" };
    }

    // Parse days
    const dayNumbers: string[] = [];
    for (const [dayName, dayNum] of Object.entries(DAY_TO_CRON)) {
      if (daysText.includes(dayName)) {
        if (!dayNumbers.includes(dayNum)) {
          dayNumbers.push(dayNum);
        }
      }
    }

    if (dayNumbers.length === 0) {
      return { success: false, error: "Could not parse day names" };
    }

    const time = parseTimeSpec(timeSpec) || { hour: 9, minute: 0 };
    const cron = `${time.minute} ${time.hour} * * ${dayNumbers.join(",")}`;

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "recurring", cron },
        priority,
        originalText: originalInput,
        confidence: 0.85,
      },
    };
  }

  return { success: false, error: "" };
}

/**
 * Parse relative time reminders ("before X", "after Y")
 */
function parseRelativeTimeTrigger(
  normalizedInput: string,
  originalInput: string,
  priority: ReminderPriority,
  baseDate: Date,
): ParseResult {
  // Pattern: "before standup", "before the meeting"
  const beforeMatch = normalizedInput.match(/before\s+(.+?)(?:\s+tomorrow|\s+today)?$/i);
  if (beforeMatch) {
    const eventName = beforeMatch[1].trim();
    const actionPart = normalizedInput.replace(/before\s+.+$/i, "").trim();
    const action = extractAction(actionPart, originalInput);

    if (action) {
      // For "before X", we create a context trigger on the event name
      // The user can also specify a time, but "before standup" is often
      // meant as a contextual reminder
      return {
        success: true,
        reminder: {
          action,
          trigger: { type: "context", pattern: eventName },
          priority,
          originalText: originalInput,
          confidence: 0.7, // Lower confidence - user might want a specific time
        },
      };
    }
  }

  // Pattern: "in X minutes/hours/days"
  const inTimeMatch = normalizedInput.match(
    /in\s+(\d+)\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i,
  );
  if (inTimeMatch) {
    const amount = parseInt(inTimeMatch[1], 10);
    const unit = inTimeMatch[2].toLowerCase();
    const actionPart = normalizedInput.replace(/in\s+\d+\s+\w+/i, "").trim();
    const action = extractAction(actionPart, originalInput);

    if (action && !isNaN(amount)) {
      const targetDate = new Date(baseDate);

      if (unit.startsWith("min")) {
        targetDate.setMinutes(targetDate.getMinutes() + amount);
      } else if (unit.startsWith("hour") || unit === "hr" || unit === "hrs") {
        targetDate.setHours(targetDate.getHours() + amount);
      } else if (unit.startsWith("day")) {
        targetDate.setDate(targetDate.getDate() + amount);
      }

      return {
        success: true,
        reminder: {
          action,
          trigger: { type: "scheduled", datetime: targetDate },
          priority,
          originalText: originalInput,
          confidence: 0.9,
        },
      };
    }
  }

  return { success: false, error: "" };
}

/**
 * Parse scheduled (one-time) reminders
 *
 * Patterns:
 * - "at 3pm"
 * - "tomorrow at 9am"
 * - "on January 20th"
 * - "next Monday at 2pm"
 */
function parseScheduledTrigger(
  normalizedInput: string,
  originalInput: string,
  priority: ReminderPriority,
  baseDate: Date,
): ParseResult {
  // Try to extract action first
  const action = extractAction(normalizedInput, originalInput);
  if (!action) {
    return { success: false, error: "Could not extract reminder action" };
  }

  // Pattern: "tomorrow at TIME" or just "tomorrow"
  const tomorrowMatch = normalizedInput.match(/tomorrow(?:\s+at\s+(.+))?$/i);
  if (tomorrowMatch) {
    const timeSpec = tomorrowMatch[1];
    const time = parseTimeSpec(timeSpec) || { hour: 9, minute: 0 };
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(time.hour, time.minute, 0, 0);

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "scheduled", datetime: targetDate },
        priority,
        originalText: originalInput,
        confidence: 0.9,
      },
    };
  }

  // Pattern: "today at TIME"
  const todayMatch = normalizedInput.match(/today\s+at\s+(.+)$/i);
  if (todayMatch) {
    const time = parseTimeSpec(todayMatch[1]);
    if (time) {
      const targetDate = new Date(baseDate);
      targetDate.setHours(time.hour, time.minute, 0, 0);

      return {
        success: true,
        reminder: {
          action,
          trigger: { type: "scheduled", datetime: targetDate },
          priority,
          originalText: originalInput,
          confidence: 0.9,
        },
      };
    }
  }

  // Pattern: "tonight" (typically 8pm)
  if (normalizedInput.includes("tonight")) {
    const targetDate = new Date(baseDate);
    targetDate.setHours(20, 0, 0, 0);

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "scheduled", datetime: targetDate },
        priority,
        originalText: originalInput,
        confidence: 0.85,
      },
    };
  }

  // Pattern: "next DAYNAME at TIME"
  const nextDayMatch = normalizedInput.match(
    /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)\s*(?:at\s+(.+))?$/i,
  );
  if (nextDayMatch) {
    const dayName = nextDayMatch[1].toLowerCase();
    const timeSpec = nextDayMatch[2];
    const time = parseTimeSpec(timeSpec) || { hour: 9, minute: 0 };

    const targetDate = new Date(baseDate);

    if (dayName === "week") {
      // "next week" means the same day next week
      targetDate.setDate(targetDate.getDate() + 7);
    } else {
      // Find the next occurrence of the specified day
      const dayNum = parseInt(DAY_TO_CRON[dayName], 10);
      const currentDay = targetDate.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Always go to NEXT week's occurrence
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }

    targetDate.setHours(time.hour, time.minute, 0, 0);

    return {
      success: true,
      reminder: {
        action,
        trigger: { type: "scheduled", datetime: targetDate },
        priority,
        originalText: originalInput,
        confidence: 0.85,
      },
    };
  }

  // Pattern: "on MONTH DAY" or "on MONTH DAYth at TIME"
  // Check this BEFORE "at TIME" to avoid partial matching
  const onDateMatch = normalizedInput.match(
    /on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:at\s+(.+))?$/i,
  );
  if (onDateMatch) {
    const monthName = onDateMatch[1].toLowerCase();
    const day = parseInt(onDateMatch[2], 10);
    const timeSpec = onDateMatch[3];
    const time = parseTimeSpec(timeSpec) || { hour: 9, minute: 0 };

    const monthIndex = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(monthName);

    if (monthIndex !== -1 && day >= 1 && day <= 31) {
      const targetDate = new Date(baseDate);
      targetDate.setMonth(monthIndex, day);
      targetDate.setHours(time.hour, time.minute, 0, 0);

      // If the date has passed this year, use next year
      if (targetDate <= baseDate) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }

      return {
        success: true,
        reminder: {
          action,
          trigger: { type: "scheduled", datetime: targetDate },
          priority,
          originalText: originalInput,
          confidence: 0.85,
        },
      };
    }
  }

  // Pattern: "at TIME" (same day) - matches both "3pm" and "midnight"/"noon"
  // Check this AFTER more specific date patterns
  const atTimeMatch = normalizedInput.match(
    /at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|midnight|noon|morning|evening|afternoon|night)/i,
  );
  if (atTimeMatch) {
    const time = parseTimeSpec(atTimeMatch[1]);
    if (time) {
      const targetDate = new Date(baseDate);
      targetDate.setHours(time.hour, time.minute, 0, 0);

      // If the time has already passed today, schedule for tomorrow
      if (targetDate <= baseDate) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      return {
        success: true,
        reminder: {
          action,
          trigger: { type: "scheduled", datetime: targetDate },
          priority,
          originalText: originalInput,
          confidence: 0.85,
        },
      };
    }
  }

  return { success: false, error: "" };
}

/**
 * Parse a time specification into hours and minutes
 *
 * Supports formats:
 * - "3pm", "3:30pm", "15:30"
 * - "9 am", "9:00 AM"
 * - "morning", "evening", etc.
 */
function parseTimeSpec(spec: string | undefined): { hour: number; minute: number } | null {
  if (!spec) return null;

  const normalized = spec.toLowerCase().trim();

  // Check for time-of-day names
  if (TIME_OF_DAY[normalized]) {
    return TIME_OF_DAY[normalized];
  }

  // Pattern: "3pm", "3:30pm", "3:30 pm"
  const timeMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    // Convert to 24-hour format
    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    } else if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
  }

  // Pattern: 24-hour format "15:30"
  const militaryMatch = normalized.match(/^(\d{2}):(\d{2})$/);
  if (militaryMatch) {
    const hour = parseInt(militaryMatch[1], 10);
    const minute = parseInt(militaryMatch[2], 10);

    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
  }

  return null;
}

/**
 * Convert a ParsedReminder to a CreateReminderInput
 */
export function parsedToCreateInput(parsed: ParsedReminder, agentId: string): CreateReminderInput {
  return {
    agentId,
    title: parsed.action,
    trigger: parsed.trigger,
    priority: parsed.priority,
  };
}

/**
 * Validate a cron expression (basic validation)
 */
export function isValidCron(cron: string): boolean {
  const parts = cron.split(" ");
  if (parts.length !== 5) return false;

  // Each part should be a valid cron field
  const patterns = [
    /^(\*|\d{1,2}(,\d{1,2})*(-\d{1,2})?)$/, // minute: 0-59
    /^(\*|\d{1,2}(,\d{1,2})*(-\d{1,2})?)$/, // hour: 0-23
    /^(\*|\d{1,2}(,\d{1,2})*(-\d{1,2})?)$/, // day of month: 1-31
    /^(\*|\d{1,2}(,\d{1,2})*(-\d{1,2})?)$/, // month: 1-12
    /^(\*|\d(,\d)*(-\d)?|[0-6](-[0-6])?)$/, // day of week: 0-6
  ];

  return parts.every((part, i) => patterns[i].test(part));
}

/**
 * Get a human-readable description of a cron expression
 */
export function describeCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const timeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  if (dayOfMonth === "*" && month === "*") {
    // Daily or weekly pattern
    if (dayOfWeek === "*") {
      return `Daily at ${timeStr}`;
    }
    if (dayOfWeek === "1-5") {
      return `Weekdays at ${timeStr}`;
    }
    if (dayOfWeek === "0,6") {
      return `Weekends at ${timeStr}`;
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = dayOfWeek.split(",").map((d) => dayNames[parseInt(d, 10)] || d);
    return `Every ${days.join(", ")} at ${timeStr}`;
  }

  if (dayOfMonth !== "*" && month === "*") {
    // Monthly pattern
    return `Monthly on day ${dayOfMonth} at ${timeStr}`;
  }

  return `Cron: ${cron}`;
}
