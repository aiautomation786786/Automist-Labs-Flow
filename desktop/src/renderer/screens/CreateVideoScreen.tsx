import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  VideoFactoryMode,
  VideoFactoryDraft,
  VideoFactoryConfig,
  SceneEntity,
  SupportedAspectRatio,
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
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [subtitleStyle, setSubtitleStyle] = useState<string>('bottom_glass');
  const [motionEnabled, setMotionEnabled] = useState<boolean>(true);
  const [motionStyle, setMotionStyle] = useState<MotionStyle>('breathe');
  const [motionTierFilter, setMotionTierFilter] = useState<'all' | 'smart' | 'pro' | 'ultra'>('all');
  const [transitionStyle, setTransitionStyle] = useState<TransitionStyle>('hard_cut');
  const [voiceEngine, setVoiceEngine] = useState<string>('edge-tts');
  const [voiceId, setVoiceId] = useState<string>('en-US-ChristopherNeural');
  const [selectedEngineTab, setSelectedEngineTab] = useState<TtsProviderId>('edge-tts');
  const [ttsEngines, setTtsEngines] = useState<TtsEngineMetadata[]>([]);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);

  // Images-only mode prompts
  const [imagesOnlyPrompts, setImagesOnlyPrompts] = useState<string>('');

  // From-skill state
  const [skillTitle, setSkillTitle] = useState<string>('');
  const [skillText, setSkillText] = useState<string>('');

  // Audio-only state (Complete Standalone Workflow)
  const [audioNarration, setAudioNarration] = useState<string>('');
  const [isSynthesizingAudioOnly, setIsSynthesizingAudioOnly] = useState<boolean>(false);
  const [audioOnlyManifest, setAudioOnlyManifest] = useState<TtsAudioManifest | null>(null);
  const [createdAudioProjectId, setCreatedAudioProjectId] = useState<string | null>(null);

  // Phase 7 Channel State
  const [channelId, setChannelId] = useState<string | undefined>();
  const [channelName, setChannelName] = useState<string | undefined>();
  const [availableChannels, setAvailableChannels] = useState<ChannelEntity[]>([]);

  // Phase 8 Skills & Script AI State
  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>(initialSkillId);
  const [availableSkills, setAvailableSkills] = useState<SkillEntity[]>([]);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [aiProgress, setAiProgress] = useState<ScriptAiProgressEvent | null>(null);
  const [aiTopic, setAiTopic] = useState<string>('');
  const [aiSceneCount, setAiSceneCount] = useState<number>(5);
  const [aiDurationSeconds, setAiDurationSeconds] = useState<number>(45);
  const [aiTone, setAiTone] = useState<string>('Cinematic & Engaging');
  const [aiInstructions, setAiInstructions] = useState<string>('');
  const [aiAccordionOpen, setAiAccordionOpen] = useState<boolean>(false);

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
          if (draft.rawScript) {
            setRawScript(draft.rawScript);
            const parsed = ScriptParser.parse(draft.rawScript);
            setScenes(parsed.scenes);
            setWarnings(parsed.warnings);
          }
          if (draft.step) setStep(draft.step);
          if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
          if (typeof draft.subtitlesEnabled === 'boolean') setSubtitlesEnabled(draft.subtitlesEnabled);
          if (draft.subtitleStyle) setSubtitleStyle(draft.subtitleStyle);
          if (typeof draft.motionEnabled === 'boolean') setMotionEnabled(draft.motionEnabled);
          if (draft.motionStyle) setMotionStyle(draft.motionStyle);
          if (draft.transitionStyle) setTransitionStyle(draft.transitionStyle);
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

  // Phase 8 Script AI & Refinement Handlers
  const handleGenerateScriptAi = async () => {
    const topic = (activeMode === 'from_skill' ? skillTitle : aiTopic).trim();
    if (!topic) {
      setErrorMsg('Please enter a video topic or premise.');
      return;
    }

    setIsGeneratingAi(true);
    setErrorMsg(null);
    setAiProgress({ stage: 'preparing', round: 0, charsReceived: 0, message: 'Initiating Script AI...' });

    try {
      if (!window.flowApi?.generateScriptAi) throw new Error('Script AI not available');
      const result = await window.flowApi.generateScriptAi({
        topic,
        skillId: selectedSkillId,
        channelId,
        targetSceneCount: aiSceneCount,
        targetDurationSeconds: aiDurationSeconds,
        aspectRatio,
        tone: aiTone,
        userInstructions: (activeMode === 'from_skill' ? (skillText ? `${skillText}\n${aiInstructions}` : aiInstructions) : aiInstructions).trim() || undefined,
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
      setAiAccordionOpen(false);

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
    const nextStep = Math.min(5, step + 1);
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
    if (!val.isValid) {
      setErrorMsg(val.errors[0]?.message || 'Cannot create video project without valid scenes.');
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
        subtitlesEnabled,
        subtitleStyle,
        motionEnabled,
        motionStyle,
        transitionStyle,
        voiceEngine,
        voiceId,
        channelId,
        channelName,
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
      setErrorMsg('Please enter at least one image prompt.');
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
      setErrorMsg('Please enter a narration script to synthesize.');
      return;
    }

    try {
      setIsSynthesizingAudioOnly(true);
      setErrorMsg(null);

      // Parse narration into structured scenes
      const parsed = ScriptParser.parse(text);
      const scenesToUse: SceneEntity[] =
        parsed.scenes && parsed.scenes.length > 0
          ? parsed.scenes
          : [
              {
                sceneNumber: 1,
                narration: text,
                imagePrompt: '',
              },
            ];

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
        Loading Video Factory...
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
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(168, 85, 247, 0.12)',
                  color: '#a855f7',
                  letterSpacing: '0.04em',
                }}
              >
                Video Factory
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Turn scripts, prompts, or titles into finished faceless videos with AI narration and camera motion.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                { s: 5, name: '5. Voice' },
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
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Video Title & Concept
                      </label>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                        Title of your video project. Extracted automatically from script if provided.
                      </p>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      persistDraft({ title: e.target.value });
                    }}
                    placeholder="e.g. The Secrets of Deep Space"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      width: '100%',
                    }}
                  />
                </div>

                {/* Hidden file input for script import */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".txt,.md,.json"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {/* Phase 8: AI Script Assistant Accordion */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    onClick={() => setAiAccordionOpen(!aiAccordionOpen)}
                    style={{
                      padding: '14px 20px',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <SparklesIcon size={16} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        AI Script Assistant
                      </span>
                      <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontWeight: 600 }}>
                        ZBot Skills
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {aiAccordionOpen ? 'Hide' : 'Auto-Generate Script from Topic & Skill'}
                      </span>
                      {aiAccordionOpen ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                    </div>
                  </div>

                  {aiAccordionOpen && (
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(16, 185, 129, 0.2)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Topic / Video Idea</label>
                          <input
                            type="text"
                            value={aiTopic}
                            onChange={(e) => setAiTopic(e.target.value)}
                            placeholder="e.g. Secrets of Deep Ocean Trenches"
                            style={{
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '12.5px',
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Selected Skill</label>
                          <select
                            value={selectedSkillId || ''}
                            onChange={(e) => setSelectedSkillId(e.target.value || undefined)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '12.5px',
                            }}
                          >
                            <option value="">No Skill (Generic Generation)</option>
                            {availableSkills.map((sk) => (
                              <option key={sk.id} value={sk.id}>{sk.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Scene Count</label>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {[3, 4, 5, 6, 8].map((count) => (
                              <button
                                key={count}
                                type="button"
                                onClick={() => setAiSceneCount(count)}
                                className={aiSceneCount === count ? 'btn-primary' : 'btn-secondary'}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '11.5px',
                                  backgroundColor: aiSceneCount === count ? '#10b981' : undefined,
                                  borderColor: aiSceneCount === count ? '#10b981' : undefined,
                                }}
                              >
                                {count} Scenes
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Desired Tone</label>
                          <input
                            type="text"
                            value={aiTone}
                            onChange={(e) => setAiTone(e.target.value)}
                            placeholder="e.g. Mysterious, Dramatic, Educational"
                            style={{
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '12.5px',
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Custom Instructions (Tier 1 Priority - Overrides all defaults)
                        </label>
                        <input
                          type="text"
                          value={aiInstructions}
                          onChange={(e) => setAiInstructions(e.target.value)}
                          placeholder="e.g. Focus specifically on Mariana Trench hydrothermal vents and bioluminescent creatures"
                          style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>

                      {/* Progress Stream Bar if generating */}
                      {isGeneratingAi && aiProgress && (
                        <div
                          style={{
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            fontSize: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', fontWeight: 600 }}>
                            <span>Stage: {aiProgress.stage.toUpperCase()}</span>
                            <span>{aiProgress.charsReceived ? `${aiProgress.charsReceived} chars` : ''}</span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>{aiProgress.message}</div>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button
                          type="button"
                          disabled={isGeneratingAi || (!aiTopic.trim() && !title.trim())}
                          onClick={() => {
                            if (!aiTopic.trim() && title.trim()) setAiTopic(title);
                            handleGenerateScriptAi();
                          }}
                          className="btn-primary"
                          style={{
                            padding: '8px 20px',
                            fontSize: '12.5px',
                            backgroundColor: '#10b981',
                            borderColor: '#10b981',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <SparklesIcon size={14} />
                          {isGeneratingAi ? 'Generating Script...' : 'Generate Full Script with AI'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

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
                    <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (editorTab === 'structured') handleSyncToRawScript();
                          setEditorTab('raw');
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 'var(--radius-xs)',
                          border: 'none',
                          backgroundColor: editorTab === 'raw' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                          color: editorTab === 'raw' ? '#c084fc' : 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: editorTab === 'raw' ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        Script Text
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorTab('structured')}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 'var(--radius-xs)',
                          border: 'none',
                          backgroundColor: editorTab === 'structured' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                          color: editorTab === 'structured' ? '#c084fc' : 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: editorTab === 'structured' ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        Scene Cards ({scenes.length})
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={handleImportFileClick}
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px' }}
                      >
                        <UploadIcon size={12} /> Import File
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadSample('documentary')}
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: '11.5px' }}
                      >
                        Sample: Ocean
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadSample('space')}
                        className="btn-secondary"
                        style={{ padding: '5px 10px', fontSize: '11.5px' }}
                      >
                        Sample: Space
                      </button>
                    </div>
                  </div>

                  {/* TAB 1: RAW SCRIPT VIEW */}
                  {editorTab === 'raw' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                        Enter or paste your script below. Supports ## SCENE 1 markers with NARRATION:, IMAGE:, and MOOD: tags, or numbered asset blocks.
                      </p>
                      <textarea
                        rows={12}
                        value={rawScript}
                        onChange={(e) => handleScriptChange(e.target.value)}
                        placeholder="Enter or paste your script here...&#10;&#10;Example:&#10;## SCENE 1&#10;NARRATION: Beneath the surface lies a mystery...&#10;IMAGE: Glowing deep sea trench with neon jellyfish&#10;&#10;## SCENE 2&#10;NARRATION: Submersibles discover new life...&#10;IMAGE: Research submarine illuminating hydrothermal vents"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                          padding: '12px',
                          borderRadius: 'var(--radius-sm)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          lineHeight: 1.5,
                          resize: 'vertical',
                          width: '100%',
                        }}
                      />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              padding: '3px 10px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: scenes.length > 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-subtle)',
                              color: scenes.length > 0 ? 'var(--success)' : 'var(--text-muted)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            {scenes.length} Scenes Detected
                          </span>
                          {scenes.length > 0 && (
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                              ~{validation.estimatedDurationSeconds}s voiceover · {validation.totalWords} words
                            </span>
                          )}

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
                        {warnings.length > 0 && (
                          <span style={{ fontSize: '11.5px', color: '#f59e0b' }}>
                            {warnings[0]}
                          </span>
                        )}
                      </div>
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

                {/* Parsed Scenes Preview (Always visible in Raw Script view if scenes exist) */}
                {editorTab === 'raw' && scenes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        Live Parsed Scenes ({scenes.length})
                      </label>
                      <button
                        type="button"
                        onClick={() => setEditorTab('structured')}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                      >
                        Open in Scene Cards Editor →
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {scenes.map((sc) => (
                        <div
                          key={sc.sceneNumber}
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
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
                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
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
                      desc: 'Standard widescreen for YouTube Longs, desktop displays, and TV broadcast.',
                      boxWidth: '70px',
                      boxHeight: '40px',
                    },
                    {
                      ratio: '9:16' as SupportedAspectRatio,
                      title: '9:16 Portrait (Vertical)',
                      desc: 'Vertical format optimized for YouTube Shorts, Instagram Reels, and TikTok.',
                      boxWidth: '40px',
                      boxHeight: '70px',
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
                          backgroundColor: isSel ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                          border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                          padding: '18px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '14px', fontWeight: 700, color: isSel ? '#c084fc' : 'var(--text-primary)' }}>
                            {f.title}
                          </span>
                          {isSel && <CheckIcon size={16} color="#a855f7" />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
                          <div
                            style={{
                              width: f.boxWidth,
                              height: f.boxHeight,
                              border: isSel ? '2px solid #a855f7' : '2px dashed var(--border-color)',
                              borderRadius: '4px',
                              backgroundColor: isSel ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                            }}
                          />
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                          {f.desc}
                        </p>
                      </div>
                    );
                  })}
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
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
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
                    padding: '14px 18px',
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
                      Synchronized word-level subtitles burned via libass rendering.
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
                      { id: 'bottom_glass', name: 'Bottom Glass', desc: 'Frosted lower bar' },
                      { id: 'bottom_bar', name: 'Solid Bar', desc: 'High-contrast strip' },
                      { id: 'neon_punch', name: 'Neon Punch', desc: 'Vibrant punchy titles' },
                      { id: 'cinema_yellow', name: 'Cinema Yellow', desc: 'Classic cinematic' },
                    ].map((st) => {
                      const isSel = subtitleStyle === st.id;
                      return (
                        <div
                          key={st.id}
                          onClick={() => {
                            if (subtitlesEnabled) {
                              setSubtitleStyle(st.id);
                              persistDraft({ subtitleStyle: st.id });
                            }
                          }}
                          style={{
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                            border: isSel && subtitlesEnabled ? '2px solid #a855f7' : '1px solid var(--border-color)',
                            backgroundColor: isSel && subtitlesEnabled ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                            opacity: subtitlesEnabled ? 1 : 0.5,
                            cursor: subtitlesEnabled ? 'pointer' : 'default',
                            textAlign: 'center',
                          }}
                        >
                          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{st.name}</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>{st.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Phase Status */}
                <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '11.5px', color: '#10b981' }}>
                  <strong>Phase 5 Active:</strong> Synchronized word-level subtitles are burned into per-scene MP4 clips via local FFmpeg libass rendering.
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
                      Master Camera Motion
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Motion ON breathes life into still images. Turn OFF for flat artwork or whiteboard slides.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !motionEnabled;
                      setMotionEnabled(next);
                      persistDraft({ motionEnabled: next });
                    }}
                    className={motionEnabled ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    {motionEnabled ? 'Motion ON' : 'Motion OFF'}
                  </button>
                </div>

                {/* Complete Motion Catalogue */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Default Motion Style
                      </label>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Select smart dynamic rotation or precise PRO/ULTRA cinematic camera styles
                      </div>
                    </div>

                    {/* Tier Filter Tabs */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['all', 'smart', 'pro', 'ultra'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setMotionTierFilter(t)}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: motionTierFilter === t ? '1px solid #a855f7' : '1px solid var(--border-color)',
                            backgroundColor: motionTierFilter === t ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-subtle)',
                            color: motionTierFilter === t ? '#c084fc' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
                    {[
                      // SMART
                      { id: 'auto' as MotionStyle, name: 'AUTO Rotation', desc: 'Anti-repetition rotation across scenes', tier: 'smart', badgeColor: '#3b82f6' },
                      { id: 'ai_director' as MotionStyle, name: 'AI Director', desc: 'Mood-adaptive dynamic camera motion', tier: 'smart', badgeColor: '#ec4899' },
                      // PRO
                      { id: 'breathe' as MotionStyle, name: 'Breathe (Default)', desc: 'Organic subtle breathing zoom', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'zoom_in' as MotionStyle, name: 'Slow Push In', desc: 'Gradual dramatic zoom into focus', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'zoom_out' as MotionStyle, name: 'Slow Pull Out', desc: 'Expansive reveal of wider scene', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'pan_left' as MotionStyle, name: 'Pan Left', desc: 'Smooth horizontal scan to the left', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'pan_right' as MotionStyle, name: 'Pan Right', desc: 'Smooth horizontal scan to the right', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'pan_up' as MotionStyle, name: 'Pan Up', desc: 'Smooth upward vertical reveal', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'pan_down' as MotionStyle, name: 'Pan Down', desc: 'Smooth downward vertical tilt', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'cinematic_dolly' as MotionStyle, name: 'Cinematic Dolly', desc: 'Diagonal camera drift push', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'drift' as MotionStyle, name: 'Drift', desc: 'Slow atmospheric floating motion', tier: 'pro', badgeColor: '#a855f7' },
                      { id: 'parallax' as MotionStyle, name: 'Parallax', desc: 'Compound depth perspective scan', tier: 'pro', badgeColor: '#a855f7' },
                      // ULTRA
                      { id: 'crash_zoom' as MotionStyle, name: 'Crash Zoom', desc: 'High-speed acceleration snap into focal point', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'bullet_time' as MotionStyle, name: 'Bullet Time', desc: 'Slow-motion matrix pan orbital drift', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'ken_burns' as MotionStyle, name: 'Ken Burns', desc: 'Documentary diagonal pan + zoom sweep', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'whip_pan_left' as MotionStyle, name: 'Whip Pan Left', desc: 'High-speed kinetic horizontal blur left', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'whip_pan_right' as MotionStyle, name: 'Whip Pan Right', desc: 'High-speed kinetic horizontal blur right', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'snap_zoom' as MotionStyle, name: 'Snap Zoom', desc: 'Instant optical focal leap for emphasis', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'dolly_zoom' as MotionStyle, name: 'Dolly Zoom', desc: 'Vertigo effect counter-scale perspective warp', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'shake' as MotionStyle, name: 'Camera Shake', desc: 'Handheld tension vibration & rumble', tier: 'ultra', badgeColor: '#f97316' },
                      { id: 'pulse' as MotionStyle, name: 'Pulse', desc: 'Rhythmic heartbeat pump expansion', tier: 'ultra', badgeColor: '#f97316' },
                      // STATIC
                      { id: 'none' as MotionStyle, name: 'Static Frame', desc: 'Fixed tripod framing without motion', tier: 'static', badgeColor: '#6b7280' },
                    ]
                      .filter((ms) => motionTierFilter === 'all' || ms.tier === motionTierFilter)
                      .map((ms) => {
                        const isSel = motionStyle === ms.id;
                        return (
                          <div
                            key={ms.id}
                            onClick={() => {
                              if (motionEnabled) {
                                setMotionStyle(ms.id);
                                persistDraft({ motionStyle: ms.id });
                              }
                            }}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: isSel && motionEnabled ? '2px solid #a855f7' : '1px solid var(--border-color)',
                              backgroundColor: isSel && motionEnabled ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                              opacity: motionEnabled ? 1 : 0.5,
                              cursor: motionEnabled ? 'pointer' : 'default',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              position: 'relative',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{ms.name}</div>
                              <span
                                style={{
                                  fontSize: '8.5px',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  backgroundColor: `${ms.badgeColor}22`,
                                  color: ms.badgeColor,
                                  border: `1px solid ${ms.badgeColor}44`,
                                }}
                              >
                                {ms.tier}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.3' }}>{ms.desc}</div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Transition Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Scene Transition Style
                  </label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {[
                      { id: 'hard_cut' as TransitionStyle, name: 'Hard Cut (Recommended)', desc: 'Clean, punchy cut without dark artifacts' },
                      { id: 'cross_fade' as TransitionStyle, name: 'Cross Fade', desc: 'Smooth alpha blend between scenes' },
                    ].map((ts) => {
                      const isSel = transitionStyle === ts.id;
                      return (
                        <button
                          key={ts.id}
                          type="button"
                          onClick={() => {
                            setTransitionStyle(ts.id);
                            persistDraft({ transitionStyle: ts.id });
                          }}
                          className={isSel ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '8px 16px', fontSize: '12px' }}
                        >
                          {ts.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Phase Status */}
                <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '11.5px', color: '#10b981' }}>
                  <strong>Phase 5 Active:</strong> Camera motion filters (zoompan) and transitions are actively rendered into video clips via local FFmpeg.
                </div>
              </div>
            )}

            {/* STEP 5: VOICE */}
            {step === 5 && (() => {
              const activeEngines = ttsEngines.length > 0 ? ttsEngines : DEFAULT_ENGINES;
              const currentEngine = activeEngines.find((e) => e.id === selectedEngineTab) || activeEngines[0];
              const providerVoices = allVoices.filter((v) => v.provider === selectedEngineTab);
              const displayVoices = providerVoices.length > 0 ? providerVoices : (DEFAULT_PROVIDER_VOICES[selectedEngineTab] || []);

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
                  <div>
                    <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      Voice & TTS Narration Foundation (ZBot Engine Selection)
                    </h2>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                      Select your speech engine and narrator persona. Automatic ZBot fallback protects video generation against API or quota failures.
                    </p>
                  </div>

                  {/* Engine Selection Tabs */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {activeEngines.map((engine) => {
                      const isSelected = selectedEngineTab === engine.id;
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
                          }}
                        >
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: engine.isAvailable ? '#10b981' : '#f59e0b',
                            }}
                          />
                          <span>{engine.name}</span>
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

                  {/* Engine Status Banner */}
                  {!currentEngine.isAvailable ? (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        fontSize: '12px',
                        color: '#f59e0b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <AlertCircleIcon size={16} />
                      <span>
                        <strong>{currentEngine.name} is offline:</strong> {currentEngine.unavailableReason || 'Requires configuration in Settings.'} (ZBot fallback will automatically synthesize using Kokoro or Edge TTS if this engine is used during generation).
                      </span>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.25)',
                        fontSize: '11.5px',
                        color: '#10b981',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <CheckIcon size={14} />
                      <span>
                        <strong>{currentEngine.name} is ready:</strong>{' '}
                        {currentEngine.supportsWordTimings
                          ? 'Exact word boundary timing synchronization supported.'
                          : 'High fidelity audio narration synced to scene durations.'}
                      </span>
                    </div>
                  )}

                  {/* Voices Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    {displayVoices.map((v) => {
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
                            padding: '16px',
                            borderRadius: 'var(--radius-md)',
                            border: isSel ? '2px solid #a855f7' : '1px solid var(--border-color)',
                            backgroundColor: isSel ? 'rgba(168, 85, 247, 0.12)' : 'var(--bg-subtle)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: isSel ? '#c084fc' : 'var(--text-primary)' }}>
                              {v.name}
                            </span>
                            {isSel && <CheckIcon size={14} color="#a855f7" />}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                              {v.locale || 'en-US'} {v.gender ? `• ${v.gender}` : ''}
                            </span>
                            {v.tier === 'premium' && (
                              <span
                                style={{
                                  fontSize: '9.5px',
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

                          <div style={{ marginTop: '6px' }}>
                            <button
                              type="button"
                              onClick={(e) => handlePreviewVoice(selectedEngineTab, v.id, e)}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              {isPlaying ? '⏹ Stop Preview' : '▶ Test Voice'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ZBot Fallback Architecture Banner */}
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(168, 85, 247, 0.08)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>ZBot Resilient Fallback Protection:</strong> In accordance with the ZBot specification, narration synthesis follows an automatic downgrade chain: <em>Selected Engine → 1 Retry → Kokoro (Local ONNX) → Edge TTS (Free Cloud)</em>. A missing voice, invalid key, or quota exhaustion will never fail your video generation. Voice previews strictly isolate engines and will never lie with cross-fallback audio.
                  </div>
                </div>
              );
            })()}

            {/* Stepper Navigation Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
              <div>
                {step > 1 && (
                  <button type="button" onClick={handlePrevStep} className="btn-secondary" style={{ padding: '8px 18px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ChevronLeftIcon size={14} /> Back
                  </button>
                )}
              </div>

              <div>
                {step < 5 ? (
                  <button type="button" onClick={handleNextStep} className="btn-primary" style={{ padding: '8px 22px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Next Step <ArrowRightIcon size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting || scenes.length === 0}
                    onClick={handleCreateFullVideoProject}
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
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Images Only Workflow
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Generate standalone scene artwork without video clips or voiceover using Infinity Flow's parallel multi-profile generator.
                </p>
              </div>

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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Aspect Ratio</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['16:9', '9:16'] as SupportedAspectRatio[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAspectRatio(r)}
                      className={aspectRatio === r ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      {r} {r === '16:9' ? '(Landscape)' : '(Portrait)'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Image Prompts (one per line)
                </label>
                <textarea
                  rows={8}
                  value={imagesOnlyPrompts}
                  onChange={(e) => setImagesOnlyPrompts(e.target.value)}
                  placeholder="Cinematic view of futuristic Tokyo street with neon signs&#10;Portrait of astronaut in reflective gold helmet overlooking red Mars dunes&#10;Macro photography of crystal dandelion floating in sunlight"
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
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
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
        {/* MODE: FROM SKILL (Autonomous Phase 8 Script AI Workflow)     */}
        {/* ============================================================ */}
        {activeMode === 'from_skill' && (
          <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981',
                    }}
                  >
                    Phase 8 Active
                  </span>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Combine a Channel Rulebook with a specialized Skill to autonomously create structured scenes with synchronized visual prompts and narration.
                </p>
              </div>

              {/* Channel and Skill Selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Channel Assignment
                  </label>
                  <select
                    value={channelId || ''}
                    onChange={(e) => {
                      const id = e.target.value || undefined;
                      const ch = availableChannels.find((c) => c.id === id);
                      setChannelId(id);
                      setChannelName(ch?.name);
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Selected Skill <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                  </label>
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
                    {availableSkills.map((sk) => (
                      <option key={sk.id} value={sk.id}>
                        {sk.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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
        {activeMode === 'audio_only' && (
          <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(168, 85, 247, 0.12)', color: 'rgb(168, 85, 247)' }}>
                    Phase 4 Studio
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Synthesize multi-scene or standalone voiceovers with ZBot fallback, concatenate with FFmpeg into broadcast master audio, and export.
                </p>
              </div>

              {/* Script Input Header & Actions */}
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
                  <span>{audioNarration.length} characters • ~{audioNarration.trim().split(/\s+/).filter(Boolean).length} words</span>
                  <span>Estimated duration: ~{Math.round(audioNarration.trim().split(/\s+/).filter(Boolean).length / 2.5)}s</span>
                </div>
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

              {/* Synthesize Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
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
                        {audioOnlyManifest.fallbackOccurred && (
                          <span style={{ color: '#f59e0b', marginLeft: '6px' }}>
                            (Downgraded via ZBot fallback from {audioOnlyManifest.provider})
                          </span>
                        )}
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
                                {sc.fallbackOccurred && (
                                  <span style={{ fontSize: '10px', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '1px 6px', borderRadius: '3px' }}>
                                    Downgraded to {sc.providerUsed}
                                  </span>
                                )}
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
