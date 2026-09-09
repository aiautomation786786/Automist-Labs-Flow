/**
 * ConcurrencyConfig – Global concurrency limits for the generation scheduler.
 *
 * SINGLE SOURCE OF TRUTH:
 *  `MAX_CONCURRENT_JOBS_PER_PROFILE` controls how many independent
 *  Flow browser tabs (each with fully isolated page, prompt field, model selector,
 *  generate button, and media detection state) may be simultaneously active
 *  under a single authenticated Google Flow profile / BrowserContext.
 *
 *  Production default is 5:
 *   - 1 ready profile = 5 concurrent execution contexts
 *   - 2 ready profiles = 10 concurrent execution contexts (10 prompts start immediately)
 *   - 5 ready profiles = 25 concurrent execution contexts
 *
 * Each slot maps to one `createJobPage()` call in ProfileSession, producing a
 * dedicated Playwright Page. The execution services (ImageExecutionService,
 * VideoExecutionService) each receive their own page and never share mutable
 * page-level state with concurrent jobs.
 */

export const DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE = 5;

let _maxConcurrentJobsPerProfile: number = DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE;

export const ConcurrencyConfig = {
  get maxConcurrentJobsPerProfile(): number {
    return _maxConcurrentJobsPerProfile;
  },
  setMaxConcurrentJobsPerProfile(val: number): void {
    _maxConcurrentJobsPerProfile = Math.max(1, Math.floor(val));
  },
  resetDefault(): void {
    _maxConcurrentJobsPerProfile = DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE;
  },
};

/** Production default maximum simultaneous generation jobs per profile (Single Source of Truth) */
export const MAX_CONCURRENT_JOBS_PER_PROFILE = DEFAULT_MAX_CONCURRENT_JOBS_PER_PROFILE;
