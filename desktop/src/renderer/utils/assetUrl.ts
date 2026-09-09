/**
 * Centralized asset URL formatter for Infinity Flow desktop application.
 *
 * Enforces the secure custom protocol (`flow-asset://`) for both card thumbnails
 * and lightbox/player modal previews, eliminating broken image placeholders.
 */

export function formatAssetUrl(mediaPath?: string, projectId?: string): string {
  if (!mediaPath) return '';

  const normalized = mediaPath.replace(/\\/g, '/');

  // If already a flow-asset URL, preserve it
  if (normalized.startsWith('flow-asset://')) {
    return normalized;
  }

  // Extract relative path from projects root starting with projectId
  if (projectId) {
    const pIdx = normalized.indexOf(projectId);
    if (pIdx !== -1) {
      const rel = normalized.substring(pIdx);
      return `flow-asset://project/${rel}`;
    }
  }

  // If no projectId or not found in string, extract from /projects/ if present
  const projectsIdx = normalized.indexOf('/projects/');
  if (projectsIdx !== -1) {
    const rel = normalized.substring(projectsIdx + '/projects/'.length);
    return `flow-asset://project/${rel}`;
  }

  // Fallback: standard project protocol URL
  return `flow-asset://project/${normalized.replace(/^file:\/\/\//, '')}`;
}
