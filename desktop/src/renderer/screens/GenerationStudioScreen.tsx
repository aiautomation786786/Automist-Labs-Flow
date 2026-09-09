import React, { useState, useMemo, useEffect, useRef } from 'react';
import type {
  SupportedAspectRatio,
  GenerationProvider,
  GeminiAspectRatio,
} from '../../shared/types';
import { ProviderRouter } from '../../shared/ProviderRouter';
import { PromptParser } from '../../shared/PromptParser';
import { naturalSort, detectAmbiguousNumericOrder } from '../../shared/utils/NaturalSort';
import { SUPPORTED_IMAGE_MODELS, getImageModelConfig } from '../../shared/image-models';
import { SegmentedControl } from '../components/SegmentedControl';
import { formatAssetUrl } from '../utils/assetUrl';
import {
  ImageIcon,
  VideoIcon,
  LayersIcon,
  ClapperboardIcon,
  SparklesIcon,
  ClockIcon,
} from '../components/Icons';

export type GenerationMode =
  | 'single_image'
  | 'single_video'
  | 'bulk_image'
  | 'bulk_video'
  | 'image_to_video'
  | 'bulk_image_to_video';

interface GenerationStudioScreenProps {
  initialMode?: GenerationMode;
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
  onNavigateProfiles: () => void;
}

const SAMPLE_IMAGE_PROMPTS = [
  'A small red apple resting on a clean white table in a softly lit studio, minimalist photography.',
  'A vibrant blue ceramic coffee mug on a rustic wooden desk with warm morning sunlight streaming through a window.',
  'A succulent plant in a sleek white ceramic pot, bright daylight, hyper-detailed natural textures.',
  'A vintage leather notebook and brass fountain pen on dark walnut wood, cinematic warm lighting.',
];

const SAMPLE_VIDEO_PROMPTS = [
  'A small red apple resting on a clean white table in a softly lit studio, with a gentle cinematic camera push-in and realistic natural movement.',
  'A blue ceramic coffee mug on a wooden desk, morning sunlight streaming through a window, subtle steam rising gently.',
  'A green succulent plant in a white ceramic pot, bright studio lighting, delicate cinematic camera orbit.',
  'A crystal glass of water with ice cubes melting slowly, soft reflections and realistic fluid refractions.',
];

const SAMPLE_IMAGE_TO_VIDEO_PROMPTS = [
  'A smooth, subtle cinematic camera orbit around the subject with soft volumetric lighting.',
  'A gentle cinematic camera push-in focusing on fine details with realistic natural depth-of-field.',
  'A slow panning motion across the scene with dynamic volumetric highlights and subtle reflections.',
  'Bring this image to life with continuous fluid motion, gentle ambient breeze, and photorealistic depth.',
];

