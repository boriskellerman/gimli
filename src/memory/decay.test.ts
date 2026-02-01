import { describe, expect, it } from "vitest";
import {
  applyDecay,
  applyDecayToResults,
  calculateAgeDays,
  calculateDecayFactor,
  DEFAULT_DECAY_CONFIG,
  resolveDecayConfig,
  shouldArchive,
  type DecayConfig,
} from "./decay.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

describe("decay", () => {
  describe("calculateDecayFactor", () => {
    describe("exponential decay", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "exponential",
        halfLifeDays: 30,
        minFactor: 0.1,
      };

      it("returns 1.0 for zero age", () => {
        expect(calculateDecayFactor(0, config)).toBe(1.0);
      });

      it("returns 0.5 at half-life", () => {
        const factor = calculateDecayFactor(30, config);
        expect(factor).toBeCloseTo(0.5, 5);
      });

      it("returns ~0.25 at two half-lives", () => {
        const factor = calculateDecayFactor(60, config);
        expect(factor).toBeCloseTo(0.25, 5);
      });

      it("respects minFactor floor", () => {
        // At 300 days (10 half-lives), factor would be 2^(-10) = ~0.001
        const factor = calculateDecayFactor(300, config);
        expect(factor).toBe(0.1);
      });

      it("returns 1.0 when decay is disabled", () => {
        const disabled = { ...config, enabled: false };
        expect(calculateDecayFactor(100, disabled)).toBe(1.0);
      });

      it("returns 1.0 for negative age", () => {
        expect(calculateDecayFactor(-10, config)).toBe(1.0);
      });
    });

    describe("linear decay", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "linear",
        halfLifeDays: 30,
        minFactor: 0.1,
      };

      it("returns 1.0 for zero age", () => {
        expect(calculateDecayFactor(0, config)).toBe(1.0);
      });

      it("returns 0.5 at half-life", () => {
        const factor = calculateDecayFactor(30, config);
        expect(factor).toBeCloseTo(0.5, 5);
      });

      it("returns 0.0 at double half-life (clamped to minFactor)", () => {
        // At 60 days, linear would be 0, but minFactor is 0.1
        const factor = calculateDecayFactor(60, config);
        expect(factor).toBe(0.1);
      });

      it("handles zero halfLifeDays gracefully", () => {
        const zeroHalfLife = { ...config, halfLifeDays: 0 };
        expect(calculateDecayFactor(10, zeroHalfLife)).toBe(1.0);
      });
    });

    describe("stepped decay", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "stepped",
        halfLifeDays: 30, // not used for stepped
        minFactor: 0.1,
        steps: [
          { ageDays: 7, factor: 1.0 },
          { ageDays: 30, factor: 0.8 },
          { ageDays: 90, factor: 0.5 },
          { ageDays: 365, factor: 0.2 },
        ],
      };

      it("returns 1.0 for age below first step", () => {
        expect(calculateDecayFactor(5, config)).toBe(1.0);
      });

      it("returns first step factor at threshold", () => {
        expect(calculateDecayFactor(7, config)).toBe(1.0);
      });

      it("returns 0.8 for age between 30 and 90 days", () => {
        expect(calculateDecayFactor(45, config)).toBe(0.8);
      });

      it("returns 0.5 for age between 90 and 365 days", () => {
        expect(calculateDecayFactor(180, config)).toBe(0.5);
      });

      it("returns 0.2 for age >= 365 days", () => {
        expect(calculateDecayFactor(400, config)).toBe(0.2);
      });

      it("handles empty steps array", () => {
        const noSteps = { ...config, steps: [] };
        expect(calculateDecayFactor(100, noSteps)).toBe(1.0);
      });

      it("handles unsorted steps", () => {
        const unsorted: DecayConfig = {
          ...config,
          steps: [
            { ageDays: 90, factor: 0.5 },
            { ageDays: 7, factor: 1.0 },
            { ageDays: 30, factor: 0.8 },
          ],
        };
        expect(calculateDecayFactor(45, unsorted)).toBe(0.8);
      });

      it("respects minFactor for stepped decay", () => {
        const lowMin: DecayConfig = {
          ...config,
          minFactor: 0.3,
          steps: [{ ageDays: 1, factor: 0.1 }],
        };
        expect(calculateDecayFactor(10, lowMin)).toBe(0.3);
      });
    });
  });

  describe("applyDecay", () => {
    const config: DecayConfig = {
      enabled: true,
      function: "exponential",
      halfLifeDays: 30,
      minFactor: 0.1,
    };

    it("applies decay to score based on age", () => {
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * MS_PER_DAY;
      const decayed = applyDecay(1.0, thirtyDaysAgo, config, now);
      expect(decayed).toBeCloseTo(0.5, 5);
    });

    it("returns original score when disabled", () => {
      const disabled = { ...config, enabled: false };
      const now = Date.now();
      const oldTime = now - 100 * MS_PER_DAY;
      expect(applyDecay(0.8, oldTime, disabled, now)).toBe(0.8);
    });

    it("handles future timestamps gracefully", () => {
      const now = Date.now();
      const future = now + 10 * MS_PER_DAY;
      // Future timestamps should be treated as age 0
      expect(applyDecay(0.9, future, config, now)).toBe(0.9);
    });
  });

  describe("applyDecayToResults", () => {
    const config: DecayConfig = {
      enabled: true,
      function: "exponential",
      halfLifeDays: 30,
      minFactor: 0.1,
    };

    it("applies decay and re-sorts results", () => {
      const now = Date.now();
      const results = [
        { id: "old-high", score: 0.9, updatedAt: now - 60 * MS_PER_DAY }, // 60 days old
        { id: "new-low", score: 0.5, updatedAt: now - 1 * MS_PER_DAY }, // 1 day old
      ];

      const decayed = applyDecayToResults(results, config, now);

      // Old high-score should decay more (0.9 * 0.25 = 0.225)
      // New low-score should stay similar (0.5 * ~0.98 = ~0.49)
      expect(decayed[0].id).toBe("new-low");
      expect(decayed[1].id).toBe("old-high");
      expect(decayed[0].score).toBeGreaterThan(decayed[1].score);
    });

    it("returns original order when disabled", () => {
      const disabled = { ...config, enabled: false };
      const now = Date.now();
      const results = [
        { id: "a", score: 0.5, updatedAt: now - 100 * MS_PER_DAY },
        { id: "b", score: 0.8, updatedAt: now },
      ];

      const decayed = applyDecayToResults(results, disabled, now);
      expect(decayed[0].id).toBe("a");
      expect(decayed[0].score).toBe(0.5);
    });

    it("handles missing updatedAt by using now", () => {
      const now = Date.now();
      const results = [{ id: "x", score: 0.7, updatedAt: null }];

      const decayed = applyDecayToResults(results, config, now);
      // Should treat as just created, no decay
      expect(decayed[0].score).toBe(0.7);
    });

    it("handles empty results", () => {
      const decayed = applyDecayToResults([], config);
      expect(decayed).toEqual([]);
    });
  });

  describe("shouldArchive", () => {
    it("returns true when age exceeds threshold", () => {
      const now = Date.now();
      const oldTime = now - 400 * MS_PER_DAY;
      expect(shouldArchive(oldTime, 365, now)).toBe(true);
    });

    it("returns false when age is below threshold", () => {
      const now = Date.now();
      const recentTime = now - 10 * MS_PER_DAY;
      expect(shouldArchive(recentTime, 365, now)).toBe(false);
    });

    it("returns true at exact threshold", () => {
      const now = Date.now();
      const atThreshold = now - 365 * MS_PER_DAY;
      expect(shouldArchive(atThreshold, 365, now)).toBe(true);
    });

    it("returns false when threshold is 0 or negative", () => {
      const now = Date.now();
      const old = now - 1000 * MS_PER_DAY;
      expect(shouldArchive(old, 0, now)).toBe(false);
      expect(shouldArchive(old, -10, now)).toBe(false);
    });
  });

  describe("resolveDecayConfig", () => {
    it("returns defaults when no config provided", () => {
      const resolved = resolveDecayConfig();
      expect(resolved).toEqual(DEFAULT_DECAY_CONFIG);
    });

    it("merges partial config with defaults", () => {
      const resolved = resolveDecayConfig({
        enabled: true,
        halfLifeDays: 60,
      });

      expect(resolved.enabled).toBe(true);
      expect(resolved.halfLifeDays).toBe(60);
      expect(resolved.function).toBe("exponential");
      expect(resolved.minFactor).toBe(0.1);
    });

    it("clamps halfLifeDays to minimum of 1", () => {
      const resolved = resolveDecayConfig({ halfLifeDays: -5 });
      expect(resolved.halfLifeDays).toBe(1);
    });

    it("clamps minFactor to 0-1 range", () => {
      expect(resolveDecayConfig({ minFactor: -0.5 }).minFactor).toBe(0);
      expect(resolveDecayConfig({ minFactor: 1.5 }).minFactor).toBe(1);
    });
  });

  describe("calculateAgeDays", () => {
    it("calculates age in days correctly", () => {
      const now = Date.now();
      const tenDaysAgo = now - 10 * MS_PER_DAY;
      expect(calculateAgeDays(tenDaysAgo, now)).toBeCloseTo(10, 5);
    });

    it("returns 0 for future timestamps", () => {
      const now = Date.now();
      const future = now + 5 * MS_PER_DAY;
      expect(calculateAgeDays(future, now)).toBe(0);
    });

    it("handles fractional days", () => {
      const now = Date.now();
      const halfDayAgo = now - 0.5 * MS_PER_DAY;
      expect(calculateAgeDays(halfDayAgo, now)).toBeCloseTo(0.5, 5);
    });
  });

  describe("DEFAULT_DECAY_CONFIG", () => {
    it("has disabled decay by default", () => {
      expect(DEFAULT_DECAY_CONFIG.enabled).toBe(false);
    });

    it("uses exponential function by default", () => {
      expect(DEFAULT_DECAY_CONFIG.function).toBe("exponential");
    });

    it("has sensible default steps", () => {
      expect(DEFAULT_DECAY_CONFIG.steps).toBeDefined();
      expect(DEFAULT_DECAY_CONFIG.steps!.length).toBeGreaterThan(0);
      // Steps should be in ascending order by ageDays
      const steps = DEFAULT_DECAY_CONFIG.steps!;
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i].ageDays).toBeGreaterThan(steps[i - 1].ageDays);
      }
    });
  });

  describe("edge cases", () => {
    it("handles very large ages", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "exponential",
        halfLifeDays: 30,
        minFactor: 0.01,
      };
      // 10 years = ~3650 days
      const factor = calculateDecayFactor(3650, config);
      expect(factor).toBe(0.01); // Should hit minFactor
    });

    it("handles very small halfLifeDays", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "exponential",
        halfLifeDays: 0.1, // 2.4 hours
        minFactor: 0.01,
      };
      const factor = calculateDecayFactor(1, config); // 1 day old
      // 1 day / 0.1 = 10 half-lives, factor = 2^(-10) = 0.00097...
      expect(factor).toBe(0.01); // Clamped to minFactor
    });

    it("maintains score precision", () => {
      const config: DecayConfig = {
        enabled: true,
        function: "exponential",
        halfLifeDays: 30,
        minFactor: 0.001,
      };
      const now = Date.now();
      const score = 0.123456789;
      const decayed = applyDecay(score, now, config, now);
      // No decay for same timestamp
      expect(decayed).toBe(score);
    });
  });
});
