/**
 * Tests for the natural language reminder parser
 */

import { describe, expect, it } from "vitest";

import { describeCron, isValidCron, parseReminderRequest, parsedToCreateInput } from "./parser.js";

describe("parseReminderRequest", () => {
  // Use a fixed date for deterministic testing
  const baseDate = new Date("2026-01-15T10:00:00.000Z");

  describe("scheduled reminders", () => {
    it("parses 'at TIME' format", () => {
      const result = parseReminderRequest("remind me to call mom at 3pm", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("call mom");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(15);
        expect(result.reminder.trigger.datetime.getMinutes()).toBe(0);
      }
    });

    it("parses 'at TIME' with minutes", () => {
      const result = parseReminderRequest("remind me to check email at 9:30am", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("check email");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(9);
        expect(result.reminder.trigger.datetime.getMinutes()).toBe(30);
      }
    });

    it("parses 'tomorrow at TIME'", () => {
      const result = parseReminderRequest("remind me to submit report tomorrow at 9am", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("submit report");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const datetime = result.reminder.trigger.datetime;
        expect(datetime.getDate()).toBe(16); // Jan 16
        expect(datetime.getHours()).toBe(9);
      }
    });

    it("parses 'tomorrow' without time (defaults to 9am)", () => {
      const result = parseReminderRequest("remind me to review PRs tomorrow", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("review PRs");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(9);
      }
    });

    it("parses 'today at TIME'", () => {
      const result = parseReminderRequest("remind me to call the dentist today at 2pm", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("call the dentist");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(14);
      }
    });

    it("parses 'tonight'", () => {
      const result = parseReminderRequest("remind me to take out trash tonight", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("take out trash");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(20);
      }
    });

    it("parses 'next Monday at TIME'", () => {
      // Base date is Jan 15, 2026 (Thursday)
      const result = parseReminderRequest(
        "remind me to start project next Monday at 10am",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("start project");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const datetime = result.reminder.trigger.datetime;
        expect(datetime.getDay()).toBe(1); // Monday
        expect(datetime.getHours()).toBe(10);
      }
    });

    it("parses 'next week'", () => {
      const result = parseReminderRequest("remind me to follow up with client next week", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("follow up with client");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const datetime = result.reminder.trigger.datetime;
        // Should be 7 days later
        expect(datetime.getDate()).toBe(22);
      }
    });

    it("parses 'on MONTH DAY'", () => {
      const result = parseReminderRequest(
        "remind me about the API deadline on March 15th",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("about the API deadline");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const datetime = result.reminder.trigger.datetime;
        expect(datetime.getMonth()).toBe(2); // March (0-indexed)
        expect(datetime.getDate()).toBe(15);
      }
    });

    it("parses 'on MONTH DAY at TIME'", () => {
      const result = parseReminderRequest(
        "remind me to call the dentist on January 20th at 2pm",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("call the dentist");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const datetime = result.reminder.trigger.datetime;
        expect(datetime.getMonth()).toBe(0); // January
        expect(datetime.getDate()).toBe(20);
        expect(datetime.getHours()).toBe(14);
      }
    });

    it("schedules for tomorrow if time has passed today", () => {
      // Base is 10:00 AM, asking for 9am
      const result = parseReminderRequest("remind me to check logs at 9am", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        // Should be tomorrow since 9am has passed
        expect(result.reminder.trigger.datetime.getDate()).toBe(16);
      }
    });
  });

  describe("recurring reminders", () => {
    it("parses 'every day at TIME'", () => {
      const result = parseReminderRequest("remind me to check email every day at 8:30am", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("check email");
      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("30 8 * * *");
      }
    });

    it("parses 'every morning'", () => {
      const result = parseReminderRequest("remind me to review dashboard every morning", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("review dashboard");
      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 9 * * *");
      }
    });

    it("parses 'every Monday at TIME'", () => {
      const result = parseReminderRequest(
        "remind me to update team status every Monday at 9am",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("update team status");
      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 9 * * 1");
      }
    });

    it("parses 'every Friday at TIME'", () => {
      const result = parseReminderRequest(
        "remind me to submit expenses every Friday at 4pm",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("submit expenses");
      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 16 * * 5");
      }
    });

    it("parses 'every weekday'", () => {
      const result = parseReminderRequest(
        "remind me to check Slack every weekday at 9am",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 9 * * 1-5");
      }
    });

    it("parses 'every weekend'", () => {
      const result = parseReminderRequest("remind me to backup files every weekend", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 9 * * 0,6");
      }
    });

    it("parses 'daily' shorthand", () => {
      const result = parseReminderRequest("remind me daily at 8am to check logs", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 8 * * *");
      }
    });

    it("parses 'weekly' shorthand", () => {
      const result = parseReminderRequest("remind me weekly at 10am to review metrics", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 10 * * 1");
      }
    });

    it("parses 'monthly' shorthand", () => {
      const result = parseReminderRequest("remind me monthly at 9am to review budget", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 9 1 * *");
      }
    });

    it("parses 'every evening'", () => {
      const result = parseReminderRequest("remind me to journal every evening", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("recurring");
      if (result.reminder.trigger.type === "recurring") {
        expect(result.reminder.trigger.cron).toBe("0 18 * * *");
      }
    });
  });

  describe("context-triggered reminders", () => {
    it("parses 'when I mention X'", () => {
      const result = parseReminderRequest(
        "remind me about the deployment checklist when I mention staging",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("about the deployment checklist");
      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("staging");
      }
    });

    it("parses 'when discussing X'", () => {
      const result = parseReminderRequest(
        "remind me about security best practices when discussing authentication",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("about security best practices");
      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("authentication");
      }
    });

    it("parses 'when I talk about X'", () => {
      const result = parseReminderRequest(
        "remind me about code review when I talk about PR",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("pr");
      }
    });

    it("parses 'when reviewing X'", () => {
      const result = parseReminderRequest(
        "remind me about the security checklist when reviewing PRs",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("prs");
      }
    });

    it("parses 'when working on X'", () => {
      const result = parseReminderRequest(
        "remind me to update tests when working on the API",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("the api");
      }
    });
  });

  describe("relative time reminders", () => {
    it("parses 'before X' as context trigger", () => {
      const result = parseReminderRequest("remind me to review PRs before standup", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("review PRs");
      expect(result.reminder.trigger.type).toBe("context");
      if (result.reminder.trigger.type === "context") {
        expect(result.reminder.trigger.pattern).toBe("standup");
      }
      // Lower confidence since user might want a specific time
      expect(result.reminder.confidence).toBeLessThan(0.8);
    });

    it("parses 'in X minutes'", () => {
      const result = parseReminderRequest("remind me to take a break in 30 minutes", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("take a break");
      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const expected = new Date(baseDate);
        expected.setMinutes(expected.getMinutes() + 30);
        expect(result.reminder.trigger.datetime.getTime()).toBe(expected.getTime());
      }
    });

    it("parses 'in X hours'", () => {
      const result = parseReminderRequest("remind me to follow up in 2 hours", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const expected = new Date(baseDate);
        expected.setHours(expected.getHours() + 2);
        expect(result.reminder.trigger.datetime.getTime()).toBe(expected.getTime());
      }
    });

    it("parses 'in X days'", () => {
      const result = parseReminderRequest("remind me to check status in 3 days", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        const expected = new Date(baseDate);
        expected.setDate(expected.getDate() + 3);
        expect(result.reminder.trigger.datetime.getTime()).toBe(expected.getTime());
      }
    });
  });

  describe("priority extraction", () => {
    it("extracts urgent priority", () => {
      const result = parseReminderRequest(
        "remind me urgently to submit the form tomorrow at 9am",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("urgent");
    });

    it("extracts urgent from 'important'", () => {
      const result = parseReminderRequest(
        "remind me about the important meeting tomorrow at 10am",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("urgent");
    });

    it("extracts urgent from 'asap'", () => {
      const result = parseReminderRequest("remind me asap to call the client in 1 hour", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("urgent");
    });

    it("extracts low priority", () => {
      const result = parseReminderRequest(
        "remind me whenever to clean up old branches when I mention cleanup",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("low");
    });

    it("extracts low from 'low priority'", () => {
      const result = parseReminderRequest(
        "remind me low priority to review old PRs tomorrow",
        baseDate,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("low");
    });

    it("defaults to normal priority", () => {
      const result = parseReminderRequest("remind me to check email tomorrow at 9am", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.priority).toBe("normal");
    });
  });

  describe("edge cases and error handling", () => {
    it("handles 'please remind me' prefix", () => {
      const result = parseReminderRequest("please remind me to call mom at 3pm", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("call mom");
    });

    it("handles 'don't forget' prefix", () => {
      const result = parseReminderRequest("don't forget to submit the form tomorrow", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("submit the form");
    });

    it("handles 'remember to' prefix", () => {
      const result = parseReminderRequest("remember to buy groceries tomorrow at 5pm", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.action).toBe("buy groceries");
    });

    it("returns error when timing cannot be determined", () => {
      const result = parseReminderRequest("remind me to do something", baseDate);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.partialAction).toBe("do something");
      expect(result.error).toContain("Could not determine when");
    });

    it("returns error for empty input", () => {
      const result = parseReminderRequest("", baseDate);

      expect(result.success).toBe(false);
    });

    it("returns error for just 'remind me'", () => {
      const result = parseReminderRequest("remind me", baseDate);

      expect(result.success).toBe(false);
    });

    it("preserves original text", () => {
      const original = "Remind Me To CALL MOM at 3PM";
      const result = parseReminderRequest(original, baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.originalText).toBe(original);
    });
  });

  describe("time parsing edge cases", () => {
    it("handles midnight", () => {
      const result = parseReminderRequest("remind me to backup at midnight", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.reminder.trigger.type).toBe("scheduled");
      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(0);
      }
    });

    it("handles noon", () => {
      const result = parseReminderRequest("remind me to take lunch at noon", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(12);
      }
    });

    it("handles 12pm correctly", () => {
      const result = parseReminderRequest("remind me to have lunch at 12pm", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(12);
      }
    });

    it("handles 12am correctly", () => {
      const result = parseReminderRequest("remind me at 12am to check backups", baseDate);

      expect(result.success).toBe(true);
      if (!result.success) return;

      if (result.reminder.trigger.type === "scheduled") {
        expect(result.reminder.trigger.datetime.getHours()).toBe(0);
      }
    });
  });
});

describe("parsedToCreateInput", () => {
  it("converts parsed reminder to create input", () => {
    const parsed = {
      action: "call mom",
      trigger: { type: "scheduled" as const, datetime: new Date("2026-01-20T15:00:00Z") },
      priority: "normal" as const,
      originalText: "remind me to call mom at 3pm",
      confidence: 0.9,
    };

    const input = parsedToCreateInput(parsed, "agent-123");

    expect(input.agentId).toBe("agent-123");
    expect(input.title).toBe("call mom");
    expect(input.trigger).toEqual(parsed.trigger);
    expect(input.priority).toBe("normal");
  });
});

describe("isValidCron", () => {
  it("validates correct cron expressions", () => {
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("30 8 * * 1-5")).toBe(true);
    expect(isValidCron("0 17 * * 5")).toBe(true);
    expect(isValidCron("0 0 1 * *")).toBe(true);
  });

  it("rejects invalid cron expressions", () => {
    expect(isValidCron("invalid")).toBe(false);
    expect(isValidCron("* * *")).toBe(false); // Too few parts
    expect(isValidCron("* * * * * *")).toBe(false); // Too many parts
  });
});

describe("describeCron", () => {
  it("describes daily cron", () => {
    expect(describeCron("0 9 * * *")).toBe("Daily at 09:00");
  });

  it("describes weekday cron", () => {
    expect(describeCron("30 8 * * 1-5")).toBe("Weekdays at 08:30");
  });

  it("describes weekend cron", () => {
    expect(describeCron("0 10 * * 0,6")).toBe("Weekends at 10:00");
  });

  it("describes specific days", () => {
    expect(describeCron("0 9 * * 1")).toBe("Every Mon at 09:00");
    expect(describeCron("0 17 * * 5")).toBe("Every Fri at 17:00");
  });

  it("describes monthly cron", () => {
    expect(describeCron("0 9 1 * *")).toBe("Monthly on day 1 at 09:00");
  });

  it("returns raw cron for complex patterns", () => {
    expect(describeCron("0 9 15 6 *")).toBe("Cron: 0 9 15 6 *");
  });
});
