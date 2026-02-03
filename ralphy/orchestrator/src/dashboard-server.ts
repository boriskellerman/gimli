/**
 * Dashboard Server
 * 
 * Serves the dashboard UI and provides API endpoints for
 * orchestrator status, metrics, and workflow triggering.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { GimliWrapper } from './gimli-wrapper';
import { ABTestRunner } from './ab-testing';
import { WorktreeManager } from './worktree-manager';

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
    upstreamSyncs: number;
    costEstimate: number;
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
  }

  /**
   * Start the dashboard server
   */
  start(port: number = 3888): void {
    const server = createServer((req, res) => this.handleRequest(req, res));

    server.listen(port, '127.0.0.1', () => {
      console.log(`\n🎛️ TAC Orchestrator Dashboard running at http://localhost:${port}`);
      console.log('   Press Ctrl+C to stop\n');
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

      // POST /api/workflow - Trigger a workflow
      if (url === '/api/workflow' && method === 'POST') {
        const body = await this.readBody(req);
        const { workflow, inputs } = JSON.parse(body);
        
        // Run workflow in background
        this.wrapper.triggerWorkflow(workflow, inputs || {}).catch(console.error);
        
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'accepted', workflow }));
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
      activeWorkflows: [], // Would come from executor
      agents: worktrees.map(wt => ({
        id: wt.agentId || wt.branch,
        branch: wt.branch,
        status: wt.status,
        path: wt.path,
      })),
      metrics: {
        totalRuns: metrics.totalWorkflowRuns,
        successfulRuns: metrics.successfulRuns,
        failedRuns: metrics.failedRuns,
        bugsFixed: metrics.bugsFixed,
        testsFixed: metrics.testsFixed,
        upstreamSyncs: metrics.upstreamSyncs,
        costEstimate: metrics.totalWorkflowRuns * 0.61, // Rough estimate
      },
      kpis: {
        presence: 12, // Minutes of human attention needed
        taskSize: 'L', // S/M/L/XL
        streak: 23, // Consecutive successes
        attempts: 1.2, // Avg retries per task
      },
      recentLogs: this.recentLogs.slice(-20),
    };
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
