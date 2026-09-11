import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  VideoFactoryMode,
  VideoFactoryDraft,
  VideoFactoryConfig,
  SceneEntity,
  SupportedAspectRatio,
  FinalOutputResolution,
  SubtitleConfig,
  MotionStyle,
  TransitionStyle,
  TtsProviderId,
  VoiceInfo,
  TtsEngineMetadata,
  TtsAudioManifest,
  ChannelEntity,
  SkillEntity,
  ScriptAiProgressEvent,
} from '../../shared/types';
import { ScriptParser } from '../../shared/ScriptParser';
import { ScriptValidator } from '../../shared/ScriptValidator';
import {
  SparklesIcon,
  CheckIcon,
  CloseIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  PlusIcon,
  TrashIcon,
  CopyIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  UploadIcon,
  AlertCircleIcon,
} from '../components/Icons';

interface CreateVideoScreenProps {
  initialMode?: VideoFactoryMode;
  initialSkillId?: string;
  onProjectCreated: (projectId: string) => void;
  onCancel: () => void;
}

const SAMPLE_SCRIPTS: Record<string, string> = {
  documentary: `# The Ocean Abyss
THUMBNAIL: Giant bioluminescent jellyfish hovering above an underwater trench

## SCENE 1
MOOD: mysterious
NARRATION: More than eighty percent of Earth's ocean depths remain unmapped and unseen by human eyes.
IMAGE: Deep dark oceanic abyss with faint bioluminescent glowing creatures drifting in the black water, cinematic 8k

## SCENE 2
MOOD: awe
NARRATION: At the bottom of the Mariana Trench, hydrothermal vents spew superheated minerals, sustaining life that defies biology.
IMAGE: Massive hydrothermal black smoker chimney emitting black mineral smoke underwater, deep-sea research robot headlights illuminating rock formations

## SCENE 3
MOOD: wonder
NARRATION: As autonomous submersibles delve deeper, they uncover secrets that may mirror oceans on distant moons.
IMAGE: Advanced futuristic underwater drone exploring a glowing crystal cave on the ocean floor, high contrast cinematic lighting
`,
  space: `# Journey to the Ringed Giant
THUMBNAIL: Massive Saturn rings spanning across black starry space

## SCENE 1
MOOD: epic
NARRATION: Cassini spent thirteen years orbiting Saturn, unraveling the mysteries of its glittering rings.
IMAGE: Ultra-wide view of Saturn's golden rings illuminated by the distant sun against deep starfield, Cassini probe in foreground

## SCENE 2
MOOD: scientific
NARRATION: Beneath the icy crust of Enceladus lies a global ocean where plumes of water vapor shoot directly into space.
IMAGE: Icy moon surface with massive geysers shooting water vapor jets into space, Saturn glowing faintly on the horizon

## SCENE 3
MOOD: inspirational
NARRATION: The exploration of the outer solar system proves that water, and perhaps life, is far more common than we ever imagined.
IMAGE: Futuristic deep space exploration spacecraft flying past the rings of Saturn into the deep cosmos
`,
};

const SAMPLE_AUDIO_SCRIPT = `# The Abyssal Deep

## SCENE 1
NARRATION: Welcome to the depths of the ocean, a world shrouded in perpetual mystery and silence.

## SCENE 2
NARRATION: Miles beneath the surface, strange bioluminescent organisms illuminate the abyssal plains like living constellations.

## SCENE 3
NARRATION: Here, extreme pressures and freezing temperatures foster alien life forms that thrive entirely without sunlight.`;

const DEFAULT_ENGINES: TtsEngineMetadata[] = [
  { id: 'edge-tts', name: 'Edge TTS', badge: 'FREE', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: true, requiresConfig: false },
  { id: 'kokoro', name: 'Kokoro ONNX', badge: 'LOCAL', audioExtension: 'wav', supportsWordTimings: false, isAvailable: false, unavailableReason: 'Runtime or model weights not installed', requiresConfig: false },
  { id: 'azure', name: 'Azure Speech', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: false, unavailableReason: 'Speech key or region not configured in Settings', requiresConfig: true },
  { id: 'ai33', name: 'ai33.pro', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: true, isAvailable: false, unavailableReason: 'ai33 API key not configured in Settings', requiresConfig: true },
  { id: 'famespeak', name: 'FameSpeak', badge: 'API KEY', audioExtension: 'mp3', supportsWordTimings: false, isAvailable: false, unavailableReason: 'FameSpeak API key not configured in Settings', requiresConfig: true },
];

const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  'edge-tts': 'Edge TTS',
  'kokoro': 'Kokoro',
  'azure': 'Azure Speech',
  'ai33': 'ai33.pro',
  'famespeak': 'FameSpeak',
};

const DEFAULT_PROVIDER_VOICES: Record<TtsProviderId, VoiceInfo[]> = {
  'edge-tts': [
    { id: 'en-US-ChristopherNeural', name: 'Christopher Neural (Documentary)', locale: 'en-US', gender: 'male', provider: 'edge-tts', isAvailable: true },
    { id: 'en-US-JennyNeural', name: 'Jenny Neural (Storyteller)', locale: 'en-US', gender: 'female', provider: 'edge-tts', isAvailable: true },
    { id: 'en-US-GuyNeural', name: 'Guy Neural (News & Authority)', locale: 'en-US', gender: 'male', provider: 'edge-tts', isAvailable: true },
    { id: 'en-US-AriaNeural', name: 'Aria Neural (Expressive & Dynamic)', locale: 'en-US', gender: 'female', provider: 'edge-tts', isAvailable: true },
    { id: 'en-US-EricNeural', name: 'Eric Neural (Conversational)', locale: 'en-US', gender: 'male', provider: 'edge-tts', isAvailable: true },
    { id: 'en-US-MichelleNeural', name: 'Michelle Neural (Friendly & Warm)', locale: 'en-US', gender: 'female', provider: 'edge-tts', isAvailable: true },
  ],
  'kokoro': [
    { id: 'af_heart', name: 'Heart (High Quality Primary)', locale: 'en-US', gender: 'female', provider: 'kokoro', isAvailable: true },
    { id: 'af_bella', name: 'Bella (Articulate)', locale: 'en-US', gender: 'female', provider: 'kokoro', isAvailable: true },
    { id: 'af_sarah', name: 'Sarah (Natural Flow)', locale: 'en-US', gender: 'female', provider: 'kokoro', isAvailable: true },
    { id: 'am_adam', name: 'Adam (Clear Narrator)', locale: 'en-US', gender: 'male', provider: 'kokoro', isAvailable: true },
    { id: 'am_michael', name: 'Michael (Deep Resonance)', locale: 'en-US', gender: 'male', provider: 'kokoro', isAvailable: true },
  ],
  'azure': [
    { id: 'en-US-JennyNeural', name: 'Jenny Neural (Azure High-Res)', locale: 'en-US', gender: 'female', provider: 'azure', isAvailable: true },
    { id: 'en-US-GuyNeural', name: 'Guy Neural (Azure Broadcast)', locale: 'en-US', gender: 'male', provider: 'azure', isAvailable: true },
    { id: 'en-US-AriaNeural', name: 'Aria Neural (Azure Expressive)', locale: 'en-US', gender: 'female', provider: 'azure', isAvailable: true },
    { id: 'en-US-DavisNeural', name: 'Davis Neural (Azure Documentary)', locale: 'en-US', gender: 'male', provider: 'azure', isAvailable: true },
    { id: 'en-GB-RyanNeural', name: 'Ryan Neural (Azure British Male)', locale: 'en-GB', gender: 'male', provider: 'azure', isAvailable: true },
    { id: 'en-GB-SoniaNeural', name: 'Sonia Neural (Azure British Female)', locale: 'en-GB', gender: 'female', provider: 'azure', isAvailable: true },
  ],
  'ai33': [
    { id: 'ai33-eleven-adam', name: 'Adam (ElevenLabs Clone via ai33)', locale: 'en-US', gender: 'male', provider: 'ai33', isAvailable: true },
    { id: 'ai33-eleven-rachel', name: 'Rachel (ElevenLabs Clone via ai33)', locale: 'en-US', gender: 'female', provider: 'ai33', isAvailable: true },
    { id: 'ai33-minimax-female', name: 'Minimax Storyteller (ai33)', locale: 'en-US', gender: 'female', provider: 'ai33', isAvailable: true },
    { id: 'ai33-fish-narrator', name: 'Fish Audio Narrator (ai33)', locale: 'en-US', gender: 'male', provider: 'ai33', isAvailable: true },
  ],
  'famespeak': [
    { id: 'famespeak-morgan', name: 'Morgan (Documentary Persona)', locale: 'en-US', gender: 'male', provider: 'famespeak', isAvailable: true },
    { id: 'famespeak-attenborough', name: 'Attenborough (Nature Persona)', locale: 'en-GB', gender: 'male', provider: 'famespeak', isAvailable: true },
    { id: 'famespeak-rogan', name: 'Joe (Podcast Persona)', locale: 'en-US', gender: 'male', provider: 'famespeak', isAvailable: true },
  ],
};

const MOTION_DESCRIPTIONS: Record<string, string> = {
  // SMART
  auto: 'Anti-repetition rotation across scenes',
  ai_director: 'Mood-adaptive camera motion selected per scene',
  // PRO
  breathe: 'Organic subtle breathing zoom',
  zoom_in: 'Gradual dramatic zoom into focus',
  zoom_out: 'Expansive reveal of wider scene',
  pan_left: 'Smooth horizontal scan to the left',
  pan_right: 'Smooth horizontal scan to the right',
  pan_up: 'Smooth upward vertical reveal',
  pan_down: 'Smooth downward vertical tilt',
  cinematic_dolly: 'Diagonal camera drift push',
  drift: 'Slow atmospheric floating motion',
  parallax: 'Compound depth perspective scan',
  // ULTRA
  crash_zoom: 'High-speed acceleration snap into focal point',
  bullet_time: 'Slow-motion matrix pan orbital drift',
  ken_burns: 'Documentary diagonal pan + zoom sweep',
  whip_pan_left: 'High-speed kinetic horizontal blur left',
  whip_pan_right: 'High-speed kinetic horizontal blur right',
  snap_zoom: 'Instant optical focal leap for emphasis',
  dolly_zoom: 'Vertigo effect counter-scale perspective warp',
  shake: 'Handheld tension vibration & rumble',
  pulse: 'Rhythmic heartbeat pump expansion',
  // STATIC
  none: 'Fixed tripod framing without motion',
};

const MOTION_NAMES: Record<string, string> = {
  auto: 'AUTO Rotation',
  ai_director: 'AI Director',
  breathe: 'Breathe (Default)',
  zoom_in: 'Slow Push In',
  zoom_out: 'Slow Pull Out',
  pan_left: 'Pan Left',
  pan_right: 'Pan Right',
  pan_up: 'Pan Up',
  pan_down: 'Pan Down',
  cinematic_dolly: 'Cinematic Dolly',
  drift: 'Drift',
  parallax: 'Parallax',
  crash_zoom: 'Crash Zoom',
  bullet_time: 'Bullet Time',
  ken_burns: 'Ken Burns',
  whip_pan_left: 'Whip Pan Left',
  whip_pan_right: 'Whip Pan Right',
  snap_zoom: 'Snap Zoom',
  dolly_zoom: 'Dolly Zoom',
  shake: 'Camera Shake',
  pulse: 'Pulse',
  none: 'Static Frame',
};