export const GenerationStudioScreen: React.FC<GenerationStudioScreenProps> = ({
  initialMode = 'single_image',
  onProjectCreated,
  onCancel,
  onNavigateProfiles: _onNavigateProfiles,
}) => {
  const [mode] = useState<GenerationMode>(initialMode);
  const [projectName, setProjectName] = useState(() => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (initialMode === 'single_image') return `Single Image · ${time}`;
    if (initialMode === 'single_video') return `Single Video · ${time}`;
    if (initialMode === 'bulk_image') return `Bulk Images · ${time}`;
    if (initialMode === 'image_to_video') return `Image to Video · ${time}`;
    if (initialMode === 'bulk_image_to_video') return `Bulk Image to Video · ${time}`;
    return `Bulk Videos · ${time}`;
  });
  const [campaignTag, setCampaignTag] = useState('');

  // Prompts
  const [singlePrompt, setSinglePrompt] = useState('');
  const [bulkPromptsText, setBulkPromptsText] = useState('');

  // Image to Video State
  const isImageToVideo = mode === 'image_to_video' || mode === 'bulk_image_to_video';
  const isSingleI2V = mode === 'image_to_video';
  const isBulkI2V = mode === 'bulk_image_to_video';
  const bulkPairDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [sourceImagePath, setSourceImagePath] = useState<string>('');
  const [sourceImageName, setSourceImageName] = useState<string>('');
  const [bulkPairs, setBulkPairs] = useState<Array<{ id: string; sourceImagePath: string; sourceImageName: string; promptText: string }>>([
    { id: 'pair_1', sourceImagePath: '', sourceImageName: '', promptText: '' },
    { id: 'pair_2', sourceImagePath: '', sourceImageName: '', promptText: '' },
  ]);

  useEffect(() => {
    return () => {
      if (bulkPairDebounceTimerRef.current) {
        clearTimeout(bulkPairDebounceTimerRef.current);
      }
    };
  }, []);

  const [libraryImages, setLibraryImages] = useState<Array<{ path: string; name: string; projectId: string }>>([]);
  const [showLibraryModal, setShowLibraryModal] = useState<boolean>(false);
  const [libraryTargetIndex, setLibraryTargetIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!window.flowApi?.listProjects) return;
    window.flowApi.listProjects().then((projects) => {
      const found: Array<{ path: string; name: string; projectId: string }> = [];
      for (const p of projects) {
        for (const s of p.slots) {
          if (s.status === 'completed' && s.result?.mediaPath && s.type === 'image') {
            const fileName = s.result.mediaPath.split(/[/\\]/).pop() || 'image.jpg';
            found.push({
              path: s.result.mediaPath,
              name: `${p.name} - ${fileName}`,
              projectId: p.projectId,
            });
          }
        }
      }
      setLibraryImages(found);
    }).catch(() => {});
  }, []);

  const handlePickSingleImage = async () => {
    if (window.flowApi?.selectImageFile) {
      const selected = await window.flowApi.selectImageFile();
      if (selected) {
        setSourceImagePath(selected);
        setSourceImageName(selected.split(/[/\\]/).pop() || 'image');
      }
    }
  };

  const handlePickBulkImage = async (index: number) => {
    if (window.flowApi?.selectImageFile) {
      const selected = await window.flowApi.selectImageFile();
      if (selected) {
        setBulkPairs((prev) =>
          prev.map((p, i) =>
            i === index
              ? { ...p, sourceImagePath: selected, sourceImageName: selected.split(/[/\\]/).pop() || 'image' }
              : p
          )
        );
      }
    }
  };

  const [zipImportError, setZipImportError] = useState<string | null>(null);
  const [zipAmbiguityWarning, setZipAmbiguityWarning] = useState<string | null>(null);

  const handleImportMultipleImages = async () => {
    if (window.flowApi?.selectMultipleImageFiles) {
      const files = await window.flowApi.selectMultipleImageFiles();
      if (files && files.length > 0) {
        setZipImportError(null);
        setZipAmbiguityWarning(null);
        const sorted = naturalSort(files, (f) => f.split(/[/\\]/).pop() || f);

        const filenames = sorted.map((f) => f.split(/[/\\]/).pop() || f);
        const ambiguities = detectAmbiguousNumericOrder(filenames);
        if (ambiguities.length > 0) {
          const ambMsg = ambiguities
            .map((a) => `Index ${a.extractedNumber}: ${a.files.join(', ')}`)
            .join('; ');
          setZipAmbiguityWarning(`Note: multiple files with identical numeric index detected (${ambMsg}). Alphabetical tie-breaking applied.`);
        }

        const parsed = PromptParser.parseRawText(bulkPromptsText, 'video');
        setBulkPairs((prev) => {
          return sorted.map((f, i) => ({
            id: `pair_${Date.now()}_${i}`,
            sourceImagePath: f,
            sourceImageName: f.split(/[/\\]/).pop() || `image_${i + 1}`,
            promptText: parsed[i]?.text || prev[i]?.promptText || '',
          }));
        });
      }
    }
  };

  const handleImportZip = async () => {
    if (!window.flowApi?.selectZipFile || !window.flowApi?.extractImageZip) return;
    try {
      setZipImportError(null);
      setZipAmbiguityWarning(null);
      const zipPath = await window.flowApi.selectZipFile();
      if (!zipPath) return;

      const result = await window.flowApi.extractImageZip(zipPath);
      if (result.files.length === 0) {
        setZipImportError('No supported image files (.jpg, .jpeg, .png, .webp) found in the ZIP archive.');
        return;
      }

      const filenames = result.files.map((f) => f.name);
      const ambiguities = detectAmbiguousNumericOrder(filenames);
      if (ambiguities.length > 0) {
        const ambMsg = ambiguities
          .map((a) => `Index ${a.extractedNumber}: ${a.files.join(', ')}`)
          .join('; ');
        setZipAmbiguityWarning(`Note: multiple files with identical numeric index detected (${ambMsg}). Alphabetical tie-breaking applied.`);
      }

      const parsed = PromptParser.parseRawText(bulkPromptsText, 'video');
      setBulkPairs((prev) => {
        return result.files.map((f, i) => ({
          id: `pair_${Date.now()}_${i}`,
          sourceImagePath: f.path,
          sourceImageName: f.name,
          promptText: parsed[i]?.text || prev[i]?.promptText || '',
        }));
      });
    } catch (err) {
      setZipImportError((err as Error).message);
    }
  };

  const handleBulkI2VPromptsTextChange = (text: string) => {
    setBulkPromptsText(text);
    if (bulkPairDebounceTimerRef.current) {
      clearTimeout(bulkPairDebounceTimerRef.current);
    }
    bulkPairDebounceTimerRef.current = setTimeout(() => {
      const parsed = PromptParser.parseRawText(text, 'video');
      setBulkPairs((prev) => {
        const count = Math.max(prev.length, parsed.length);
        const next = [];
        for (let i = 0; i < count; i++) {
          next.push({
            id: prev[i]?.id || `pair_${Date.now()}_${i}`,
            sourceImagePath: prev[i]?.sourceImagePath || '',
            sourceImageName: prev[i]?.sourceImageName || '',
            promptText: parsed[i] ? parsed[i].text : '',
          });
        }
        return next;
      });
    }, 80);
  };

  const handleUpdateSlotPrompt = (index: number, val: string) => {
    setBulkPairs((prev) => {
      const updated = prev.map((p, i) => (i === index ? { ...p, promptText: val } : p));
      setBulkPromptsText(updated.map((p) => p.promptText).join('\n'));
      return updated;
    });
  };

  const handleRemoveSlot = (index: number) => {
    setBulkPairs((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      setBulkPromptsText(updated.map((p) => p.promptText).join('\n'));
      return updated.length > 0 ? updated : [{ id: `pair_${Date.now()}_0`, sourceImagePath: '', sourceImageName: '', promptText: '' }];
    });
  };

  const handleAddSceneSlot = () => {
    setBulkPairs((prev) => [
      ...prev,
      { id: `pair_${Date.now()}_${prev.length}`, sourceImagePath: '', sourceImageName: '', promptText: '' },
    ]);
  };

  const handleClearAllPairs = () => {
    setBulkPairs([{ id: `pair_${Date.now()}_0`, sourceImagePath: '', sourceImageName: '', promptText: '' }]);
    setBulkPromptsText('');
    setZipImportError(null);
    setZipAmbiguityWarning(null);
  };

  const handleApplySampleBulkI2VPrompts = () => {
    const count = bulkPairs.filter((p) => p.sourceImagePath).length || 3;
    const samples = Array.from({ length: count }, (_, i) => {
      return SAMPLE_IMAGE_TO_VIDEO_PROMPTS[i % SAMPLE_IMAGE_TO_VIDEO_PROMPTS.length];
    });
    handleBulkI2VPromptsTextChange(samples.join('\n'));
  };

  // Common Settings
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [imageModel, setImageModel] = useState<string>('Nano Banana 2');
  const [imageDownloadQuality, setImageDownloadQuality] = useState<'original' | '2k'>('original');

  // Video-Specific Settings
  const [videoModel, setVideoModel] = useState<'Omni 1.1 Flash' | 'Veo 3.1 - Quality' | 'Veo 3.1 - Fast' | 'Veo 3.1 - Lite'>(
    initialMode.includes('image_to_video') ? 'Omni 1.1 Flash' : 'Veo 3.1 - Quality'
  );
  const [veoDuration, setVeoDuration] = useState<'4s' | '6s' | '8s'>('8s');
  const [omniResolution, setOmniResolution] = useState<'360p' | '720p'>('720p');
  const [omniDuration, setOmniDuration] = useState<'4s' | '6s' | '8s' | '10s'>('4s');
  const [videoDownloadQuality, setVideoDownloadQuality] = useState<'original' | '1080p'>('original');
  const [videoProvider, setVideoProvider] = useState<'flow' | 'gemini' | 'auto'>('flow');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isImageMode = mode === 'single_image' || mode === 'bulk_image';
  const isBulkMode = mode === 'bulk_image' || mode === 'bulk_video';

  const parsedBulkPrompts = useMemo(() => {
    if (!isBulkMode) return [];
    return PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video');
  }, [bulkPromptsText, isBulkMode, isImageMode]);

  const activePromptsCount = isBulkI2V
    ? bulkPairs.filter((p) => p.sourceImagePath && p.promptText.trim()).length
    : isBulkMode
    ? parsedBulkPrompts.length
    : isSingleI2V
    ? (sourceImagePath && singlePrompt.trim().length > 0 ? 1 : 0)
    : singlePrompt.trim().length > 0
    ? 1
    : 0;

  const handleApplySampleSinglePrompt = (sample?: string) => {
    if (sample) {
      setSinglePrompt(sample);
      return;
    }
    const list = isImageToVideo ? SAMPLE_IMAGE_TO_VIDEO_PROMPTS : isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    const random = list[Math.floor(Math.random() * list.length)]!;
    setSinglePrompt(random);
  };

  const handleApplySampleBulkPrompts = () => {
    const list = isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS;
    const joined = list.join('\n\n');
    setBulkPromptsText(joined);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.flowApi) return;

    let currentPairs = bulkPairs;
    if (isBulkI2V && bulkPairDebounceTimerRef.current) {
      clearTimeout(bulkPairDebounceTimerRef.current);
      bulkPairDebounceTimerRef.current = null;
      const parsed = PromptParser.parseRawText(bulkPromptsText, 'video');
      const count = Math.max(bulkPairs.length, parsed.length);
      const next = [];
      for (let i = 0; i < count; i++) {
        next.push({
          id: bulkPairs[i]?.id || `pair_${Date.now()}_${i}`,
          sourceImagePath: bulkPairs[i]?.sourceImagePath || '',
          sourceImageName: bulkPairs[i]?.sourceImageName || '',
          promptText: parsed[i] ? parsed[i].text : '',
        });
      }
      currentPairs = next;
      setBulkPairs(next);
    }

    if (isSingleI2V) {
      if (!sourceImagePath) {
        setErrorMsg('Please select a source image for Image to Video generation.');
        return;
      }
      if (!singlePrompt.trim()) {
        setErrorMsg('Please enter a creative motion prompt for the video generation.');
        return;
      }
    } else if (isBulkI2V) {
      const validPairs = currentPairs.filter((p) => p.sourceImagePath && p.promptText.trim());
      if (validPairs.length === 0) {
        setErrorMsg('Please configure at least one Image-to-Video pair with both an image and motion prompt.');
        return;
      }
      const imagesCount = currentPairs.filter((p) => Boolean(p.sourceImagePath)).length;
      if (validPairs.length < imagesCount) {
        setErrorMsg(`All selected images must have a motion prompt (${validPairs.length} of ${imagesCount} complete).`);
        return;
      }
    } else {
      const liveParsedBulk = isBulkMode
        ? PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video')
        : [];
      const submissionPromptsCount = isBulkMode
        ? liveParsedBulk.length
        : singlePrompt.trim().length > 0
        ? 1
        : 0;

      if (submissionPromptsCount === 0) {
        setErrorMsg(isBulkMode ? 'Please enter at least one prompt line.' : 'Please enter a creative prompt.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      let promptsList: Array<{ text: string; type: 'image' | 'video'; sourceImagePath?: string }> = [];

      if (isSingleI2V) {
        promptsList = [
          {
            text: singlePrompt.trim(),
            type: 'video',
            sourceImagePath,
          },
        ];
      } else if (isBulkI2V) {
        const validPairs = currentPairs.filter((p) => p.sourceImagePath && p.promptText.trim());
        promptsList = validPairs.map((p) => ({
          text: p.promptText.trim(),
          type: 'video',
          sourceImagePath: p.sourceImagePath,
        }));
      } else if (isBulkMode) {
        const liveParsedBulk = PromptParser.parseRawText(bulkPromptsText, isImageMode ? 'image' : 'video');
        promptsList = liveParsedBulk.map((p) => ({ text: p.text, type: p.type }));
      } else {
        promptsList = [{ text: singlePrompt.trim(), type: isImageMode ? 'image' : 'video' }];
      }

      const effectiveVideoModel = isImageToVideo ? 'Omni 1.1 Flash' : videoModel;
      const isOmni = effectiveVideoModel.includes('Omni');
      const effectiveProvider: GenerationProvider = (!isImageMode && isOmni) ? videoProvider : 'flow';

      const effectiveDuration = isImageToVideo
        ? (effectiveProvider === 'gemini' ? '10s' : omniDuration)
        : videoModel === 'Veo 3.1 - Quality'
        ? '8s'
        : isOmni
        ? (effectiveProvider === 'gemini' ? '10s' : omniDuration)
        : veoDuration;

      let promptsWithProvider: Array<{ text: string; type: 'image' | 'video'; sourceImagePath?: string; provider?: GenerationProvider }>;

      if (!isImageMode && effectiveProvider === 'auto') {
        promptsWithProvider = ProviderRouter.routeBulkSlots(promptsList, {
          requestedProvider: 'auto',
          model: effectiveVideoModel,
          duration: effectiveDuration,
          ratio: aspectRatio,
          flowSafeCapacity: 5,
          geminiSafeCapacity: 5,
        });
      } else if (!isImageMode && effectiveProvider === 'gemini') {
        promptsWithProvider = promptsList.map((p) => ({
          ...p,
          provider: 'gemini' as const,
        }));
      } else {
        promptsWithProvider = promptsList;
      }

      const allGemini = !isImageMode && promptsWithProvider.length > 0 && promptsWithProvider.every((p) => p.provider === 'gemini');
      const resolvedGenMode = allGemini
        ? (isBulkI2V
            ? 'gemini_bulk_image_to_video'
            : isSingleI2V
            ? 'gemini_image_to_video'
            : isBulkMode
            ? 'gemini_bulk_text_to_video'
            : 'gemini_text_to_video')
        : mode;

      const project = await window.flowApi.createProject({
        name: projectName.trim() || `${mode} project`,
        campaignTag: campaignTag.trim() || undefined,
        provider: effectiveProvider,
        generationMode: resolvedGenMode,
        imageModel: isImageMode ? imageModel : undefined,
        imageRatio: isImageMode ? aspectRatio : undefined,
        videoRatio: !isImageMode ? aspectRatio : undefined,
        geminiAspectRatio: effectiveProvider === 'gemini' ? (aspectRatio as GeminiAspectRatio) : undefined,
        imageDownloadQuality: isImageMode ? imageDownloadQuality : undefined,
        videoDownloadQuality: !isImageMode ? videoDownloadQuality : undefined,
        videoModel: !isImageMode ? (effectiveProvider === 'gemini' ? 'Gemini Omni' : effectiveVideoModel) : undefined,
        videoResolution: !isImageMode ? (effectiveProvider === 'gemini' ? '720p' : (isOmni ? omniResolution : '720p')) : undefined,
        videoDuration: !isImageMode ? effectiveDuration : undefined,
        prompts: promptsWithProvider,
      });

      await window.flowApi.startProjectGeneration(project.projectId);
      onProjectCreated(project.projectId);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="studio-canvas">
      {/* Studio Header (Unboxed & Minimalist) */}
      <div className="studio-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isImageMode ? 'var(--info-image-bg)' : 'var(--info-video-bg)',
                color: isImageMode ? 'var(--info-image)' : 'var(--info-video)',
                border: `1px solid ${isImageMode ? 'var(--info-image-border)' : 'var(--info-video-border)'}`,
              }}
            >
              {mode === 'single_image' && <ImageIcon size={18} />}
              {mode === 'single_video' && <VideoIcon size={18} />}
              {mode === 'bulk_image' && <LayersIcon size={18} />}
              {mode === 'bulk_video' && <ClapperboardIcon size={18} />}
              {mode === 'image_to_video' && <VideoIcon size={18} />}
              {mode === 'bulk_image_to_video' && <ClapperboardIcon size={18} />}
            </span>
            <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {mode === 'single_image' && 'Single Image Studio'}
              {mode === 'single_video' && 'Single Video Studio'}
              {mode === 'bulk_image' && 'Bulk Image Studio'}
              {mode === 'bulk_video' && 'Bulk Video Studio'}
              {mode === 'image_to_video' && 'Image to Video Studio'}
              {mode === 'bulk_image_to_video' && 'Bulk Image to Video Studio'}
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              {isImageToVideo
                ? (videoProvider === 'gemini' ? 'Gemini Omni' : 'Omni 1.1 Flash')
                : isImageMode
                ? imageModel
                : (videoModel.includes('Omni') && videoProvider === 'gemini' ? 'Gemini Omni' : videoModel)}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {mode === 'single_image' && 'Generate high-fidelity imagery with prompt styling and 2K upscale export'}
            {mode === 'single_video' && 'Generate cinematic motion with Veo 3.1 & Omni 1.1 with 1080p upscale export'}
            {mode === 'bulk_image' && 'High-throughput multi-prompt parallel image generation mapped across Flow accounts'}
            {mode === 'bulk_video' && 'Multi-scene parallel cinematic video generation dispatched across Flow accounts'}
            {mode === 'image_to_video' && 'Animate still imagery into realistic video motion with Omni 1.1 Flash'}
            {mode === 'bulk_image_to_video' && 'Batch animate multiple image-prompt pairs with parallel generation across Flow accounts'}
          </p>
        </div>

        {/* Inline Project Name & Campaign Tag Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Project Name</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name..."
              style={{
                fontSize: '12.5px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                width: '180px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Campaign Tag</span>
            <input
              type="text"
              value={campaignTag}
              onChange={(e) => setCampaignTag(e.target.value)}
              placeholder="e.g. Q4 Studio Test"
              style={{
                fontSize: '12.5px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                width: '130px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
              }}
            />
          </div>
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-md)',
            color: '#fb7185',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontWeight: 600 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Creative Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Creative Prompt Composer (Hero Element) */}
        <div className="prompt-hero-container">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SparklesIcon size={16} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                {isBulkI2V
                  ? 'Image-to-Video Batch Pairs'
                  : isSingleI2V
                  ? 'Source Image & Motion Prompt'
                  : isBulkMode
                  ? 'Batch Prompt Composer'
                  : 'Creative Prompt Composer'}
              </span>
            </div>
            {isBulkI2V ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                {libraryImages.length > 0 && (
                  <button
                    type="button"
                    className="sample-chip"
                    onClick={() => {
                      setLibraryTargetIndex(null);
                      setShowLibraryModal(true);
                    }}
                  >
                    Library ({libraryImages.length})
                  </button>
                )}
                <button
                  type="button"
                  className="sample-chip"
                  onClick={handleImportMultipleImages}
                >
                  + Batch Import Images
                </button>
                <button
                  type="button"
                  className="sample-chip"
                  onClick={() => {
                    setBulkPairs((prev) => [
                      ...prev,
                      { id: `pair_${Date.now()}`, sourceImagePath: '', sourceImageName: '', promptText: '' },
                    ]);
                  }}
                >
                  + Add Item
                </button>
              </div>
            ) : isBulkMode ? (
              <button
                type="button"
                className="sample-chip"
                onClick={handleApplySampleBulkPrompts}
              >
                + Insert Sample Batch
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                {(isImageToVideo ? SAMPLE_IMAGE_TO_VIDEO_PROMPTS : isImageMode ? SAMPLE_IMAGE_PROMPTS : SAMPLE_VIDEO_PROMPTS).slice(0, 2).map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="sample-chip"
                    onClick={() => handleApplySampleSinglePrompt(s)}
                    title={s}
                  >
                    + Sample #{idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* SINGLE IMAGE TO VIDEO COMPOSER */}
          {isSingleI2V && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Source Image Box */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Source Image Attachment
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {libraryImages.length > 0 && (
                      <button
                        type="button"
                        className="sample-chip"
                        onClick={() => {
                          setLibraryTargetIndex(null);
                          setShowLibraryModal(true);
                        }}
                      >
                        From Library ({libraryImages.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="sample-chip"
                      onClick={handlePickSingleImage}
                    >
                      Browse File...
                    </button>
                  </div>
                </div>

                {sourceImagePath ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '12px',
                      backgroundColor: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <img
                      src={formatAssetUrl(sourceImagePath)}
                      alt="Source"
                      style={{
                        width: '100px',
                        height: '65px',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sourceImageName || sourceImagePath.split(/[/\\]/).pop()}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                        {sourceImagePath}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '11.5px', padding: '5px 12px', color: '#fb7185' }}
                      onClick={() => {
                        setSourceImagePath('');
                        setSourceImageName('');
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={handlePickSingleImage}
                    style={{
                      padding: '24px',
                      border: '2px dashed var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    <div style={{ fontSize: '24px', marginBottom: '6px' }}>🖼️</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px' }}>
                      Click to browse or drop an image here
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Supports JPG, PNG, WEBP · Adapted for Omni 1.1 Flash Video
                    </div>
                  </div>
                )}
              </div>

              {/* Motion Prompt Textarea */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Motion Prompt
                </label>
                <textarea
                  value={singlePrompt}
                  onChange={(e) => setSinglePrompt(e.target.value)}
                  placeholder="Describe camera movement and cinematography (e.g. A smooth cinematic orbit around the subject with soft volumetric lighting...)"
                  rows={4}
                  style={{
                    width: '100%',
                    backgroundColor: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    padding: '4px 0',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '10px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>Engine: <strong style={{ color: '#06b6d4' }}>Omni 1.1 Flash</strong></span>
                  <span>Duration: <strong style={{ color: 'var(--text-secondary)' }}>{omniDuration}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {singlePrompt.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSinglePrompt('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11.5px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {singlePrompt.length} chars
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* BULK IMAGE TO VIDEO WORKSPACE (ONE-BLOCK PROMPTS + ORDERED SCENE TABLE) */}
          {isBulkI2V && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* TOP BULK ACTIONS TOOLBAR */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleImportMultipleImages}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      backgroundColor: 'var(--primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    📁 Select Multiple Images
                  </button>
                  <button
                    type="button"
                    onClick={handleImportZip}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🗜️ Import ZIP Archive
                  </button>
                  {(bulkPairs.some((p) => p.sourceImagePath || p.promptText.trim()) || bulkPromptsText.trim().length > 0) && (
                    <button
                      type="button"
                      onClick={handleClearAllPairs}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                      }}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* PAIRING STATUS BADGE */}
                <div>
                  {(() => {
                    const imgCount = bulkPairs.filter((p) => Boolean(p.sourceImagePath)).length;
                    const promptCount = PromptParser.parseRawText(bulkPromptsText, 'video').length;
                    if (imgCount === 0 && promptCount === 0) {
                      return (
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            padding: '4px 10px',
                            backgroundColor: 'var(--bg-input)',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          0 images · 0 prompts
                        </span>
                      );
                    }
                    if (imgCount === promptCount && imgCount > 0) {
                      return (
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            padding: '4px 10px',
                            borderRadius: '4px',
                          }}
                        >
                          ✓ {imgCount} scenes ready (1-to-1 matched)
                        </span>
                      );
                    }
                    const diff = Math.abs(imgCount - promptCount);
                    const isMissingPrompts = imgCount > promptCount;
                    return (
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#f59e0b',
                          backgroundColor: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          padding: '4px 10px',
                          borderRadius: '4px',
                        }}
                      >
                        ⚠ {imgCount} images · {promptCount} prompts ({isMissingPrompts ? `${diff} prompts missing` : `${diff} unused prompts`})
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* ZIP IMPORT ERROR / AMBIGUITY WARNING BANNERS */}
              {zipImportError && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#ef4444',
                    fontSize: '12.5px',
                  }}
                >
                  <span>⚠️ {zipImportError}</span>
                  <button
                    type="button"
                    onClick={() => setZipImportError(null)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }}
                  >
                    ×
                  </button>
                </div>
              )}
              {zipAmbiguityWarning && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#f59e0b',
                    fontSize: '12.5px',
                  }}
                >
                  <span>ℹ️ {zipAmbiguityWarning}</span>
                  <button
                    type="button"
                    onClick={() => setZipAmbiguityWarning(null)}
                    style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '14px' }}
                  >
                    ×
                  </button>
                </div>
              )}

              {/* ONE-BLOCK PROMPT INPUT UX */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Motion Prompts (1 line per scene)
                    </label>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Line 1 pairs with Image 1, Line 2 with Image 2... Line order is strictly preserved 1-to-1.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplySampleBulkI2VPrompts}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    ✨ Sample Prompts
                  </button>
                </div>

                <textarea
                  value={bulkPromptsText}
                  onChange={(e) => handleBulkI2VPromptsTextChange(e.target.value)}
                  placeholder={`Enter one motion prompt per line...&#10;Line 1 -> Image #01: Smooth cinematic orbit around the subject...&#10;Line 2 -> Image #02: Gentle push-in with soft volumetric lighting...&#10;Line 3 -> Image #03: Fluid panning motion with subtle atmospheric depth...`}
                  rows={5}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    fontFamily: 'var(--font-mono)',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* COMPACT ORDERED PREVIEW TABLE */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Ordered Scene Slots ({bulkPairs.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddSceneSlot}
                    style={{
                      background: 'none',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    + Add Scene Slot
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxHeight: '420px',
                    overflowY: 'auto',
                    paddingRight: '4px',
                  }}
                >
                  {bulkPairs.map((pair, idx) => (
                    <div
                      key={pair.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '48px 180px 1fr 32px',
                        gap: '10px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        alignItems: 'center',
                      }}
                    >
                      {/* Slot Index */}
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: 'var(--primary)',
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'center',
                        }}
                      >
                        #{String(idx + 1).padStart(2, '0')}
                      </div>

                      {/* Source Image */}
                      <div>
                        {pair.sourceImagePath ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <img
                              src={formatAssetUrl(pair.sourceImagePath)}
                              alt={pair.sourceImageName || `Slot ${idx + 1}`}
                              style={{
                                width: '44px',
                                height: '44px',
                                objectFit: 'cover',
                                borderRadius: '4px',
                                border: '1px solid var(--border-subtle)',
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: '11.5px',
                                  fontWeight: 500,
                                  color: 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={pair.sourceImageName}
                              >
                                {pair.sourceImageName || `image_${idx + 1}`}
                              </div>
                              <button
                                type="button"
                                onClick={() => handlePickBulkImage(idx)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  marginTop: '2px',
                                  fontSize: '10.5px',
                                  color: 'var(--primary)',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                              >
                                Change
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handlePickBulkImage(idx)}
                            style={{
                              width: '100%',
                              height: '44px',
                              border: '1px dashed var(--border-color)',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-muted)',
                              fontSize: '11px',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            <span>🖼️</span> Select Image
                          </button>
                        )}
                      </div>

                      {/* Inline Prompt Input */}
                      <div>
                        <input
                          type="text"
                          value={pair.promptText}
                          onChange={(e) => handleUpdateSlotPrompt(idx, e.target.value)}
                          placeholder={`Motion prompt for Scene #${idx + 1}...`}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            outline: 'none',
                          }}
                        />
                      </div>

                      {/* Remove Button */}
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {bulkPairs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(idx)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: '16px',
                              padding: '2px 6px',
                              borderRadius: '3px',
                            }}
                            title="Remove Scene Slot"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STANDARD SINGLE PROMPT COMPOSER (SINGLE IMAGE / SINGLE VIDEO) */}
          {!isImageToVideo && !isBulkMode && (
            <div>
              <textarea
                value={singlePrompt}
                onChange={(e) => setSinglePrompt(e.target.value)}
                placeholder={
                  isImageMode
                    ? 'Describe your desired image with artistic precision (e.g. A small red apple resting on a clean white table in a softly lit studio, minimalist photography...)'
                    : 'Describe camera movement and cinematography (e.g. A small red apple resting on a clean white table in a softly lit studio, with a gentle cinematic camera push-in...)'
                }
                rows={5}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '14.5px',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  padding: '4px 0',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>Scope: <strong>1 item</strong></span>
                  <span>Engine: <strong style={{ color: 'var(--text-secondary)' }}>{isImageMode ? imageModel : videoModel}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {singlePrompt.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSinglePrompt('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11.5px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {singlePrompt.length} chars
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STANDARD BATCH PROMPT COMPOSER (BULK IMAGE / BULK VIDEO) */}
          {!isImageToVideo && isBulkMode && (
            <div>
              <textarea
                value={bulkPromptsText}
                onChange={(e) => setBulkPromptsText(e.target.value)}
                placeholder="Enter one creative prompt per line...&#10;&#10;Prompt 1 -> Slot #01&#10;Prompt 2 -> Slot #02&#10;Prompt 3 -> Slot #03"
                rows={7}
                style={{
                  width: '100%',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '13.5px',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                  fontFamily: 'var(--font-mono)',
                  padding: '4px 0',
                }}
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: parsedBulkPrompts.length > 0 ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                      color: parsedBulkPrompts.length > 0 ? '#a5b4fc' : 'var(--text-muted)',
                      border: `1px solid ${parsedBulkPrompts.length > 0 ? 'var(--primary-border)' : 'var(--border-color)'}`,
                    }}
                  >
                    {parsedBulkPrompts.length} {parsedBulkPrompts.length === 1 ? 'Slot' : 'Slots'} Assigned
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Permanent slot mapping (0 .. {Math.max(0, parsedBulkPrompts.length - 1)})
                  </span>
                </div>

                {bulkPromptsText.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setBulkPromptsText('')}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11.5px', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Live Scene / Slot Breakdown Preview */}
              {parsedBulkPrompts.length > 0 && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: 'var(--radius-sm)',
                    maxHeight: '120px',
                    overflowY: 'auto',
                    fontSize: '12px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {parsedBulkPrompts.slice(0, 30).map((p, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '3px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--primary)', width: '60px', fontFamily: 'var(--font-mono)' }}>
                        {mode === 'bulk_video' ? `${String(idx + 1).padStart(2, '0')} Scene` : `#${String(idx + 1).padStart(2, '0')}`}
                      </span>
                      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.text}
                      </span>
                    </div>
                  ))}
                  {parsedBulkPrompts.length > 30 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '6px 0', textAlign: 'center' }}>
                      + {parsedBulkPrompts.length - 30} more scenes assigned...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unboxed Controls Row (Segmented Controls & Surfaces) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {/* Aspect Ratio & Model Block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Aspect Ratio */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Aspect Ratio
              </label>
              <SegmentedControl<SupportedAspectRatio>
                options={[
                  { value: '16:9', label: '16:9 Landscape', icon: '📐' },
                  { value: '9:16', label: '9:16 Portrait', icon: '📱' },
                ]}
                value={aspectRatio}
                onChange={(val) => setAspectRatio(val)}
                fullWidth
              />
            </div>

            {/* Model Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isImageMode ? 'AI Image Engine' : 'AI Video Model'}
              </label>
              {isImageMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <select
                    aria-label="AI Image Engine"
                    value={imageModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setImageModel(newModel);
                      const config = getImageModelConfig(newModel);
                      if (!config.supports2k && imageDownloadQuality === '2k') {
                        setImageDownloadQuality('original');
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {SUPPORTED_IMAGE_MODELS.map((m) => (
                      <option key={m.id} value={m.displayName}>
                        {m.displayName} ({m.badge})
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {getImageModelConfig(imageModel).description}
                  </span>
                </div>
              ) : isImageToVideo ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Omni 1.1 Flash
                    </span>
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(6, 182, 212, 0.15)',
                        color: '#06b6d4',
                      }}
                    >
                      Primary I2V Engine
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    High-speed multimodal image-to-video generation engine.
                  </span>

                  {/* Provider Selector for Omni I2V */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        Provider Engine
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {videoProvider === 'gemini'
                          ? 'Gemini Omni Web'
                          : videoProvider === 'auto'
                          ? 'Adaptive Flow & Gemini'
                          : 'Google Flow'}
                      </span>
                    </div>
                    <SegmentedControl<'flow' | 'gemini' | 'auto'>
                      options={[
                        { value: 'flow', label: 'Google Flow' },
                        { value: 'gemini', label: 'Gemini' },
                        { value: 'auto', label: 'Auto' },
                      ]}
                      value={videoProvider}
                      onChange={(p) => setVideoProvider(p)}
                      size="sm"
                      fullWidth
                    />
                  </div>

                  {videoProvider === 'gemini' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                      <div className="native-info-pill" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                        <SparklesIcon size={14} style={{ color: '#60a5fa' }} />
                        <span>Gemini Native Duration:</span>
                        <strong style={{ color: '#60a5fa' }}>10s</strong>
                        <span style={{ opacity: 0.8, fontSize: '11px' }}>(Omni Video)</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Native 10-second Gemini Omni image animation · 720p output
                      </span>
                    </div>
                  ) : (
                    /* Omni Duration & Resolution */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Duration
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {videoProvider === 'auto' && omniDuration === '10s'
                            ? '10s eligible for Flow & Gemini load-balancing'
                            : 'Flow Omni Flash duration'}
                        </span>
                      </div>
                      <SegmentedControl<'4s' | '6s' | '8s' | '10s'>
                        options={[
                          { value: '4s', label: '4s (Default)' },
                          { value: '6s', label: '6s' },
                          { value: '8s', label: '8s' },
                          { value: '10s', label: '10s' },
                        ]}
                        value={omniDuration}
                        onChange={(d) => setOmniDuration(d)}
                        size="sm"
                        fullWidth
                      />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Resolution
                        </span>
                      </div>
                      <SegmentedControl<'360p' | '720p'>
                        options={[
                          { value: '360p', label: '360p' },
                          { value: '720p', label: '720p' },
                        ]}
                        value={omniResolution}
                        onChange={(r) => setOmniResolution(r)}
                        size="sm"
                        fullWidth
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <select
                    aria-label="AI Video Model"
                    value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="Veo 3.1 - Quality">Veo 3.1 - Quality (High Fidelity Cinema)</option>
                    <option value="Veo 3.1 - Fast">Veo 3.1 - Fast (Rapid Generation)</option>
                    <option value="Veo 3.1 - Lite">Veo 3.1 - Lite (Lightweight)</option>
                    <option value="Omni 1.1 Flash">Omni 1.1 Flash (Multimodal & Fast)</option>
                  </select>

                  {/* Context-Sensitive Duration & Resolution */}
                  {videoModel.includes('Omni') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Provider Engine
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {videoProvider === 'gemini'
                              ? 'Gemini Omni Web'
                              : videoProvider === 'auto'
                              ? 'Adaptive Flow & Gemini'
                              : 'Google Flow'}
                          </span>
                        </div>
                        <SegmentedControl<'flow' | 'gemini' | 'auto'>
                          options={[
                            { value: 'flow', label: 'Google Flow' },
                            { value: 'gemini', label: 'Gemini' },
                            { value: 'auto', label: 'Auto' },
                          ]}
                          value={videoProvider}
                          onChange={(p) => setVideoProvider(p)}
                          size="sm"
                          fullWidth
                        />
                      </div>

                      {videoProvider === 'gemini' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                          <div className="native-info-pill" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                            <SparklesIcon size={14} style={{ color: '#60a5fa' }} />
                            <span>Gemini Native Duration:</span>
                            <strong style={{ color: '#60a5fa' }}>10s</strong>
                            <span style={{ opacity: 0.8, fontSize: '11px' }}>(Omni Video)</span>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Native 10-second Gemini Omni generation · 720p output
                          </span>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                              Omni Duration
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {videoProvider === 'auto' && omniDuration === '10s'
                                ? '10s eligible for Flow & Gemini load-balancing'
                                : 'Omni 1.1 Flash live duration controls'}
                            </span>
                          </div>
                          <SegmentedControl<'4s' | '6s' | '8s' | '10s'>
                            options={[
                              { value: '4s', label: '4s' },
                              { value: '6s', label: '6s' },
                              { value: '8s', label: '8s' },
                              { value: '10s', label: '10s' },
                            ]}
                            value={omniDuration}
                            onChange={(d) => setOmniDuration(d)}
                            size="sm"
                            fullWidth
                          />

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                              Omni Generation Resolution
                            </span>
                          </div>
                          <SegmentedControl<'360p' | '720p'>
                            options={[
                              { value: '360p', label: '360p' },
                              { value: '720p', label: '720p' },
                            ]}
                            value={omniResolution}
                            onChange={(r) => setOmniResolution(r)}
                            size="sm"
                            fullWidth
                          />
                        </>
                      )}
                    </div>
                  ) : videoModel === 'Veo 3.1 - Quality' ? (
                    <div className="native-info-pill">
                      <ClockIcon size={14} />
                      <span>Native Flow Duration:</span>
                      <strong style={{ color: '#ffffff' }}>8s</strong>
                      <span style={{ opacity: 0.8, fontSize: '11px' }}>
                        (Cinema Quality Default)
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Veo Duration
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Supported 4s, 6s, or 8s generation
                        </span>
                      </div>
                      <SegmentedControl<'4s' | '6s' | '8s'>
                        options={[
                          { value: '4s', label: '4s' },
                          { value: '6s', label: '6s' },
                          { value: '8s', label: '8s (Default)' },
                        ]}
                        value={veoDuration}
                        onChange={(d) => setVeoDuration(d)}
                        size="sm"
                        fullWidth
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Export Quality & Target Account Block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Export Resolution (STRICT: NO 4K!) */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Export Resolution
              </label>
              {isImageMode ? (
                <SegmentedControl<'original' | '2k'>
                  options={[
                    { value: 'original', label: 'Original (Native)' },
                    {
                      value: '2k',
                      label: '2K Upscaled',
                      badge: !getImageModelConfig(imageModel).supports2k ? 'Unavailable' : 'HD',
                      disabled: !getImageModelConfig(imageModel).supports2k,
                    },
                  ]}
                  value={imageDownloadQuality}
                  onChange={(val) => setImageDownloadQuality(val)}
                  fullWidth
                />
              ) : (
                <SegmentedControl<'original' | '1080p'>
                  options={[
                    { value: 'original', label: 'Original (Native)' },
                    { value: '1080p', label: '1080p Upscaled', badge: 'FHD' },
                  ]}
                  value={videoDownloadQuality}
                  onChange={(val) => setVideoDownloadQuality(val)}
                  fullWidth
                />
              )}
            </div>

            {/* Automatic Account Dispatch */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Account Dispatch
              </label>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--primary-border)',
                  backgroundColor: 'var(--primary-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontSize: '16px' }}>⚡</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    Automatic Worker Dispatch
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {isBulkMode || isBulkI2V
                      ? 'Jobs are distributed across all ready accounts automatically. Multiple profiles run concurrently; same-profile jobs run sequentially.'
                      : 'The next available ready account is selected automatically. No manual selection needed.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Commanding Floating / Dock Action Bar */}
        <div className="action-bar-floating">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isBulkI2V
                  ? `${activePromptsCount} Scenes Planned`
                  : isBulkMode
                  ? `${activePromptsCount} ${isImageMode ? 'Images' : 'Videos'} Planned`
                  : isSingleI2V
                  ? '1 Video Prepared from Image'
                  : `1 ${isImageMode ? 'Image' : 'Video'} Prepared`}
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                {isImageToVideo
                  ? `Omni 1.1 Flash · ${omniDuration} · ${aspectRatio} · ${videoDownloadQuality === '1080p' ? '1080p Upscale' : 'Original'}`
                  : isImageMode
                  ? `${imageModel} · ${aspectRatio} · ${imageDownloadQuality === '2k' ? '2K Upscale' : 'Original'}`
                  : `${videoModel} · ${aspectRatio} · ${videoDownloadQuality === '1080p' ? '1080p Upscale' : 'Original'}`}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
              style={{ padding: '10px 18px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-hero"
              disabled={isSubmitting || activePromptsCount === 0}
            >
              {isSubmitting ? (
                <span>Starting Generation...</span>
              ) : isBulkI2V ? (
                <span>Generate {activePromptsCount} Videos from Images in Parallel</span>
              ) : isBulkMode ? (
                <span>Generate {activePromptsCount} {isImageMode ? 'Images' : 'Videos'} in Parallel</span>
              ) : isSingleI2V ? (
                <span>Generate Video from Image (x1)</span>
              ) : (
                <span>Generate {isImageMode ? 'Image' : 'Video'} (x1)</span>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Library Picker Modal */}
      {showLibraryModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setShowLibraryModal(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Select Image from Project Library
              </span>
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding: '16px',
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '12px',
              }}
            >
              {libraryImages.map((img, i) => (
                <div
                  key={i}
                  onClick={() => {
                    if (libraryTargetIndex === null) {
                      setSourceImagePath(img.path);
                      setSourceImageName(img.name);
                    } else {
                      setBulkPairs((prev) =>
                        prev.map((p, pIdx) =>
                          pIdx === libraryTargetIndex
                            ? { ...p, sourceImagePath: img.path, sourceImageName: img.name }
                            : p
                        )
                      );
                    }
                    setShowLibraryModal(false);
                  }}
                  style={{
                    borderRadius: '6px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    backgroundColor: 'var(--bg-subtle)',
                    transition: 'transform 0.15s',
                  }}
                >
                  <img
                    src={formatAssetUrl(img.path, img.projectId)}
                    alt={img.name}
                    style={{ width: '100%', height: '90px', objectFit: 'cover' }}
                  />
                  <div style={{ padding: '6px', fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
