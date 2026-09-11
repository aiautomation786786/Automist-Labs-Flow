/**
 * MotionFilterBuilder – Deterministic FFmpeg filtergraph generator for camera motion.
 *
 * Implements real FFmpeg zoompan and scaling transformations:
 *  - breathe: Sinusoidal breathing zoom
 *  - zoom_in: Slow push in (1.0 -> 1.15)
 *  - zoom_out: Slow pull out (1.15 -> 1.0)
 *  - pan_left: Smooth right-to-left horizontal pan
 *  - pan_right: Smooth left-to-right horizontal pan
 *  - cinematic_dolly: Diagonal push-in with simultaneous zoom & pan
 *  - none: Static artwork framing
 */

import type { MotionStyle, SupportedAspectRatio } from './RenderTypes';

export interface MotionFilterOptions {
  motionStyle: MotionStyle;
  durationSeconds: number;
  aspectRatio: SupportedAspectRatio;
  fps?: number;
}

export class MotionFilterBuilder {
  /**
   * Resolves target pixel dimensions based on aspect ratio.
   */
  static getDimensions(aspectRatio: SupportedAspectRatio): { width: number; height: number } {
    if (aspectRatio === '9:16') {
      return { width: 720, height: 1280 };
    }
    // Default 16:9
    return { width: 1280, height: 720 };
  }

  /**
   * Builds filter along with metadata (filterComplex, totalFrames, dimensions).
   */
  static build(options: MotionFilterOptions): { filterComplex: string; totalFrames: number; width: number; height: number } {
    const fps = options.fps && options.fps > 0 ? options.fps : 25;
    const duration = Math.max(0.5, options.durationSeconds);
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const { width, height } = this.getDimensions(options.aspectRatio || '16:9');
    const filterComplex = this.buildFilter(options);
    return { filterComplex, totalFrames, width, height };
  }

  /**
   * Returns all supported concrete motion styles.
   */
  static getAllMotionStyles(): MotionStyle[] {
    return [
      'breathe',
      'zoom_in',
      'zoom_out',
      'pan_left',
      'pan_right',
      'pan_up',
      'pan_down',
      'cinematic_dolly',
      'drift',
      'parallax',
      'crash_zoom',
      'bullet_time',
      'ken_burns',
      'whip_pan_left',
      'whip_pan_right',
      'snap_zoom',
      'dolly_zoom',
      'shake',
      'pulse',
      'none',
    ];
  }

  /**
   * Returns PRO tier motion styles.
   */
  static getProMotionStyles(): MotionStyle[] {
    return [
      'breathe',
      'zoom_in',
      'zoom_out',
      'pan_left',
      'pan_right',
      'pan_up',
      'pan_down',
      'cinematic_dolly',
      'drift',
      'parallax',
    ];
  }

  /**
   * Returns ULTRA tier motion styles.
   */
  static getUltraMotionStyles(): MotionStyle[] {
    return [
      'crash_zoom',
      'bullet_time',
      'ken_burns',
      'whip_pan_left',
      'whip_pan_right',
      'snap_zoom',
      'dolly_zoom',
      'shake',
      'pulse',
    ];
  }

  /**
   * Checks if a motion style is a valid recognized concrete style.
   */
  static isMotionStyleSupported(style: string): boolean {
    return this.getAllMotionStyles().includes(style as MotionStyle) || style === 'auto' || style === 'ai_director';
  }

