/**
 * ConcurrencyConfig – Global concurrency limits for the generation scheduler.
 *
 * The `MAX_CONCURRENT_JOBS_PER_PROFILE` constant controls how many independent
 * Flow browser tabs (each with fully isolated page, prompt field, model selector,
 * generate button, and media detection state) may be simultaneously active
 * under a single authenticated Google Flow profile / BrowserContext.
 *
 * Each slot maps to one `createJobPage()` call in ProfileSession, producing a
 * dedicated Playwright Page. The execution services (ImageExecutionService,
 * VideoExecutionService) each receive their own page and never share mutable
 * page-level state with concurrent jobs.
 *
 * Safety notes:
 *  - A value of 1 reproduces the original serialized behavior.
 *  - A value of 2 is the safe initial default; tested against real Flow quota behavior.
 *  - Values >3 risk rate-limit / CAPTCHA triggers from Google Flow.
 */

/** Maximum simultaneous generation jobs allowed per authenticated profile. */
export const MAX_CONCURRENT_JOBS_PER_PROFILE = 2;
