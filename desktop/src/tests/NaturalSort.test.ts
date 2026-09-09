import { describe, it, expect } from 'vitest';
import {
  naturalCompare,
  naturalSort,
  extractLeadingOrEmbeddedNumber,
  detectAmbiguousNumericOrder,
} from '../shared/utils/NaturalSort';

describe('NaturalSort Unit Tests', () => {
  describe('extractLeadingOrEmbeddedNumber', () => {
    it('should extract leading numbers accurately', () => {
      expect(extractLeadingOrEmbeddedNumber('1.png')).toBe(1);
      expect(extractLeadingOrEmbeddedNumber('02_scene.jpg')).toBe(2);
      expect(extractLeadingOrEmbeddedNumber('007_james_bond.webp')).toBe(7);
      expect(extractLeadingOrEmbeddedNumber('100_final.jpeg')).toBe(100);
    });

    it('should extract embedded numbers when no leading number exists', () => {
      expect(extractLeadingOrEmbeddedNumber('image_1.png')).toBe(1);
      expect(extractLeadingOrEmbeddedNumber('scene-12-cut.jpg')).toBe(12);
      expect(extractLeadingOrEmbeddedNumber('photo (5).webp')).toBe(5);
    });

    it('should return null when no number is found', () => {
      expect(extractLeadingOrEmbeddedNumber('apple.png')).toBeNull();
      expect(extractLeadingOrEmbeddedNumber('banner_hero.jpg')).toBeNull();
    });
  });

  describe('naturalCompare & naturalSort', () => {
    it('should correctly sort numeric filenames naturally (1, 2, 10 instead of 1, 10, 2)', () => {
      const files = [
        '10.jpg',
        '1.jpg',
        '2.jpg',
        '20.jpg',
        '3.jpg',
        '11.jpg',
      ];
      const sorted = naturalSort(files);
      expect(sorted).toEqual([
        '1.jpg',
        '2.jpg',
        '3.jpg',
        '10.jpg',
        '11.jpg',
        '20.jpg',
      ]);
    });

    it('should correctly sort prefixed filenames naturally', () => {
      const files = [
        'img_10.png',
        'img_1.png',
        'img_2.png',
        'img_03.png',
        'img_25.png',
      ];
      const sorted = naturalSort(files);
      expect(sorted).toEqual([
        'img_1.png',
        'img_2.png',
        'img_03.png',
        'img_10.png',
        'img_25.png',
      ]);
    });

    it('should place numbered files before unnumbered files and sort unnumbered alphabetically', () => {
      const files = [
        'zebra.jpg',
        '02_forest.jpg',
        '01_mountain.jpg',
        'apple.jpg',
      ];
      const sorted = naturalSort(files);
      expect(sorted).toEqual([
        '01_mountain.jpg',
        '02_forest.jpg',
        'apple.jpg',
        'zebra.jpg',
      ]);
    });

    it('should use key selector when sorting objects', () => {
      const items = [
        { path: 'C:/assets/10_cut.png', id: 1 },
        { path: 'C:/assets/1_cut.png', id: 2 },
        { path: 'C:/assets/2_cut.png', id: 3 },
      ];
      const sorted = naturalSort(items, (item) => item.path.split('/').pop() || item.path);
      expect(sorted.map((i) => i.id)).toEqual([2, 3, 1]);
    });
  });

  describe('detectAmbiguousNumericOrder', () => {
    it('should detect when multiple files share the same numeric index', () => {
      const files = [
        '01_intro.png',
        '01_intro_alt.png',
        '02_main.png',
        '03_outro.png',
      ];
      const ambiguities = detectAmbiguousNumericOrder(files);
      expect(ambiguities.length).toBe(1);
      expect(ambiguities[0].extractedNumber).toBe(1);
      expect(ambiguities[0].files).toEqual(['01_intro.png', '01_intro_alt.png']);
    });

    it('should return empty array when all numeric indices are unique', () => {
      const files = [
        '1.jpg',
        '2.jpg',
        '3.jpg',
        '4.jpg',
      ];
      const ambiguities = detectAmbiguousNumericOrder(files);
      expect(ambiguities).toEqual([]);
    });
  });
});