  /**
   * Generates the video filter string for FFmpeg.
   */
  static buildFilter(options: MotionFilterOptions): string {
    const fps = options.fps && options.fps > 0 ? options.fps : 25;
    const duration = Math.max(0.5, options.durationSeconds);
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const { width, height } = this.getDimensions(options.aspectRatio);

    const style = options.motionStyle || 'breathe';

    if (style === 'none') {
      return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    }

    let zExpr: string;
    let xExpr: string;
    let yExpr: string;

    switch (style) {
      // -----------------------------------------------------------------------
      // PRO Tier
      // -----------------------------------------------------------------------
      case 'zoom_in':
        zExpr = `min(1.0+0.15*(on/${totalFrames}),1.15)`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'zoom_out':
        zExpr = `max(1.15-0.15*(on/${totalFrames}),1.0)`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'pan_left':
        zExpr = `1.15`;
        xExpr = `(iw-iw/zoom)*(1-on/${totalFrames})`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'pan_right':
        zExpr = `1.15`;
        xExpr = `(iw-iw/zoom)*(on/${totalFrames})`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'pan_up':
        zExpr = `1.15`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `(ih-ih/zoom)*(1-on/${totalFrames})`;
        break;

      case 'pan_down':
        zExpr = `1.15`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `(ih-ih/zoom)*(on/${totalFrames})`;
        break;

      case 'cinematic_dolly':
        zExpr = `min(1.0+0.12*(on/${totalFrames}),1.12)`;
        xExpr = `(iw-iw/zoom)*(on/${totalFrames})`;
        yExpr = `(ih-ih/zoom)*(0.3+0.4*(on/${totalFrames}))`;
        break;

      case 'drift':
        zExpr = `1.08+0.02*sin(PI*on/${totalFrames})`;
        xExpr = `(iw-iw/zoom)*(0.2+0.6*(on/${totalFrames}))`;
        yExpr = `(ih-ih/zoom)*(0.8-0.6*(on/${totalFrames}))`;
        break;

      case 'parallax':
        zExpr = `1.12+0.06*sin(PI*on/${totalFrames})`;
        xExpr = `(iw-iw/zoom)*(0.5+0.4*sin(2*PI*on/${totalFrames}))`;
        yExpr = `(ih-ih/zoom)*(0.5+0.3*cos(2*PI*on/${totalFrames}))`;
        break;

      // -----------------------------------------------------------------------
      // ULTRA Tier
      // -----------------------------------------------------------------------
      case 'crash_zoom':
        zExpr = `min(1.0+0.35*sqrt(on/${totalFrames}),1.35)`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'bullet_time':
        zExpr = `1.15`;
        xExpr = `(iw-iw/zoom)*(0.5+0.4*cos(2*PI*on/${totalFrames}))`;
        yExpr = `(ih-ih/zoom)*(0.5+0.4*sin(2*PI*on/${totalFrames}))`;
        break;

      case 'ken_burns':
        zExpr = `1.05+0.15*(on/${totalFrames})`;
        xExpr = `(iw-iw/zoom)*(0.1+0.8*(on/${totalFrames}))`;
        yExpr = `(ih-ih/zoom)*(0.1+0.8*(on/${totalFrames}))`;
        break;

      case 'whip_pan_left':
        zExpr = `1.18`;
        xExpr = `(iw-iw/zoom)*(1-(on/${totalFrames})*(on/${totalFrames}))`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'whip_pan_right':
        zExpr = `1.18`;
        xExpr = `(iw-iw/zoom)*((on/${totalFrames})*(on/${totalFrames}))`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'snap_zoom':
        zExpr = `if(lte(on/${totalFrames},0.25),1.0+0.25*(on/(${totalFrames}*0.25)),1.25+0.02*sin(2*PI*(on-${totalFrames}*0.25)/(${totalFrames}*0.75)))`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'dolly_zoom':
        zExpr = `1.25-0.20*(on/${totalFrames})`;
        xExpr = `(iw-iw/zoom)*(0.5+0.3*(on/${totalFrames}))`;
        yExpr = `(ih-ih/zoom)*(0.5-0.3*(on/${totalFrames}))`;
        break;

      case 'shake':
        zExpr = `1.08`;
        xExpr = `(iw-iw/zoom)*(0.5+0.08*sin(0.35*on)+0.04*cos(0.65*on))`;
        yExpr = `(ih-ih/zoom)*(0.5+0.08*cos(0.4*on)+0.04*sin(0.8*on))`;
        break;

      case 'pulse':
        zExpr = `1.06+0.05*abs(sin(4*PI*on/${totalFrames}))`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;

      case 'breathe':
      default:
        // Organic sinusoidal breathing zoom (Default)
        zExpr = `1.04+0.04*sin(2*PI*on/${totalFrames})`;
        xExpr = `iw/2-(iw/zoom/2)`;
        yExpr = `ih/2-(ih/zoom/2)`;
        break;
    }

    return `zoompan=z='${zExpr}':d=${totalFrames}:x='${xExpr}':y='${yExpr}':s=${width}x${height}:fps=${fps},setsar=1`;
  }
}

export const getAllMotionStyles = () => MotionFilterBuilder.getAllMotionStyles();
export const getProMotionStyles = () => MotionFilterBuilder.getProMotionStyles();
export const getUltraMotionStyles = () => MotionFilterBuilder.getUltraMotionStyles();
export const isMotionStyleSupported = (style: MotionStyle) => MotionFilterBuilder.isMotionStyleSupported(style);
