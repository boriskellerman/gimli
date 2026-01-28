import fs from "node:fs";
import path from "node:path";

import { resolveGimliPackageRoot } from "../infra/gimli-root.js";

export async function resolveGimliDocsPath(params: {
  workspaceDir?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): Promise<string | null> {
  const workspaceDir = params.workspaceDir?.trim();
  if (workspaceDir) {
    const workspaceDocs = path.join(workspaceDir, "docs");
    if (fs.existsSync(workspaceDocs)) return workspaceDocs;
  }

  const packageRoot = await resolveGimliPackageRoot({
    cwd: params.cwd,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
  });
  if (!packageRoot) return null;

  const packageDocs = path.join(packageRoot, "docs");
  return fs.existsSync(packageDocs) ? packageDocs : null;
}
