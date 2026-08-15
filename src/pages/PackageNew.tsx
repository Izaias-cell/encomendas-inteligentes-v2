import React, { useState, useEffect, useRef, useMemo } from 'react';
/*
 * REGRA DE OURO DO REGISTRO DE ENCOMENDAS (PROTEÇÃO DE FLUXO):
 * 1. O OCR nunca deve rodar antes da foto estar capturada e armazenada.
 * 2. Fluxo Fixo: Abrir Câmera Traseira -> Estabilizar -> Capturar -> Salvar Alta Qualidade -> Processar OCR.
 * 3. NÃO retornar ao reconhecimento em tempo real/ao vivo (borra a imagem e reduz precisão).
 * 4. NÃO comprimir excessivamente antes do OCR (mínimo 0.8 qualidade).
 * 5. Filtros permitidos: Contraste leve, Nitidez leve, Correção de brilho. Evitar filtros agressivos.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Package, 
  User, 
  Building2, 
  Truck, 
  Camera, 
  ArrowLeft, 
  Search, 
  Loader2, 
  CheckCircle, 
  X, 
  Check,
  FileText,
  Sparkles,
  AlertCircle,
  Hash,
  Info,
  Zap,
  ZapOff,
  ChevronRight,
  Save,
  Send,
  ArrowRight,
  ExternalLink,
  MessageCircle
} from 'lucide-react';
import { feedback } from '../lib/feedback';
import { supabase } from '../lib/supabase';
import { Profile, Morador, CondominiumSettings } from '../types';
import toast from 'react-hot-toast';
import { registrarAuditoria, sanitizeUuid, isValidUuid } from '../services/auditService';
import { getCurrentPorter, setManualPorter } from '../lib/porterUtils';
import { getActivePlantao } from '../lib/plantaoUtils';
import { extractBasicText } from '../services/geminiService';
import { parseLabelText } from '../services/labelParser';
import { findMatchingResidents, ScoredResident, normalizeUnit, normalizeName } from '../services/residentMatcher';
import { formatResidentAddress } from '../lib/residentUtils';
import { motion, AnimatePresence } from 'motion/react';
import { generatePickupCode, prepareWhatsAppNotification, sendWhatsAppMessage, getWhatsAppLink } from '../services/whatsappService';
import { isTestResident } from '../services/residentModeService';

interface PackageNewProps {
  user: Profile;
}

type Step = 'camera' | 'manual' | 'analyzing';

const QUICK_OBSERVATIONS = [
  'Carta Registrada',
  'Encomenda Registrada',
  'Carta Simples',
  'Correios',
  'Amazon',
  'Shopee',
  'Mercado Livre',
  'TikTok Shop',
  'Caixa frágil',
  'Pacote grande',
  'Encomenda grande (retirada imediata)',
  'Envelope'
];

export default function PackageNew({ user }: PackageNewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep] = useState<Step>('camera');
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchingResidents, setIsSearchingResidents] = useState(false);
  const [selectedResident, setSelectedResident] = useState<Morador | null>(null);
  const [matchingResidents, setMatchingResidents] = useState<ScoredResident[]>([]);
  
  const [recipientName, setRecipientName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [pickupCode, setPickupCode] = useState('');
  const [condoName, setCondoName] = useState('');
  const [isManualUnitSearch, setIsManualUnitSearch] = useState(true);
  const [allCondoResidents, setAllCondoResidents] = useState<Morador[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [condoSettings, setCondoSettings] = useState<CondominiumSettings | null>(null);
  const [foundPartialData, setFoundPartialData] = useState(false);
  const [isAiSearch, setIsAiSearch] = useState(false);
  const [notifyAfter, setNotifyAfter] = useState(() => {
    return localStorage.getItem('notify_after_registration') === 'true';
  });

  const [currentPorterState, setCurrentPorterState] = useState(() => {
    const plantao = getActivePlantao(user?.condominium_id);
    return plantao ? plantao.porteiro_nome : getCurrentPorter(user?.condominium_id);
  });
  const [showPorterModal, setShowPorterModal] = useState(false);
  const [portersList, setPortersList] = useState<Profile[]>([]);

  useEffect(() => {
    if (user?.condominium_id) {
      supabase
        .from('profiles')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .eq('role', 'porteiro')
        .eq('active', true)
        .order('full_name')
        .then(({ data, error }) => {
          if (!error && data) {
            setPortersList(data);
          }
        });
    }
  }, [user?.condominium_id]);

  useEffect(() => {
    const plantao = getActivePlantao(user?.condominium_id);
    const p = plantao ? plantao.porteiro_nome : getCurrentPorter(user?.condominium_id);
    setCurrentPorterState(p);
  }, [user?.condominium_id]);

  useEffect(() => {
    if (currentPorterState === 'Selecione o Porteiro') {
      setShowPorterModal(true);
    }
  }, [currentPorterState]);

  useEffect(() => {
    localStorage.setItem('notify_after_registration', notifyAfter.toString());
  }, [notifyAfter]);
  const [statusMessage, setStatusMessage] = useState('Lendo etiqueta...');
  const [allResidents, setAllResidents] = useState<Morador[]>([]);
  const [isWaitingForReturn, setIsWaitingForReturn] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<'alta' | 'media' | 'baixa' | null>(null);
  const [debugOcrImage, setDebugOcrImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraStabilizing, setIsCameraStabilizing] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [blockAutoCamera, setBlockAutoCamera] = useState(false);
  const [showCaptureFeedback, setShowCaptureFeedback] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<any>(null);
  const [shouldFocusSearch, setShouldFocusSearch] = useState(false);
  const [isBatch, setIsBatch] = useState(false);
  const [batchQuantity, setBatchQuantity] = useState(1);
  const [detectedHandwrittenUnit, setDetectedHandwrittenUnit] = useState<string | null>(null);
  const [showResidencyAlert, setShowResidencyAlert] = useState(false);
  const [ignoreResidencyAlert, setIgnoreResidencyAlert] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(true);
  const [showPickupCode, setShowPickupCode] = useState(false);
  const [isUnitInputFocused, setIsUnitInputFocused] = useState(false);
  const unitInputRef = useRef<HTMLInputElement>(null);
  const residentsSectionRef = useRef<HTMLDivElement>(null);
  const uploadPromiseRef = useRef<Promise<string | null> | null>(null);
  const currentPhotoRef = useRef<string>('');

  // Pre-indexed resident data for O(1)/instant searches without repeating regexes
  const indexedResidents = useMemo(() => {
    if (!allResidents || allResidents.length === 0) return [];
    return allResidents.map(r => {
      const normUnit = normalizeUnit(r.unidade || '');
      const normName = normalizeName(r.nome || '');
      const fullNameUpper = (r.nome || '').toUpperCase();
      const rawUnitUpper = (r.unidade || '').toUpperCase();
      return {
        raw: r,
        normUnit,
        normName,
        fullNameUpper,
        rawUnitUpper,
        condoId: r.condominium_id
      };
    });
  }, [allResidents]);

  // Refs de controle para estabilidade de memória, concorrência e câmera
  const isStartingCameraRef = useRef<boolean>(false);
  const activeRequestIdRef = useRef<number>(0);
  const objectUrlRef = useRef<string | null>(null);
  const scrollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrolledTargetYRef = useRef<number>(-1);
  const searchedTermRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const whatsAppOpenedTimeRef = useRef<number>(0);
  const hasBeenHiddenRef = useRef<boolean>(false);

  const playSuccessSound = () => {
    feedback.success();
  };

  const APP_VERSION = "2.2.1-flow";
  const BUILD_TIME = "2026-04-27 17:55";
  const ENVIRONMENT = window.location.hostname.includes('ais-dev') ? 'preview' : 'produção';

  // Heurística de gênero para diferenciação visual (lilás para feminino)
  const isFemale = (name?: string) => {
    if (!name) return false;
    const first = name.trim().split(' ')[0].toLowerCase().replace(/[^a-zÀ-ÿ]/g, '');
    return first.endsWith('a') || first.endsWith('e');
  };

  // Detect context return for individual flow (e.g. from WhatsApp)
  useEffect(() => {
    const handleReturn = () => {
      if (isWaitingForReturn) {
        const elapsed = Date.now() - whatsAppOpenedTimeRef.current;
        // Evita processar retornos instantâneos gerados pelo próprio disparo do window.open
        if (!hasBeenHiddenRef.current && elapsed < 1200) {
          return;
        }

        setIsWaitingForReturn(false);
        hasBeenHiddenRef.current = false;
        resetForm();
        startCamera();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast.success('Câmera pronta para o próximo registro!', { icon: '📸', duration: 4000 });
      }
    };

    const handleFocus = () => {
      if (isWaitingForReturn && (hasBeenHiddenRef.current || (Date.now() - whatsAppOpenedTimeRef.current > 1500))) {
        handleReturn();
      }
    };

    const handleBlur = () => {
      if (isWaitingForReturn) {
        hasBeenHiddenRef.current = true;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (isWaitingForReturn) {
          hasBeenHiddenRef.current = true;
        }
      } else if (document.visibilityState === 'visible') {
        if (isWaitingForReturn && (hasBeenHiddenRef.current || (Date.now() - whatsAppOpenedTimeRef.current > 1500))) {
          handleReturn();
        }
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isWaitingForReturn]);

  // Fetch residents and settings on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.condominium_id) return;
      
      const { data: settings } = await supabase
        .from('condominium_settings')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .maybeSingle();
      if (settings) setCondoSettings(settings);

      const { data: residentsList } = await supabase
        .from('moradores')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .eq('ativo', true)
        .order('nome');
      if (residentsList) {
        setAllResidents(residentsList);
        setAllCondoResidents(residentsList as Morador[]);
      }
    };
    fetchData();
  }, [user?.condominium_id]);

  // Auto-trigger camera on mount
  useEffect(() => {
    if (step === 'camera' && !photoUrl && !cameraActive && !blockAutoCamera) {
      startCamera();
    }
    return () => stopCamera();
  }, [step, photoUrl, blockAutoCamera]);

  // Fetch condominium name on mount
  useEffect(() => {
    const fetchCondoName = async () => {
      if (!user?.condominium_id) return;
      const { data, error } = await supabase
        .from('condominiums')
        .select('name')
        .eq('id', user.condominium_id)
        .single();
      
      if (!error && data) {
        setCondoName(data.name);
      }
    };

    fetchCondoName();
  }, [user?.condominium_id]);

  const startCamera = async () => {
    // 1. Verificar suporte
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Câmera não suportada neste dispositivo.");
      return;
    }

    // Evitar chamadas concorrentes/simultâneas que travam o WebRTC do navegador
    if (isStartingCameraRef.current) {
      return;
    }

    // Se já estiver ativa com track funcionando, não precisa recriar
    if (cameraActive && streamRef.current) {
      const activeTrack = streamRef.current.getVideoTracks()[0];
      if (activeTrack && activeTrack.readyState === 'live') {
        return;
      }
    }

    isStartingCameraRef.current = true;

    // 2. Parar qualquer stream existente antes de abrir uma nova
    stopCamera();
    setIsCameraStabilizing(true);
    setBlockAutoCamera(false);
    setCameraError(null);
    
    try {
      let stream: MediaStream;
      
      // 3. Tentar preferencialmente a câmera traseira
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
      } catch (err1) {
        console.warn("Falha ao abrir câmera traseira, tentando frontal...", err1);
        // 4. Fallback para câmera frontal
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
          });
        } catch (err2) {
          console.warn("Falha ao abrir câmera frontal, tentando qualquer vídeo...", err2);
          // 5. Fallback final: qualquer vídeo disponível
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: false 
          });
        }
      }
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Android Chrome precisa de load() em alguns casos após atribuir srcObject
        try { videoRef.current.load(); } catch(e) {}
        
        setCameraActive(true);

        // Aguarda estabilização (foco e exposição contínua se disponível)
        setTimeout(() => {
          setIsCameraStabilizing(false);
          const track = stream.getVideoTracks()[0];
          if (track && track.applyConstraints) {
            track.applyConstraints({
              advanced: [
                { focusMode: 'continuous' } as any,
                { exposureMode: 'continuous' } as any
              ]
            }).catch(() => {});
          }
        }, 800); // 800ms para estabilização térmica e de sensor
      }
    } catch (err: any) {
      console.error("Erro crítico ao acessar câmera:", err);
      
      // 6. Tratar erros específicos conforme solicitado
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError("Permissão da câmera negada. Ative nas configurações do navegador ou abra o aplicativo em uma nova aba fora do chat.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError("Nenhuma câmera encontrada no dispositivo.");
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError("A câmera está sendo usada por outro aplicativo ou falhou ao iniciar.");
      } else {
        setCameraError("Erro ao abrir câmera. Tente novamente.");
      }
      
      setCameraActive(false);
      setIsCameraStabilizing(false);
    } finally {
      isStartingCameraRef.current = false;
    }
  };

  const stopCamera = () => {
    isStartingCameraRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch(e) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setFlashOn(false);
  };

  const toggleFlash = async () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    
    if (!track.getCapabilities) {
      toast.error("Seu navegador não suporta controle de flash");
      return;
    }

    try {
      const capabilities = track.getCapabilities() as any;
      if (!capabilities || !capabilities.torch) {
        toast.error("Flash não suportado neste dispositivo");
        return;
      }
      
      const newFlashState = !flashOn;
      await track.applyConstraints({
        advanced: [{ torch: newFlashState }]
      } as any);
      setFlashOn(newFlashState);
    } catch (err) {
      console.error("Erro ao alternar flash:", err);
      toast.error("Flash não disponível");
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || isCameraStabilizing || isCapturing) return;
    
    setIsCapturing(true);
    const requestId = ++activeRequestIdRef.current;

    // Abortar chamadas anteriores do Gemini se houver
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Resolução otimizada para foto da encomenda (máximo 1600px)
    const MAX_DIMENSION = 1600; 
    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;
    
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    if (ratio < 1) {
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;
    
    const context = canvas.getContext('2d', { alpha: false });
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, width, height);

      // Captura de baixa resolução para OCR (Alta velocidade e foco no essencial)
      const OCR_MAX = 600; 
      let ocrWidth = video.videoWidth || 600;
      let ocrHeight = video.videoHeight || 450;
      const ocrRatio = Math.min(OCR_MAX / ocrWidth, OCR_MAX / ocrHeight);
      ocrWidth = Math.round(ocrWidth * ocrRatio);
      ocrHeight = Math.round(ocrHeight * ocrRatio);

      const ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = ocrWidth;
      ocrCanvas.height = ocrHeight;
      const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
      let ocrBase64 = '';
      if (ocrCtx) {
        ocrCtx.imageSmoothingEnabled = true;
        ocrCtx.imageSmoothingQuality = 'medium';
        ocrCtx.drawImage(video, 0, 0, ocrWidth, ocrHeight);
        ocrBase64 = ocrCanvas.toDataURL('image/jpeg', 0.70);
      }

      // Parar câmera imediatamente para liberar hardware
      stopCamera();

      // Limpar seleções e preparar entrada manual imediatamente
      setSelectedResident(null);
      setRecipientName('');
      setUnitNumber('');
      setSearchTerm('');
      setMatchingResidents([]);
      setNotes('');
      lastScrolledTargetYRef.current = -1;
      searchedTermRef.current = '';
      setIsOcrLoading(false);
      setStatusMessage('Entrada Manual');
      setIsManualUnitSearch(true);
      setStep('manual');
      setShouldFocusSearch(true);

      // Processar Blob da foto em paralelo para upload e visualização rápida
      canvas.toBlob((blob) => {
        if (!blob || requestId !== activeRequestIdRef.current) return;

        if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
          try { URL.revokeObjectURL(objectUrlRef.current); } catch(e) {}
        }
        const previewUrl = URL.createObjectURL(blob);
        objectUrlRef.current = previewUrl;
        setPhotoUrl(previewUrl);

        // Inicia upload e OCR com o blob direto sem converter de volta
        processImageFlow(previewUrl, ocrBase64, true, requestId, blob);
      }, 'image/jpeg', 0.85);
    } else {
      setIsCapturing(false);
    }
  };

  const processImageFlow = async (previewUrl: string, ocrBase64: string, runOcr: boolean = true, requestId?: number, capturedBlob?: Blob) => {
    const currentReq = requestId || activeRequestIdRef.current;
    try {
      // 1. Inicia upload em background (Prova Jurídica) direto com o Blob
      uploadPromiseRef.current = (async () => {
        try {
          let blob = capturedBlob;
          if (!blob) {
            const res = await fetch(previewUrl);
            blob = await res.blob();
          }
          const file = new File([blob], "package_photo.jpg", { type: "image/jpeg" });
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
          const filePath = `package-photos/${fileName}`;
          
          const { error: uploadError } = await supabase.storage
            .from('packages')
            .upload(filePath, file);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('packages')
              .getPublicUrl(filePath);

            if (currentReq === activeRequestIdRef.current) {
              setPhotoUrl(publicUrl);
            }
            return publicUrl;
          }
          return null;
        } catch (e) {
          console.error('Erro no upload de prova:', e);
          return null;
        }
      })();

      if (!runOcr || !ocrBase64) {
        if (currentReq === activeRequestIdRef.current) {
          setIsOcrLoading(false);
          setIsCapturing(false);
        }
        return;
      }

      // 2. Executa OCR apenas na miniatura leve de 600px
      const result = await processImageWithWait(ocrBase64, ocrBase64);

      if (currentReq !== activeRequestIdRef.current) {
        return;
      }

      if (result && (result.casa || result.inicial || result.destinatario)) {
        await handleOCRResult(result, currentReq);
      } else {
        fallbackToManual(previewUrl, currentReq);
      }
    } catch (error) {
      console.error('Erro no fluxo de imagem:', error);
      fallbackToManual(previewUrl, currentReq);
    } finally {
      if (currentReq === activeRequestIdRef.current) {
        setIsOcrLoading(false);
        setIsCapturing(false);
      }
    }
  };

  const fallbackToManual = (originalUrl?: string, requestId?: number) => {
    if (requestId && requestId !== activeRequestIdRef.current) return;
    setOcrConfidence('baixa');
    setStatusMessage('Entrada Manual');
    setStep('manual');
    setIsOcrLoading(false);
  };

  const handleOCRResult = async (parsedData: any, requestId?: number) => {
    if (requestId && requestId !== activeRequestIdRef.current) return;

    const unitToUse = parsedData.casa || '';
    const initialToUse = parsedData.inicial || '';
    const nameToUse = parsedData.destinatario || '';
    const confidence = parsedData.confianca as 'alta' | 'media' | 'baixa';

    if (unitToUse && confidence === 'alta') {
      setDetectedHandwrittenUnit(unitToUse);
    }

    setDiagnosticInfo((prev: any) => ({
      ...prev,
      ocrStatus: 'SUCESSO',
      detectedName: nameToUse,
      detectedHouse: unitToUse,
      detectedInitial: initialToUse,
      confidence: confidence,
      ocrTimestamp: new Date().toLocaleTimeString()
    }));
    
    setOcrConfidence(confidence);

    if (unitToUse && !unitNumber) setUnitNumber(unitToUse);
    if (nameToUse && !recipientName) setRecipientName(nameToUse);

    // Se o usuário já digitou ou selecionou um morador, não interferir no campo
    if (searchTerm.trim().length > 0 || selectedResident) {
      return;
    }
    
    if ((unitToUse || initialToUse || nameToUse) && user?.condominium_id) {
      setStatusMessage('Buscando Morador...');
      
      const matches = await findMatchingResidents(
        user.condominium_id,
        unitToUse,
        nameToUse,
        undefined,
        initialToUse,
        allResidents
      );
 
      if (matches.length > 0) {
        if (!searchTerm.trim() && !selectedResident) {
          setMatchingResidents(matches.slice(0, 10));
          setIsAiSearch(true);
          const term = unitToUse || nameToUse || initialToUse;
          setSearchTerm(term);
          setIsManualUnitSearch(!!unitToUse);
        }
      } else if (unitToUse) {
        if (!searchTerm.trim() && !selectedResident) {
          setSearchTerm(unitToUse);
          setIsManualUnitSearch(true);
          const normalizedUnitSearch = normalizeUnit(unitToUse);
          const houseMatches = (allResidents || [])
            .filter(r => r && r.id && normalizeUnit(r.unidade || '').includes(normalizedUnitSearch))
            .map(r => ({ resident: r, score: 100 }));
          
          if (houseMatches.length > 0) {
            setMatchingResidents(houseMatches);
            setOcrConfidence('media');
          }
        }
      } else if (!searchTerm.trim() && !selectedResident) {
        fallbackToManual();
      }
    } else if (!searchTerm.trim() && !selectedResident) {
      fallbackToManual();
    }
  };

  const processingRef = useRef(false);

  const processImageWithWait = async (base64: string, ocrBase64?: string) => {
    try {
      const startTime = Date.now();
      const finalOcrBase64 = ocrBase64 || base64;
      setStatusMessage('LENDO ETIQUETA...'); // Mensagem mais clara
      
      // Limpa estados de detecção anterior
      setRecipientName('');
      setUnitNumber('');
      setMatchingResidents([]);
      setSelectedResident(null);
      setOcrConfidence(null);
      setIsAiSearch(false);
      setIsManualUnitSearch(true);

      const ocrPromise = (async () => {
        try {
          const parsedData = await extractBasicText(finalOcrBase64, abortControllerRef.current?.signal);
          return parsedData;
        } catch (err: any) {
          console.error("Erro no OCR:", err);
          return null;
        }
      })();

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 15000));
      
      const raceResult = await Promise.race([
        ocrPromise,
        timeoutPromise
      ]);

      // Transição visual suave (200ms em vez de 1.8s de espera artificial)
      const elapsedTime = Date.now() - startTime;
      const minWait = 200;
      if (elapsedTime < minWait) {
        await new Promise(resolve => setTimeout(resolve, minWait - elapsedTime));
      }

      if (raceResult === 'timeout') {
        return null;
      }

      return raceResult;
    } catch (err) {
      console.warn("[IA] Erro:", err);
      return null;
    }
  };

  // Generate 4-digit code on mount
  useEffect(() => {
    const code = generatePickupCode();
    setPickupCode(code);
  }, []);

  // Pre-fill if resident is passed via state
  useEffect(() => {
    if (location.state?.resident) {
      handleSelectResident(location.state.resident, false);
      setStep('manual'); // If coming from resident card, go to manual/form
    }
  }, [location.state]);

  // Search residents with indexed pre-normalized records
  useEffect(() => {
    if (selectedResident) {
      setIsSearchingResidents(false);
      return;
    }

    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setIsSearchingResidents(false);
      searchedTermRef.current = '';
      if (isManualUnitSearch) {
        setMatchingResidents([]);
      } else if (!foundPartialData) {
        setMatchingResidents((allResidents || []).slice(0, 10).map(r => ({ resident: r, score: 0 })));
      }
      return;
    }

    setIsSearchingResidents(true);

    const timer = setTimeout(() => {
      try {
        if (!indexedResidents || indexedResidents.length === 0) {
          setMatchingResidents([]);
          return;
        }

        const condoId = user?.condominium_id;

        if (isManualUnitSearch) {
          const normalizedSearch = normalizeUnit(trimmed);
          const rawSearchUpper = trimmed.toUpperCase();
          
          const matches: ScoredResident[] = [];
          for (let i = 0; i < indexedResidents.length; i++) {
            const item = indexedResidents[i];
            if (!item.raw || !item.raw.id) continue;
            if (condoId && item.condoId && item.condoId !== condoId) continue;

            if (item.normUnit.includes(normalizedSearch) || item.rawUnitUpper.includes(rawSearchUpper)) {
              const exact = item.normUnit === normalizedSearch || item.rawUnitUpper === rawSearchUpper;
              matches.push({
                resident: item.raw,
                score: exact ? 100 : 50
              });
              if (matches.length >= 25) break;
            }
          }
          matches.sort((a, b) => b.score - a.score);
          setMatchingResidents(matches);
        } else {
          const normalizedSearch = normalizeName(trimmed);
          const rawSearchUpper = trimmed.toUpperCase();

          const matches: ScoredResident[] = [];
          for (let i = 0; i < indexedResidents.length; i++) {
            const item = indexedResidents[i];
            if (!item.raw || !item.raw.id) continue;
            if (condoId && item.condoId && item.condoId !== condoId) continue;

            if (
              item.normName.includes(normalizedSearch) || 
              item.fullNameUpper.includes(rawSearchUpper) || 
              item.normUnit.includes(normalizedSearch)
            ) {
              const exact = item.normName === normalizedSearch || item.fullNameUpper === rawSearchUpper;
              const starts = item.normName.startsWith(normalizedSearch) || item.fullNameUpper.startsWith(rawSearchUpper);
              matches.push({
                resident: item.raw,
                score: exact ? 100 : (starts ? 80 : 60)
              });
              if (matches.length >= 25) break;
            }
          }
          matches.sort((a, b) => b.score - a.score);
          setMatchingResidents(matches);
        }
        searchedTermRef.current = trimmed;
      } catch (err) {
        console.error("Erro ao pesquisar morador:", err);
        setMatchingResidents([]);
      } finally {
        setIsSearchingResidents(false);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [searchTerm, user?.condominium_id, selectedResident, indexedResidents, foundPartialData, isManualUnitSearch, allResidents]);

  // Fechamento automático do teclado e posicionamento suave da lista de moradores após a digitação estabilizada
  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (
      !isSearchingResidents && 
      matchingResidents.length > 0 && 
      step === 'manual' && 
      !selectedResident && 
      trimmed.length > 0 && 
      searchedTermRef.current === trimmed
    ) {
      // Aguarda a estabilização completa da digitação (400ms após a última tecla)
      const stabilizationTimer = setTimeout(() => {
        // 1. Fecha o teclado virtual liberando a área visual da tela
        if (unitInputRef.current && document.activeElement === unitInputRef.current) {
          unitInputRef.current.blur();
        }

        // 2. Executa o scroll automático com pequeno delay para adaptação da viewport pós-teclado
        setTimeout(() => {
          if (residentsSectionRef.current) {
            const element = residentsSectionRef.current;
            const rect = element.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            
            const targetY = Math.max(0, rect.top + scrollTop - 40);

            if (lastScrolledTargetYRef.current === -1 || Math.abs(targetY - lastScrolledTargetYRef.current) > 15) {
              lastScrolledTargetYRef.current = targetY;
              window.scrollTo({
                top: targetY,
                behavior: 'smooth'
              });
            }
          }
        }, 100);
      }, 400);

      return () => clearTimeout(stabilizationTimer);
    }
  }, [isSearchingResidents, matchingResidents.length, step, selectedResident, searchTerm]);

  const triggerWhatsAppForResident = (resident: Morador, codeToUse?: string) => {
    try {
      const activeCode = codeToUse || pickupCode || generatePickupCode();
      const nameOfCondo = condoName || 'Condomínio';
      const isBatchNote = isBatch || batchQuantity > 1;
      const batchLabel = isBatchNote ? ` (Lote de ${batchQuantity} encomendas)` : '';
      const finalNotes = isBatchNote ? (notes ? `${notes}, Lote de ${batchQuantity} encomendas` : `Lote de ${batchQuantity} encomendas`) : notes;
      const isLargePackage = notes.includes('Encomenda grande (retirada imediata)');

      let directMessage = `Olá, ${resident.nome}! Sua encomenda chegou na portaria de ${nameOfCondo}. Código: ${activeCode}${batchLabel}`;
      try {
        const prepared = prepareWhatsAppNotification(
          resident,
          nameOfCondo,
          activeCode,
          finalNotes,
          undefined,
          1,
          'disponivel',
          undefined,
          undefined,
          photoUrl,
          isLargePackage
        );
        if (prepared) directMessage = prepared;
      } catch (prepErr) {
        console.warn("Erro ao preparar texto do WhatsApp:", prepErr);
      }

      const cleanPhone = resident.telefone ? resident.telefone.replace(/\D/g, '') : '';
      if (cleanPhone && cleanPhone.length >= 10) {
        // BLINDAGEM DE MODO TESTE: Se o morador for importado em MODO TESTE, simula e NUNCA abre WhatsApp real
        if (isTestResident(resident)) {
          toast.success(`🧪 [MODO TESTE] Envio simulado com sucesso para ${resident.nome}. Nenhuma mensagem real foi enviada.`, {
            icon: '🧪',
            duration: 4000
          });
          resetForm();
          startCamera();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast.success('Câmera pronta para o próximo registro!', { icon: '📸', duration: 4000 });
          return;
        }

        whatsAppOpenedTimeRef.current = Date.now();
        hasBeenHiddenRef.current = false;
        setIsWaitingForReturn(true);
        const link = getWhatsAppLink(resident.telefone!, directMessage, photoUrl);
        window.open(link, '_blank');
        toast.success(`Abrindo WhatsApp para ${resident.nome}...`, { icon: '💬' });
        // O reset do formulário e reativação da câmera ocorrerão suavemente no retorno do WhatsApp (ao focar a janela)
      } else {
        toast.error(`Morador ${resident.nome} selecionado, porém não possui telefone válido cadastrado para WhatsApp.`, { duration: 5000 });
      }
    } catch (err) {
      console.error("Erro ao disparar WhatsApp do morador:", err);
    }
  };

  const handleSelectResident = async (resident: Morador, shouldOpenWhatsapp: boolean = false) => {
    unitInputRef.current?.blur();
    setSelectedResident(resident);
    setRecipientName(resident.nome || '');
    setUnitNumber(resident.unidade || '');
    if (resident.unit_type) {
      setUnitType(resident.unit_type);
    } else if (!unitType) {
      setUnitType('');
    }
    setSearchTerm(resident.nome || '');
    setMatchingResidents([]);

    let activeCode = pickupCode;

    // Check for existing pending packages to reuse code/token em background
    try {
      const { data: existing } = await supabase
        .from('packages')
        .select('pickup_code, pickup_token')
        .eq('recipient_id', resident.id)
        .eq('status', 'received')
        .order('received_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0 && existing[0].pickup_code) {
        activeCode = existing[0].pickup_code;
        setPickupCode(activeCode);
      }
    } catch (err) {
      console.warn("Erro ao buscar código existente:", err);
    }
  };

  const handleClearResident = () => {
    setSelectedResident(null);
    setLoading(false);
    setIsSaving(false);
    lastScrolledTargetYRef.current = -1;
    searchedTermRef.current = '';
    // Não limpamos recipientName e unitNumber para que o porteiro possa ver o que o OCR leu
    setSearchTerm('');
    setMatchingResidents([]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStep('analyzing');
    setLoading(true);
    setStatusMessage('Lendo nome...');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;

        setPhotoUrl(base64);
        setStep('analyzing');
        setStatusMessage('Buscando dados da etiqueta...');
        processImageWithWait(base64); 
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      feedback.error();
      toast.error('Erro ao carregar foto: ' + error.message);
      setStep('camera');
      setLoading(false);
    }
  };

  const resetForm = (stayInManual: boolean = false) => {
    // Invalida requisições assíncronas pendentes (OCR e Uploads)
    activeRequestIdRef.current++;
    lastScrolledTargetYRef.current = -1;
    searchedTermRef.current = '';

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
      try { URL.revokeObjectURL(objectUrlRef.current); } catch(e) {}
      objectUrlRef.current = null;
    }

    if (!stayInManual) {
      setStep('camera');
      setPhotoUrl('');
      currentPhotoRef.current = '';
      setDebugOcrImage(null);
      setShouldFocusSearch(false);
      setCameraError(null);
      setDetectedHandwrittenUnit(null);
      setShowResidencyAlert(false);
      setIgnoreResidencyAlert(false);
    }
    
    setSelectedResident(null);
    setRecipientName('');
    setUnitNumber('');
    setUnitType('');
    setCarrier('');
    setTrackingNumber('');
    setNotes('');
    setSearchTerm('');
    setIsBatch(false);
    setBatchQuantity(1);
    // No "next package" mode, we keep the unit search active
    setIsManualUnitSearch(true);
    setMatchingResidents([]);
    setPickupCode(generatePickupCode());
    setFoundPartialData(false);
    setIsAiSearch(false);
    setLoading(false);
    setIsSaving(false);
    setIsDetailsExpanded(true);
    setShowPickupCode(false);
    setIsOcrLoading(false);
    setOcrConfidence(null);
    setStatusMessage('Aguardando...');
    
    // REMOVIDO: Reinicialização automática da câmera
    // REMOVIDO: Foco automático no input para evitar abrir teclado
  };

  useEffect(() => {
    if (shouldFocusSearch && step === 'manual') {
      // Se o usuário já começou a digitar ou interagir, cancela o foco automático de background
      if (searchTerm.trim().length > 0) {
        setShouldFocusSearch(false);
        return;
      }

      const timer = setTimeout(() => {
        if (unitInputRef.current && searchTerm.trim().length === 0) {
          unitInputRef.current.focus();
        }
        setShouldFocusSearch(false);
      }, 40);
      return () => clearTimeout(timer);
    }
  }, [shouldFocusSearch, step, searchTerm]);


  useEffect(() => {
    if (selectedResident && detectedHandwrittenUnit && !ignoreResidencyAlert) {
      const normalizedDetected = normalizeUnit(detectedHandwrittenUnit).replace(/[^0-9]/g, '');
      const normalizedSelected = normalizeUnit(selectedResident.unidade || '').replace(/[^0-9]/g, '');
      
      if (normalizedDetected && normalizedSelected && normalizedDetected !== normalizedSelected) {
        setShowResidencyAlert(true);
      } else {
        setShowResidencyAlert(false);
      }
    } else {
      setShowResidencyAlert(false);
    }
  }, [selectedResident, detectedHandwrittenUnit, ignoreResidencyAlert]);

  // Removed: Auto-expand logic as it's now open by default
  const registrarEncomenda = async (e?: React.FormEvent, directResident?: Morador, shouldNotify: boolean = false) => {
    if (e) e.preventDefault();
    
    if (isSaving) return;

    const residentToUse = directResident || selectedResident;

    // Recurso EVITAR ERRO: Interceptar se houver divergência e o alerta não foi ignorado
    if (residentToUse && detectedHandwrittenUnit && !ignoreResidencyAlert) {
      const normalizedDetected = normalizeUnit(detectedHandwrittenUnit).replace(/[^0-9]/g, '');
      const normalizedSelected = normalizeUnit(residentToUse.unidade || '').replace(/[^0-9]/g, '');
      
      if (normalizedDetected && normalizedSelected && normalizedDetected !== normalizedSelected) {
        setShowResidencyAlert(true);
        // Se foi um clique direto na lista, selecionamos o morador mas NÃO salvamos ainda
        if (directResident) {
          handleSelectResident(directResident, false);
        }
        return;
      }
    }
    
    const targetResident = directResident || selectedResident;
    
    if (!targetResident || !user) {
      toast.error('Selecione um morador para salvar');
      return;
    }

    unitInputRef.current?.blur();
    setSelectedResident(targetResident);
    setRecipientName(targetResident.nome || '');
    setUnitNumber(targetResident.unidade || '');
    if (targetResident.unit_type) {
      setUnitType(targetResident.unit_type);
    }

    setLoading(true);
    setIsSaving(true);
    setStatusMessage('SALVANDO...');
    const toastId = toast.loading('Salvando encomenda...', { id: 'saving-package' });

    try {
      // 0. Garantir que a foto foi enviada (Prova Jurídica)
      let finalPhotoUrl = photoUrl;
      console.log("[SALVAMENTO] Iniciando com foto:", finalPhotoUrl?.substring(0, 50));
      
      if (finalPhotoUrl && (finalPhotoUrl.startsWith('data:') || finalPhotoUrl.startsWith('blob:')) && uploadPromiseRef.current) {
        setStatusMessage('FINALIZANDO FOTO...');
        const uploadedUrl = await uploadPromiseRef.current;
        if (uploadedUrl) {
          finalPhotoUrl = uploadedUrl;
          setPhotoUrl(uploadedUrl);
        }
      }

      // 1. Obter o usuário logado e tratar UUIDs de forma segura
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const condoId = sanitizeUuid(user?.condominium_id) || user?.condominium_id || '';
      const candidateUuid = (authUser?.id && isValidUuid(authUser.id)) 
        ? authUser.id 
        : (user?.id && isValidUuid(user.id) ? user.id : sanitizeUuid(user?.id));

      let validProfileId: string | null = null;
      if (candidateUuid) {
        try {
          const { data: prof } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', candidateUuid)
            .maybeSingle();
          if (prof?.id) {
            validProfileId = prof.id;
          }
        } catch (e) {
          console.warn("Verificação de perfil ignorada:", e);
        }
      }

      // 2. Verificar agrupamento (encomendas pendentes do mesmo morador)
      const { data: existingPackages } = await supabase
        .from('packages')
        .select('id, pickup_code, pickup_token')
        .eq('recipient_id', targetResident.id)
        .eq('status', 'received')
        .order('received_at', { ascending: false });

      const hasExisting = existingPackages && existingPackages.length > 0;
      const existingToken = existingPackages?.find(p => p.pickup_token)?.pickup_token;
      const existingCode = existingPackages?.find(p => p.pickup_code)?.pickup_code;

      const finalPickupCode = existingCode || pickupCode;
      const finalPickupToken = existingToken || (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
      const totalPackages = (existingPackages?.length || 0) + 1;

      // Se houver encomendas existentes, sincroniza códigos
      if (hasExisting) {
        await supabase
          .from('packages')
          .update({ 
            pickup_code: finalPickupCode, 
            pickup_token: finalPickupToken 
          })
          .eq('recipient_id', targetResident.id)
          .eq('status', 'received');
      }

      // 3. Preparar mensagem
      const isBatchNote = isBatch || batchQuantity > 1;
      const batchLabel = isBatchNote ? ` (Lote de ${batchQuantity} encomendas)` : '';
      const finalNotes = isBatchNote ? (notes ? `${notes}, Lote de ${batchQuantity} encomendas` : `Lote de ${batchQuantity} encomendas`) : notes;
      const isLargePackage = notes.includes('Encomenda grande (retirada imediata)');

      let directMessage = `Olá, ${targetResident.nome}! Sua encomenda chegou na portaria de ${condoName}. Código: ${finalPickupCode}${batchLabel}`;
      try {
        const prepared = prepareWhatsAppNotification(
          targetResident,
          condoName,
          finalPickupCode,
          finalNotes,
          finalPickupToken,
          totalPackages,
          'disponivel',
          undefined,
          undefined,
          finalPhotoUrl,
          isLargePackage
        );
        if (prepared) directMessage = prepared;
      } catch (e) {
        console.error("Erro ao preparar mensagem:", e);
      }

      // 4. Montar objeto da encomenda (Campos mínimos obrigatórios e estáveis)
      const hasValidPhone = !!(targetResident.telefone && targetResident.telefone.replace(/\D/g, '').length >= 10);
      const shouldOpenWhatsAppNow = hasValidPhone && !notifyAfter;
      
      const packageData: any = {
        condominium_id: condoId,
        recipient_id: targetResident.id,
        unit_number: unitNumber || targetResident.unidade || '',
        carrier: carrier || '',
        tracking_code: trackingNumber || '',
        notes: finalNotes || '',
        photo_url: finalPhotoUrl || '',
        recebido_por: (currentPorterState && currentPorterState !== 'Selecione o Porteiro') ? currentPorterState : (user?.full_name || 'Porteiro'),
        porter_name: (currentPorterState && currentPorterState !== 'Selecione o Porteiro') ? currentPorterState : (user?.full_name || 'Porteiro'),
        received_at: new Date().toISOString(),
        pickup_code: finalPickupCode,
        pickup_token: finalPickupToken,
        status: 'received',
        whatsapp_notified: shouldOpenWhatsAppNow, 
        whatsapp_sent: shouldOpenWhatsAppNow,
        whatsapp_status: shouldOpenWhatsAppNow ? 'enviado' : (targetResident.telefone ? 'pending' : 'no_recipient'),
        whatsapp_message: directMessage
      };

      if (validProfileId) {
        packageData.received_by = validProfileId;
        packageData.registered_by = validProfileId;
      }

      console.log("[SALVAMENTO] Objeto final:", packageData);

      let insertResult = await supabase
        .from('packages')
        .insert([packageData])
        .select('*')
        .single();

      if (insertResult.error && (insertResult.error.code === '23503' || insertResult.error.message?.includes('foreign key constraint'))) {
        console.warn("[FALLBACK] Falha de chave estrangeira em received_by/registered_by. Tentando salvar com autor em texto:", insertResult.error);
        const fallbackData = { ...packageData };
        delete fallbackData.received_by;
        delete fallbackData.registered_by;
        insertResult = await supabase
          .from('packages')
          .insert([fallbackData])
          .select('*')
          .single();
      }

      if (insertResult.error) {
        console.error("[ERRO_CRITICO] Falha ao inserir no banco:", insertResult.error);
        throw new Error(insertResult.error.message);
      }

      const newPackage = insertResult.data;

      console.log("[SUCESSO] Encomenda salva com ID:", newPackage.id);

      // 5. Notificação via WhatsApp Z-API (Se configurado)
      if (!notifyAfter && targetResident.telefone) {
        const apiActive = condoSettings?.whatsapp_mode === 'api_automatica' && 
                        condoSettings?.api_url && 
                        condoSettings?.api_token;

        if (apiActive) {
          try {
            await sendWhatsAppMessage(targetResident.telefone, directMessage, user.condominium_id, {
              api_url: condoSettings?.api_url,
              api_token: condoSettings?.api_token,
              instance_id: condoSettings?.instance_id,
              whatsapp_provider: condoSettings?.whatsapp_provider,
              photo_url: finalPhotoUrl
            });
            
            await supabase
              .from('packages')
              .update({ 
                whatsapp_status: 'enviado', 
                whatsapp_notified: true,
                whatsapp_sent: true,
                notified_at: new Date().toISOString(),
                last_notification_at: new Date().toISOString(),
                whatsapp_sent_at: new Date().toISOString()
              })
              .eq('id', newPackage.id);
          } catch (err) {
            console.error('Erro no envio automático:', err);
          }
        }
      }

      // 6. Auditoria
      try {
        await registrarAuditoria({
          condominio_id: user?.condominium_id || '',
          usuario_id: user?.id || '',
          usuario_nome: user?.full_name || 'Porteiro',
          usuario_perfil: user?.role || 'porteiro',
          tipo_evento: 'ENCOMENDA_CADASTRADA',
          acao: 'CREATE',
          tabela_afetada: 'encomendas',
          registro_id: newPackage.id,
          descricao: `Encomenda registrada para ${targetResident.nome} - ${targetResident.unidade}`,
          metodo: finalPhotoUrl ? 'FOTO' : 'MANUAL'
        });
      } catch (logErr) {
        console.warn('Erro ao logar ação:', logErr);
      }

      // 7. Sucesso e Feedback
      playSuccessSound();
      toast.success('Encomenda registrada com sucesso!', { id: toastId, icon: '📦' });
      
      // ENVIO AUTOMÁTICO VIA LINK (SOLICITAÇÃO DO USUÁRIO)
      if (shouldOpenWhatsAppNow) {
        try {
          whatsAppOpenedTimeRef.current = Date.now();
          hasBeenHiddenRef.current = false;
          setIsWaitingForReturn(true);
          const link = getWhatsAppLink(targetResident.telefone, directMessage, finalPhotoUrl);
          window.open(link, '_blank');
        } catch (linkErr) {
          console.error('Erro ao abrir link do WhatsApp:', linkErr);
        }
      } else {
        // FLUXO DE ESTABILIDADE: Highlight, Scroll e Reset para a próxima encomenda apenas se NÃO abriu o WhatsApp
        setIsHighlighting(true);
        setTimeout(() => setIsHighlighting(false), 1000);
        setBlockAutoCamera(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        resetForm();
      }
    } catch (error: any) {
      console.error('Erro ao registrar encomenda:', error);
      feedback.error();
      toast.error('Erro ao salvar: ' + (error.message || 'Verifique sua conexão'), { id: toastId });
    } finally {
      setLoading(false);
      setIsSaving(false);
      setStatusMessage('');
    }
  };

  const toggleObservation = (obs: string) => {
    if (notes.includes(obs)) {
      setNotes(notes.replace(obs, '').replace(/,\s*,/, ',').replace(/^,\s*/, '').replace(/,\s*$/, '').trim());
    } else {
      setNotes(notes ? `${notes}, ${obs}` : obs);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center overflow-x-hidden">
      <div className="w-full max-w-[480px] bg-gray-50 min-h-screen relative flex flex-col shadow-2xl overflow-x-hidden">
        {/* Header */}
        <div className="bg-white border-b sticky top-0 z-10 w-full">
          <div className="px-4 h-16 flex items-center justify-between">
            <button 
              onClick={() => {
                setLoading(false);
                setIsSaving(false);
                setIsOcrLoading(false);
                if (photoUrl) {
                  setPhotoUrl('');
                  setDebugOcrImage(null);
                  setStep('camera');
                  startCamera();
                } else if (step === 'manual') {
                  resetForm();
                } else {
                  navigate('/portaria');
                }
              }}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-gray-600" />
            </button>
            <h1 className="text-base font-semibold text-gray-900 leading-tight text-center flex-1 mx-2">
              <span className="block truncate">
                {step === 'manual' ? 'Novo Registro' : step === 'analyzing' ? 'Analisando Etiqueta' : 'Capturar Etiqueta'}
              </span>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <button
                  type="button"
                  onClick={() => setShowPorterModal(true)}
                  className={`text-[9.5px] font-bold uppercase tracking-tight whitespace-nowrap px-3 py-1 rounded-full border transition-all active:scale-95 cursor-pointer ${
                    currentPorterState === 'Selecione o Porteiro' 
                      ? 'text-amber-600 bg-amber-50 border-amber-200 animate-pulse' 
                      : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  }`}
                >
                  {currentPorterState === 'Selecione o Porteiro' ? '👤 SELECIONE O PORTEIRO' : `👤 ${currentPorterState.toUpperCase()}`}
                </button>
              </div>
              <div className="mt-1 text-[8px] text-gray-400 font-medium uppercase tracking-[0.2em]">
                Fluxo Rápido
              </div>
            </h1>
            <div className="w-10" />
          </div>
        </div>

        <div className={`flex-1 px-4 py-6 ${isUnitInputFocused ? 'pb-[400px]' : ''}`}>
        <AnimatePresence mode="wait">
          {step === 'analyzing' && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[60vh] space-y-8"
            >
              <div className="relative">
                <div className="w-32 h-32 border-4 border-indigo-100 rounded-full flex items-center justify-center">
                  <div className="w-24 h-24 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-indigo-600 animate-pulse" />
                </div>
              </div>
              
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-black text-indigo-900 uppercase tracking-tighter">Lendo Encomenda</h2>
                <p className="text-gray-500 font-medium animate-pulse">{statusMessage}</p>
              </div>

              {photoUrl && (
                <div className="w-48 aspect-square rounded-3xl overflow-hidden border-4 border-white shadow-2xl relative">
                  <img src={photoUrl} alt="Preview" className="w-full h-full object-cover blur-[2px] opacity-50" />
                  <div className="absolute inset-0 bg-indigo-600/20 mix-blend-overlay" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-1 bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.8)] animate-[scan_2s_ease-in-out_infinite]" />
                  </div>
                </div>
              )}
              
              <button 
                onClick={() => setStep('manual')}
                className="text-indigo-600 font-bold text-xs uppercase tracking-widest hover:underline"
              >
                Pular e digitar manual
              </button>
            </motion.div>
          )}

          {step === 'camera' && (
            <motion.div
              key="camera"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="aspect-[3/4] bg-gray-900 flex flex-col items-center justify-center relative">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Flash Effect na Captura */}
                  <AnimatePresence>
                    {isCapturing && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.1 }}
                        className="absolute inset-0 bg-white z-[100]"
                      />
                    )}
                  </AnimatePresence>

                  {/* Feedback "Foto Capturada" */}
                  <AnimatePresence>
                    {showCaptureFeedback && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="absolute inset-0 z-[110] flex items-center justify-center bg-emerald-500/90 backdrop-blur-sm"
                      >
                        <div className="flex flex-col items-center gap-3 text-white">
                          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center">
                            <CheckCircle className="w-10 h-10" />
                          </div>
                          <p className="text-xl font-black uppercase tracking-widest">Foto capturada ✔</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Camera Error Message */}
                  {cameraError && (
                    <div className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 sm:p-8 pb-20 sm:pb-8">
                      <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-xs w-full text-center space-y-6 transform -translate-y-12 sm:translate-y-0">
                        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                          <AlertCircle className="w-10 h-10 text-red-500" />
                        </div>
                        <p className="text-gray-900 font-bold leading-tight">{cameraError}</p>
                        <div className="space-y-3">
                          {window.self !== window.top && (
                            <a
                              href={window.location.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 transition-all active:scale-95 text-sm cursor-pointer"
                            >
                              <ExternalLink className="w-5 h-5" />
                              ABRIR EM NOVA ABA
                            </a>
                          )}
                          <button
                            onClick={startCamera}
                            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 transition-all active:scale-95 text-sm"
                          >
                            <Zap className="w-5 h-5" />
                            TENTAR ABRIR CÂMERA
                          </button>
                          <button
                            onClick={() => {
                              setCameraError(null);
                              setStep('manual');
                            }}
                            className="w-full py-4 bg-gray-100 text-gray-700 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-all active:scale-95 text-sm"
                          >
                            <FileText className="w-5 h-5" />
                            USAR MODO MANUAL
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!cameraActive && !cameraError && (
                    <div className="absolute inset-0 bg-gray-900 flex items-center justify-center overflow-hidden">
                      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500 via-transparent to-transparent animate-pulse" />
                      <div className="text-center relative z-10 px-8">
                        <div className="w-20 h-20 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                          <Camera className="w-10 h-10 text-indigo-400" />
                        </div>
                        <h3 className="text-white font-black text-xl uppercase tracking-widest mb-2">Pronto para Capturar</h3>
                        <p className="text-indigo-200 text-sm opacity-60">Toque no botão abaixo para iniciar a câmera</p>
                      </div>
                    </div>
                  )}

                  {cameraActive && (
                    <button
                      onClick={toggleFlash}
                      className="absolute top-4 right-4 p-3 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors z-20"
                      type="button"
                    >
                      {flashOn ? <Zap className="w-6 h-6 text-yellow-400 fill-yellow-400" /> : <ZapOff className="w-6 h-6" />}
                    </button>
                  )}

                  {/* Overlay removido conforme solicitação */}


                  <div className="absolute bottom-8 left-0 right-0 flex justify-center px-8 gap-4">
                    <motion.button
                      onClick={cameraActive ? capturePhoto : startCamera}
                      animate={isHighlighting ? { scale: [1, 1.1, 1], boxShadow: ["0 0 0px rgba(79,70,229,0)", "0 0 20px rgba(79,70,229,0.5)", "0 0 0px rgba(79,70,229,0)"] } : {}}
                      transition={{ duration: 0.5, repeat: 1 }}
                      disabled={(cameraActive && (isCameraStabilizing || isOcrLoading)) || isSaving}
                      className={`w-28 h-28 bg-white rounded-full flex flex-col items-center justify-center shadow-2xl active:scale-95 transition-all border-8 border-gray-100 ${
                        (cameraActive && (isCameraStabilizing || isOcrLoading)) || isSaving ? 'opacity-50' : 'opacity-100'
                      } ${isHighlighting ? 'ring-4 ring-indigo-500 ring-offset-4' : ''}`}
                    >
                      {(cameraActive && (isCameraStabilizing || isOcrLoading)) ? (
                         <div className="w-10 h-10 border-4 border-gray-100 rounded-full border-t-indigo-600 animate-spin" />
                      ) : (
                         <>
                           <Camera className={`w-8 h-8 mb-1 ${cameraActive ? 'text-indigo-600' : 'text-gray-900'}`} />
                           <span className="text-[10px] font-black text-gray-900 uppercase tracking-tighter">
                             {cameraActive ? 'CAPTURAR' : 'TIRAR FOTO'}
                           </span>
                         </>
                      )}
                    </motion.button>
                  </div>

                  <canvas ref={canvasRef} className="hidden" />
                </div>
                
                  <div className="p-6 bg-gray-50 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setLoading(false);
                        setIsSaving(false);
                        setIsOcrLoading(false);
                        setStep('manual');
                      }}
                      className="text-gray-500 font-medium hover:text-gray-700 flex items-center gap-2"
                    >
                      <FileText className="w-5 h-5" />
                      Pular para Busca
                    </button>
                    <div className="flex items-center gap-2 text-indigo-600 font-semibold">
                      <Zap className="w-5 h-5" />
                      Assistente IA
                    </div>
                  </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3">
                <Info className="w-5 h-5 text-amber-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-amber-800 font-medium">
                    Certifique-se de que o nome do morador e a unidade estejam bem visíveis na foto.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {(step === 'confirmation' || step === 'manual') && (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Photo Preview or Capture option */}
              {photoUrl ? (
                <div className="relative rounded-2xl overflow-hidden aspect-video bg-gray-100 border border-gray-200 shadow-sm">
                  <img 
                    src={photoUrl} 
                    alt="Encomenda" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-4">
                    <div className="flex items-center gap-2 text-white">
                      <Camera className="w-4 h-4" />
                      <span className="text-xs font-medium">Foto capturada</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); resetForm(); }}
                    className="absolute top-2 right-2 p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-lg hover:bg-white transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setStep('camera');
                      startCamera();
                    }}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-black/40 backdrop-blur-sm rounded-lg text-[10px] text-white font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-black/60 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Tirar nova foto
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setStep('camera');
                    startCamera();
                  }}
                  className="w-full py-4 border-2 border-dashed border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 rounded-2xl flex items-center justify-center gap-2 text-indigo-600 font-bold transition-all shadow-sm active:scale-[0.99]"
                >
                  <Camera className="w-5 h-5 text-indigo-600" />
                  <span>Tirar foto da encomenda</span>
                </button>
              )}

              <form id="package-form" onSubmit={(e) => e.preventDefault()} className="space-y-6">
                {/* Resident Selection */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
                        <User className="w-5 h-5 text-indigo-600" />
                      </div>
                      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Quem está recebendo?</h2>
                    </div>
                    {selectedResident && (
                      <button
                        type="button"
                        onClick={handleClearResident}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                      >
                        ALTERAR
                      </button>
                    )}
                  </div>

                  {!selectedResident ? (
                    <div className="space-y-4">
                      {isOcrLoading && (
                        <div className="flex items-center gap-2 mb-2 animate-pulse">
                          <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">{statusMessage}</span>
                        </div>
                      )}


                          {ocrConfidence === 'baixa' && matchingResidents.length > 0 && (
                            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                              <p className="text-xs text-amber-800 font-medium">Possível leitura parcial. Verifique se o morador está na lista abaixo.</p>
                            </div>
                          )}
                      <div className="flex items-center gap-2 mb-4">
                        <button
                          type="button"
                          onClick={() => {
                            setIsManualUnitSearch(true);
                            setSearchTerm('');
                            setIsAiSearch(false);
                          }}
                          className={`flex-1 py-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            isManualUnitSearch 
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' 
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          <Hash className="w-4 h-4" />
                          Por nº da Casa
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsManualUnitSearch(false);
                            setSearchTerm('');
                            setIsAiSearch(false);
                          }}
                          className={`flex-1 py-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            !isManualUnitSearch 
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' 
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          <User className="w-4 h-4" />
                          Por Nome
                        </button>
                      </div>

                      {/* Batch Registration Selector */}
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Truck className="w-5 h-5 text-indigo-600" />
                          <div>
                            <p className="text-xs font-bold text-indigo-900 uppercase tracking-tight">Registro em Lote</p>
                            <p className="text-[10px] text-indigo-600">Várias encomendas juntas</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setBatchQuantity(Math.max(1, batchQuantity - 1))}
                            className="w-10 h-10 bg-white border border-indigo-200 rounded-xl flex items-center justify-center text-indigo-600 font-bold active:scale-90"
                          >
                            -
                          </button>
                          <span className="text-xl font-black text-indigo-900 w-6 text-center">{batchQuantity}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setBatchQuantity(batchQuantity + 1);
                              setIsBatch(true);
                            }}
                            className="w-10 h-10 bg-white border border-indigo-200 rounded-xl flex items-center justify-center text-indigo-600 font-bold active:scale-90"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div ref={residentsSectionRef} className="relative mb-6">
                        {isManualUnitSearch ? (
                           <div className="relative">
                             <div className="absolute left-6 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
                               <Hash className="w-5 h-5 text-indigo-400" />
                             </div>
                             <input
                               ref={unitInputRef}
                               type="tel"
                               inputMode="numeric"
                               autoFocus
                               placeholder="Casa / Unidade..."
                               value={searchTerm}
                               onChange={(e) => setSearchTerm(e.target.value)}
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   e.preventDefault();
                                   e.stopPropagation();
                                   unitInputRef.current?.blur();
                                 }
                               }}
                               onFocus={() => setIsUnitInputFocused(true)}
                               onBlur={() => setIsUnitInputFocused(false)}
                               className="w-full pl-16 pr-4 py-5 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl transition-all outline-none text-2xl font-black text-indigo-900 placeholder:text-gray-300"
                             />
                           </div>
                        ) : (
                          <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                              ref={unitInputRef}
                              type="text"
                              placeholder="Pesquisar nome do morador..."
                              value={searchTerm}
                              onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setIsAiSearch(false);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  unitInputRef.current?.blur();
                                }
                              }}
                              className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl transition-all outline-none text-lg text-gray-900 placeholder:text-gray-400"
                            />
                          </div>
                        )}
                      </div>

                      {/* Loading indicator while searching */}
                      {isSearchingResidents && (
                        <div className="flex items-center gap-2 py-3 px-4 bg-indigo-50/80 rounded-xl mb-4 border border-indigo-100 text-indigo-700 font-bold text-xs animate-pulse">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                          <span>Localizando morador da {isManualUnitSearch ? `unidade ${searchTerm}` : `busca '${searchTerm}'`}...</span>
                        </div>
                      )}

                      {/* Search Results / Intelligent Suggestions */}
                      {!isSearchingResidents && matchingResidents.length > 0 && (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 pb-2 scroll-smooth custom-scrollbar">
                          <div className="flex items-center gap-2 px-1 mb-2">
                             <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                               {isManualUnitSearch ? `Moradores da Casa ${searchTerm}` : (!searchTerm ? 'Moradores (A-Z)' : 'Moradores sugeridos')}
                             </p>
                          </div>
                          
                          {matchingResidents.slice(0, 10).map((item, index) => {
                            if (!item || !item.resident) return null;
                            const { resident, score } = item;
                            const isBest = !!(searchTerm && index === 0 && score >= 70);
                            
                            return (
                              <button
                                key={resident.id}
                                type="button"
                                onClick={() => {
                                  registrarEncomenda(undefined, resident, false);
                                }}
                                className={`w-full relative flex flex-col p-4 rounded-2xl transition-all border-2 text-left outline-none hover:shadow-lg active:scale-[0.98] cursor-pointer touch-manipulation group ${
                                  isBest 
                                    ? (isFemale(resident.nome) ? 'bg-violet-50 border-violet-200 shadow-md ring-1 ring-violet-200' : 'bg-indigo-50 border-indigo-200 shadow-md ring-1 ring-indigo-200')
                                    : (isFemale(resident.nome) ? 'bg-white border-gray-100 hover:border-violet-200 hover:bg-violet-50' : 'bg-white border-gray-100 hover:border-indigo-100 hover:bg-gray-50')
                                }`}
                              >
                                {isBest && (
                                  <div className="absolute -top-2.5 right-4 z-10">
                                    <span className={`px-3 py-1 text-[10px] font-black rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm ${
                                      isFemale(resident.nome) ? 'bg-violet-500 text-white' : 'bg-emerald-500 text-white'
                                    }`}>
                                      <CheckCircle className="w-3 h-3" />
                                      Mais provável
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center gap-4 mb-3">
                                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border shadow-sm shrink-0 transition-colors ${
                                    isBest 
                                      ? (isFemale(resident.nome) ? 'bg-violet-500 border-violet-400' : 'bg-indigo-600 border-indigo-500')
                                      : (isFemale(resident.nome) ? 'bg-violet-50 border-violet-100' : 'bg-gray-50 border-gray-100')
                                  }`}>
                                    <User className={`w-6 h-6 ${isBest ? 'text-white' : (isFemale(resident.nome) ? 'text-violet-400' : 'text-gray-400')}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="font-bold text-lg text-gray-900 leading-tight truncate">
                                        {resident.nome}
                                      </p>
                                    </div>
                                    <p className={`text-sm font-semibold flex items-center gap-1.5 ${
                                      isBest 
                                        ? (isFemale(resident.nome) ? 'text-violet-700' : 'text-indigo-700') 
                                        : 'text-gray-500'
                                    }`}>
                                      <Building2 className="w-3.5 h-3.5" />
                                      {formatResidentAddress(resident)}
                                    </p>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-400" />
                                </div>

                                {resident.telefone && (
                                  <div className={`mt-1 pt-2 border-t flex items-center gap-2 text-xs ${
                                    isBest ? 'border-indigo-100/50 text-indigo-400' : 'border-gray-50 text-gray-400'
                                  }`}>
                                    <Zap className="w-3 h-3" />
                                    <span>Possui WhatsApp: {resident.telefone}</span>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      
                      {!isSearchingResidents && searchTerm.trim().length >= 1 && matchingResidents.length === 0 && (
                        <div className="py-6 space-y-4">
                          <div className="bg-white rounded-2xl p-6 border-2 border-dashed border-gray-200 text-center">
                            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3 text-amber-600">
                              <Search className="w-6 h-6" />
                            </div>
                            <h3 className="text-gray-900 font-bold mb-1 text-base">
                              {isManualUnitSearch 
                                ? `Nenhum morador encontrado na unidade ${searchTerm}`
                                : `Nenhum morador encontrado para "${searchTerm}"`}
                            </h3>
                            <p className="text-gray-500 text-xs mb-5">
                              Verifique se o número foi digitado corretamente ou escolha uma das opções:
                            </p>
                            
                            <div className="grid grid-cols-1 gap-3">
                              {isManualUnitSearch ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsManualUnitSearch(false);
                                    setSearchTerm('');
                                  }}
                                  className="flex items-center justify-center gap-3 w-full py-3.5 bg-indigo-50 text-indigo-700 rounded-xl font-bold hover:bg-indigo-100 transition-all border border-indigo-100 text-xs"
                                >
                                  <Search className="w-4 h-4" />
                                  Buscar pelo Nome do Morador
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsManualUnitSearch(true);
                                    setSearchTerm('');
                                  }}
                                  className="flex items-center justify-center gap-3 w-full py-3.5 bg-emerald-50 text-emerald-700 rounded-xl font-bold hover:bg-emerald-100 transition-all border border-emerald-100 text-xs"
                                >
                                  <Hash className="w-4 h-4" />
                                  Buscar pelo Número da Casa
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="flex items-center justify-center gap-3 w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-xs"
                              >
                                Limpar Busca
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Card do Morador Selecionado (Informative status layout) */}
                      <div
                        className={`w-full px-4 py-5 rounded-2xl border-2 flex items-center justify-between shadow-sm text-left ${
                          isFemale(selectedResident.nome) 
                            ? 'bg-violet-50 border-violet-100 text-violet-900' 
                            : 'bg-indigo-50 border-indigo-100 text-indigo-900'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                            isFemale(selectedResident.nome) ? 'bg-violet-100 border-violet-200' : 'bg-indigo-100 border-indigo-200'
                          }`}>
                            <User className={`w-5 h-5 ${isFemale(selectedResident.nome) ? 'text-violet-500' : 'text-indigo-600'}`} />
                          </div>
                          <div>
                            <p className="font-bold text-sm leading-none mb-1">{selectedResident.nome}</p>
                            <p className="text-[10px] font-medium opacity-70 mb-0.5">{formatResidentAddress(selectedResident)}</p>
                            <p className={`text-[9px] font-black uppercase tracking-widest ${isFemale(selectedResident.nome) ? 'text-violet-400' : 'text-indigo-400'}`}>Morador Selecionado</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => triggerWhatsAppForResident(selectedResident)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all shadow-sm flex items-center gap-1 text-xs font-bold"
                            title="Notificar no WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                            <span>WhatsApp</span>
                          </button>
                          <CheckCircle className={`w-5 h-5 ${isFemale(selectedResident.nome) ? 'text-violet-400' : 'text-indigo-400'}`} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Package Details */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="space-y-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-emerald-600" />
                      </div>
                      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Tipo do Pacote 📦</h2>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Observações Rápidas
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {QUICK_OBSERVATIONS.map((obs) => (
                            <button
                              key={obs}
                              type="button"
                              onClick={() => toggleObservation(obs)}
                              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                notes.includes(obs)
                                  ? 'bg-indigo-600 text-white shadow-md'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {obs}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Outras Observações
                        </label>
                        <div className="relative">
                          <FileText className="absolute top-3 left-3 h-4 w-4 text-gray-400" />
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            placeholder="Detalhes adicionais do pacote..."
                            className="block w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none text-sm text-gray-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* MODO DE NOTIFICAÇÃO - Versão padronizada e legível (Compacta) */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 py-3 px-6 mb-4 flex flex-col justify-center min-h-[64px]">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-1.5 text-center">
                    Modo de Notificação
                  </h3>
                  
                  <div className="flex items-center justify-between gap-4">
                    <button 
                      type="button"
                      onClick={() => {
                        setNotifyAfter(false);
                        if (navigator.vibrate) navigator.vibrate(10);
                      }}
                      className={`flex-1 text-center transition-all ${!notifyAfter ? 'opacity-100' : 'opacity-20'}`}
                    >
                      <p className={`text-[12px] font-black uppercase transition-colors ${!notifyAfter ? 'text-indigo-600' : 'text-gray-900'}`}>
                        AUTOMÁTICO
                      </p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-0">
                        Notificar agora
                      </p>
                    </button>

                    <div 
                      className="relative w-20 h-10 bg-gray-100 rounded-full cursor-pointer p-1 shadow-inner shrink-0 flex items-center"
                      onClick={() => {
                        setNotifyAfter(!notifyAfter);
                        if (navigator.vibrate) navigator.vibrate(15);
                      }}
                    >
                      <motion.div
                        initial={false}
                        animate={{ x: notifyAfter ? 40 : 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className={`w-8 h-8 rounded-full shadow-md flex items-center justify-center transition-colors relative z-10 ${notifyAfter ? 'bg-orange-600' : 'bg-indigo-600'}`}
                      >
                        <ArrowRight className="w-4 h-4 text-white" />
                      </motion.div>
                    </div>

                    <button 
                      type="button"
                      onClick={() => {
                        setNotifyAfter(true);
                        if (navigator.vibrate) navigator.vibrate(10);
                      }}
                      className={`flex-1 text-center transition-all ${notifyAfter ? 'opacity-100' : 'opacity-20'}`}
                    >
                      <p className={`text-[12px] font-black uppercase transition-colors ${notifyAfter ? 'text-orange-600' : 'text-gray-900'}`}>
                        EM LOTE
                      </p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-0">
                        Avisar depois
                      </p>
                    </button>
                  </div>
                </div>

                {/* Pickup Code Compact Toggle */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-2">
                  <button
                    type="button"
                    onClick={() => setShowPickupCode(!showPickupCode)}
                    className="w-full flex items-center justify-between px-2 group transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 group-hover:text-gray-600 transition-colors">
                        {showPickupCode ? '🔓' : '🔒'}
                      </span>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest group-hover:text-gray-600 transition-colors">
                        Código de retirada
                      </span>
                    </div>
                    <AnimatePresence mode="wait">
                      {showPickupCode ? (
                        <motion.span
                          key="code-visible"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.15 }}
                          className="text-lg font-black text-indigo-600 tracking-widest"
                        >
                          {pickupCode}
                        </motion.span>
                      ) : (
                        <motion.span
                          key="code-hidden"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="w-8 h-1.5 bg-gray-100 rounded-full"
                        />
                      )}
                    </AnimatePresence>
                  </button>
                </div>

                {/* Final Actions - SALVAR ENCOMENDA appears when resident is selected */}
                {selectedResident && (
                  <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-gray-200 z-50 animate-in fade-in slide-in-from-bottom-5">
                    <div className="max-w-2xl mx-auto">
                      <button
                        type="button"
                        disabled={loading || isOcrLoading}
                        onClick={() => registrarEncomenda(undefined, undefined, false)}
                        className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all disabled:opacity-50 active:scale-[0.98]"
                      >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        SALVAR ENCOMENDA
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* RECURSO EVITAR ERRO: Alerta de Divergência de Residência */}
        <AnimatePresence>
          {showResidencyAlert && (
            <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white rounded-[32px] shadow-2xl border-4 border-red-100 max-w-sm w-full overflow-hidden"
              >
                <div className="bg-red-50 p-8 flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6 shadow-inner animate-pulse">
                    <AlertCircle className="w-10 h-10" />
                  </div>
                  <h3 className="text-2xl font-black text-red-900 mb-2 leading-tight uppercase tracking-tight">
                    RESIDÊNCIA NÃO CONFERE
                  </h3>
                  <p className="text-red-700 font-medium mb-6">
                    O número capturado na foto parece ser diferente do selecionado.
                  </p>

                  <div className="w-full grid grid-cols-2 gap-4 mb-8">
                    <div className="bg-white rounded-2xl p-4 border border-red-100 shadow-sm">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Na Foto</p>
                      <p className="text-2xl font-black text-red-600 font-mono">{detectedHandwrittenUnit}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-4 border border-zinc-100 shadow-sm">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Digitado</p>
                      <p className="text-2xl font-black text-zinc-900 font-mono">{(selectedResident || matchingResidents[0]?.resident)?.unidade}</p>
                    </div>
                  </div>

                  <p className="text-xs text-red-500 font-bold uppercase tracking-widest mb-8">Verifique antes de registrar.</p>

                  <div className="flex flex-col gap-3 w-full">
                    <button
                      onClick={() => {
                        setShowResidencyAlert(false);
                        handleClearResident();
                        setIsManualUnitSearch(true);
                        setSearchTerm('');
                        setTimeout(() => unitInputRef.current?.focus(), 300);
                      }}
                      className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold text-lg hover:bg-red-700 transition-all shadow-lg shadow-red-200 active:scale-95 flex items-center justify-center gap-2"
                    >
                      CORRIGIR NÚMERO
                    </button>
                    <button
                      onClick={() => {
                        setIgnoreResidencyAlert(true);
                        setShowResidencyAlert(false);
                        // Tenta registrar novamente agora que ignore está true
                        setTimeout(() => {
                           if (selectedResident) registrarEncomenda(undefined, selectedResident, false);
                        }, 100);
                      }}
                      className="w-full py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95"
                    >
                      CONTINUAR MESMO ASSIM
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showPorterModal && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl relative border border-zinc-100"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-zinc-900">Selecionar Porteiro</h3>
                  <button 
                    type="button" 
                    onClick={() => setShowPorterModal(false)} 
                    className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-400 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {portersList.length === 0 ? (
                    <div className="p-4 text-center bg-zinc-50 rounded-2xl text-zinc-500 text-sm">
                      <p className="font-semibold">Nenhum porteiro cadastrado neste condomínio.</p>
                      <p className="text-xs text-zinc-400 mt-1">Cadastre porteiros no menu "Usuários".</p>
                    </div>
                  ) : (
                    portersList.map((porter) => (
                      <button
                        type="button"
                        key={porter.id}
                        onClick={() => {
                          setCurrentPorterState(porter.full_name);
                          setManualPorter(porter.full_name, user?.condominium_id);
                          setShowPorterModal(false);
                          toast.success(`Porteiro alterado para ${porter.full_name}`);
                        }}
                        className={`w-full py-4 px-6 rounded-2xl font-bold transition-all text-left flex items-center justify-between border cursor-pointer ${
                          currentPorterState === porter.full_name 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                            : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-zinc-100 hover:border-zinc-200'
                        }`}
                      >
                        {porter.full_name}
                        {currentPorterState === porter.full_name && <Check className="w-5 h-5 text-emerald-600" />}
                      </button>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowPorterModal(false)}
                  className="w-full mt-6 py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all cursor-pointer"
                >
                  FECHAR
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  </div>
);
}