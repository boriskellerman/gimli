/**
 * Expert Manager — Act → Learn → Reuse cycle for Agent Experts
 *
 * Agent Experts are domain-specific knowledge files (YAML) that agents
 * load before working on tasks. After completing tasks, agents extract
 * learnings and append them to the relevant expert files.
 *
 * This is TAC Class 1 Grade 7 — the self-improving agent layer.
 *
 * Flow:
 *   1. LOAD: Before a task, load relevant expert(s) based on domain
 *   2. ACT:  Agent works with expert knowledge as context
 *   3. LEARN: After task, extract patterns/anti-patterns from results
 *   4. REUSE: Append learnings to expert files for future agents
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import * as yaml from 'js-yaml';

// ============================================================================
// Types
// ============================================================================

/** A single learning extracted from a workflow run */
export interface Learning {
  /** Unique ID for this learning */
  id: string;
  /** When this learning was captured */
  timestamp: number;
  /** Source workflow that generated this learning */
  sourceWorkflow: string;
  /** Source workflow run ID */
  sourceRunId: string;
  /** Category of learning */
  category: 'pattern' | 'anti_pattern' | 'debugging_tip' | 'convention' | 'common_error' | 'performance';
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** How many times this pattern has been observed */
  occurrences: number;
  /** Tags for cross-referencing */
  tags: string[];
}

/** Schema for expert YAML files */
export interface ExpertDefinition {
  name: string;
  version: string;
  domain: string;
  description: string;
  updated: string;

  /** Core mental model — the static knowledge */
  mental_model: Record<string, any>;

  /** Learnings — the dynamic, accumulated knowledge from Act→Learn→Reuse */
  learnings?: {
    patterns?: Learning[];
    anti_patterns?: Learning[];
    debugging_tips?: Learning[];
    conventions?: Learning[];
    common_errors?: Learning[];
    performance?: Learning[];
  };

  /** Self-improvement config */
  self_improve?: {
    /** When to re-sync this expert from source files */
    when_to_resync?: string[];
    /** Source files this expert is derived from */
    source_files_to_monitor?: string[];
    /** Max learnings per category (prevents unbounded growth) */
    max_learnings_per_category?: number;
  };
}

/** Result of selecting experts for a task */
export interface ExpertSelection {
  /** Primary expert(s) loaded */
  experts: ExpertDefinition[];
  /** Combined context string for prompt injection */
  contextString: string;
  /** Total token estimate */
  estimatedTokens: number;
}