export const CreateVideoScreen: React.FC<CreateVideoScreenProps> = ({
  initialMode,
  initialSkillId,
  onProjectCreated,
  onCancel,
}) => {
  const [activeMode, setActiveMode] = useState<VideoFactoryMode>(initialMode || 'full_video');
  const [step, setStep] = useState<number>(1);
  const [title, setTitle] = useState<string>('New Faceless Video');
  const [rawScript, setRawScript] = useState<string>('');
  const [scenes, setScenes] = useState<SceneEntity[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<SupportedAspectRatio>('16:9');
  const [outputResolution, setOutputResolution] = useState<FinalOutputResolution>('source');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [subtitleStyle, setSubtitleStyle] = useState<string>('bottom_glass');
  const [subtitleConfig, setSubtitleConfig] = useState<SubtitleConfig>({
    enabled: true,
    preset: 'bottom_glass',
    position: 'bottom',
    fontFamily: 'Arial',
    fontSize: 32,
    textColor: '#FFFFFF',
    backgroundColor: '#1A1917',
    boxColor: '#1A1917',
    boxEnabled: true,
    outlineWidth: 3,
    shadowDepth: 0,
    animation: 'karaoke',
    whatToShow: 'all',
  });

  // Script Input Tab: 'paste' | 'one_file' | 'separate_files'
  const [scriptInputMode, setScriptInputMode] = useState<'paste' | 'one_file' | 'separate_files'>('paste');
  const [oneFile, setOneFile] = useState<{ filePath: string; fileName: string; content: string } | null>(null);
  const [narrationFile, setNarrationFile] = useState<{ filePath: string; fileName: string; content: string } | null>(null);
  const [promptsFile, setPromptsFile] = useState<{ filePath: string; fileName: string; content: string } | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<{ filePath: string; fileName: string; content: string } | null>(null);
  const [separateFilesMismatchNotice, setSeparateFilesMismatchNotice] = useState<string | null>(null);

  // Background Music state (ZBot Audio Card)
  const [musicEnabled, setMusicEnabled] = useState<boolean>(false);
  const [musicPath, setMusicPath] = useState<string>('');
  const [musicVolume, setMusicVolume] = useState<number>(0.20);
  const [duckingEnabled, setDuckingEnabled] = useState<boolean>(true);
  const [crossfadeDuration, setCrossfadeDuration] = useState<number>(0.75);

  const [motionEnabled, setMotionEnabled] = useState<boolean>(true);
  const [motionStyle, setMotionStyle] = useState<MotionStyle>('breathe');
  const [transitionStyle, setTransitionStyle] = useState<TransitionStyle>('hard_cut');
  const [voiceEngine, setVoiceEngine] = useState<string>('edge-tts');
  const [voiceId, setVoiceId] = useState<string>('en-US-ChristopherNeural');
  const [selectedEngineTab, setSelectedEngineTab] = useState<TtsProviderId>('edge-tts');
  const [ttsEngines, setTtsEngines] = useState<TtsEngineMetadata[]>([]);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState<string>('');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');

  // Images-only mode
  const [imagesOnlyPrompts, setImagesOnlyPrompts] = useState<string>('');
  const [imagesInputMode, setImagesInputMode] = useState<'paste' | 'file'>('paste');
  const [imagesFile, setImagesFile] = useState<{ fileName: string; filePath: string; content: string } | null>(null);
  const [imagesSaveDirectory, setImagesSaveDirectory] = useState<string>('');
  const imagesFileInputRef = useRef<HTMLInputElement | null>(null);

  // From-skill state
  const [skillTitle, setSkillTitle] = useState<string>('');
  const [skillText, setSkillText] = useState<string>('');
  const [skillSourceTab, setSkillSourceTab] = useState<'select' | 'paste' | 'upload'>('select');
  const [pastedSkillContent, setPastedSkillContent] = useState<string>('');
  const [uploadedSkillFileName, setUploadedSkillFileName] = useState<string | null>(null);
  const skillFileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio-only state (Complete Standalone Narration Studio)
  const [audioNarration, setAudioNarration] = useState<string>('');
  const [audioInputMode, setAudioInputMode] = useState<'paste' | 'file'>('paste');
  const [audioFile, setAudioFile] = useState<{ fileName: string; filePath: string; content: string } | null>(null);
  const [splitAtBlankLines, setSplitAtBlankLines] = useState<boolean>(true);
  const [audioSaveDirectory, setAudioSaveDirectory] = useState<string>('');
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSynthesizingAudioOnly, setIsSynthesizingAudioOnly] = useState<boolean>(false);
  const [audioOnlyManifest, setAudioOnlyManifest] = useState<TtsAudioManifest | null>(null);
  const [createdAudioProjectId, setCreatedAudioProjectId] = useState<string | null>(null);

  // Channel State
  const [channelId, setChannelId] = useState<string | undefined>();
  const [channelName, setChannelName] = useState<string | undefined>();
  const [availableChannels, setAvailableChannels] = useState<ChannelEntity[]>([]);

  // Skills & Script AI State
  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>(initialSkillId);
  const [availableSkills, setAvailableSkills] = useState<SkillEntity[]>([]);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiProgress, setAiProgress] = useState<ScriptAiProgressEvent | null>(null);
  const [aiSceneCount, setAiSceneCount] = useState<number>(5);
  const [aiDurationSeconds, setAiDurationSeconds] = useState<number>(45);
  const [aiTone, setAiTone] = useState<string>('Cinematic & Engaging');

  useEffect(() => {
    if (initialMode) setActiveMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialSkillId) setSelectedSkillId(initialSkillId);
  }, [initialSkillId]);

  // Single-Scene Refinement State
  const [refiningSceneNumber, setRefiningSceneNumber] = useState<number | null>(null);
  const [refiningField, setRefiningField] = useState<'narration' | 'imagePrompt' | null>(null);
  const [refiningInstructions, setRefiningInstructions] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);

  // AI Re-Read State
  const [isReReading, setIsReReading] = useState<boolean>(false);
  const [showParsedScenesPreview, setShowParsedScenesPreview] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // UI status
  const [loadingDraft, setLoadingDraft] = useState<boolean>(true);
  const [savingMsg, setSavingMsg] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [activeAudio, setActiveAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
    };
  }, [activeAudio]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.flowApi?.onScriptAiProgress) {
      unsub = window.flowApi.onScriptAiProgress((ev) => {
        setAiProgress(ev);
      });
    }
    return () => {
      unsub?.();
    };
  }, []);

  // Step 1 Editor View: 'raw' (text script) | 'structured' (scene cards)
  const [editorTab, setEditorTab] = useState<'raw' | 'structured'>('raw');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live validation
  const validation = useMemo(() => {
    return ScriptValidator.validate({ title, scenes });
  }, [title, scenes]);

  // Real project readiness validation (Step 6 & launch guard)
  const readiness = useMemo(() => {
    const isScriptValid = scenes.length > 0 && validation.isValid;
    const isFormatValid = Boolean(aspectRatio && outputResolution);
    const isVoiceValid = Boolean(voiceId && voiceEngine);
    const isSubtitlesValid = !subtitlesEnabled || Boolean(subtitleStyle);
    const isMotionValid = !motionEnabled || Boolean(motionStyle);

    // Selected voice label
    const selectedVoiceObj = allVoices.find((v) => v.id === voiceId) ||
      (DEFAULT_PROVIDER_VOICES[voiceEngine as TtsProviderId] || []).find((v) => v.id === voiceId);
    const voiceDisplayName = selectedVoiceObj?.name || voiceId || 'None selected';

    const items = [
      {
        id: 'script',
        label: 'Script loaded',
        isReady: isScriptValid,
        required: true,
        detail: scenes.length === 0
          ? 'No scenes defined in script'
          : !validation.isValid
          ? (validation.errors[0]?.message || 'Script has validation errors')
          : `${scenes.length} scene${scenes.length === 1 ? '' : 's'} (${validation.totalWords} words, ~${validation.estimatedDurationSeconds}s)`,
      },
      {
        id: 'format',
        label: 'Format selected',
        isReady: isFormatValid,
        required: true,
        detail: `${aspectRatio === '9:16' ? '9:16 Vertical' : '16:9 Landscape'} · ${outputResolution === '4k' ? '4K Ultra HD' : outputResolution === '1080p' ? '1080p Full HD' : 'Original Resolution'}`,
      },
      {
        id: 'voice',
        label: 'Voice selected',
        isReady: isVoiceValid,
        required: true,
        detail: isVoiceValid
          ? `${ENGINE_DISPLAY_NAMES[voiceEngine] || voiceEngine} · ${voiceDisplayName}`
          : 'No narrator voice selected',
      },
      {
        id: 'subtitles',
        label: 'Subtitles configured',
        isReady: isSubtitlesValid,
        required: true,
        detail: subtitlesEnabled
          ? `Enabled · ${subtitleStyle} (${subtitleConfig.fontSize || 32}px, ${subtitleConfig.position || 'bottom'})`
          : 'Disabled (No subtitles)',
      },
      {
        id: 'motion',
        label: 'Motion configured',
        isReady: isMotionValid,
        required: true,
        detail: motionEnabled
          ? `Enabled · ${MOTION_NAMES[motionStyle] || motionStyle} (${transitionStyle === 'cross_fade' ? `Crossfade ${crossfadeDuration}s` : 'Hard Cut'})`
          : 'Disabled (Static frames)',
      },
      {
        id: 'music',
        label: 'Background music',
        isReady: true,
        required: false,
        detail: musicEnabled
          ? (musicPath ? `${musicPath.split(/[/\\]/).pop()} (${Math.round(musicVolume * 100)}% vol)` : 'Enabled · Voiceover only')
          : 'Disabled (Voiceover only)',
      },
    ];

    const blockingIssues = items.filter((i) => !i.isReady);
    const allReady = isScriptValid && isFormatValid && isVoiceValid && isSubtitlesValid && isMotionValid;

    return { items, allReady, blockingIssues };
  }, [scenes, validation, aspectRatio, outputResolution, voiceId, voiceEngine, subtitlesEnabled, subtitleStyle, subtitleConfig, motionEnabled, motionStyle, transitionStyle, crossfadeDuration, musicEnabled, musicPath, musicVolume, allVoices]);

  // Load initial draft and channels from storage
  useEffect(() => {
    let mounted = true;
    const loadDraft = async () => {
      if (window.flowApi?.listChannels) {
        window.flowApi.listChannels().then((chs) => {
          if (mounted && chs) setAvailableChannels(chs);
        }).catch(() => {});
      }

      if (window.flowApi?.listSkills) {
        window.flowApi.listSkills().then((sks) => {
          if (mounted && sks) {
            setAvailableSkills(sks);
            if (!selectedSkillId && sks.length > 0) {
              setSelectedSkillId(sks[0].id);
            }
          }
        }).catch(() => {});
      }

      if (window.flowApi?.getTtsEngines) {
        window.flowApi.getTtsEngines().then((engs) => {
          if (mounted && engs) setTtsEngines(engs);
        }).catch(() => {});
      }

      if (window.flowApi?.listVoices) {
        window.flowApi.listVoices().then((vcs) => {
          if (mounted && vcs) setAllVoices(vcs);
        }).catch(() => {});
      }

      if (!window.flowApi?.getFactoryDraft) {
        setLoadingDraft(false);
        return;
      }
      try {
        const draft = await window.flowApi.getFactoryDraft();
        if (mounted && draft) {
          if (draft.title) setTitle(draft.title);
          if (draft.rawScript) setRawScript(draft.rawScript);
          if (draft.scenes && Array.isArray(draft.scenes) && draft.scenes.length > 0) {
            setScenes(draft.scenes);
          } else if (draft.rawScript) {
            const parsed = ScriptParser.parse(draft.rawScript);
            setScenes(parsed.scenes);
            setWarnings(parsed.warnings);
          }
          if (draft.step) setStep(draft.step);
          if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
          if (draft.outputResolution) setOutputResolution(draft.outputResolution);
          if (typeof draft.subtitlesEnabled === 'boolean') setSubtitlesEnabled(draft.subtitlesEnabled);
          if (draft.subtitleStyle) setSubtitleStyle(draft.subtitleStyle);
          if (draft.subtitleConfig) setSubtitleConfig(draft.subtitleConfig);
          if (typeof draft.musicEnabled === 'boolean') setMusicEnabled(draft.musicEnabled);
          if (draft.musicPath) setMusicPath(draft.musicPath);
          if (typeof draft.musicVolume === 'number') setMusicVolume(draft.musicVolume);
          if (typeof draft.duckingEnabled === 'boolean') setDuckingEnabled(draft.duckingEnabled);
          if (typeof draft.motionEnabled === 'boolean') setMotionEnabled(draft.motionEnabled);
          if (draft.motionStyle) setMotionStyle(draft.motionStyle);
          if (draft.transitionStyle) setTransitionStyle(draft.transitionStyle);
          if (typeof draft.crossfadeDuration === 'number') setCrossfadeDuration(draft.crossfadeDuration);
          if (draft.voiceEngine) setVoiceEngine(draft.voiceEngine);
          if (draft.voiceId) setVoiceId(draft.voiceId);
          if (draft.activeMode && !initialMode) setActiveMode(draft.activeMode);
          if (draft.skillId && !initialSkillId) setSelectedSkillId(draft.skillId);
          if (draft.channelId) {
            setChannelId(draft.channelId);
            setChannelName(draft.channelName);
          }
        }
      } catch (err) {
        console.error('Failed to load factory draft', err);
      } finally {
        if (mounted) setLoadingDraft(false);
      }
    };
    loadDraft();
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-save draft on changes (debounced)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const persistDraft = useCallback(
    (patch: Partial<VideoFactoryDraft>) => {
      if (typeof window.flowApi?.saveFactoryDraft !== 'function') return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          if (typeof window.flowApi?.saveFactoryDraft === 'function') {
            await window.flowApi.saveFactoryDraft(patch);
            setSavingMsg(true);
            setTimeout(() => setSavingMsg(false), 1200);
          }
        } catch (err) {
          console.error('Failed to auto-save draft', err);
        }
      }, 400);
    },
    []
  );

  // Parse script whenever raw text changes
  const handleScriptChange = (text: string) => {
    setRawScript(text);
    const parsed = ScriptParser.parse(text);
    if (parsed.title) setTitle(parsed.title);
    setScenes(parsed.scenes);
    setWarnings(parsed.warnings);
    persistDraft({
      rawScript: text,
      title: parsed.title || title,
      scenes: parsed.scenes,
    });
  };

  const handleLoadSample = (sampleKey: 'documentary' | 'space') => {
    const sample = SAMPLE_SCRIPTS[sampleKey];
    if (sample) {
      if (scriptInputMode === 'one_file') {
        setOneFile({
          fileName: sampleKey === 'documentary' ? 'ocean_documentary_sample.md' : 'deep_space_sample.md',
          filePath: `samples/${sampleKey}.md`,
          content: sample,
        });
      }
      handleScriptChange(sample);
    }
  };

  // Structured scene editing handlers
  const handleUpdateScene = (index: number, patch: Partial<SceneEntity>) => {
    setScenes((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;

      const narration = patch.narration !== undefined ? patch.narration : current.narration;
      const metrics = ScriptValidator.computeSceneMetrics(narration);

      next[index] = {
        ...current,
        ...patch,
        wordCount: metrics.wordCount,
        durationSeconds: metrics.durationSeconds,
      };

      persistDraft({ scenes: next });
      return next;
    });
  };

  const handleAddScene = () => {
    setScenes((prev) => {
      const newScene: SceneEntity = {
        sceneNumber: prev.length + 1,
        narration: '',
        imagePrompt: '',
        mood: undefined,
        durationSeconds: ScriptValidator.MIN_SCENE_DURATION_SECONDS,
        wordCount: 0,
      };
      const next = [...prev, newScene];
      persistDraft({ scenes: next });
      return next;
    });
  };

  const handleDeleteScene = (index: number) => {
    setScenes((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      const renumbered = ScriptValidator.renumberScenes(filtered);
      persistDraft({ scenes: renumbered });
      return renumbered;
    });
  };

  const handleDuplicateScene = (index: number) => {
    setScenes((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const duplicate: SceneEntity = {
        ...target,
        sceneNumber: index + 2,
      };
      const next = [...prev.slice(0, index + 1), duplicate, ...prev.slice(index + 1)];
      const renumbered = ScriptValidator.renumberScenes(next);
      persistDraft({ scenes: renumbered });
      return renumbered;
    });
  };

  const handleMoveScene = (index: number, direction: 'up' | 'down') => {
    setScenes((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[targetIndex]!;
      next[targetIndex] = temp;
      const renumbered = ScriptValidator.renumberScenes(next);
      persistDraft({ scenes: renumbered });
      return renumbered;
    });
  };

  const handleSyncToRawScript = () => {
    const exported = ScriptParser.toMarkedScript({ title, scenes });
    setRawScript(exported);
    persistDraft({ rawScript: exported, scenes, title });
  };

  const handleDropOneFile = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file) {
        try {
          const content = await file.text();
          const fileInfo = {
            filePath: (file as any).path || file.name,
            fileName: file.name,
            content,
          };
          setOneFile(fileInfo);
          handleScriptChange(content);
        } catch (err: any) {
          setErrorMsg(`Failed to read dropped file: ${err.message}`);
        }
      }
    }
  };

  const handleImportFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      const file = files[0];
      const text = await file.text();
      handleScriptChange(text);
      if (e.target) e.target.value = '';
      return;
    }

    // Multi-file import: separate narration + prompts (+ optional thumbnail) (ZBot spec §8.1 Layout 4)
    let narrationText = '';
    let promptsText = '';
    let thumbnailText = '';
    let detectedTitle = '';

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const content = await f.text();
      const lowerName = f.name.toLowerCase();

      if (lowerName.includes('thumb')) {
        thumbnailText = content;
      } else if (lowerName.includes('prompt') || lowerName.includes('image') || lowerName.includes('visual')) {
        promptsText = content;
      } else if (lowerName.includes('narrat') || lowerName.includes('script') || lowerName.includes('audio') || lowerName.includes('voice')) {
        narrationText = content;
      } else if (!narrationText) {
        narrationText = content;
        detectedTitle = f.name.replace(/\.[^/.]+$/, '');
      } else if (!promptsText) {
        promptsText = content;
      } else {
        thumbnailText = content;
      }
    }

    const parsed = ScriptParser.parseSeparateFiles({
      narrationText,
      promptsText,
      thumbnailText,
      title: detectedTitle || title,
    });

    if (parsed.title) setTitle(parsed.title);
    setScenes(parsed.scenes);
    setWarnings(parsed.warnings);
    const marked = ScriptParser.toMarkedScript({
      title: parsed.title || title,
      scenes: parsed.scenes,
      thumbnailPrompt: parsed.thumbnailPrompt,
    });
    setRawScript(marked);
    persistDraft({
      rawScript: marked,
      title: parsed.title || title,
      scenes: parsed.scenes,
    });

    if (e.target) e.target.value = '';
  };

  const handleSelectScriptFile = async (target: 'one' | 'narration' | 'prompts' | 'thumbnail') => {
    try {
      if (window.flowApi?.selectScriptFile) {
        const fileInfo = await window.flowApi.selectScriptFile();
        if (!fileInfo) return;
        if (target === 'one') {
          setOneFile(fileInfo);
          handleScriptChange(fileInfo.content);
        } else if (target === 'narration') {
          setNarrationFile(fileInfo);
        } else if (target === 'prompts') {
          setPromptsFile(fileInfo);
        } else if (target === 'thumbnail') {
          setThumbnailFile(fileInfo);
        }
      } else {
        handleImportFileClick();
      }
    } catch (err: any) {
      setErrorMsg(`Failed to load file: ${err.message}`);
    }
  };

  const handleParseSeparateFiles = () => {
    if (!promptsFile?.content.trim()) {
      setErrorMsg('Image Prompts file is required as authoritative scene count for Separate Files.');
      return;
    }
    setErrorMsg(null);
    const narrationText = narrationFile?.content || '';
    const promptsText = promptsFile.content;
    const thumbnailText = thumbnailFile?.content || '';
    const detectedTitle =
      title.trim() && title !== 'New Faceless Video'
        ? title
        : promptsFile.fileName.replace(/\.[^/.]+$/, '') || 'New Faceless Video';

    const result = ScriptParser.parseSeparateFiles({
      narrationText,
      promptsText,
      thumbnailText,
      title: detectedTitle,
    });

    if (result.title) setTitle(result.title);
    setScenes(result.scenes);
    setWarnings(result.warnings);

    const marked = ScriptParser.toMarkedScript({
      title: result.title || detectedTitle,
      scenes: result.scenes,
      thumbnailPrompt: result.thumbnailPrompt,
    });
    setRawScript(marked);
    persistDraft({
      rawScript: marked,
      title: result.title || detectedTitle,
      scenes: result.scenes,
    });

    const promptCount = promptsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length;
    setSeparateFilesMismatchNotice(
      `Parsed ${result.scenes.length} scene(s) based on authoritative prompt count (${promptCount} prompts). Narration distributed across scenes.`
    );
    setEditorTab('structured');
  };

  const handleSelectMusicFile = async () => {
    try {
      if (window.flowApi?.selectMusicFile) {
        const selected = await window.flowApi.selectMusicFile();
        if (selected) {
          setMusicPath(selected);
          setMusicEnabled(true);
          persistDraft({ musicPath: selected, musicEnabled: true });
        }
      }
    } catch (err: any) {
      setErrorMsg(`Failed to select music file: ${err.message}`);
    }
  };

  // From Skill Upload Handler
  const handleUploadSkillFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setErrorMsg(null);
      if (window.flowApi?.importSkill) {
        const buffer = await file.arrayBuffer();
        const imported = await window.flowApi.importSkill(buffer, file.name);
        setUploadedSkillFileName(file.name);
        if (window.flowApi?.listSkills) {
          const updated = await window.flowApi.listSkills();
          setAvailableSkills(updated);
        }
        setSelectedSkillId(imported.id);
        setSkillSourceTab('select');
      } else {
        const text = await file.text();
        setPastedSkillContent(text);
        setUploadedSkillFileName(file.name);
        setSkillSourceTab('paste');
      }
    } catch (err: any) {
      setErrorMsg(`Failed to import skill: ${err.message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  // Images Only Handlers
  const handleSelectImagesFile = async () => {
    try {
      if (window.flowApi?.selectScriptFile) {
        const fileInfo = await window.flowApi.selectScriptFile();
        if (fileInfo) {
          setImagesFile(fileInfo);
          setImagesOnlyPrompts(fileInfo.content);
        }
      } else {
        imagesFileInputRef.current?.click();
      }
    } catch (err: any) {
      setErrorMsg(`Failed to load image prompts file: ${err.message}`);
    }
  };

  const handleImagesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const fileInfo = { fileName: file.name, filePath: (file as any).path || file.name, content };
      setImagesFile(fileInfo);
      setImagesOnlyPrompts(content);
    } catch (err: any) {
      setErrorMsg(`Failed to read file: ${err.message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleSelectImagesSaveDirectory = async () => {
    try {
      if (window.flowApi?.selectDirectory) {
        const dir = await window.flowApi.selectDirectory();
        if (dir) setImagesSaveDirectory(dir);
      } else if (window.flowApi?.selectOutputDir) {
        const dir = await window.flowApi.selectOutputDir();
        if (dir) setImagesSaveDirectory(dir);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to select destination directory: ${err.message}`);
    }
  };

  // Audio Only Handlers
  const handleSelectAudioFile = async () => {
    try {
      if (window.flowApi?.selectScriptFile) {
        const fileInfo = await window.flowApi.selectScriptFile();
        if (fileInfo) {
          setAudioFile(fileInfo);
          setAudioNarration(fileInfo.content);
        }
      } else {
        audioFileInputRef.current?.click();
      }
    } catch (err: any) {
      setErrorMsg(`Failed to load narration file: ${err.message}`);
    }
  };

  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const fileInfo = { fileName: file.name, filePath: (file as any).path || file.name, content };
      setAudioFile(fileInfo);
      setAudioNarration(content);
    } catch (err: any) {
      setErrorMsg(`Failed to read narration file: ${err.message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleSelectAudioSaveDirectory = async () => {
    try {
      if (window.flowApi?.selectDirectory) {
        const dir = await window.flowApi.selectDirectory();
        if (dir) setAudioSaveDirectory(dir);
      } else if (window.flowApi?.selectOutputDir) {
        const dir = await window.flowApi.selectOutputDir();
        if (dir) setAudioSaveDirectory(dir);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to select destination directory: ${err.message}`);
    }
  };

  // Script AI Generation Handler (Dedicated to From Skill mode)
  const handleGenerateScriptAi = async () => {
    const topic = skillTitle.trim();
    if (!topic) {
      setErrorMsg('Please enter a video topic or premise.');
      return;
    }

    setIsGeneratingAi(true);
    setErrorMsg(null);
    setAiProgress({ stage: 'preparing', round: 0, charsReceived: 0, message: 'Initiating Script AI...' });

    try {
      if (!window.flowApi?.generateScriptAi) throw new Error('Script AI not available');
      
      let effectiveInstructions = '';
      if (skillSourceTab === 'paste' && pastedSkillContent.trim()) {
        effectiveInstructions = `SKILL DIRECTIVES:\n${pastedSkillContent.trim()}\n\nUSER INSTRUCTIONS:\n${skillText}`.trim();
      } else if (skillText.trim()) {
        effectiveInstructions = skillText.trim();
      }

      const result = await window.flowApi.generateScriptAi({
        topic,
        skillId: skillSourceTab === 'select' ? selectedSkillId : undefined,
        channelId,
        targetSceneCount: aiSceneCount,
        targetDurationSeconds: aiDurationSeconds,
        aspectRatio,
        tone: aiTone,
        userInstructions: effectiveInstructions || undefined,
      });

      if (!result.success || !result.story) {
        throw new Error(result.error || 'Failed to generate script');
      }

      setTitle(result.story.title);
      setScenes(result.story.scenes);
      if (result.story.rawScript) {
        setRawScript(result.story.rawScript);
      }

      if (activeMode === 'from_skill') {
        setActiveMode('full_video');
      }
      setStep(1);
      setEditorTab('structured');

      persistDraft({
        title: result.story.title,
        scenes: result.story.scenes,
        rawScript: result.story.rawScript || '',
        skillId: selectedSkillId,
      });
    } catch (err: any) {
      setErrorMsg(`Script AI Error: ${err.message}`);
    } finally {
      setIsGeneratingAi(false);
      setAiProgress(null);
    }
  };

  const handleExecuteRefine = async (sceneNumber: number, target: 'narration' | 'imagePrompt') => {
    const targetScene = scenes.find((s) => s.sceneNumber === sceneNumber);
    if (!targetScene) return;

    setIsRefining(true);
    setErrorMsg(null);

    try {
      if (!window.flowApi?.refineSceneAi) throw new Error('Scene refinement not available');
      const result = await window.flowApi.refineSceneAi({
        scene: targetScene,
        target,
        skillId: selectedSkillId,
        channelId,
        userInstructions: refiningInstructions.trim() || undefined,
        storyContext: { title },
      });

      if (!result.success || !result.refinedScene) {
        throw new Error(result.error || 'Failed to refine scene');
      }

      const updatedScenes = scenes.map((s) => (s.sceneNumber === sceneNumber ? result.refinedScene! : s));
      setScenes(updatedScenes);
      persistDraft({ scenes: updatedScenes });
      setRefiningSceneNumber(null);
      setRefiningField(null);
      setRefiningInstructions('');
    } catch (err: any) {
      setErrorMsg(`Refine Scene Error: ${err.message}`);
    } finally {
      setIsRefining(false);
    }
  };

  const handleAiReRead = async () => {
    if (!rawScript.trim()) {
      setErrorMsg('No script text to re-read.');
      return;
    }

    setIsReReading(true);
    setErrorMsg(null);

    try {
      if (!window.flowApi?.reReadScriptAi) throw new Error('Script Re-read not available');
      const result = await window.flowApi.reReadScriptAi({
        rawScript,
      });

      if (!result.success || !result.story) {
        throw new Error(result.error || 'Failed to re-read script');
      }

      setScenes(result.story.scenes);
      setEditorTab('structured');
      persistDraft({ scenes: result.story.scenes });
    } catch (err: any) {
      setErrorMsg(`AI Re-Read Error: ${err.message}`);
    } finally {
      setIsReReading(false);
    }
  };

  // Stepper navigation
  const handleNextStep = () => {
    if (step === 1) {
      const val = ScriptValidator.validate({ title, scenes });
      if (!val.isValid) {
        setErrorMsg(val.errors[0]?.message || 'Please resolve all script validation errors before proceeding.');
        return;
      }
    }
    setErrorMsg(null);
    const nextStep = Math.min(6, step + 1);
    setStep(nextStep);
    persistDraft({ step: nextStep });
  };

  const handlePrevStep = () => {
    setErrorMsg(null);
    const prevStep = Math.max(1, step - 1);
    setStep(prevStep);
    persistDraft({ step: prevStep });
  };

  const handlePreviewVoice = async (vProvider: TtsProviderId, vId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewingVoiceId === vId) {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
      setPreviewingVoiceId(null);
      return;
    }
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    }
    setPreviewingVoiceId(vId);
    try {
      if (!window.flowApi?.previewVoice) {
        throw new Error('TTS Voice Preview is not supported in this build.');
      }
      const res = await window.flowApi.previewVoice(
        vProvider,
        vId,
        'Welcome to Infinity Flow. This is a voice preview for your faceless video.'
      );
      if (!res.success || !res.audioDataUri) {
        throw new Error(res.error || 'Failed to preview voice.');
      }
      const audio = new Audio(res.audioDataUri);
      audio.onended = () => {
        setPreviewingVoiceId(null);
      };
      audio.onerror = () => {
        setPreviewingVoiceId(null);
      };
      setActiveAudio(audio);
      await audio.play();
    } catch (err: any) {
      setPreviewingVoiceId(null);
      setErrorMsg(err.message || 'Voice preview failed.');
    }
  };

  // Final project creation for Full Video
  const handleCreateFullVideoProject = async () => {
    const val = ScriptValidator.validate({ title, scenes });
    if (!val.isValid || !readiness.allReady) {
      const err = !val.isValid
        ? (val.errors[0]?.message || 'Cannot create video project without valid scenes.')
        : (readiness.blockingIssues[0]?.detail || 'Cannot create video project: configuration incomplete.');
      setErrorMsg(err);
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const config: VideoFactoryConfig = {
        mode: 'full_video',
        story: {
          title: title.trim() || 'Untitled Video Project',
          scenes,
          rawScript,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        aspectRatio,
        outputResolution,
        subtitlesEnabled,
        subtitleStyle,
        subtitleConfig: {
          ...subtitleConfig,
          enabled: subtitlesEnabled,
          preset: subtitleStyle,
        },
        motionEnabled,
        motionStyle,
        transitionStyle,
        crossfadeDuration,
        voiceEngine,
        voiceId,
        channelId,
        channelName,
        musicEnabled,
        musicPath: musicPath.trim() || undefined,
        musicVolume,
        duckingEnabled,
        stage: 'assets_queued',
      };

      if (!window.flowApi?.createFactoryProject) {
        throw new Error('Video factory API is not available.');
      }

      const { projectId } = await window.flowApi.createFactoryProject(config);

      // Phase 2 Unified Pipeline: Start pipeline in background
      if (window.flowApi?.startPipeline) {
        window.flowApi.startPipeline(projectId, 'full_video').catch((pErr: any) => {
          console.error('Pipeline execution error:', pErr);
        });
      } else if (window.flowApi?.synthesizeProjectVoice && voiceEngine !== 'none') {
        try {
          await window.flowApi.synthesizeProjectVoice(projectId, voiceId, voiceEngine as any);
        } catch (synthErr: any) {
          console.error('Failed to synthesize narration during project creation', synthErr);
        }
      }

      onProjectCreated(projectId);
    } catch (err: any) {
      console.error('Failed to create factory project', err);
      setErrorMsg(err?.message || 'Failed to create Video Factory project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Images-only project creation (immediately functional)
  const handleCreateImagesOnlyProject = async () => {
    const prompts = imagesOnlyPrompts
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (prompts.length === 0) {
      setErrorMsg('Please enter or import at least one image prompt.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const created = await window.flowApi!.createProject({
        name: title.trim() || `Batch Images · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        imageRatio: aspectRatio,
        generationMode: 'bulk_image',
        prompts: prompts.map((p) => ({ text: p, type: 'image' })),
      });

      if (imagesSaveDirectory && window.flowApi?.updateProject) {
        try {
          await window.flowApi.updateProject(created.projectId, { destinationDir: imagesSaveDirectory } as any);
        } catch {
          // ignore optional field
        }
      }

      onProjectCreated(created.projectId);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create batch image project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSynthesizeAudioOnly = async () => {
    const text = audioNarration.trim();
    if (!text) {
      setErrorMsg('Please enter or load a narration script to synthesize.');
      return;
    }

    try {
      setIsSynthesizingAudioOnly(true);
      setErrorMsg(null);

      let scenesToUse: SceneEntity[] = [];

      // Parse narration into structured scenes based on splitAtBlankLines toggle
      if (splitAtBlankLines) {
        if (/#+\s*SCENE/i.test(text)) {
          const parsed = ScriptParser.parse(text);
          scenesToUse = parsed.scenes && parsed.scenes.length > 0 ? parsed.scenes : [];
        }

        if (scenesToUse.length === 0) {
          const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
          scenesToUse = blocks.map((block, idx) => {
            const metrics = ScriptValidator.computeSceneMetrics(block);
            return {
              sceneNumber: idx + 1,
              narration: block,
              imagePrompt: '',
              durationSeconds: metrics.durationSeconds,
              wordCount: metrics.wordCount,
            };
          });
        }
      } else {
        const metrics = ScriptValidator.computeSceneMetrics(text);
        scenesToUse = [
          {
            sceneNumber: 1,
            narration: text,
            imagePrompt: '',
            durationSeconds: metrics.durationSeconds,
            wordCount: metrics.wordCount,
          },
        ];
      }

      const projTitle =
        title.trim() && title !== 'New Faceless Video'
          ? title.trim()
          : `Audio Story - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      const config: VideoFactoryConfig = {
        mode: 'audio_only',
        story: {
          title: projTitle,
          scenes: scenesToUse,
          rawScript: text,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        aspectRatio,
        subtitlesEnabled: false,
        motionEnabled: false,
        motionStyle: motionStyle || 'breathe',
        transitionStyle: transitionStyle || 'hard_cut',
        voiceEngine,
        voiceId,
        stage: 'assets_queued',
      };

      if (!window.flowApi?.createFactoryProject) {
        throw new Error('Video factory API is not available.');
      }

      const { projectId } = await window.flowApi.createFactoryProject(config);
      setCreatedAudioProjectId(projectId);

      if (audioSaveDirectory && window.flowApi?.updateProject) {
        try {
          await window.flowApi.updateProject(projectId, { destinationDir: audioSaveDirectory } as any);
        } catch {
          // ignore optional field
        }
      }

      let manifest: any = null;

      // Phase 2 Unified Pipeline: Run in audio_only mode
      if (window.flowApi?.startPipeline) {
        await window.flowApi.startPipeline(projectId, 'audio_only');
        if (window.flowApi?.getAudioManifest) {
          manifest = await window.flowApi.getAudioManifest(projectId);
        }
      } else if (window.flowApi?.synthesizeProjectVoice) {
        manifest = await window.flowApi.synthesizeProjectVoice(projectId, voiceId, voiceEngine as TtsProviderId);
        if (window.flowApi?.combineAudio) {
          try {
            const combined = await window.flowApi.combineAudio(projectId, 'final_audio.mp3');
            manifest.masterAudioFile = 'audio/final_audio.mp3';
            manifest.masterAudioPath = combined.masterAudioPath;
            manifest.totalDurationSeconds = combined.durationSeconds;
          } catch (combineErr) {
            console.warn('Audio combination warning:', combineErr);
          }
        }
      }

      if (manifest) {
        setAudioOnlyManifest(manifest);
      }
    } catch (err: any) {
      console.error('Audio only synthesis failed:', err);
      setErrorMsg(err?.message || 'Failed to synthesize standalone audio.');
    } finally {
      setIsSynthesizingAudioOnly(false);
    }
  };

  if (loadingDraft) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading Studio...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header bar */}
      <div
        style={{
          padding: '16px 32px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(168, 85, 247, 0.12)',
              color: '#a855f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SparklesIcon size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Create Video
              </h1>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Turn scripts, prompts, or titles into finished faceless videos with AI narration and camera motion.
            </p>
          </div>
        </div>

        {/* Project Metadata & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Project:</span>
            <input
              type="text"
              aria-label="Project Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                persistDraft({ title: e.target.value });
              }}
              placeholder="e.g. New Faceless Video"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12.5px',
                fontWeight: 600,
                width: '240px',
              }}
            />
          </div>

          {savingMsg && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckIcon size={12} /> Auto-saved
            </span>
          )}
          <button type="button" onClick={onCancel} className="btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }}>
            Cancel
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div
        style={{
          padding: '12px 32px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-subtle)',
          display: 'flex',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        {[
          { id: 'full_video', label: '1. Full Video', desc: 'Script in → Video out' },
          { id: 'from_skill', label: '2. From Skill', desc: 'Title in → Complete package' },
          { id: 'images_only', label: '3. Images Only', desc: 'Batch scene artwork' },
          { id: 'audio_only', label: '4. Audio Only', desc: 'Narration voiceover' },
        ].map((m) => {
          const isSel = activeMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setActiveMode(m.id as VideoFactoryMode);
                persistDraft({ activeMode: m.id as VideoFactoryMode });
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: isSel ? '1px solid #a855f7' : '1px solid var(--border-color)',
                backgroundColor: isSel ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-surface)',
                color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: isSel ? 700 : 600 }}>{m.label}</span>
              <span style={{ fontSize: '11px', color: isSel ? '#a855f7' : 'var(--text-muted)' }}>{m.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Error Alert if any */}
      {errorMsg && (
        <div
          style={{
            margin: '12px 32px 0 32px',
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger, #ef4444)',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Main View Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {/* ============================================================ */}
        {/* MODE: FULL VIDEO                                             */}
        {/* ============================================================ */}
        {activeMode === 'full_video' && (
          <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* 5-Step Stepper Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '6px 8px',
                gap: '4px',
              }}
            >
              {[
                { s: 1, name: '1. Script' },
                { s: 2, name: '2. Format' },
                { s: 3, name: '3. Subtitles' },
                { s: 4, name: '4. Motion' },
                { s: 5, name: '5. Voice & Music' },
                { s: 6, name: '6. Review & Launch' },
              ].map((st) => {
                const isActive = step === st.s;
                const isPassed = step > st.s;
                return (
                  <button
                    key={st.s}
                    type="button"
                    onClick={() => {
                      if (st.s < step || scenes.length > 0) {
                        setStep(st.s);
                        persistDraft({ step: st.s });
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-md)',
                      border: 'none',
                      backgroundColor: isActive ? 'rgba(168, 85, 247, 0.16)' : 'transparent',
                      color: isActive ? '#c084fc' : isPassed ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '12.5px',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    {isPassed && <CheckIcon size={13} />}
                    {st.name}
                  </button>
                );
              })}
            </div>

            {/* STEP 1: SCRIPT */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Hidden file input for script import */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".txt,.md,.json"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {/* Script Editor Container */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  {/* Mode Bar & Action Controls */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    {editorTab === 'raw' ? (
                      <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                        {[
                          { id: 'one_file', label: 'One File', ariaLabel: 'One File' },
                          { id: 'separate_files', label: 'Separate Files', ariaLabel: 'Separate Files' },
                          { id: 'paste', label: 'Paste Text', ariaLabel: 'Paste Text (Paste Script)' },
                        ].map((sub) => {
                          const isSel = scriptInputMode === sub.id;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              aria-label={sub.ariaLabel}
                              onClick={() => setScriptInputMode(sub.id as any)}
                              style={{
                                padding: '6px 14px',
                                borderRadius: 'var(--radius-xs)',
                                border: 'none',
                                backgroundColor: isSel ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                                color: isSel ? '#c084fc' : 'var(--text-secondary)',
                                fontSize: '12px',
                                fontWeight: isSel ? 700 : 500,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {sub.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          type="button"
                          aria-label="Script Text"
                          onClick={() => {
                            handleSyncToRawScript();
                            setEditorTab('raw');
                            setScriptInputMode('paste');
                          }}
                          className="btn-secondary"
                          style={{
                            padding: '6px 14px',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          ← Script Text
                        </button>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Structured Scene Cards View
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {editorTab === 'raw' ? (
                        <button
                          type="button"
                          onClick={() => setEditorTab('structured')}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid rgba(168, 85, 247, 0.4)',
                            backgroundColor: 'rgba(168, 85, 247, 0.12)',
                            color: '#c084fc',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          Scene Cards ({scenes.length}) →
                        </button>
                      ) : (
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                          {scenes.length} {scenes.length === 1 ? 'Scene' : 'Scenes'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* TAB 1: SCRIPT INPUT VIEW */}
                  {editorTab === 'raw' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* SUBMODE 1: ONE FILE */}
                      {scriptInputMode === 'one_file' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                            Import a single unified script file (.md, .txt, or .json) containing narration, image prompts, and optional title/thumbnail.
                          </p>

                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              setIsDraggingFile(true);
                            }}
                            onDragLeave={() => setIsDraggingFile(false)}
                            onDrop={handleDropOneFile}
                            style={{
                              border: isDraggingFile ? '2px dashed #a855f7' : '2px dashed var(--border-color)',
                              borderRadius: 'var(--radius-md)',
                              padding: '28px 20px',
                              textAlign: 'center',
                              backgroundColor: isDraggingFile ? 'rgba(168, 85, 247, 0.08)' : 'var(--bg-subtle)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '12px',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            <UploadIcon size={28} />

                            {oneFile ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                  📄 {oneFile.fileName}
                                </span>
                                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                  {oneFile.filePath} · {oneFile.content.length} characters
                                </span>
                                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectScriptFile('one')}
                                    className="btn-secondary"
                                    style={{ padding: '5px 14px', fontSize: '11.5px' }}
                                  >
                                    Replace File
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOneFile(null);
                                      handleScriptChange('');
                                    }}
                                    className="btn-secondary"
                                    style={{ padding: '5px 14px', fontSize: '11.5px', color: 'var(--danger)' }}
                                  >
                                    Clear File
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                                    Drag and drop your script file here, or browse from disk
                                  </span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    Supported formats: Markdown (.md), Plain Text (.txt), JSON Story (.json)
                                  </span>
                                </div>

                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '2px' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectScriptFile('one')}
                                    className="btn-primary"
                                    style={{ padding: '7px 18px', fontSize: '12px' }}
                                  >
                                    Browse Files...
                                  </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Or quick test:</span>
                                  <button
                                    type="button"
                                    onClick={() => handleLoadSample('documentary')}
                                    className="btn-secondary"
                                    style={{ padding: '3px 10px', fontSize: '11px' }}
                                  >
                                    Sample: Ocean
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleLoadSample('space')}
                                    className="btn-secondary"
                                    style={{ padding: '3px 10px', fontSize: '11px' }}
                                  >
                                    Sample: Space
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* SUBMODE 2: SEPARATE FILES */}
                      {scriptInputMode === 'separate_files' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div
                            style={{
                              padding: '10px 14px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'rgba(59, 130, 246, 0.08)',
                              border: '1px solid rgba(59, 130, 246, 0.25)',
                              fontSize: '12px',
                              color: '#60a5fa',
                              lineHeight: 1.4,
                            }}
                          >
                            <strong>ZBot Separate Files Workflow:</strong> Select separate Narration and Image Prompts files. The Image Prompts file is <em>authoritative</em> for scene count (Golden Rule #2); narration is automatically distributed across scenes.
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {/* Row 1: Narration File */}
                            <div
                              style={{
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--bg-subtle)',
                                border: '1px solid var(--border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    1. Narration File (.txt, .md)
                                  </span>
                                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontWeight: 600 }}>
                                    Required
                                  </span>
                                  {narrationFile && (
                                    <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>✓ Ready</span>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  Voiceover script paragraphs or sentences
                                </span>
                              </div>

                              {narrationFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    📄 {narrationFile.fileName}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectScriptFile('narration')}
                                    className="btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
                                  >
                                    Replace
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNarrationFile(null)}
                                    style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: '13px' }}
                                    title="Remove file"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSelectScriptFile('narration')}
                                  className="btn-secondary"
                                  style={{ padding: '6px 14px', fontSize: '11.5px' }}
                                >
                                  Browse Narration File...
                                </button>
                              )}
                            </div>

                            {/* Row 2: Image Prompts File (Authoritative) */}
                            <div
                              style={{
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--bg-subtle)',
                                border: '1px solid var(--border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    2. Image Prompts File (.txt, .md)
                                  </span>
                                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontWeight: 700 }}>
                                    GOLDEN RULE #2
                                  </span>
                                  {promptsFile && (
                                    <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>✓ Ready</span>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  Number of prompts strictly dictates scene count
                                </span>
                              </div>

                              {promptsFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    🎨 {promptsFile.fileName}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectScriptFile('prompts')}
                                    className="btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
                                  >
                                    Replace
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPromptsFile(null)}
                                    style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: '13px' }}
                                    title="Remove file"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSelectScriptFile('prompts')}
                                  className="btn-secondary"
                                  style={{ padding: '6px 14px', fontSize: '11.5px' }}
                                >
                                  Browse Prompts File...
                                </button>
                              )}
                            </div>

                            {/* Row 3: Optional Thumbnail File */}
                            <div
                              style={{
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--bg-subtle)',
                                border: '1px solid var(--border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    3. Thumbnail Prompt File (.txt, .md)
                                  </span>
                                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                                    Optional
                                  </span>
                                  {thumbnailFile && (
                                    <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>✓ Ready</span>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  Dedicated prompt for YouTube/Shorts cover artwork
                                </span>
                              </div>

                              {thumbnailFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    🖼️ {thumbnailFile.fileName}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectScriptFile('thumbnail')}
                                    className="btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
                                  >
                                    Replace
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setThumbnailFile(null)}
                                    style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: '13px' }}
                                    title="Remove file"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSelectScriptFile('thumbnail')}
                                  className="btn-secondary"
                                  style={{ padding: '6px 14px', fontSize: '11.5px' }}
                                >
                                  Browse Thumbnail Prompt...
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Action Button & Mismatch Notice */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                            <button
                              type="button"
                              disabled={!promptsFile}
                              onClick={handleParseSeparateFiles}
                              className="btn-primary"
                              style={{ padding: '8px 22px', fontSize: '12.5px', fontWeight: 600 }}
                            >
                              Parse & Match Scenes
                            </button>
                          </div>

                          {separateFilesMismatchNotice && (
                            <div
                              style={{
                                padding: '10px 14px',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                fontSize: '11.5px',
                                color: '#10b981',
                              }}
                            >
                              {separateFilesMismatchNotice}
                            </div>
                          )}
                        </div>
                      )}

                      {/* SUBMODE 3: PASTE TEXT */}
                      {scriptInputMode === 'paste' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                              Paste script text in any format: Marked (## SCENE, NARRATION:, IMAGE:), Asset Blocks (IMG 1, ASSET 1), Sectioned (=== NARRATION ===), JSON Story, or Plain Text.
                            </p>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => handleLoadSample('documentary')}
                                className="btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                              >
                                Sample: Ocean
                              </button>
                              <button
                                type="button"
                                onClick={() => handleLoadSample('space')}
                                className="btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                              >
                                Sample: Space
                              </button>
                            </div>
                          </div>

                          <textarea
                            rows={12}
                            value={rawScript}
                            onChange={(e) => handleScriptChange(e.target.value)}
                            placeholder="Enter or paste your script here...&#10;&#10;Example:&#10;## SCENE 1&#10;NARRATION: Beneath the surface lies a mystery...&#10;IMAGE: Glowing deep sea trench with neon jellyfish&#10;&#10;## SCENE 2&#10;NARRATION: Submersibles discover new life...&#10;IMAGE: Research submarine illuminating hydrothermal vents"
                            style={{
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-color)',
                              padding: '14px',
                              borderRadius: 'var(--radius-sm)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              lineHeight: 1.5,
                              resize: 'vertical',
                              minHeight: '200px',
                              width: '100%',
                            }}
                          />

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleScriptChange(rawScript)}
                              className="btn-secondary"
                              style={{ padding: '5px 14px', fontSize: '11.5px' }}
                            >
                              Parse Script
                            </button>
                          </div>
                        </div>
                      )}

                      {/* UNIFIED RESULT BAR & PREVIEW (Directly below active input method) */}
                      {scenes.length > 0 && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '12px 16px',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'rgba(16, 185, 129, 0.05)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  padding: '4px 10px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                  color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                }}
                              >
                                ✓ {scenes.length} Scenes Loaded
                              </span>

                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                ~{validation.estimatedDurationSeconds}s voiceover · {validation.totalWords} words
                              </span>

                              <button
                                type="button"
                                disabled={isReReading || !rawScript.trim()}
                                onClick={handleAiReRead}
                                className="btn-secondary"
                                style={{
                                  padding: '3px 10px',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#10b981',
                                }}
                              >
                                <SparklesIcon size={12} />
                                {isReReading ? 'Re-reading lines...' : 'Wrong count? Re-read with AI'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                                type="button"
                                onClick={() => setShowParsedScenesPreview(!showParsedScenesPreview)}
                                className="btn-secondary"
                                style={{ padding: '4px 10px', fontSize: '11.5px' }}
                              >
                                {showParsedScenesPreview ? 'Hide Preview' : 'Preview Scenes'}
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditorTab('structured')}
                                style={{
                                  padding: '4px 12px',
                                  fontSize: '11.5px',
                                  borderRadius: 'var(--radius-xs)',
                                  backgroundColor: 'rgba(168, 85, 247, 0.2)',
                                  color: '#c084fc',
                                  border: '1px solid rgba(168, 85, 247, 0.35)',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                Scene Cards ({scenes.length}) →
                              </button>
                            </div>
                          </div>

                          {/* Collapsible Preview Cards */}
                          {showParsedScenesPreview && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                borderTop: '1px solid rgba(16, 185, 129, 0.2)',
                                paddingTop: '10px',
                                maxHeight: '320px',
                                overflowY: 'auto',
                              }}
                            >
                              {scenes.map((sc) => (
                                <div
                                  key={sc.sceneNumber}
                                  style={{
                                    backgroundColor: 'var(--bg-surface)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '10px 14px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc' }}>
                                      Scene {sc.sceneNumber}
                                    </span>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                                        ~{sc.durationSeconds || 3}s · {sc.wordCount || 0} words
                                      </span>
                                      {sc.mood && (
                                        <span
                                          style={{
                                            fontSize: '10px',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            backgroundColor: 'var(--bg-subtle)',
                                            color: 'var(--text-secondary)',
                                          }}
                                        >
                                          Mood: {sc.mood}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                                    <strong>Narration:</strong> {sc.narration}
                                  </div>
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                    <strong>Prompt:</strong> {sc.imagePrompt}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {warnings.length > 0 && (
                            <span style={{ fontSize: '11.5px', color: '#f59e0b' }}>
                              ⚠️ {warnings[0]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: STRUCTURED SCENES EDITOR */}
                  {editorTab === 'structured' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Review and edit scene prompts, narrations, and moods. User prompts are preserved 100% verbatim.
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={handleSyncToRawScript}
                            className="btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            Sync to Script Text
                          </button>
                          <button
                            type="button"
                            onClick={handleAddScene}
                            className="btn-primary"
                            style={{ padding: '4px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <PlusIcon size={12} /> Add Scene
                          </button>
                        </div>
                      </div>

                      {scenes.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                          No scenes yet. Enter a script in Script Text view or click "+ Add Scene" above.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {scenes.map((sc, idx) => {
                            const isMissingPrompt = !sc.imagePrompt.trim();
                            return (
                              <div
                                key={sc.sceneNumber}
                                style={{
                                  backgroundColor: 'var(--bg-subtle)',
                                  border: isMissingPrompt ? '1px solid var(--danger, #ef4444)' : '1px solid var(--border-color)',
                                  borderRadius: 'var(--radius-md)',
                                  padding: '16px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '12px',
                                }}
                              >
                                {/* Scene Card Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#c084fc' }}>
                                      Scene #{sc.sceneNumber}
                                    </span>
                                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                      ~{sc.durationSeconds || 3}s · {sc.wordCount || 0} words
                                    </span>
                                  </div>

                                  {/* Actions: Move Up / Down / Duplicate / Delete */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveScene(idx, 'up')}
                                      title="Move scene up"
                                      className="btn-secondary"
                                      style={{ padding: '4px 6px', fontSize: '11px', opacity: idx === 0 ? 0.4 : 1 }}
                                    >
                                      <ChevronUpIcon size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === scenes.length - 1}
                                      onClick={() => handleMoveScene(idx, 'down')}
                                      title="Move scene down"
                                      className="btn-secondary"
                                      style={{ padding: '4px 6px', fontSize: '11px', opacity: idx === scenes.length - 1 ? 0.4 : 1 }}
                                    >
                                      <ChevronDownIcon size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDuplicateScene(idx)}
                                      title="Duplicate scene"
                                      className="btn-secondary"
                                      style={{ padding: '4px 6px', fontSize: '11px' }}
                                    >
                                      <CopyIcon size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={scenes.length <= 1}
                                      onClick={() => handleDeleteScene(idx)}
                                      title="Delete scene"
                                      className="btn-secondary"
                                      style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--danger, #ef4444)', opacity: scenes.length <= 1 ? 0.4 : 1 }}
                                    >
                                      <TrashIcon size={12} />
                                    </button>
                                  </div>
                                </div>

                                {/* Single-Scene AI Refinement Box if active */}
                                {refiningSceneNumber === sc.sceneNumber && (
                                  <div
                                    style={{
                                      padding: '12px 14px',
                                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                                      border: '1px solid rgba(16, 185, 129, 0.35)',
                                      borderRadius: 'var(--radius-sm)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '8px',
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <SparklesIcon size={12} />
                                        Refine Scene #{sc.sceneNumber} {refiningField === 'narration' ? 'Voiceover' : 'Visual Prompt'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRefiningSceneNumber(null);
                                          setRefiningField(null);
                                        }}
                                        style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}
                                      >
                                        ✕
                                      </button>
                                    </div>

                                    <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                      {refiningField === 'narration'
                                        ? 'Refines ONLY spoken text. Image prompt and all other scenes remain 100% untouched.'
                                        : 'Refines ONLY visual generation prompt. Narration and all other scenes remain 100% untouched.'}
                                    </p>

                                    <input
                                      type="text"
                                      value={refiningInstructions}
                                      onChange={(e) => setRefiningInstructions(e.target.value)}
                                      placeholder={
                                        refiningField === 'narration'
                                          ? 'e.g. Make it more dramatic, urgent, and cinematic'
                                          : 'e.g. Add volumetric sunset lighting, macro depth of field, neon hues'
                                      }
                                      style={{
                                        padding: '7px 10px',
                                        borderRadius: 'var(--radius-xs)',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--bg-surface)',
                                        color: 'var(--text-primary)',
                                        fontSize: '12px',
                                      }}
                                    />

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
                                      <button
                                        type="button"
                                        disabled={isRefining}
                                        onClick={() => {
                                          setRefiningSceneNumber(null);
                                          setRefiningField(null);
                                        }}
                                        className="btn-secondary"
                                        style={{ padding: '4px 10px', fontSize: '11.5px' }}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isRefining}
                                        onClick={() => handleExecuteRefine(sc.sceneNumber, refiningField!)}
                                        className="btn-primary"
                                        style={{
                                          padding: '4px 14px',
                                          fontSize: '11.5px',
                                          backgroundColor: '#10b981',
                                          borderColor: '#10b981',
                                        }}
                                      >
                                        {isRefining ? 'Refining...' : 'Apply Refinement'}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Image Prompt Field (Verbatim) */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                      Image Prompt (Verbatim for Generation)
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRefiningSceneNumber(sc.sceneNumber);
                                        setRefiningField('imagePrompt');
                                        setRefiningInstructions('');
                                      }}
                                      className="btn-secondary"
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '11px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: '#10b981',
                                      }}
                                    >
                                      <SparklesIcon size={11} /> Refine Prompt
                                    </button>
                                  </div>
                                  <textarea
                                    rows={2}
                                    value={sc.imagePrompt}
                                    onChange={(e) => handleUpdateScene(idx, { imagePrompt: e.target.value })}
                                    placeholder="Enter exact visual prompt for scene artwork..."
                                    style={{
                                      backgroundColor: 'var(--bg-surface)',
                                      color: 'var(--text-primary)',
                                      border: isMissingPrompt ? '1px solid var(--danger, #ef4444)' : '1px solid var(--border-color)',
                                      padding: '8px 10px',
                                      borderRadius: 'var(--radius-sm)',
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '12px',
                                      lineHeight: 1.4,
                                      resize: 'vertical',
                                      width: '100%',
                                    }}
                                  />
                                  {isMissingPrompt && (
                                    <span style={{ fontSize: '11px', color: 'var(--danger, #ef4444)' }}>
                                      Image prompt is required for this scene.
                                    </span>
                                  )}
                                </div>

                                {/* Narration Field */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                      Voiceover Narration
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRefiningSceneNumber(sc.sceneNumber);
                                        setRefiningField('narration');
                                        setRefiningInstructions('');
                                      }}
                                      className="btn-secondary"
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '11px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: '#a855f7',
                                      }}
                                    >
                                      <SparklesIcon size={11} /> Refine Voiceover
                                    </button>
                                  </div>
                                  <textarea
                                    rows={2}
                                    value={sc.narration}
                                    onChange={(e) => handleUpdateScene(idx, { narration: e.target.value })}
                                    placeholder="Enter spoken voiceover script for this scene..."
                                    style={{
                                      backgroundColor: 'var(--bg-surface)',
                                      color: 'var(--text-primary)',
                                      border: '1px solid var(--border-color)',
                                      padding: '8px 10px',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: '12px',
                                      lineHeight: 1.4,
                                      resize: 'vertical',
                                      width: '100%',
                                    }}
                                  />
                                </div>

                                {/* Mood & Quick Chips */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                    Mood:
                                  </label>
                                  <input
                                    type="text"
                                    value={sc.mood || ''}
                                    onChange={(e) => handleUpdateScene(idx, { mood: e.target.value })}
                                    placeholder="e.g. dramatic, awe"
                                    style={{
                                      backgroundColor: 'var(--bg-surface)',
                                      color: 'var(--text-primary)',
                                      border: '1px solid var(--border-color)',
                                      padding: '3px 8px',
                                      borderRadius: 'var(--radius-xs)',
                                      fontSize: '11.5px',
                                      width: '120px',
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    {['mysterious', 'dramatic', 'awe', 'calm', 'energetic'].map((preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => handleUpdateScene(idx, { mood: preset })}
                                        style={{
                                          padding: '2px 7px',
                                          borderRadius: '4px',
                                          border: '1px solid var(--border-color)',
                                          backgroundColor: sc.mood === preset ? 'rgba(168, 85, 247, 0.16)' : 'var(--bg-surface)',
                                          color: sc.mood === preset ? '#c084fc' : 'var(--text-secondary)',
                                          fontSize: '10.5px',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {preset}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '6px' }}>
                            <button
                              type="button"
                              onClick={handleAddScene}
                              className="btn-secondary"
                              style={{ padding: '8px 20px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                              <PlusIcon size={14} /> Add Another Scene
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Validation Status & Issues Banner */}
                {!validation.isValid && validation.errors.length > 0 && (
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger, #ef4444)', fontWeight: 600, fontSize: '12.5px' }}>
                      <AlertCircleIcon size={14} /> Please resolve the following script validation issues:
                    </div>
                    <ul style={{ margin: '0 0 0 20px', padding: 0, fontSize: '11.5px', color: 'var(--danger, #ef4444)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {validation.errors.map((err, i) => (
                        <li key={i}>{err.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            )}

            {/* STEP 2: FORMAT */}
            {step === 2 && (
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Select Video Format & Orientation
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Choose the target aspect ratio. Scene artwork generation and camera motion will be framed accordingly.
                  </p>
                </div>

                {/* Channel Assignment (Phase 7) */}
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Channel Workflow (Optional)
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Assigning a channel applies its rulebook, formatting presets, and dedicated output folders.
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select
                      value={channelId || 'none'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'none') {
                          setChannelId(undefined);
                          setChannelName(undefined);
                          persistDraft({ channelId: undefined, channelName: undefined });
                        } else {
                          const selectedCh = availableChannels.find((c) => c.id === val);
                          if (selectedCh) {
                            setChannelId(selectedCh.id);
                            setChannelName(selectedCh.name);
                            if (selectedCh.defaultAspectRatio) setAspectRatio(selectedCh.defaultAspectRatio);
                            if (selectedCh.defaultMotionStyle) setMotionStyle(selectedCh.defaultMotionStyle);
                            if (selectedCh.defaultSubtitleStyle) setSubtitleStyle(selectedCh.defaultSubtitleStyle);
                            if (selectedCh.defaultTransitionStyle) setTransitionStyle(selectedCh.defaultTransitionStyle);
                            if (selectedCh.defaultVoiceId) setVoiceId(selectedCh.defaultVoiceId);
                            persistDraft({
                              channelId: selectedCh.id,
                              channelName: selectedCh.name,
                              aspectRatio: selectedCh.defaultAspectRatio || aspectRatio,
                              motionStyle: selectedCh.defaultMotionStyle || motionStyle,
                              subtitleStyle: selectedCh.defaultSubtitleStyle || subtitleStyle,
                              transitionStyle: selectedCh.defaultTransitionStyle || transitionStyle,
                              voiceId: selectedCh.defaultVoiceId || voiceId,
                            });
                          }
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-color)',
                        color: channelId ? '#60a5fa' : 'var(--text-primary)',
                        fontSize: '13px',
                        cursor: 'pointer',
                        minWidth: '200px',
                      }}
                    >
                      <option value="none">-- Unassigned --</option>
                      {availableChannels.map((c) => (
                        <option key={c.id} value={c.id}>
                          📺 {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {[
                    {
                      ratio: '16:9' as SupportedAspectRatio,
                      title: '16:9 Landscape',
                      platforms: ['YouTube', 'TV'],
                      boxWidth: '80px',
                      boxHeight: '45px',
                    },
                    {
                      ratio: '9:16' as SupportedAspectRatio,
                      title: '9:16 Portrait (Vertical)',
                      platforms: ['TikTok', 'Reels', 'Shorts'],
                      boxWidth: '45px',
                      boxHeight: '80px',
                    },
                  ].map((f) => {
                    const isSel = aspectRatio === f.ratio;
                    return (
                      <div
                        key={f.ratio}
                        onClick={() => {
                          setAspectRatio(f.ratio);
                          persistDraft({ aspectRatio: f.ratio });
                        }}
                        style={{
                          backgroundColor: isSel ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-subtle)',
                          border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                          boxShadow: isSel ? '0 0 0 1px rgba(168, 85, 247, 0.4), 0 4px 16px rgba(168, 85, 247, 0.15)' : 'none',
                          borderRadius: 'var(--radius-md)',
                          padding: '20px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                          transition: 'all 0.18s ease-in-out',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '15px', fontWeight: isSel ? 700 : 600, color: isSel ? '#ffffff' : 'var(--text-primary)' }}>
                            {f.title}
                          </span>
                          <div
                            style={{
                              width: '22px',
                              height: '22px',
                              borderRadius: '50%',
                              backgroundColor: isSel ? '#a855f7' : 'transparent',
                              border: isSel ? '2px solid #a855f7' : '2px solid var(--border-color)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.18s ease-in-out',
                            }}
                          >
                            {isSel && <CheckIcon size={13} color="#ffffff" />}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '96px' }}>
                          <div
                            style={{
                              width: f.boxWidth,
                              height: f.boxHeight,
                              border: isSel ? '2px solid #a855f7' : '2px dashed rgba(255, 255, 255, 0.25)',
                              borderRadius: '6px',
                              backgroundColor: isSel ? 'rgba(168, 85, 247, 0.28)' : 'rgba(255, 255, 255, 0.02)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.18s ease-in-out',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: isSel ? '#e9d5ff' : 'var(--text-muted)',
                              }}
                            >
                              {f.ratio}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {f.platforms.map((platform) => (
                            <span
                              key={platform}
                              style={{
                                fontSize: '11px',
                                fontWeight: 500,
                                padding: '3px 9px',
                                borderRadius: '12px',
                                backgroundColor: isSel ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                                color: isSel ? '#e9d5ff' : 'var(--text-muted)',
                                border: isSel ? '1px solid rgba(168, 85, 247, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                                transition: 'all 0.18s ease-in-out',
                              }}
                            >
                              {platform}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Output Resolution */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Output Resolution
                    </label>
                    <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      Choose the final output resolution.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    {[
                      {
                        id: 'source' as FinalOutputResolution,
                        name: 'Source / Original',
                        desc: aspectRatio === '9:16' ? '720 × 1280' : '1280 × 720',
                      },
                      {
                        id: '1080p' as FinalOutputResolution,
                        name: '1080p Full HD',
                        desc: aspectRatio === '9:16' ? '1080 × 1920' : '1920 × 1080',
                      },
                      {
                        id: '4k' as FinalOutputResolution,
                        name: '4K Ultra HD',
                        desc: aspectRatio === '9:16' ? '2160 × 3840' : '3840 × 2160',
                      },
                    ].map((res) => {
                      const isSel = outputResolution === res.id;
                      return (
                        <div
                          key={res.id}
                          onClick={() => {
                            setOutputResolution(res.id);
                            persistDraft({ outputResolution: res.id });
                          }}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 'var(--radius-sm)',
                            border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                            backgroundColor: isSel ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-subtle)',
                            boxShadow: isSel ? '0 0 0 1px rgba(168, 85, 247, 0.3)' : 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            transition: 'all 0.18s ease-in-out',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: isSel ? 700 : 600, color: isSel ? '#ffffff' : 'var(--text-primary)' }}>
                              {res.name}
                            </span>
                            <div
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                backgroundColor: isSel ? '#a855f7' : 'transparent',
                                border: isSel ? '2px solid #a855f7' : '1.5px solid var(--border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {isSel && <CheckIcon size={10} color="#ffffff" />}
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', color: isSel ? '#d8b4fe' : 'var(--text-muted)' }}>
                            {res.desc}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: SUBTITLES */}
            {step === 3 && (
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Subtitles Configuration
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Configure whether burned animated subtitles should be rendered over the video scenes.
                  </p>
                </div>

                {/* Master Switch */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    backgroundColor: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Burn Subtitles onto Video
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Synchronized animated subtitles burned directly onto video clips.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !subtitlesEnabled;
                      setSubtitlesEnabled(next);
                      persistDraft({ subtitlesEnabled: next });
                    }}
                    className={subtitlesEnabled ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    {subtitlesEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {/* Subtitle Style Presets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Subtitle Preset Style
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {[
                      {
                        id: 'bottom_glass',
                        name: 'Bottom Glass',
                        desc: 'Frosted lower bar',
                        cfg: {
                          preset: 'bottom_glass',
                          fontFamily: 'Arial',
                          fontSize: 32,
                          textColor: '#FFFFFF',
                          backgroundColor: '#1A1917',
                          boxColor: '#1A1917',
                          boxEnabled: true,
                          outlineWidth: 3,
                          shadowDepth: 0,
                          position: 'bottom' as const,
                        },
                      },
                      {
                        id: 'solid_bar',
                        name: 'Solid Bar',
                        desc: 'High-contrast strip',
                        cfg: {
                          preset: 'solid_bar',
                          fontFamily: 'Arial',
                          fontSize: 32,
                          textColor: '#FFFFFF',
                          backgroundColor: '#000000',
                          boxColor: '#000000',
                          boxEnabled: true,
                          outlineWidth: 4,
                          shadowDepth: 0,
                          position: 'bottom' as const,
                        },
                      },
                      {
                        id: 'neon_punch',
                        name: 'Neon Punch',
                        desc: 'Vibrant punchy titles',
                        cfg: {
                          preset: 'neon_punch',
                          fontFamily: 'Arial',
                          fontSize: 34,
                          textColor: '#00FFFF',
                          backgroundColor: '#101010',
                          boxColor: '#101010',
                          boxEnabled: false,
                          outlineWidth: 3,
                          shadowDepth: 2,
                          position: 'bottom' as const,
                        },
                      },
                      {
                        id: 'cinema_yellow',
                        name: 'Cinema Yellow',
                        desc: 'Classic cinematic',
                        cfg: {
                          preset: 'cinema_yellow',
                          fontFamily: 'Arial',
                          fontSize: 34,
                          textColor: '#FFE500',
                          backgroundColor: '#000000',
                          boxColor: '#000000',
                          boxEnabled: false,
                          outlineWidth: 3,
                          shadowDepth: 2,
                          position: 'bottom' as const,
                        },
                      },
                    ].map((st) => {
                      const isSel = subtitleStyle === st.id;
                      return (
                        <div
                          key={st.id}
                          onClick={() => {
                            if (subtitlesEnabled) {
                              setSubtitleStyle(st.id);
                              setSubtitleConfig((prev) => ({
                                ...prev,
                                ...st.cfg,
                                enabled: true,
                              }));
                              persistDraft({
                                subtitleStyle: st.id,
                                subtitleConfig: {
                                  ...subtitleConfig,
                                  ...st.cfg,
                                  enabled: true,
                                },
                              });
                            }
                          }}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 'var(--radius-sm)',
                            border: isSel && subtitlesEnabled ? '2px solid #a855f7' : '1px solid var(--border-color)',
                            backgroundColor: isSel && subtitlesEnabled ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-subtle)',
                            boxShadow: isSel && subtitlesEnabled ? '0 0 0 1px rgba(168, 85, 247, 0.3)' : 'none',
                            opacity: subtitlesEnabled ? 1 : 0.45,
                            cursor: subtitlesEnabled ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            transition: 'all 0.18s ease-in-out',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: isSel && subtitlesEnabled ? 700 : 600, color: isSel && subtitlesEnabled ? '#ffffff' : 'var(--text-primary)' }}>
                              {st.name}
                            </span>
                            <div
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                backgroundColor: isSel && subtitlesEnabled ? '#a855f7' : 'transparent',
                                border: isSel && subtitlesEnabled ? '2px solid #a855f7' : '1.5px solid var(--border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {isSel && subtitlesEnabled && <CheckIcon size={10} color="#ffffff" />}
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', color: isSel && subtitlesEnabled ? '#d8b4fe' : 'var(--text-muted)' }}>
                            {st.desc}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Direct Individual Subtitle Controls */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    opacity: subtitlesEnabled ? 1 : 0.45,
                    pointerEvents: subtitlesEnabled ? 'auto' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Configuration
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Directly configure animation, positioning, typography, and container styling
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {/* Row 1, Col 1: Animation */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Animation
                      </label>
                      <select
                        value={subtitleConfig.animation || 'karaoke'}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setSubtitleConfig((prev) => ({ ...prev, animation: val }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, animation: val } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="karaoke">Karaoke — Word-by-word Highlight</option>
                        <option value="none">None — Static Subtitles</option>
                        <option value="fade">Fade — Smooth In / Out</option>
                        <option value="pop">Pop — Bouncy Entrance</option>
                      </select>
                    </div>

                    {/* Row 1, Col 2: What to Show */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        What to Show
                      </label>
                      <select
                        value={subtitleConfig.whatToShow || 'all'}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setSubtitleConfig((prev) => ({ ...prev, whatToShow: val }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, whatToShow: val } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="all">All Spoken Text</option>
                        <option value="dialogue_only">Dialogue Only</option>
                        <option value="narration_only">Narration Only</option>
                      </select>
                    </div>

                    {/* Row 1, Col 3: Position */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Position
                      </label>
                      <select
                        value={subtitleConfig.position || 'bottom'}
                        onChange={(e) => {
                          const val = e.target.value as 'bottom' | 'center' | 'top';
                          setSubtitleConfig((prev) => ({ ...prev, position: val }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, position: val } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="bottom">Bottom Overlay</option>
                        <option value="center">Center Screen</option>
                        <option value="top">Top Header</option>
                      </select>
                    </div>

                    {/* Row 2, Col 1: Font */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Font
                      </label>
                      <select
                        value={subtitleConfig.fontFamily || 'Arial'}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSubtitleConfig((prev) => ({ ...prev, fontFamily: val }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, fontFamily: val } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        {['Arial', 'Montserrat', 'Roboto', 'Impact', 'Helvetica', 'Georgia', 'Inter'].map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>

                    {/* Row 2, Col 2: Size */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Size
                      </label>
                      <select
                        value={subtitleConfig.fontSize || 32}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setSubtitleConfig((prev) => ({ ...prev, fontSize: val }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, fontSize: val } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value={24}>Small (24px)</option>
                        <option value={28}>Normal (28px)</option>
                        <option value={32}>Medium (32px)</option>
                        <option value={36}>Large (36px)</option>
                        <option value={42}>Extra Large (42px)</option>
                      </select>
                    </div>

                    {/* Row 2, Col 3: Text Color */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Text Color
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={
                            ['#FFFFFF', '#FFE500', '#00FFFF', '#A855F7', '#38BDF8', '#4ADE80', '#FF4D4D'].includes((subtitleConfig.textColor || '#FFFFFF').toUpperCase())
                              ? (subtitleConfig.textColor || '#FFFFFF').toUpperCase()
                              : 'custom'
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== 'custom') {
                              setSubtitleConfig((prev) => ({ ...prev, textColor: val }));
                              persistDraft({ subtitleConfig: { ...subtitleConfig, textColor: val } });
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="#FFFFFF">White</option>
                          <option value="#FFE500">Yellow</option>
                          <option value="#00FFFF">Cyan</option>
                          <option value="#A855F7">Purple</option>
                          <option value="#38BDF8">Sky Blue</option>
                          <option value="#4ADE80">Electric Green</option>
                          <option value="#FF4D4D">Red</option>
                          {!['#FFFFFF', '#FFE500', '#00FFFF', '#A855F7', '#38BDF8', '#4ADE80', '#FF4D4D'].includes((subtitleConfig.textColor || '#FFFFFF').toUpperCase()) && (
                            <option value="custom">Custom ({(subtitleConfig.textColor || '#FFFFFF').toUpperCase()})</option>
                          )}
                        </select>
                        <input
                          type="color"
                          value={subtitleConfig.textColor || '#FFFFFF'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubtitleConfig((prev) => ({ ...prev, textColor: val }));
                            persistDraft({ subtitleConfig: { ...subtitleConfig, textColor: val } });
                          }}
                          title="Choose custom text color"
                          style={{
                            width: '36px',
                            height: '36px',
                            padding: 0,
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                          }}
                        />
                      </div>
                    </div>

                    {/* Row 3, Col 1: Background Box */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Background Box
                      </label>
                      <select
                        value={subtitleConfig.boxEnabled ? 'box' : 'no_box'}
                        onChange={(e) => {
                          const isBox = e.target.value === 'box';
                          setSubtitleConfig((prev) => ({ ...prev, boxEnabled: isBox }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, boxEnabled: isBox } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="no_box">No Background Box</option>
                        <option value="box">Background Box (Glass / Bar)</option>
                      </select>
                    </div>

                    {/* Row 3, Col 2: Box Color */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', opacity: subtitleConfig.boxEnabled ? 1 : 0.45 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Box Color
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          disabled={!subtitleConfig.boxEnabled}
                          value={
                            ['#1A1917', '#000000', '#1E1B4B', '#18181B', '#7C2D12'].includes((subtitleConfig.boxColor || subtitleConfig.backgroundColor || '#1A1917').toUpperCase())
                              ? (subtitleConfig.boxColor || subtitleConfig.backgroundColor || '#1A1917').toUpperCase()
                              : 'custom'
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== 'custom') {
                              setSubtitleConfig((prev) => ({ ...prev, boxColor: val, backgroundColor: val }));
                              persistDraft({ subtitleConfig: { ...subtitleConfig, boxColor: val, backgroundColor: val } });
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                            cursor: subtitleConfig.boxEnabled ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <option value="#1A1917">Frosted Dark Glass</option>
                          <option value="#000000">Pure Black</option>
                          <option value="#1E1B4B">Midnight Navy</option>
                          <option value="#18181B">Zinc Charcoal</option>
                          <option value="#7C2D12">Warm Amber</option>
                          {!['#1A1917', '#000000', '#1E1B4B', '#18181B', '#7C2D12'].includes((subtitleConfig.boxColor || subtitleConfig.backgroundColor || '#1A1917').toUpperCase()) && (
                            <option value="custom">Custom ({(subtitleConfig.boxColor || subtitleConfig.backgroundColor || '#1A1917').toUpperCase()})</option>
                          )}
                        </select>
                        <input
                          type="color"
                          disabled={!subtitleConfig.boxEnabled}
                          value={subtitleConfig.boxColor || subtitleConfig.backgroundColor || '#1A1917'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubtitleConfig((prev) => ({ ...prev, boxColor: val, backgroundColor: val }));
                            persistDraft({ subtitleConfig: { ...subtitleConfig, boxColor: val, backgroundColor: val } });
                          }}
                          title="Choose custom box color"
                          style={{
                            width: '36px',
                            height: '36px',
                            padding: 0,
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'transparent',
                            cursor: subtitleConfig.boxEnabled ? 'pointer' : 'not-allowed',
                          }}
                        />
                      </div>
                    </div>

                    {/* Row 3, Col 3: Outline & Shadow */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Outline & Shadow
                      </label>
                      <select
                        value={
                          subtitleConfig.outlineWidth === 4
                            ? 'heavy'
                            : subtitleConfig.shadowDepth === 2
                            ? 'shadow'
                            : subtitleConfig.outlineWidth === 0 && subtitleConfig.shadowDepth === 0
                            ? 'none'
                            : 'medium'
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          let outlineWidth = 3;
                          let shadowDepth = 0;
                          if (val === 'heavy') {
                            outlineWidth = 4;
                            shadowDepth = 0;
                          } else if (val === 'shadow') {
                            outlineWidth = 3;
                            shadowDepth = 2;
                          } else if (val === 'none') {
                            outlineWidth = 0;
                            shadowDepth = 0;
                          }
                          setSubtitleConfig((prev) => ({ ...prev, outlineWidth, shadowDepth }));
                          persistDraft({ subtitleConfig: { ...subtitleConfig, outlineWidth, shadowDepth } });
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="medium">Medium Outline (3px)</option>
                        <option value="heavy">Heavy Outline (4px)</option>
                        <option value="shadow">Drop Shadow & Outline</option>
                        <option value="none">None (Clean Text)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Live Interactive Subtitle Preview Canvas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Live Subtitle Interactive Preview
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Preview canvas ({aspectRatio})
                    </span>
                  </div>

                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      maxWidth: aspectRatio === '9:16' ? '240px' : '480px',
                      height: aspectRatio === '9:16' ? '160px' : '100px',
                      margin: '0 auto',
                      borderRadius: 'var(--radius-md)',
                      background: 'radial-gradient(circle at center, #1e1b4b 0%, #09090b 100%)',
                      border: '1px solid var(--border-color)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '10px',
                        fontSize: '9.5px',
                        color: 'rgba(255,255,255,0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Preview Frame
                    </div>

                    {subtitlesEnabled ? (
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          ...(subtitleConfig.position === 'top'
                            ? { top: '14px' }
                            : subtitleConfig.position === 'center'
                            ? { top: '50%', transform: 'translate(-50%, -50%)' }
                            : { bottom: '14px' }),
                          fontFamily: subtitleConfig.fontFamily || 'Arial',
                          fontSize: `${Math.round((subtitleConfig.fontSize || 32) * 0.42)}px`,
                          color: subtitleConfig.textColor || '#FFFFFF',
                          backgroundColor: subtitleConfig.boxEnabled
                            ? subtitleConfig.boxColor || subtitleConfig.backgroundColor || 'rgba(0,0,0,0.7)'
                            : 'transparent',
                          padding: subtitleConfig.boxEnabled ? '5px 12px' : '0',
                          borderRadius: '4px',
                          textAlign: 'center',
                          maxWidth: '85%',
                          fontWeight: 700,
                          lineHeight: 1.3,
                          textShadow:
                            !subtitleConfig.boxEnabled && (subtitleConfig.outlineWidth || subtitleConfig.shadowDepth)
                              ? '0 2px 4px rgba(0,0,0,0.9), 0 0 2px #000'
                              : 'none',
                          boxShadow: subtitleConfig.boxEnabled ? '0 2px 8px rgba(0,0,0,0.4)' : 'none',
                          border: subtitleConfig.boxEnabled ? '1px solid rgba(255,255,255,0.1)' : 'none',
                        }}
                      >
                        {subtitleConfig.animation === 'karaoke' ? (
                          <>
                            Bioluminescent creatures{' '}
                            <span
                              style={{
                                color: (subtitleConfig.textColor || '#FFFFFF').toUpperCase() === '#FFE500' ? '#FFFFFF' : '#FFE500',
                                textDecoration: 'underline',
                              }}
                            >
                              illuminate
                            </span>{' '}
                            the abyss.
                          </>
                        ) : subtitleConfig.whatToShow === 'dialogue_only' ? (
                          '"The abyss is glowing with life."'
                        ) : (
                          'Bioluminescent creatures illuminate the oceanic abyss.'
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        (Subtitles Disabled)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: MOTION */}
            {step === 4 && (
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Camera Motion & Transitions
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Turn still AI artwork into cinematic clips using dynamic camera motion filters.
                  </p>
                </div>

                {/* Master Motion Switch */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    backgroundColor: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Move the camera over each image
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Smooth dynamic pan and zoom over still scenes. Turn OFF for static framing.
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="master-motion-toggle"
                    onClick={() => {
                      const next = !motionEnabled;
                      setMotionEnabled(next);
                      persistDraft({ motionEnabled: next });
                    }}
                    className={motionEnabled ? 'btn-primary' : 'btn-secondary'}
                    style={{
                      padding: '6px 20px',
                      fontSize: '12px',
                      fontWeight: 600,
                      minWidth: '70px',
                      backgroundColor: motionEnabled ? '#a855f7' : '#27272a',
                      borderColor: motionEnabled ? '#9333ea' : '#3f3f46',
                      color: '#ffffff',
                    }}
                  >
                    {motionEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Camera Motion & Transition Controls */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '18px',
                    opacity: motionEnabled ? 1 : 0.45,
                    pointerEvents: motionEnabled ? 'auto' : 'none',
                    transition: 'opacity 0.15s ease',
                  }}
                >
                  {/* Camera Motion Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Camera Motion
                    </label>
                    <select
                      value={motionStyle}
                      disabled={!motionEnabled}
                      onChange={(e) => {
                        const val = e.target.value as MotionStyle;
                        setMotionStyle(val);
                        persistDraft({ motionStyle: val });
                      }}
                      style={{
                        padding: '10px 14px',
                        fontSize: '13px',
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        outline: 'none',
                        cursor: motionEnabled ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <optgroup label="SMART">
                        <option value="auto">AUTO Rotation</option>
                        <option value="ai_director">AI Director</option>
                      </optgroup>
                      <optgroup label="PRO">
                        <option value="breathe">Breathe (Default)</option>
                        <option value="zoom_in">Slow Push In</option>
                        <option value="zoom_out">Slow Pull Out</option>
                        <option value="pan_left">Pan Left</option>
                        <option value="pan_right">Pan Right</option>
                        <option value="pan_up">Pan Up</option>
                        <option value="pan_down">Pan Down</option>
                        <option value="cinematic_dolly">Cinematic Dolly</option>
                        <option value="drift">Drift</option>
                        <option value="parallax">Parallax</option>
                      </optgroup>
                      <optgroup label="ULTRA">
                        <option value="crash_zoom">Crash Zoom</option>
                        <option value="bullet_time">Bullet Time</option>
                        <option value="ken_burns">Ken Burns</option>
                        <option value="whip_pan_left">Whip Pan Left</option>
                        <option value="whip_pan_right">Whip Pan Right</option>
                        <option value="snap_zoom">Snap Zoom</option>
                        <option value="dolly_zoom">Dolly Zoom</option>
                        <option value="shake">Camera Shake</option>
                        <option value="pulse">Pulse</option>
                      </optgroup>
                    </select>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {MOTION_DESCRIPTIONS[motionStyle] || 'Smooth dynamic camera motion'}
                    </div>
                  </div>

                  {/* Scene Transition Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Scene Transition
                    </label>
                    <select
                      value={transitionStyle}
                      disabled={!motionEnabled}
                      onChange={(e) => {
                        const val = e.target.value as TransitionStyle;
                        setTransitionStyle(val);
                        persistDraft({ transitionStyle: val });
                      }}
                      style={{
                        padding: '10px 14px',
                        fontSize: '13px',
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        outline: 'none',
                        cursor: motionEnabled ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <option value="hard_cut">Hard Cut (Recommended)</option>
                      <option value="cross_fade">Cross Fade</option>
                    </select>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {transitionStyle === 'cross_fade'
                        ? 'Smooth fade between scenes'
                        : 'Clean cut from one scene to the next'}
                    </div>

                    {/* Crossfade Duration Slider (shown only when cross_fade selected) */}
                    {transitionStyle === 'cross_fade' && (
                      <div
                        style={{
                          marginTop: '8px',
                          padding: '12px 16px',
                          backgroundColor: 'var(--bg-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Crossfade Duration
                          </label>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#a855f7' }}>
                            {crossfadeDuration.toFixed(2)}s
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="2.0"
                          step="0.05"
                          value={crossfadeDuration}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCrossfadeDuration(val);
                            persistDraft({ crossfadeDuration: val });
                          }}
                          style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: VOICE */}
            {step === 5 && (() => {
              const activeEngines = ttsEngines.length > 0 ? ttsEngines : DEFAULT_ENGINES;
              const currentEngine = activeEngines.find((e) => e.id === selectedEngineTab) || activeEngines[0];
              const providerVoices = allVoices.filter((v) => v.provider === selectedEngineTab);
              const displayVoices = providerVoices.length > 0 ? providerVoices : (DEFAULT_PROVIDER_VOICES[selectedEngineTab] || []);

              // Filter voices by search query and gender
              const filteredVoices = displayVoices.filter((v) => {
                const q = voiceSearchQuery.trim().toLowerCase();
                const matchesSearch = !q ||
                  v.name.toLowerCase().includes(q) ||
                  (v.locale && v.locale.toLowerCase().includes(q)) ||
                  v.id.toLowerCase().includes(q);
                const matchesGender = voiceGenderFilter === 'all' ||
                  (v.gender && v.gender.toLowerCase() === voiceGenderFilter);
                return matchesSearch && matchesGender;
              });

              // Active selected voice object
              const selectedVoice = displayVoices.find((v) => v.id === voiceId) ||
                allVoices.find((v) => v.id === voiceId) ||
                DEFAULT_PROVIDER_VOICES[selectedEngineTab]?.find((v) => v.id === voiceId);

              const isSelectedVoicePlaying = previewingVoiceId === voiceId;
              const engineDisplayName = ENGINE_DISPLAY_NAMES[selectedEngineTab] || currentEngine.name;

              return (
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                  }}
                >
                  {/* Header */}
                  <div>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      Voice & TTS Narration Foundation
                    </h2>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                      Select your speech engine, choose a narrator persona, and configure background soundtrack audio.
                    </p>
                  </div>

                  {/* 1. VOICE ENGINE TABS */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                      Voice Engine
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {activeEngines.map((engine) => {
                        const isSelected = selectedEngineTab === engine.id;
                        const displayName = ENGINE_DISPLAY_NAMES[engine.id] || engine.name;
                        const badgeColor =
                          engine.badge === 'FREE' ? '#10b981' : engine.badge === 'LOCAL' ? '#3b82f6' : '#a855f7';
                        const badgeBg =
                          engine.badge === 'FREE'
                            ? 'rgba(16, 185, 129, 0.12)'
                            : engine.badge === 'LOCAL'
                            ? 'rgba(59, 130, 246, 0.12)'
                            : 'rgba(168, 85, 247, 0.12)';

                        return (
                          <button
                            key={engine.id}
                            type="button"
                            onClick={() => {
                              setSelectedEngineTab(engine.id);
                              setVoiceEngine(engine.id);
                              persistDraft({ voiceEngine: engine.id });

                              const voicesForEng = allVoices.filter((v) => v.provider === engine.id);
                              const firstVoice = voicesForEng[0]?.id || DEFAULT_PROVIDER_VOICES[engine.id]?.[0]?.id;
                              if (firstVoice) {
                                setVoiceId(firstVoice);
                                persistDraft({ voiceId: firstVoice, voiceEngine: engine.id });
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '8px 14px',
                              borderRadius: 'var(--radius-sm)',
                              border: isSelected ? '2px solid #a855f7' : '1px solid var(--border-color)',
                              backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                              color: isSelected ? '#c084fc' : 'var(--text-primary)',
                              cursor: 'pointer',
                              fontSize: '12.5px',
                              fontWeight: isSelected ? 700 : 500,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: engine.isAvailable ? '#10b981' : '#f59e0b',
                                flexShrink: 0,
                              }}
                            />
                            <span>{displayName}</span>
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                backgroundColor: badgeBg,
                                color: badgeColor,
                              }}
                            >
                              {engine.badge}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Engine Status Line */}
                    {!currentEngine.isAvailable ? (
                      <div
                        style={{
                          padding: '9px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          fontSize: '11.5px',
                          color: '#f59e0b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <AlertCircleIcon size={14} />
                        <span>
                          <strong>{engineDisplayName} requires configuration:</strong>{' '}
                          {currentEngine.unavailableReason || 'Requires API key or local model setup in Settings.'}
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'rgba(16, 185, 129, 0.06)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          fontSize: '11.5px',
                          color: '#10b981',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <CheckIcon size={13} />
                        <span>
                          <strong>{engineDisplayName} is ready:</strong>{' '}
                          {currentEngine.supportsWordTimings
                            ? 'High quality neural speech with exact word-level synchronization.'
                            : 'High fidelity audio narration synchronized to scene durations.'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 2. NARRATOR VOICE (Dedicated Active Summary Card) */}
                  <div
                    style={{
                      padding: '16px 18px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(168, 85, 247, 0.06)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#c084fc', letterSpacing: '0.05em' }}>
                        Active Narrator Voice
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {selectedVoice?.name || voiceId}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {engineDisplayName} · {selectedVoice?.locale || 'en-US'}{selectedVoice?.gender ? ` · ${selectedVoice.gender.charAt(0).toUpperCase() + selectedVoice.gender.slice(1)}` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handlePreviewVoice(selectedEngineTab, voiceId, e)}
                      className={isSelectedVoicePlaying ? 'btn-primary' : 'btn-secondary'}
                      style={{
                        padding: '8px 16px',
                        fontSize: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexShrink: 0,
                      }}
                    >
                      {isSelectedVoicePlaying ? '⏹ Stop Preview' : '▶ Preview Voice'}
                    </button>
                  </div>

                  {/* 3. VOICE SELECTION / PREVIEW */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                        Available Voices ({filteredVoices.length})
                      </div>

                      {/* Search & Gender Filters */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={voiceSearchQuery}
                          onChange={(e) => setVoiceSearchQuery(e.target.value)}
                          placeholder="Filter voices..."
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '4px 10px',
                            fontSize: '11.5px',
                            color: 'var(--text-primary)',
                            width: '150px',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', padding: '2px', border: '1px solid var(--border-color)' }}>
                          {(['all', 'male', 'female'] as const).map((g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setVoiceGenderFilter(g)}
                              style={{
                                border: 'none',
                                backgroundColor: voiceGenderFilter === g ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                                color: voiceGenderFilter === g ? '#c084fc' : 'var(--text-secondary)',
                                borderRadius: 'var(--radius-xs)',
                                padding: '2px 8px',
                                fontSize: '11px',
                                cursor: 'pointer',
                                fontWeight: voiceGenderFilter === g ? 600 : 400,
                              }}
                            >
                              {g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Bounded Scrollable Voice Grid */}
                    <div
                      style={{
                        maxHeight: '260px',
                        overflowY: 'auto',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '10px',
                        paddingRight: '4px',
                      }}
                    >
                      {filteredVoices.map((v) => {
                        const isSel = voiceId === v.id;
                        const isPlaying = previewingVoiceId === v.id;

                        return (
                          <div
                            key={v.id}
                            onClick={() => {
                              setErrorMsg(null);
                              setVoiceId(v.id);
                              setVoiceEngine(selectedEngineTab);
                              persistDraft({ voiceId: v.id, voiceEngine: selectedEngineTab });
                            }}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 'var(--radius-md)',
                              border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                              backgroundColor: isSel ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12.5px', fontWeight: 700, color: isSel ? '#c084fc' : 'var(--text-primary)' }}>
                                {v.name}
                              </span>
                              {isSel && <CheckIcon size={14} color="#a855f7" />}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {v.locale || 'en-US'} {v.gender ? `• ${v.gender.charAt(0).toUpperCase() + v.gender.slice(1)}` : ''}
                              </span>
                              {v.tier === 'premium' && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                                    color: '#a855f7',
                                    fontWeight: 600,
                                  }}
                                >
                                  Premium
                                </span>
                              )}
                            </div>

                            <div style={{ marginTop: '4px' }}>
                              <button
                                type="button"
                                onClick={(e) => handlePreviewVoice(selectedEngineTab, v.id, e)}
                                className="btn-secondary"
                                style={{ padding: '3px 9px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                {isPlaying ? '⏹ Stop' : '▶ Preview'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 4. BACKGROUND MUSIC */}
                  <div
                    style={{
                      padding: '16px 18px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-subtle)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Background Music
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Layer a soundtrack beneath spoken narration with automatic ducking during voiceover.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !musicEnabled;
                          setMusicEnabled(next);
                          persistDraft({ musicEnabled: next });
                        }}
                        className={musicEnabled ? 'btn-primary' : 'btn-secondary'}
                        style={{ padding: '6px 16px', fontSize: '12px' }}
                      >
                        {musicEnabled ? 'Music ON' : 'Music OFF'}
                      </button>
                    </div>

                    {musicEnabled ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '6px' }}>
                        {/* Audio File Selection */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                            <button
                              type="button"
                              onClick={handleSelectMusicFile}
                              className="btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '11.5px', flexShrink: 0 }}
                            >
                              Select Music Track...
                            </button>
                            <span style={{ fontSize: '12px', color: musicPath ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {musicPath ? `🎵 ${musicPath.split(/[/\\]/).pop()}` : 'No music track selected'}
                            </span>
                          </div>
                          {musicPath && (
                            <button
                              type="button"
                              onClick={() => {
                                setMusicPath('');
                                persistDraft({ musicPath: '' });
                              }}
                              style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
                            >
                              Remove Track
                            </button>
                          )}
                        </div>

                        {/* Volume and Ducking Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                              Volume: {Math.round(musicVolume * 100)}%
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={musicVolume}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setMusicVolume(val);
                                persistDraft({ musicVolume: val });
                              }}
                              style={{ flex: 1 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                              Auto Ducking:
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = !duckingEnabled;
                                setDuckingEnabled(next);
                                persistDraft({ duckingEnabled: next });
                              }}
                              className={duckingEnabled ? 'btn-primary' : 'btn-secondary'}
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >
                              {duckingEnabled ? 'Ducking ON' : 'Ducking OFF'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No background music · Spoken narration only
                      </div>
                    )}
                  </div>

                  {/* 5. PRE-RENDER CONFIGURATION OVERVIEW */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                      Pre-Render Configuration
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10.5px' }}>Format & Resolution</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {aspectRatio === '9:16' ? '9:16 Vertical' : '16:9 Landscape'} · {outputResolution === '4k' ? '4K Ultra HD' : outputResolution === '1080p' ? '1080p Full HD' : 'Original'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10.5px' }}>Narrator Voice</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {engineDisplayName} · {selectedVoice?.name || voiceId}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10.5px' }}>Background Music</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {musicEnabled && musicPath ? `${musicPath.split(/[/\\]/).pop()} (${Math.round(musicVolume * 100)}%)` : musicEnabled ? 'Music ON (No track)' : 'Disabled'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10.5px' }}>Subtitles</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {subtitlesEnabled ? `${subtitleStyle} (${subtitleConfig.fontSize || 32}px)` : 'Disabled'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10.5px' }}>Camera Motion</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {motionEnabled ? `${MOTION_NAMES[motionStyle] || motionStyle} (${transitionStyle === 'cross_fade' ? 'Crossfade' : 'Hard Cut'})` : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* STEP 6: REVIEW & LAUNCH (Infinity Flow Summary Layer) */}
            {step === 6 && (
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Review Project & Production Pipeline
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Confirm your faceless video production settings before launching autonomous asset generation and rendering.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                  {/* Card 1: Project Story */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Project & Script</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{title || 'Untitled Project'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {scenes.length} Scenes · ~{validation.estimatedDurationSeconds}s voiceover · {validation.totalWords} words
                    </span>
                  </div>

                  {/* Card 2: Video Format & Resolution */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Format & Resolution</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {aspectRatio === '9:16' ? '9:16 Vertical (Shorts/Reels)' : '16:9 Landscape (Widescreen)'}
                    </span>
                    <span style={{ fontSize: '12px', color: '#c084fc', fontWeight: 600 }}>
                      Output Resolution: {outputResolution === '4k' ? '4K Ultra HD' : outputResolution === '1080p' ? '1080p Full HD' : 'Source / Original'}
                    </span>
                  </div>

                  {/* Card 3: Subtitles */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Subtitles</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {subtitlesEnabled ? `Enabled · ${subtitleStyle} (${subtitleConfig.fontFamily || 'Arial'})` : 'Disabled'}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      Position: {subtitleConfig.position || 'bottom'} · Size: {subtitleConfig.fontSize || 32}px {subtitleConfig.boxEnabled ? '· Box' : '· Outline'}{subtitleConfig.animation ? ` · ${subtitleConfig.animation}` : ''}
                    </span>
                  </div>

                  {/* Card 4: Camera Motion */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Motion & Transitions</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {motionEnabled ? `Motion ON · ${MOTION_NAMES[motionStyle] || motionStyle}` : 'Motion OFF (Static Frames)'}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      Transition: {transitionStyle === 'cross_fade' ? `Cross Fade (${crossfadeDuration}s)` : 'Hard Cut'}
                    </span>
                  </div>

                  {/* Card 5: Voice & Engine */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Voice & TTS Narrator</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Engine: {voiceEngine}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      Voice ID: {voiceId}
                    </span>
                  </div>

                  {/* Card 6: Background Music */}
                  <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Background Music</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {musicEnabled && musicPath ? `Active (${Math.round(musicVolume * 100)}% vol)` : 'No Background Music'}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {musicEnabled && musicPath ? `${musicPath.split(/[/\\]/).pop()} ${duckingEnabled ? '· Ducking ON' : ''}` : 'Voiceover only'}
                    </span>
                  </div>
                </div>

                {/* Real Readiness Validation Banner */}
                {readiness.allReady ? (
                  <div
                    style={{
                      padding: '16px 20px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 700, fontSize: '13.5px' }}>
                      <CheckIcon size={16} />
                      <span>Ready to Create — All Configuration Parameters Validated</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {readiness.items.map((item) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <CheckIcon size={13} color="#10b981" />
                          <span><strong style={{ color: 'var(--text-primary)' }}>{item.label}:</strong> {item.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '16px 20px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 700, fontSize: '13.5px' }}>
                      <AlertCircleIcon size={16} />
                      <span>Not Ready — Configuration Incomplete</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      <span>The following required items must be resolved before creating your project:</span>
                      {readiness.blockingIssues.map((issue) => (
                        <div key={issue.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171' }}>
                          <CloseIcon size={13} />
                          <span><strong>{issue.label}:</strong> {issue.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stepper Navigation Actions */}
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                backgroundColor: 'rgba(15, 17, 23, 0.95)',
                backdropFilter: 'blur(12px)',
                borderTop: '1px solid var(--border-color)',
                padding: '14px 20px',
                borderRadius: 'var(--radius-lg)',
                marginTop: '16px',
                marginBottom: '8px',
                zIndex: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.45)',
              }}
            >
              <div>
                {step > 1 && (
                  <button type="button" onClick={handlePrevStep} className="btn-secondary" style={{ padding: '8px 18px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ChevronLeftIcon size={14} /> Back
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {step === 5 && (
                  <button
                    type="button"
                    disabled={isSubmitting || !readiness.allReady}
                    onClick={handleCreateFullVideoProject}
                    className="btn-secondary"
                    style={{
                      padding: '8px 16px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      opacity: (!readiness.allReady || isSubmitting) ? 0.5 : 1,
                      cursor: (!readiness.allReady || isSubmitting) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <SparklesIcon size={13} />
                    {isSubmitting ? 'Creating Project...' : 'Create Video Project'}
                  </button>
                )}

                {step < 6 ? (
                  <button type="button" onClick={handleNextStep} className="btn-primary" style={{ padding: '8px 22px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {step === 5 ? 'Next: Review & Launch' : 'Next Step'} <ArrowRightIcon size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting || !readiness.allReady}
                    onClick={handleCreateFullVideoProject}
                    className="btn-primary"
                    style={{
                      padding: '10px 24px',
                      fontSize: '13px',
                      fontWeight: 700,
                      backgroundColor: readiness.allReady ? '#a855f7' : '#4b5563',
                      borderColor: readiness.allReady ? '#a855f7' : '#4b5563',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: (!readiness.allReady || isSubmitting) ? 0.5 : 1,
                      cursor: (!readiness.allReady || isSubmitting) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <SparklesIcon size={15} />
                    {isSubmitting ? 'Creating Project...' : 'Create Video Project'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODE: IMAGES ONLY (Immediately Functional)                   */}
        {/* ============================================================ */}
        {activeMode === 'images_only' && (
          <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Hidden file input for prompts */}
            <input
              type="file"
              ref={imagesFileInputRef}
              accept=".txt,.md,.json"
              style={{ display: 'none' }}
              onChange={handleImagesFileChange}
            />

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Images Only Workflow
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Generate standalone scene artwork without video clips or voiceover using parallel multi-profile generation.
                </p>
              </div>

              {/* Project Title */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Project Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Cyberpunk Concept Art Batch"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                  }}
                />
              </div>

              {/* Prompt Input Sourcing Tabs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Image Prompts
                  </label>
                  {(() => {
                    const promptCount = imagesOnlyPrompts
                      .split(/\r?\n/)
                      .map((p) => p.trim())
                      .filter((p) => p.length > 0).length;
                    return (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: promptCount > 0 ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-subtle)',
                          color: promptCount > 0 ? '#c084fc' : 'var(--text-muted)',
                        }}
                      >
                        {promptCount} {promptCount === 1 ? 'Prompt Loaded' : 'Prompts Loaded'}
                      </span>
                    );
                  })()}
                </div>

                <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)', width: 'fit-content', border: '1px solid var(--border-color)' }}>
                  <button
                    type="button"
                    onClick={() => setImagesInputMode('paste')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      backgroundColor: imagesInputMode === 'paste' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                      color: imagesInputMode === 'paste' ? '#c084fc' : 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: imagesInputMode === 'paste' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    Paste Prompts
                  </button>
                  <button
                    type="button"
                    onClick={() => setImagesInputMode('file')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      backgroundColor: imagesInputMode === 'file' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                      color: imagesInputMode === 'file' ? '#c084fc' : 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: imagesInputMode === 'file' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    Import from File
                  </button>
                </div>

                {imagesInputMode === 'paste' ? (
                  <textarea
                    rows={8}
                    value={imagesOnlyPrompts}
                    onChange={(e) => setImagesOnlyPrompts(e.target.value)}
                    placeholder="Enter one prompt per line, or asset-block format:&#10;Cinematic view of futuristic Tokyo street with neon signs&#10;Portrait of astronaut in reflective gold helmet overlooking red Mars dunes&#10;Macro photography of crystal dandelion floating in sunlight"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      lineHeight: 1.5,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      padding: '20px',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      textAlign: 'center',
                    }}
                  >
                    {imagesFile ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          📄 {imagesFile.fileName}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {imagesFile.content.length} characters loaded
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                          <button
                            type="button"
                            onClick={handleSelectImagesFile}
                            className="btn-secondary"
                            style={{ padding: '4px 12px', fontSize: '11.5px' }}
                          >
                            Replace File
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setImagesOnlyPrompts(imagesFile.content);
                            }}
                            className="btn-secondary"
                            style={{ padding: '4px 12px', fontSize: '11.5px' }}
                          >
                            Reload Prompts
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Import a .txt, .md, or .json file containing image prompts
                        </div>
                        <button
                          type="button"
                          onClick={handleSelectImagesFile}
                          className="btn-primary"
                          style={{ padding: '6px 16px', fontSize: '12px' }}
                        >
                          Choose Prompts File...
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Aspect Ratio Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Aspect Ratio</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {[
                    { id: '16:9', label: '16:9 Landscape', desc: 'YouTube, Desktop & Standard Displays' },
                    { id: '9:16', label: '9:16 Portrait', desc: 'YouTube Shorts, TikTok & Mobile Reels' },
                  ].map((r) => {
                    const isSel = aspectRatio === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setAspectRatio(r.id as SupportedAspectRatio)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                          backgroundColor: isSel ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 700, color: isSel ? '#c084fc' : 'var(--text-primary)' }}>
                          {r.label}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{r.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Export Destination Folder */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Save to Folder</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {imagesSaveDirectory ? imagesSaveDirectory : 'Default: Project Folder (userData/projects)'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSelectImagesSaveDirectory}
                  className="btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  Choose Folder...
                </button>
              </div>

              {/* Action */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                  type="button"
                  disabled={isSubmitting || !imagesOnlyPrompts.trim()}
                  onClick={handleCreateImagesOnlyProject}
                  className="btn-primary"
                  style={{ padding: '10px 22px', fontSize: '13px' }}
                >
                  {isSubmitting ? 'Creating Batch...' : 'Create Batch Image Project'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODE: FROM SKILL (Autonomous Script AI Workflow)             */}
        {/* ============================================================ */}
        {activeMode === 'from_skill' && (
          <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Hidden file input for skill uploads */}
            <input
              type="file"
              ref={skillFileInputRef}
              accept=".md,.txt,.pdf,.skill,.zip"
              style={{ display: 'none' }}
              onChange={handleUploadSkillFile}
            />

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    From Skill Workflow
                  </h2>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Combine a Channel Rulebook with a specialized Skill to autonomously create structured scenes with synchronized visual prompts and narration.
                </p>
              </div>

              {/* Channel Assignment */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Channel Assignment
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Auto-binds channel output folder & export settings
                  </span>
                </div>
                <select
                  value={channelId || ''}
                  onChange={(e) => {
                    const id = e.target.value || undefined;
                    const ch = availableChannels.find((c) => c.id === id);
                    setChannelId(id);
                    setChannelName(ch?.name);
                    if ((ch as any)?.skillId) {
                      setSelectedSkillId((ch as any).skillId);
                    }
                    persistDraft({ channelId: id, channelName: ch?.name });
                  }}
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">(None - Unassigned Channel)</option>
                  {availableChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} {ch.rulebook?.tone ? `(${ch.rulebook.tone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Skill Sourcing Tabs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Skill Rulebook <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    {skillSourceTab === 'select' ? 'Saved Channel Skill' : skillSourceTab === 'paste' ? 'Custom Pasted Directives' : 'Imported File'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)', width: 'fit-content', border: '1px solid var(--border-color)' }}>
                  {[
                    { id: 'select', label: 'Select Existing' },
                    { id: 'paste', label: 'Paste Skill' },
                    { id: 'upload', label: 'Upload Skill' },
                  ].map((tab) => {
                    const isSel = skillSourceTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSkillSourceTab(tab.id as any)}
                        style={{
                          padding: '5px 14px',
                          borderRadius: 'var(--radius-xs)',
                          border: 'none',
                          backgroundColor: isSel ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                          color: isSel ? '#10b981' : 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: isSel ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {skillSourceTab === 'select' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <select
                      value={selectedSkillId || ''}
                      onChange={(e) => {
                        const id = e.target.value || undefined;
                        setSelectedSkillId(id);
                        persistDraft({ skillId: id });
                      }}
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '13px',
                      }}
                    >
                      <option value="">No Skill (Generic Generation)</option>
                      {availableSkills.map((sk) => (
                        <option key={sk.id} value={sk.id}>
                          {sk.name}
                        </option>
                      ))}
                    </select>

                    {/* Selected Skill Preview Card */}
                    {selectedSkillId && (() => {
                      const currentSkill = availableSkills.find((s) => s.id === selectedSkillId);
                      if (!currentSkill) return null;
                      return (
                        <div
                          style={{
                            padding: '12px 16px',
                            backgroundColor: 'rgba(16, 185, 129, 0.06)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#10b981' }}>
                            {currentSkill.name} Directives
                          </div>
                          {currentSkill.description && (
                            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                              {currentSkill.description}
                            </div>
                          )}
                          {currentSkill.promptGuidance && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              <strong style={{ color: 'var(--text-secondary)' }}>Visual Style:</strong> {currentSkill.promptGuidance}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {skillSourceTab === 'paste' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <textarea
                      rows={5}
                      value={pastedSkillContent}
                      onChange={(e) => setPastedSkillContent(e.target.value)}
                      placeholder="Paste your channel skill markdown rulebook directly here (e.g. tone, narrative arcs, visual style, pacing directives)..."
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        lineHeight: 1.45,
                      }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Pasted skill directives will be dynamically combined with your prompt.
                    </span>
                  </div>
                )}

                {skillSourceTab === 'upload' && (
                  <div
                    style={{
                      padding: '20px',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      textAlign: 'center',
                    }}
                  >
                    {uploadedSkillFileName ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981' }}>
                          ✓ Imported: {uploadedSkillFileName}
                        </div>
                        <button
                          type="button"
                          onClick={() => skillFileInputRef.current?.click()}
                          className="btn-secondary"
                          style={{ padding: '4px 12px', fontSize: '11.5px' }}
                        >
                          Upload Different Skill
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Upload a skill rulebook (.md, .txt, .pdf, .skill, or .zip archive)
                        </div>
                        <button
                          type="button"
                          onClick={() => skillFileInputRef.current?.click()}
                          className="btn-primary"
                          style={{ padding: '6px 16px', fontSize: '12px', backgroundColor: '#10b981', borderColor: '#10b981' }}
                        >
                          Choose Skill File...
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Topic / Idea Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Video Topic / Premise <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={skillTitle}
                  onChange={(e) => {
                    setSkillTitle(e.target.value);
                    setTitle(e.target.value);
                  }}
                  placeholder="e.g. 5 Cosmic Mysteries That Baffle Modern Physicists"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13.5px',
                  }}
                />
              </div>

              {/* Scene Count & Duration */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Target Scene Count
                  </label>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {[3, 4, 5, 6, 8, 10].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setAiSceneCount(count)}
                        className={aiSceneCount === count ? 'btn-primary' : 'btn-secondary'}
                        style={{
                          padding: '5px 8px',
                          fontSize: '11px',
                          backgroundColor: aiSceneCount === count ? '#10b981' : undefined,
                          borderColor: aiSceneCount === count ? '#10b981' : undefined,
                        }}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Target Duration
                  </label>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {[30, 45, 60, 90].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setAiDurationSeconds(sec)}
                        className={aiDurationSeconds === sec ? 'btn-primary' : 'btn-secondary'}
                        style={{
                          padding: '5px 8px',
                          fontSize: '11px',
                          backgroundColor: aiDurationSeconds === sec ? '#10b981' : undefined,
                          borderColor: aiDurationSeconds === sec ? '#10b981' : undefined,
                        }}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Desired Tone
                  </label>
                  <input
                    type="text"
                    value={aiTone}
                    onChange={(e) => setAiTone(e.target.value)}
                    placeholder="e.g. Cinematic, Mind-bending"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                    }}
                  />
                </div>
              </div>

              {/* User Instructions (Tier 1 Priority) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Custom User Instructions (Tier 1 - Highest Priority)
                  </label>
                  <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    Overrides all skill & channel defaults
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={skillText}
                  onChange={(e) => setSkillText(e.target.value)}
                  placeholder="Enter any specific constraints, required focus points, opening hooks, or visual directions..."
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12.5px',
                    lineHeight: 1.45,
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Progress Box during Generation */}
              {isGeneratingAi && aiProgress && (
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <SparklesIcon size={14} />
                      STAGE: {aiProgress.stage.toUpperCase()} (Round {aiProgress.round})
                    </span>
                    {aiProgress.charsReceived ? (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {aiProgress.charsReceived} characters received
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    {aiProgress.message}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '8px' }}>
                <button
                  type="button"
                  disabled={isGeneratingAi || !skillTitle.trim()}
                  onClick={handleGenerateScriptAi}
                  className="btn-primary"
                  style={{
                    padding: '10px 24px',
                    fontSize: '13px',
                    fontWeight: 700,
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <SparklesIcon size={16} />
                  {isGeneratingAi ? 'Generating Script with AI...' : 'Generate Script & Review Scenes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODE: AUDIO ONLY (Complete Standalone Workflow)               */}
        {/* ============================================================ */}
        {/* ============================================================ */}
        {/* MODE: AUDIO ONLY (Complete Standalone Workflow)               */}
        {/* ============================================================ */}
        {activeMode === 'audio_only' && (
          <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Hidden file input for audio imports */}
            <input
              type="file"
              ref={audioFileInputRef}
              accept=".txt,.md"
              style={{ display: 'none' }}
              onChange={handleAudioFileChange}
            />

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Audio Only Workflow (Standalone Narration Studio)
                  </h2>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Synthesize multi-scene or standalone voiceovers with broadcast quality, concatenate into master audio, and export.
                </p>
              </div>

              {/* Input Mode Tabs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border-color)', width: '100%' }}>
                  {[
                    { id: 'paste', label: 'Paste Narration' },
                    { id: 'file', label: 'Load from File' },
                  ].map((tab) => {
                    const isSel = audioInputMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setAudioInputMode(tab.id as 'paste' | 'file')}
                        style={{
                          padding: '8px 16px',
                          border: 'none',
                          borderBottom: isSel ? '2px solid #a855f7' : '2px solid transparent',
                          backgroundColor: 'transparent',
                          color: isSel ? '#c084fc' : 'var(--text-secondary)',
                          fontSize: '12.5px',
                          fontWeight: isSel ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {audioInputMode === 'paste' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Narration Script (Marked Markdown or Plain Text)
                      </label>
                      <button
                        type="button"
                        onClick={() => setAudioNarration(SAMPLE_AUDIO_SCRIPT)}
                        className="btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <CopyIcon size={12} /> Load Sample Script
                      </button>
                    </div>
                    <textarea
                      rows={8}
                      value={audioNarration}
                      onChange={(e) => setAudioNarration(e.target.value)}
                      placeholder="Enter script with '# SCENE 1', '# SCENE 2' or plain paragraphs..."
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12.5px',
                        lineHeight: 1.5,
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span>
                        {audioNarration.length} characters • ~{audioNarration.trim().split(/\s+/).filter(Boolean).length} words
                      </span>
                      <span>
                        Estimated duration: ~{Math.round(audioNarration.trim().split(/\s+/).filter(Boolean).length / 2.5)}s
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '24px',
                      border: '1px dashed var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      textAlign: 'center',
                    }}
                  >
                    {audioFile ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#a855f7' }}>
                          ✓ Loaded: {audioFile.fileName}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {audioNarration.length} characters • ~{audioNarration.trim().split(/\s+/).filter(Boolean).length} words • Estimated: ~{Math.round(audioNarration.trim().split(/\s+/).filter(Boolean).length / 2.5)}s
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <button
                            type="button"
                            onClick={handleSelectAudioFile}
                            className="btn-secondary"
                            style={{ padding: '5px 12px', fontSize: '11.5px' }}
                          >
                            Replace File
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Load a narration script file (.txt or .md)
                        </div>
                        <button
                          type="button"
                          onClick={handleSelectAudioFile}
                          className="btn-primary"
                          style={{ padding: '6px 16px', fontSize: '12px', backgroundColor: '#a855f7', borderColor: '#a855f7' }}
                        >
                          Choose Narration File...
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Split at blank lines toggle (ZBot spec §8.2) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Split at blank lines
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    {splitAtBlankLines
                      ? 'Blank lines split text into separate scene audio takes, concatenated into master audio.'
                      : 'Synthesize entire text as a single continuous master audio take.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSplitAtBlankLines(!splitAtBlankLines)}
                  className={splitAtBlankLines ? 'btn-primary' : 'btn-secondary'}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: splitAtBlankLines ? '#a855f7' : undefined,
                    borderColor: splitAtBlankLines ? '#a855f7' : undefined,
                  }}
                >
                  {splitAtBlankLines ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Voice Engine & Persona Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Narrator Engine & Voice Persona
                </label>

                {/* Engine Selector */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {(ttsEngines.length > 0 ? ttsEngines : DEFAULT_ENGINES).map((eng) => {
                    const isSelected = selectedEngineTab === eng.id;
                    const badgeColor = eng.badge === 'FREE' ? '#10b981' : eng.badge === 'LOCAL' ? '#3b82f6' : '#a855f7';
                    const badgeBg = eng.badge === 'FREE' ? 'rgba(16, 185, 129, 0.12)' : eng.badge === 'LOCAL' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)';

                    return (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => {
                          setSelectedEngineTab(eng.id);
                          setVoiceEngine(eng.id);
                          const firstV = (allVoices.find((v) => v.provider === eng.id) || DEFAULT_PROVIDER_VOICES[eng.id]?.[0])?.id;
                          if (firstV) setVoiceId(firstV);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: isSelected ? '2px solid #a855f7' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                          color: isSelected ? '#c084fc' : 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: isSelected ? 700 : 500,
                        }}
                      >
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: eng.isAvailable ? '#10b981' : '#f59e0b' }} />
                        <span>{eng.name}</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', backgroundColor: badgeBg, color: badgeColor }}>{eng.badge}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Voice Picker Dropdown & Preview */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <select
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    style={{
                      flex: 1,
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                    }}
                  >
                    {((allVoices.filter((v) => v.provider === selectedEngineTab).length > 0
                      ? allVoices.filter((v) => v.provider === selectedEngineTab)
                      : DEFAULT_PROVIDER_VOICES[selectedEngineTab] || []
                    ).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.locale || 'en-US'})
                      </option>
                    )))}
                  </select>

                  <button
                    type="button"
                    onClick={(e) => handlePreviewVoice(selectedEngineTab, voiceId, e)}
                    className="btn-secondary"
                    style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                  >
                    {previewingVoiceId === voiceId ? '⏹ Stop' : '▶ Preview Voice'}
                  </button>
                </div>
              </div>

              {/* Export Destination Folder */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Save to Folder</div>
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--text-secondary)',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {audioSaveDirectory ? audioSaveDirectory : 'Default: Project Folder (userData/projects)'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSelectAudioSaveDirectory}
                  className="btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  Choose Folder...
                </button>
              </div>

              {/* Synthesize Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                <button
                  type="button"
                  disabled={isSynthesizingAudioOnly || !audioNarration.trim()}
                  onClick={handleSynthesizeAudioOnly}
                  className="btn-primary"
                  style={{
                    padding: '10px 24px',
                    fontSize: '13px',
                    fontWeight: 700,
                    backgroundColor: '#a855f7',
                    borderColor: '#a855f7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <SparklesIcon size={16} />
                  {isSynthesizingAudioOnly ? 'Synthesizing & Combining Audio...' : 'Synthesize Standalone Audio'}
                </button>
              </div>

              {/* Audio Manifest & Player Output */}
              {audioOnlyManifest && createdAudioProjectId && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '18px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(168, 85, 247, 0.06)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                          Master Audio Track Ready
                        </h3>
                        <span
                          style={{
                            fontSize: '10.5px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            fontWeight: 700,
                          }}
                        >
                          {audioOnlyManifest.totalDurationSeconds.toFixed(2)}s
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                        Engine: <strong>{audioOnlyManifest.actualProvider || audioOnlyManifest.provider}</strong>
                      </p>
                    </div>

                    {audioOnlyManifest.masterAudioPath && window.flowApi?.revealAsset && (
                      <button
                        type="button"
                        onClick={() => window.flowApi?.revealAsset?.(audioOnlyManifest.masterAudioPath!)}
                        className="btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        📁 Reveal in Explorer
                      </button>
                    )}
                  </div>

                  {/* HTML5 Master Audio Player */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      MASTER AUDIO (final_audio.mp3)
                    </label>
                    <audio
                      controls
                      src={`flow-asset://${createdAudioProjectId}/audio/final_audio.mp3`}
                      style={{ width: '100%', height: '40px' }}
                    />
                  </div>

                  {/* Scene by Scene Breakdown */}
                  {audioOnlyManifest.scenes.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Scene Narration Breakdown ({audioOnlyManifest.scenes.length} Scenes)
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {audioOnlyManifest.scenes.map((sc) => (
                          <div
                            key={sc.sceneNumber}
                            style={{
                              padding: '10px 14px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'var(--bg-subtle)',
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', fontWeight: 700, color: '#a855f7' }}>
                                  Scene #{sc.sceneNumber}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  {sc.durationSeconds.toFixed(2)}s
                                </span>
                              </div>
                              <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sc.audioFile}
                              </p>
                            </div>

                            <audio
                              controls
                              src={`flow-asset://${createdAudioProjectId}/${sc.audioFile}`}
                              style={{ height: '32px', maxWidth: '240px' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
