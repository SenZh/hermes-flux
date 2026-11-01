/**
 * Session-Project Matching Utility (packages/core/src/project/sessionProjectMatcher.ts)
 * Resolves session affiliation to projects across Windows/UNIX pathing,
 * case sensitivity, and identifier hierarchies.
 */

export interface SessionProjectLike {
  id: string;
  name: string;
  path?: string;
}

export interface SessionRecordLike {
  id: string;
  projectId?: string;
  projectName?: string;
  cwd?: string;
}

/**
 * Normalizes Windows and UNIX file paths to uniform lowercase forward-slash paths
 */
export function normalizeFsPath(rawPath?: string): string {
  if (!rawPath) return '';
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * Pure evaluator: checks whether a session belongs to a target project
 */
export function doesSessionBelongToProject(
  session: SessionRecordLike,
  project: SessionProjectLike
): boolean {
  if (!session || !project) return false;

  // 1. Direct Project ID match
  if (session.projectId && session.projectId === project.id) {
    return true;
  }

  // 2. Direct Project Name match (case-insensitive)
  if (
    session.projectName &&
    session.projectName.trim().toLowerCase() === project.name.trim().toLowerCase()
  ) {
    return true;
  }

  // 3. Filesystem Path match (exact or subfolder prefix)
  const projectPathNorm = normalizeFsPath(project.path);
  const sessionCwdNorm = normalizeFsPath(session.cwd);

  if (projectPathNorm && sessionCwdNorm) {
    if (sessionCwdNorm === projectPathNorm) {
      return true;
    }
    if (sessionCwdNorm.startsWith(projectPathNorm + '/')) {
      return true;
    }
  }

  return false;
}
