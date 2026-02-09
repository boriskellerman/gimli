/**
 * Dashboard Server
 * 
 * Serves the dashboard UI and provides API endpoints for
 * orchestrator status, metrics, and workflow triggering.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import { GimliWrapper } from './gimli-wrapper';
import { ABTestRunner } from './ab-testing';
import { WorktreeManager } from './worktree-manager';
import { KPITracker } from './kpi-tracker';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

interface DashboardState {
  status: 'running' | 'idle' | 'error';
  uptime: number;
  lastActivity: number;
  activeWorkflows: any[];
  agents: any[];
  metrics: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    bugsFixed: number;
    testsFixed: number;
    securityIssuesResolved: number;
    upstreamSyncs: number;
    tokensEstimate: number;
  };
  kpis: {
    presence: number;
    taskSize: string;
    streak: number;
    attempts: number;
  };
  recentLogs: any[];
}

export class DashboardServer {
  private wrapper: GimliWrapper;
  private abRunner: ABTestRunner;
  private worktreeManager: WorktreeManager;
  private kpiTracker: KPITracker;
  private dashboardPath: string;
  private startTime: number;
  private recentLogs: any[] = [];

  constructor(options: {
    gimliPath: string;
    orchestratorPath: string;
  }) {
    this.dashboardPath = join(options.orchestratorPath, 'dashboard');
    this.startTime = Date.now();

    this.wrapper = new GimliWrapper({
      gimliPath: options.gimliPath,
      orchestratorPath: options.orchestratorPath,
    });

    this.abRunner = new ABTestRunner({
      repoPath: options.gimliPath,
      orchestratorPath: options.orchestratorPath,
    });

    this.worktreeManager = new WorktreeManager({
      repoPath: options.gimliPath,
    });

    this.kpiTracker = new KPITracker({
      orchestratorPath: options.orchestratorPath,
      tasksPath: '/home/gimli/gimli/TASKS.md',
    });
  }

  /**
   * Start the dashboard server
   */
  start(port: number = 3888): void {
    const server = createServer((req, res) => this.handleRequest(req, res));

    const host = process.env.HOST || '0.0.0.0';
    server.listen(port, host, () => {
      console.log(`\n🎛️ TAC Orchestrator Dashboard running at http://${host}:${port}`);
      console.log('   Press Ctrl+C to stop\n');
      
      // Add startup logs
      this.log('info', 'TAC Orchestrator Dashboard started');
      this.log('info', `Monitoring ${this.wrapper.getWorkflows().length} workflows`);
    });
  }

  /**
   * Handle incoming requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // Enable CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.startsWith('/api/')) {
      return this.handleAPI(url, method, req, res);
    }

    // Static files
    return this.serveStatic(url, res);
  }

  /**
   * Handle API requests
   */
  private async handleAPI(
    url: string,
    method: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    try {
      // GET /api/dashboard - Full dashboard state
      if (url === '/api/dashboard' && method === 'GET') {
        const state = await this.getDashboardState();
        res.writeHead(200);
        res.end(JSON.stringify(state));
        return;
      }

      // GET /api/health - Health check
      if (url === '/api/health' && method === 'GET') {
        const health = await this.wrapper.checkHealth();
        res.writeHead(200);
        res.end(JSON.stringify(health));
        return;
      }

      // GET /api/metrics - Metrics only
      if (url === '/api/metrics' && method === 'GET') {
        const metrics = this.wrapper.getMetrics();
        res.writeHead(200);
        res.end(JSON.stringify(metrics));
        return;
      }

      // GET /api/workflows - List workflows
      if (url === '/api/workflows' && method === 'GET') {
        const workflows = this.wrapper.getWorkflows();
        res.writeHead(200);
        res.end(JSON.stringify({ workflows }));
        return;
      }

      // POST /api/workflow - Trigger a workflow via Gimli main session
      if (url === '/api/workflow' && method === 'POST') {
        const body = await this.readBody(req);
        const { workflow, inputs } = JSON.parse(body);
        
        // Log the trigger
        this.log('info', `Workflow "${workflow}" triggered via dashboard`);
        
        // Send workflow request to Gimli main session
        const gatewayUrl = process.env.GIMLI_GATEWAY_URL || 'http://localhost:18789';
        const gatewayToken = process.env.GIMLI_GATEWAY_TOKEN || '';
        
        try {
          // First, try the wrapper's method (uses ADW executor)
          this.wrapper.triggerWorkflow(workflow, inputs || {})
            .then(() => {
              this.log('success', `Workflow "${workflow}" completed successfully`);
            })
            .catch((err) => {
              this.log('error', `Workflow "${workflow}" failed: ${err.message}`);
            });
          
          res.writeHead(202);
          res.end(JSON.stringify({ status: 'accepted', workflow }));
        } catch (error: any) {
          this.log('error', `Failed to trigger workflow: ${error.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // GET /api/worktrees - List active worktrees
      if (url === '/api/worktrees' && method === 'GET') {
        const worktrees = this.worktreeManager.getWorktrees();
        res.writeHead(200);
        res.end(JSON.stringify({ worktrees }));
        return;
      }

      // GET /api/ab-results - A/B test history
      if (url === '/api/ab-results' && method === 'GET') {
        const results = this.abRunner.loadResults();
        res.writeHead(200);
        res.end(JSON.stringify({ results }));
        return;
      }

      // POST /api/loop - Trigger autonomous loop
      if (url === '/api/loop' && method === 'POST') {
        this.wrapper.runAutonomousLoop().catch(console.error);
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'accepted', action: 'loop' }));
        return;
      }

      // POST /api/trigger-gimli - Send a message to Gimli main session to run a workflow
      if (url === '/api/trigger-gimli' && method === 'POST') {
        const body = await this.readBody(req);
        const { workflow, inputs } = JSON.parse(body);
        
        const gatewayUrl = process.env.GIMLI_GATEWAY_URL || 'http://localhost:18789';
        const gatewayToken = process.env.GIMLI_GATEWAY_TOKEN || '';
        
        // Build the workflow prompt
        const workflowPrompts: Record<string, string> = {
          'self-improve': `Run TAC self-improvement workflow:\n1. Check test health: \`npm test\`\n2. Fix any failing tests using sessions_spawn\n3. Log results to memory\nBe autonomous.`,
          'test-fix': `Run TAC test-fix workflow:\n1. Run \`npm test\` to find failing tests\n2. For each failing test, spawn a sub-agent to fix it\n3. Verify fixes\n4. Log results`,
          'security-audit': `Run TAC security audit:\n1. Run \`npm audit\`\n2. Scan for secrets in code\n3. Check permissions\n4. Log findings`,
          'bug-investigate': `Investigate and fix bugs in Gimli:\n1. Check logs for errors\n2. Identify root causes\n3. Spawn sub-agents to fix\n4. Verify fixes`,
          'plan-build': `Plan and build a feature: ${inputs?.feature || 'Check TASKS.md for next feature'}\n1. Analyze requirements\n2. Create implementation plan\n3. Spawn agents to build\n4. Test and document`,
        };

        const prompt = workflowPrompts[workflow] || `Run TAC workflow: ${workflow}`;
        
        try {
          // Wake Gimli and send the workflow request
          const response = await fetch(`${gatewayUrl}/api/wake`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${gatewayToken}`,
            },
            body: JSON.stringify({
              sessionKey: 'agent:main:main',
              text: prompt,
            }),
          });
          
          if (response.ok) {
            this.log('info', `Sent workflow "${workflow}" to Gimli main session`);
            res.writeHead(202);
            res.end(JSON.stringify({ status: 'accepted', workflow, method: 'gimli-wake' }));
          } else {
            throw new Error(`Gateway returned ${response.status}`);
          }
        } catch (error: any) {
          this.log('error', `Failed to trigger Gimli: ${error.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // GET /api/experts - Expert system status
      if (url === '/api/experts' && method === 'GET') {
        try {
          const data = this.getExpertData();
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(200);
          res.end(JSON.stringify({ error: err.message, experts: [], totalLearnings: 0, totalTokens: 0 }));
        }
        return;
      }

      // GET /api/validation - Validation stats
      if (url === '/api/validation' && method === 'GET') {
        try {
          const data = this.getValidationData();
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(200);
          res.end(JSON.stringify({ error: err.message, passRate: '0%', totalChecks: 0, recentChecks: [] }));
        }
        return;
      }

      // GET /api/context - Context budget
      if (url === '/api/context' && method === 'GET') {
        try {
          const data = this.getContextData();
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(200);
          res.end(JSON.stringify({ error: err.message, files: [], totalTokens: 0, windowPercent: 0 }));
        }
        return;
      }

      // GET /api/github - GitHub issue poller status
      if (url === '/api/github' && method === 'GET') {
        try {
          const data = this.getGitHubData();
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(200);
          res.end(JSON.stringify({ error: err.message, lastCheck: null, processedCount: 0 }));
        }
        return;
      }

      // GET /api/kpis - KPI data
      if (url === '/api/kpis' && method === 'GET') {
        try {
          const data = this.getKPIData();
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.writeHead(200);
          res.end(JSON.stringify({ error: err.message, presence: 0, streak: 0, attempts: 0, taskSize: 'M' }));
        }
        return;
      }

      // 404 for unknown API routes
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * Serve static files
   */
  private serveStatic(url: string, res: ServerResponse): void {
    // Handle URLs without trailing slash - redirect to add it
    if (url === '') {
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }
    
    // Default to index.html
    let filePath = url === '/' ? '/index.html' : url;
    filePath = join(this.dashboardPath, filePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.dashboardPath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const content = readFileSync(filePath);
      res.setHeader('Content-Type', contentType);
      res.writeHead(200);
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
  }

  /**
   * Get full dashboard state
   */
  private async getDashboardState(): Promise<DashboardState> {
    const metrics = this.wrapper.getMetrics();
    const worktrees = this.worktreeManager.getWorktrees();

    return {
      status: 'running',
      uptime: Date.now() - this.startTime,
      lastActivity: Date.now(),
      activeWorkflows: this.wrapper.getActiveWorkflows(),
      agents: [
        // Default orchestrator agent
        {
          id: 'Orchestrator',
          branch: 'main',
          status: this.wrapper.getActiveWorkflows().length > 0 ? 'working' : 'idle',
          path: '/home/gimli/github/gimli',
        },
        // Add any active worktrees
        ...worktrees.map(wt => ({
          id: wt.agentId || wt.branch,
          branch: wt.branch,
          status: wt.status,
          path: wt.path,
        })),
      ],
      metrics: {
        totalRuns: metrics.totalWorkflowRuns,
        successfulRuns: metrics.successfulRuns,
        failedRuns: metrics.failedRuns,
        bugsFixed: metrics.bugsFixed,
        testsFixed: metrics.testsFixed,
        securityIssuesResolved: metrics.securityIssuesResolved,
        upstreamSyncs: metrics.upstreamSyncs,
        tokensEstimate: metrics.totalWorkflowRuns * 50000, // Rough token estimate
      },
      kpis: this.kpiTracker.getKPIs(),
      recentLogs: this.recentLogs.slice(-20),
    };
  }

  /**
   * Get expert system data by parsing expert YAML files directly
   */
  private getExpertData(): any {
    const expertsDir = '/home/gimli/github/gimli/ralphy/experts';
    const result: any = { experts: [], totalLearnings: 0, totalTokens: 0, expertCount: 0 };

    try {
      const fs = require('fs');
      const path = require('path');
      const files = fs.readdirSync(expertsDir).filter((f: string) => f.endsWith('-expert.yaml'));
      result.expertCount = files.length;

      let totalSize = 0;
      for (const file of files) {
        const filePath = path.join(expertsDir, file);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').length;
        const learnings = (content.match(/^\s*- date:/gm) || []).length;
        const name = file.replace('.yaml', '');

        totalSize += stat.size;
        result.totalLearnings += learnings;
        result.experts.push({
          name,
          lines,
          sizeBytes: stat.size,
          sizeHuman: stat.size >= 1024 ? Math.round(stat.size / 1024) + 'KB' : stat.size + 'B',
          learnings,
          lastModified: stat.mtime.toISOString().split('T')[0],
        });
      }
      result.totalTokens = Math.round(totalSize / 4); // ~4 chars per token
    } catch (err) {
      // Directory may not exist yet
    }

    return result;
  }

  /**
   * Get validation stats from JSON files
   */
  private getValidationData(): any {
    const statsPath = '/home/gimli/gimli/memory/validation-stats.json';
    const logPath = '/home/gimli/gimli/memory/validation-log.jsonl';
    const result: any = { passRate: '0%', totalChecks: 0, passed: 0, failed: 0, warned: 0, recentChecks: [] };

    try {
      if (existsSync(statsPath)) {
        const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
        result.passRate = stats.passRate || '0%';
        result.totalChecks = stats.totalChecks || 0;
        result.passed = stats.passed || 0;
        result.failed = stats.failed || 0;
        result.lastUpdated = stats.lastUpdated || null;
      }
    } catch (e) { /* ignore */ }

    try {
      if (existsSync(logPath)) {
        const lines = readFileSync(logPath, 'utf8').trim().split('\n');
        const recent = lines.slice(-20);
        result.recentChecks = recent.map((line: string) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        // Count warns from recent
        result.warned = result.recentChecks.filter((c: any) => c.status === 'warn').length;
      }
    } catch (e) { /* ignore */ }

    return result;
  }

  /**
   * Get context budget data by reading workspace files
   */
  private getContextData(): any {
    const workspace = '/home/gimli/gimli';
    const contextFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md', 'IDENTITY.md'];
    const contextWindow = 1000000;
    const result: any = { files: [], totalBytes: 0, totalTokens: 0, windowSize: contextWindow, windowPercent: 0 };

    for (const file of contextFiles) {
      const filePath = join(workspace, file);
      if (existsSync(filePath)) {
        try {
          const stat = require('fs').statSync(filePath);
          const tokens = Math.round(stat.size / 4);
          result.files.push({
            name: file,
            bytes: stat.size,
            tokens,
          });
          result.totalBytes += stat.size;
          result.totalTokens += tokens;
        } catch (e) { /* ignore */ }
      }
    }

    result.windowPercent = parseFloat(((result.totalTokens / contextWindow) * 100).toFixed(2));
    return result;
  }

  /**
   * Get GitHub issue poller state
   */
  private getGitHubData(): any {
    const statePath = '/home/gimli/gimli/memory/tac-github-state.json';
    const result: any = { lastCheck: null, processedCount: 0, processedIds: [] };

    try {
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        result.lastCheck = state.lastCheck || null;
        result.processedIds = state.processed || [];
        result.processedCount = result.processedIds.length;
      }
    } catch (e) { /* ignore */ }

    return result;
  }

  /**
   * Get KPI data from kpi-state.json
   */
  private getKPIData(): any {
    const kpiPath = join(
      process.env.ORCHESTRATOR_PATH || '/home/gimli/github/gimli/ralphy/orchestrator',
      'metrics', 'kpi-state.json'
    );
    const result: any = { presence: 0, streak: 0, attempts: 0, taskSize: 'M', totalTasks: 0, lastRunSuccess: false };

    try {
      if (existsSync(kpiPath)) {
        const kpi = JSON.parse(readFileSync(kpiPath, 'utf8'));
        result.presence = kpi.presenceMinutes || 0;
        result.streak = kpi.consecutiveSuccesses || 0;
        result.attempts = kpi.totalTasks > 0 ? parseFloat((kpi.totalAttempts / kpi.totalTasks).toFixed(1)) : 0;
        result.taskSize = kpi.currentTaskSize || 'M';
        result.totalTasks = kpi.totalTasks || 0;
        result.totalAttempts = kpi.totalAttempts || 0;
        result.lastRunSuccess = kpi.lastRunSuccess || false;
        result.lastUpdated = kpi.lastUpdated ? new Date(kpi.lastUpdated).toISOString() : null;
      }
    } catch (e) { /* ignore */ }

    return result;
  }

  /**
   * Read request body
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Add a log entry
   */
  log(level: 'info' | 'success' | 'warn' | 'error', message: string): void {
    this.recentLogs.push({
      time: new Date().toISOString(),
      level,
      message,
    });

    // Keep only last 100 logs
    if (this.recentLogs.length > 100) {
      this.recentLogs = this.recentLogs.slice(-100);
    }
  }
}

// CLI entry point
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3888');
  
  const server = new DashboardServer({
    gimliPath: process.env.GIMLI_PATH || '/home/gimli/github/gimli',
    orchestratorPath: process.env.ORCHESTRATOR_PATH || '/home/gimli/github/gimli/ralphy/orchestrator',
  });

  server.start(port);
}

export default DashboardServer;
