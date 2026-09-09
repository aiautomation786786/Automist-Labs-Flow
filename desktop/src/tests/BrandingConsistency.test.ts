/**
 * BrandingConsistency.test.ts
 *
 * Automated regression suite verifying enterprise brand consistency for Infinity Flow:
 *  - Package metadata & build configuration
 *  - Vector & raster asset existence and integrity
 *  - Zero-data-loss storage invariants (%LOCALAPPDATA% paths unchanged)
 *  - Elimination of legacy "Google Flow Desktop" user-facing references
 *  - Multi-provider hierarchy preservation (Google Flow + Gemini as external engines)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getAppDataDir } from '../main/utils/AppLogger';
import { getProfilesRootDir } from '../main/engine/ProfileConfig';

describe('Infinity Flow — Brand Consistency & Asset Integrity', () => {
  const desktopRoot = path.resolve(__dirname, '../..');
  const assetsDir = path.join(desktopRoot, 'assets');

  it('verifies package.json has official Infinity Flow product identity', () => {
    const pkgPath = path.join(desktopRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.name).toBe('infinity-flow');
    expect(pkg.description).toContain('Infinity Flow');
    expect(pkg.scripts['build:assets']).toContain('generate-infinity-flow-assets.mjs');
  });

  it('verifies electron-builder.json configures InfinityFlow naming and preserves appId', () => {
    const builderPath = path.join(desktopRoot, 'electron-builder.json');
    const config = JSON.parse(fs.readFileSync(builderPath, 'utf8'));

    expect(config.productName).toBe('Infinity Flow');
    expect(config.executableName).toBe('InfinityFlow');
    expect(config.nsis.shortcutName).toBe('Infinity Flow');
    expect(config.nsis.uninstallDisplayName).toBe('Infinity Flow');
    expect(config.win.icon).toBe('assets/infinity-flow.ico');

    // CRITICAL: Must preserve exact appId for backwards compatibility and zero data loss
    expect(config.appId).toBe('com.automistlabs.googleflow');
  });

  it('verifies all master vector and raster brand assets exist and are valid', () => {
    const requiredAssets = [
      'infinity-flow-mark.svg',
      'infinity-flow-logo.svg',
      'infinity-flow-mark-light.svg',
      'infinity-flow-mark-white.svg',
      'infinity-flow-logo-light.svg',
      'infinity-flow-mark.png',
      'infinity-flow.ico',
      'icon.png',
      'icon.ico',
    ];

    for (const asset of requiredAssets) {
      const p = path.join(assetsDir, asset);
      expect(fs.existsSync(p), `Asset missing: ${asset}`).toBe(true);
      const stat = fs.statSync(p);
      expect(stat.size, `Asset empty: ${asset}`).toBeGreaterThan(100);
    }
  });

  it('verifies master SVGs contain clean vector geometry and no legacy strings', () => {
    const markSvg = fs.readFileSync(path.join(assetsDir, 'infinity-flow-mark.svg'), 'utf8');
    const logoSvg = fs.readFileSync(path.join(assetsDir, 'infinity-flow-logo.svg'), 'utf8');

    expect(markSvg).toContain('<svg');
    expect(markSvg).toContain('viewBox="0 0 100 100"');
    expect(markSvg).not.toContain('Google Flow Desktop');

    expect(logoSvg).toContain('INFINITY');
    expect(logoSvg).toContain('FLOW');
    expect(logoSvg).toContain('AI VIDEO AUTOMATION');
  });

  it('verifies storage paths invariant for zero-data-loss backwards compatibility', () => {
    const appData = getAppDataDir();
    expect(appData).toContain('GoogleFlowApp');

    const profilesDir = getProfilesRootDir();
    expect(profilesDir).toContain('FlowProfiles');
  });

  it('verifies renderer index.html reflects official Infinity Flow branding', () => {
    const htmlPath = path.join(desktopRoot, 'src', 'renderer', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('<title>Infinity Flow</title>');
    expect(html).toContain('infinity-flow-mark.svg');
    expect(html).not.toContain('Google Flow Desktop');
  });

  it('verifies main process window title and startup log reflect Infinity Flow', () => {
    const mainPath = path.join(desktopRoot, 'src', 'main', 'main.ts');
    const mainSrc = fs.readFileSync(mainPath, 'utf8');

    expect(mainSrc).toContain("title: 'Infinity Flow'");
    expect(mainSrc).toContain("Starting Infinity Flow Application...");
    expect(mainSrc).not.toContain("title: 'Google Flow Desktop'");
  });

  it('verifies AppShell and SettingsScreen have no legacy "Google Flow Desktop" mentions', () => {
    const appShellPath = path.join(desktopRoot, 'src', 'renderer', 'components', 'AppShell.tsx');
    const appShellSrc = fs.readFileSync(appShellPath, 'utf8');

    expect(appShellSrc).not.toContain('Google Flow Desktop');
    expect(appShellSrc).toContain('InfinityFlowMark');
    expect(appShellSrc).toContain('AI Video Automation');

    const settingsPath = path.join(desktopRoot, 'src', 'renderer', 'screens', 'SettingsScreen.tsx');
    const settingsSrc = fs.readFileSync(settingsPath, 'utf8');

    expect(settingsSrc).not.toContain('About Google Flow Desktop');
    expect(settingsSrc).toContain('InfinityFlowLogo');
  });
});