/** Domain mapping: keywords → expert names */
interface DomainMapping {
  expert: string;
  keywords: string[];
  filePatterns: string[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_LEARNINGS_PER_CATEGORY = 25;
const MAX_CONTEXT_CHARS = 8000; // ~2000 tokens — keep expert context compact
const LEARNING_ID_PREFIX = 'lrn';

/** Map task domains to expert files */
const DOMAIN_MAPPINGS: DomainMapping[] = [
  {
    expert: 'gateway-expert',
    keywords: ['gateway', 'websocket', 'session', 'connection', 'reconnect', 'heartbeat', 'channel'],
    filePatterns: ['src/gateway/', 'src/channels/', 'src/ws/'],
  },
  {
    expert: 'database-expert',
    keywords: ['database', 'sqlite', 'json', 'store', 'persistence', 'migration', 'cache', 'memory-index'],
    filePatterns: ['src/infra/', 'src/stores/'],
  },
  {
    expert: 'security-expert',
    keywords: ['security', 'auth', 'credential', 'encrypt', 'permission', 'allowlist', 'pairing', 'sandbox'],
    filePatterns: ['src/security/', 'src/auth/'],
  },
  {
    expert: 'channel-expert',
    keywords: ['telegram', 'whatsapp', 'discord', 'slack', 'signal', 'imessage', 'channel', 'message'],
    filePatterns: ['src/channels/'],
  },
  {
    expert: 'frontend-expert',
    keywords: ['ui', 'frontend', 'dashboard', 'portal', 'html', 'css', 'webchat', 'kanban', 'browser'],
    filePatterns: ['ui/', 'portal/', 'dashboard/'],
  },
  {
    expert: 'plugin-expert',
    keywords: ['plugin', 'skill', 'extension', 'mcp', 'hook', 'addon'],
    filePatterns: ['skills/', 'plugins/', 'src/skills/'],
  },
];

// ============================================================================
// Expert Manager
// ============================================================================

export class ExpertManager {
  private expertsDir: string;
  private experts: Map<string, ExpertDefinition> = new Map();

  constructor(expertsDir: string) {
    this.expertsDir = expertsDir;

    if (!existsSync(this.expertsDir)) {
      mkdirSync(this.expertsDir, { recursive: true });
    }

    this.loadAllExperts();
  }

  // --------------------------------------------------------------------------
  // LOAD — Load experts for a task
  // --------------------------------------------------------------------------

  /**
   * Load all expert YAML files from disk
   */
  private loadAllExperts(): void {
    this.experts.clear();
    const files = readdirSync(this.expertsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of files) {
      try {
        const path = join(this.expertsDir, file);
        const content = readFileSync(path, 'utf-8');
        const expert = yaml.load(content) as ExpertDefinition;
        const name = basename(file, file.endsWith('.yaml') ? '.yaml' : '.yml');
        this.experts.set(name, expert);
      } catch (error) {
        console.warn(`[ExpertManager] Failed to load expert ${file}: ${error}`);
      }
    }

    console.log(`[ExpertManager] Loaded ${this.experts.size} experts: ${[...this.experts.keys()].join(', ')}`);
  }

  /**
   * List all available experts
   */
  listExperts(): string[] {
    return [...this.experts.keys()];
  }

  /**
   * Get a specific expert by name
   */
  getExpert(name: string): ExpertDefinition | undefined {
    return this.experts.get(name);
  }

  /**
   * Select relevant experts based on task description and affected files
   */
  selectExperts(taskDescription: string, affectedFiles: string[] = []): ExpertSelection {
    const descLower = taskDescription.toLowerCase();
    const scores: Map<string, number> = new Map();

    for (const mapping of DOMAIN_MAPPINGS) {
      let score = 0;

      // Score by keyword matches in description
      for (const keyword of mapping.keywords) {
        if (descLower.includes(keyword)) {
          score += 2;
        }
      }

      // Score by file pattern matches
      for (const file of affectedFiles) {
        for (const pattern of mapping.filePatterns) {
          if (file.includes(pattern)) {
            score += 3; // File matches are stronger signals
          }
        }
      }

      if (score > 0 && this.experts.has(mapping.expert)) {
        scores.set(mapping.expert, score);
      }
    }

    // Sort by score descending, take top 2 max
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    const selectedExperts: ExpertDefinition[] = sorted
      .map(([name]) => this.experts.get(name)!)
      .filter(Boolean);

    // Build compact context string
    const contextString = this.buildContextString(selectedExperts);

    return {
      experts: selectedExperts,
      contextString,
      estimatedTokens: Math.ceil(contextString.length / 4),
    };
  }

  /**
   * Build a compact context string from selected experts
   * Includes: domain overview + recent learnings (not the full YAML)
   */
  private buildContextString(experts: ExpertDefinition[]): string {
    if (experts.length === 0) return '';

    const sections: string[] = [];

    for (const expert of experts) {
      const lines: string[] = [];
      lines.push(`## Expert: ${expert.name} (${expert.domain})`);
      lines.push(`${expert.description}`);
      lines.push('');

      // Include key patterns (most useful for agents)
      if (expert.learnings) {
        const allLearnings = [
          ...(expert.learnings.patterns || []),
          ...(expert.learnings.anti_patterns || []),
          ...(expert.learnings.common_errors || []),
        ];

        // Sort by confidence * occurrences (most proven learnings first)
        const topLearnings = allLearnings
          .sort((a, b) => (b.confidence * b.occurrences) - (a.confidence * a.occurrences))
          .slice(0, 10);

        if (topLearnings.length > 0) {
          lines.push('### Key Learnings:');
          for (const learning of topLearnings) {
            const prefix = learning.category === 'anti_pattern' ? '❌' :
                          learning.category === 'common_error' ? '⚠️' : '✅';
            lines.push(`${prefix} **${learning.title}**: ${learning.description}`);
          }
          lines.push('');
        }

        // Include debugging tips
        if (expert.learnings.debugging_tips && expert.learnings.debugging_tips.length > 0) {
          lines.push('### Debugging Tips:');
          for (const tip of expert.learnings.debugging_tips.slice(0, 5)) {
            lines.push(`- ${tip.title}: ${tip.description}`);
          }
          lines.push('');
        }
      }

      sections.push(lines.join('\n'));
    }

    const full = sections.join('\n---\n\n');

    // Truncate if exceeds max context size
    if (full.length > MAX_CONTEXT_CHARS) {
      return full.substring(0, MAX_CONTEXT_CHARS) + '\n\n[Expert context truncated]';
    }

    return full;
  }

  // --------------------------------------------------------------------------
  // LEARN — Extract and record learnings from workflow results
  // --------------------------------------------------------------------------

  /**
   * Extract learnings from a completed workflow run and append to experts
   */
  recordLearnings(params: {
    workflowName: string;
    runId: string;
    domain: string;
    learnings: Array<{
      category: Learning['category'];
      title: string;
      description: string;
      confidence: number;
      tags?: string[];
    }>;
  }): number {
    const { workflowName, runId, domain, learnings } = params;

    // Find the expert for this domain
    const expertName = this.findExpertForDomain(domain);
    if (!expertName) {
      console.warn(`[ExpertManager] No expert found for domain: ${domain}`);
      return 0;
    }

    const expert = this.experts.get(expertName);
    if (!expert) return 0;

    // Initialize learnings section if it doesn't exist
    if (!expert.learnings) {
      expert.learnings = {};
    }

    let added = 0;

    for (const learning of learnings) {
      const newLearning: Learning = {
        id: `${LEARNING_ID_PREFIX}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        sourceWorkflow: workflowName,
        sourceRunId: runId,
        category: learning.category,
        title: learning.title,
        description: learning.description,
        confidence: learning.confidence,
        occurrences: 1,
        tags: learning.tags || [],
      };

      // Check for duplicates — if similar learning exists, bump its occurrence count
      const existingCategory = this.getCategoryArray(expert, learning.category);
      const duplicate = existingCategory.find(l =>
        this.isSimilarLearning(l, newLearning)
      );

      if (duplicate) {
        duplicate.occurrences++;
        duplicate.confidence = Math.min(1.0, (duplicate.confidence + learning.confidence) / 2 + 0.05);
        duplicate.timestamp = Date.now();
        console.log(`[ExpertManager] Updated existing learning: ${duplicate.title} (occurrences: ${duplicate.occurrences})`);
      } else {
        existingCategory.push(newLearning);
        added++;
        console.log(`[ExpertManager] Added new learning: ${newLearning.title}`);
      }

      // Enforce max learnings per category
      const maxPerCategory = expert.self_improve?.max_learnings_per_category || MAX_LEARNINGS_PER_CATEGORY;
      this.pruneCategoryIfNeeded(existingCategory, maxPerCategory);
    }

    // Update the expert's timestamp
    expert.updated = new Date().toISOString().split('T')[0];

    // Save back to disk
    this.saveExpert(expertName, expert);

    return added;
  }

  /**
   * Get the array for a specific learning category, creating it if needed
   */
  private getCategoryArray(expert: ExpertDefinition, category: Learning['category']): Learning[] {
    if (!expert.learnings) expert.learnings = {};

    switch (category) {
      case 'pattern':
        if (!expert.learnings.patterns) expert.learnings.patterns = [];
        return expert.learnings.patterns;
      case 'anti_pattern':
        if (!expert.learnings.anti_patterns) expert.learnings.anti_patterns = [];
        return expert.learnings.anti_patterns;
      case 'debugging_tip':
        if (!expert.learnings.debugging_tips) expert.learnings.debugging_tips = [];
        return expert.learnings.debugging_tips;
      case 'convention':
        if (!expert.learnings.conventions) expert.learnings.conventions = [];
        return expert.learnings.conventions;
      case 'common_error':
        if (!expert.learnings.common_errors) expert.learnings.common_errors = [];
        return expert.learnings.common_errors;
      case 'performance':
        if (!expert.learnings.performance) expert.learnings.performance = [];
        return expert.learnings.performance;
      default:
        if (!expert.learnings.patterns) expert.learnings.patterns = [];
        return expert.learnings.patterns;
    }
  }

  /**
   * Check if two learnings are semantically similar (dedup)
   */
  private isSimilarLearning(existing: Learning, candidate: Learning): boolean {
    // Same title is obviously a match
    if (existing.title.toLowerCase() === candidate.title.toLowerCase()) return true;

    // Check tag overlap (>50% shared tags)
    if (existing.tags.length > 0 && candidate.tags.length > 0) {
      const shared = existing.tags.filter(t => candidate.tags.includes(t));
      const overlap = shared.length / Math.max(existing.tags.length, candidate.tags.length);
      if (overlap >= 0.5 && existing.category === candidate.category) {
        // High tag overlap + same category → likely duplicate
        // Also check title word overlap
        const existWords = new Set(existing.title.toLowerCase().split(/\s+/));
        const candWords = candidate.title.toLowerCase().split(/\s+/);
        const wordOverlap = candWords.filter(w => existWords.has(w)).length / candWords.length;
        if (wordOverlap >= 0.5) return true;
      }
    }

    return false;
  }

  /**
   * Prune a category array to stay within limits
   * Removes lowest-confidence, lowest-occurrence learnings first
   */
  private pruneCategoryIfNeeded(arr: Learning[], max: number): void {
    if (arr.length <= max) return;

    // Sort by score (confidence * occurrences) ascending — prune worst first
    arr.sort((a, b) => (a.confidence * a.occurrences) - (b.confidence * b.occurrences));

    const toRemove = arr.length - max;
    arr.splice(0, toRemove);

    console.log(`[ExpertManager] Pruned ${toRemove} low-value learnings`);
  }

  /**
   * Find the best expert for a given domain string
   */
  private findExpertForDomain(domain: string): string | undefined {
    const domainLower = domain.toLowerCase();

    // Direct match
    for (const [name, expert] of this.experts) {
      if (expert.domain?.toLowerCase() === domainLower ||
          name.replace('-expert', '') === domainLower) {
        return name;
      }
    }

    // Keyword match via domain mappings
    for (const mapping of DOMAIN_MAPPINGS) {
      if (mapping.keywords.some(k => domainLower.includes(k))) {
        if (this.experts.has(mapping.expert)) {
          return mapping.expert;
        }
      }
    }

    return undefined;
  }

  // --------------------------------------------------------------------------
  // REUSE — Save experts back to disk
  // --------------------------------------------------------------------------

  /**
   * Save an expert definition back to its YAML file
   */
  private saveExpert(name: string, expert: ExpertDefinition): void {
    const filename = name.endsWith('.yaml') ? name : `${name}.yaml`;
    const path = join(this.expertsDir, filename);

    try {
      const content = yaml.dump(expert, {
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
      });
      writeFileSync(path, content);
      console.log(`[ExpertManager] Saved expert: ${name}`);
    } catch (error) {
      console.error(`[ExpertManager] Failed to save expert ${name}: ${error}`);
    }
  }

  /**
   * Get learning statistics across all experts
   */
  getStats(): Record<string, {
    totalLearnings: number;
    byCategory: Record<string, number>;
    lastUpdated: string;
  }> {
    const stats: Record<string, any> = {};

    for (const [name, expert] of this.experts) {
      const byCategory: Record<string, number> = {};
      let total = 0;

      if (expert.learnings) {
        for (const [cat, items] of Object.entries(expert.learnings)) {
          const count = Array.isArray(items) ? items.length : 0;
          byCategory[cat] = count;
          total += count;
        }
      }

      stats[name] = {
        totalLearnings: total,
        byCategory,
        lastUpdated: expert.updated || 'unknown',
      };
    }

    return stats;
  }

  /**
   * Reload all experts from disk (e.g., after external edits)
   */
  reload(): void {
    this.loadAllExperts();
  }
}

export default ExpertManager;
