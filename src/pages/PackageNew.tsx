import React, { useState, useEffect, useRef } from 'react';
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
  ExternalLink
} from 'lucide-react';
import { feedback } from '../lib/feedback';
import { supabase } from '../lib/supabase';
import { Profile, Morador, CondominiumSettings } from '../types';
import toast from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { getCurrentPorter } from '../lib/porterUtils';
import { extractBasicText } from '../services/geminiService';
import { parseLabelText } from '../services/labelParser';
import { findMatchingResidents, ScoredResident, normalizeUnit, normalizeName } from '../services/residentMatcher';
import { formatResidentAddress } from '../lib/residentUtils';
import { motion, AnimatePresence } from 'motion/react';
import { generatePickupCode, prepareWhatsAppNotification, sendWhatsAppMessage, getWhatsAppLink } from '../services/whatsappService';

interface PackageNewProps {
  user: Profile;
}

type Step = 'camera' | 'manual' | 'analyzing';

const QUICK_OBSERVATIONS = [
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

  // Detect context return for individual flow
  useEffect(() => {
    const handleFocus = () => {
      if (isWaitingForReturn) {
        setIsWaitingForReturn(false);
        resetForm();
        // Feedback visual de que está pronto para o próximo
        toast.success('Câmera aberta para o próximo registro', { icon: '📸' });
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
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
      if (residentsList) setAllResidents(residentsList);
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

  // Fetch all residents for AI context
  useEffect(() => {
    const fetchAllResidents = async () => {
      if (!user?.condominium_id) return;
      const { data, error } = await supabase
        .from('moradores')
        .select('nome, unidade')
        .eq('condominium_id', user.condominium_id)
        .eq('ativo', true);
      
      if (!error && data) {
        setAllCondoResidents(data as Morador[]);
      }
    };
    
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

    fetchAllResidents();
    fetchCondoName();
  }, [user?.condominium_id]);

  const startCamera = async () => {
    // 1. Verificar suporte
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Câmera não suportada neste dispositivo.");
      return;
    }

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
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
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
    
    // Feedback visual imediato (flash)
    setIsCapturing(true);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Resolução otimizada para precisão OCR (máximo 1600px conforme solicitado)
    const MAX_DIMENSION = 1600; 
    let width = video.videoWidth;
    let height = video.videoHeight;
    
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    if (ratio < 1) {
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;
    
    const context = canvas.getContext('2d', { alpha: false });
    if (context) {
      // Captura de alta fidelidade para armazenamento
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, width, height);
      const base64 = canvas.toDataURL('image/jpeg', 0.90);

      // Captura de baixa resolução para OCR (Alta velocidade e foco no essencial)
      const OCR_MAX = 600; 
      let ocrWidth = video.videoWidth;
      let ocrHeight = video.videoHeight;
      const ocrRatio = Math.min(OCR_MAX / ocrWidth, OCR_MAX / ocrHeight);
      ocrWidth = Math.round(ocrWidth * ocrRatio);
      ocrHeight = Math.round(ocrHeight * ocrRatio);

      const ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = ocrWidth;
      ocrCanvas.height = ocrHeight;
      const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
      let ocrBase64 = base64; // Fallback
      if (ocrCtx) {
        ocrCtx.imageSmoothingEnabled = true;
        ocrCtx.imageSmoothingQuality = 'medium';
        ocrCtx.drawImage(video, 0, 0, ocrWidth, ocrHeight);
        ocrBase64 = ocrCanvas.toDataURL('image/jpeg', 0.70);
      }
      
      // Mudar fluxo IMEDIATAMENTE para manual
      stopCamera();
      setPhotoUrl(base64);
      currentPhotoRef.current = base64;
      setDebugOcrImage(ocrBase64); 
      setIsOcrLoading(false);
      setStatusMessage('Entrada Manual');
      setIsManualUnitSearch(true); 
      
      setStep('manual');
      
      // Ativa o foco com um pequeno delay para garantir que o estado de 'manual' disparou o render do input
      setTimeout(() => {
        setShouldFocusSearch(true);
      }, 100);

      // Inicia o fluxo de processamento (Apenas Upload em background)
      // Agora habilitamos o OCR para o recurso "EVITAR ERRO" em background
      processImageFlow(base64, ocrBase64, true); 
    } else {
      setIsCapturing(false);
    }
  };

  const processImageFlow = async (base64: string, ocrBase64: string, runOcr: boolean = true) => {
    try {
      // 1. Inicia upload em background (Prova Jurídica)
      uploadPromiseRef.current = (async () => {
        try {
          const res = await fetch(base64);
          const blob = await res.blob();
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
            setPhotoUrl(publicUrl);
            return publicUrl;
          }
          return null;
        } catch (e) {
          console.error('Erro no upload de prova:', e);
          return null;
        }
      })();

      // Se não for para rodar OCR, apenas encerramos aqui (o step já foi mudado para manual)
      if (!runOcr) {
        setIsOcrLoading(false);
        setIsCapturing(false);
        return;
      }

      // 2. Executa OCR
      const result = await processImageWithWait(base64, ocrBase64);

      if (currentPhotoRef.current !== base64) {
        console.log("[OCR] Cancelando processamento pois o cadastro foi salvo ou cancelado.");
        return;
      }

      if (result && (result.casa || result.inicial || result.destinatario)) {
        await handleOCRResult(result);
        if (currentPhotoRef.current === base64) {
          setStep('manual'); // Garantir que está no passo manual para mostrar os campos
        }
      } else {
        fallbackToManual(base64);
      }
    } catch (error) {
      console.error('Erro no fluxo de imagem:', error);
      fallbackToManual(base64);
    } finally {
      setIsOcrLoading(false);
      setIsCapturing(false);
    }
  };

  const fallbackToManual = (originalBase64?: string) => {
    // Pequeno atraso para o usuário perceber que a IA não identificou automaticamente
    setTimeout(() => {
      if (originalBase64 && currentPhotoRef.current !== originalBase64) {
        console.log("[OCR] Cancelando fallback manual pois o cadastro foi salvo ou cancelado.");
        return;
      }
      setOcrConfidence('baixa');
      setShouldFocusSearch(true);
      setStatusMessage('Entrada Manual');
      setStep('manual');
      setIsOcrLoading(false);
      toast('Identifique o morador manualmente', { icon: '⌨️' });
    }, 600);
  };

  const handleOCRResult = async (parsedData: any) => {
    const unitToUse = parsedData.casa || '';
    const initialToUse = parsedData.inicial || '';
    const nameToUse = parsedData.destinatario || '';
    const confidence = parsedData.confianca as 'alta' | 'media' | 'baixa';

    // Armazena o número identificado para comparação posterior (EVITAR ERRO)
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
    
    if ((unitToUse || initialToUse || nameToUse) && user?.condominium_id) {
      if (!searchTerm) {
        setStatusMessage('Buscando Morador...');
      }
      
      const matches = await findMatchingResidents(
        user.condominium_id,
        unitToUse,
        nameToUse,
        undefined,
        initialToUse
      );
 
      if (matches.length > 0) {
        setMatchingResidents(matches.slice(0, 10));
        setIsAiSearch(true);
        const term = unitToUse || nameToUse || initialToUse;
        
        // SÓ ATUALIZA o campo de busca se o usuário ainda não tiver digitado nada
        if (!searchTerm) {
          setSearchTerm(term);
          setIsManualUnitSearch(!!unitToUse);
        }
      } else if (unitToUse) {
        if (!searchTerm) {
          setSearchTerm(unitToUse);
          setIsManualUnitSearch(true);
        }
        const normalizedUnitSearch = normalizeUnit(unitToUse);
        const houseMatches = allResidents
          .filter(r => normalizeUnit(r.unidade || '').includes(normalizedUnitSearch))
          .map(r => ({ resident: r, score: 100 }));
        
        if (houseMatches.length > 0) {
          setMatchingResidents(houseMatches);
          setOcrConfidence('media');
        }
      } else if (!searchTerm) {
        fallbackToManual();
      }
    } else {
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
          const parsedData = await extractBasicText(finalOcrBase64);
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

      // Feedback visual mínimo de 1.8 segundos para dar tempo do usuário ver a análise
      const elapsedTime = Date.now() - startTime;
      const minWait = 1800; // 1.8 segundos
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
      handleSelectResident(location.state.resident);
      setStep('manual'); // If coming from resident card, go to manual/form
    }
  }, [location.state]);

  // Search residents
  useEffect(() => {
    const searchResidents = async () => {
      if (selectedResident) return;

      if (isManualUnitSearch) {
        if (!searchTerm) {
          setMatchingResidents([]);
          return;
        }
        // Manual search by house number with normalization
        const normalizedSearch = normalizeUnit(searchTerm);
        const matches = allResidents
          .filter(r => {
            const resUnit = normalizeUnit(r.unidade || '');
            return resUnit.includes(normalizedSearch);
          })
          .map(r => {
            const resUnit = normalizeUnit(r.unidade || '');
            return { resident: r, score: (resUnit === normalizedSearch ? 100 : 50) };
          })
          .sort((a,b) => b.score - a.score);
        setMatchingResidents(matches as ScoredResident[]);
        return;
      }

      // If empty search, show some default residents (browse mode)
      if (!searchTerm && !foundPartialData) {
        setMatchingResidents(allResidents.slice(0, 10).map(r => ({ resident: r, score: 0 })));
        return;
      }

      // Intelligent search: Use the matcher even for manual typing
      const matches = await findMatchingResidents(
        user?.condominium_id || '',
        searchTerm, // Try as unit
        searchTerm, // Try as name
        { full_string: searchTerm } // Try as full string
      );

      if (matches.length > 0) {
        setMatchingResidents(matches);
      } else {
        setMatchingResidents([]);
      }
    };

    const timer = setTimeout(searchResidents, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, user?.condominium_id, selectedResident, allResidents, foundPartialData, isAiSearch]);

  const handleSelectResident = async (resident: Morador) => {
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

    // Check for existing pending packages to reuse code/token
    try {
      const { data: existing } = await supabase
        .from('packages')
        .select('pickup_code, pickup_token')
        .eq('recipient_id', resident.id)
        .eq('status', 'received')
        .order('received_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        if (existing[0].pickup_code) setPickupCode(existing[0].pickup_code);
        // Token isn't in state but used in handleSubmit, it handles it there
      }
    } catch (err) {
      console.warn("Erro ao buscar código existente:", err);
    }
  };

  const handleClearResident = () => {
    setSelectedResident(null);
    setLoading(false);
    setIsSaving(false);
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
      const timer = setTimeout(() => {
        if (unitInputRef.current) {
          unitInputRef.current.focus();
          // Tentativa extra para garantir em dispositivos móveis
          setTimeout(() => unitInputRef.current?.focus(), 50);
          setShouldFocusSearch(false);
        }
      }, 400); // Delay de 400ms conforme solicitado
      return () => clearTimeout(timer);
    }
  }, [shouldFocusSearch, step]);

  // Efeito de rolagem automática ao digitar número da casa (Mobile UX)
  useEffect(() => {
    if (isManualUnitSearch && searchTerm.length > 0 && step === 'manual' && !selectedResident) {
      const scrollTimer = setTimeout(() => {
        // Se houver moradores encontrados para esta unidade, fecha o teclado para facilitar visualização
        if (matchingResidents.length > 0) {
          unitInputRef.current?.blur();
          
          if (residentsSectionRef.current) {
            // Calcula a posição para deixar o input visível no topo
            const element = residentsSectionRef.current;
            const rect = element.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const targetY = rect.top + scrollTop - 80; // 80px de margem do topo para evitar esconder atrás de headers e menus do navegador

            window.scrollTo({
              top: targetY,
              behavior: 'smooth'
            });
          }
        }
      }, 500); // Delay de 500ms conforme solicitado por UX de digitação
      return () => clearTimeout(scrollTimer);
    }
  }, [searchTerm, isManualUnitSearch, step, selectedResident, matchingResidents.length]);

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
          handleSelectResident(directResident);
        }
        return;
      }
    }
    
    const targetResident = directResident || selectedResident;
    
    if (!targetResident || !user) {
      toast.error('Selecione um morador para salvar');
      return;
    }

    setLoading(true);
    setIsSaving(true);
    setStatusMessage('SALVANDO...');
    const toastId = toast.loading('Salvando encomenda...', { id: 'saving-package' });

    try {
      // 0. Garantir que a foto foi enviada (Prova Jurídica)
      let finalPhotoUrl = photoUrl;
      console.log("[SALVAMENTO] Iniciando com foto:", finalPhotoUrl?.substring(0, 50));
      
      if (finalPhotoUrl && finalPhotoUrl.startsWith('data:') && uploadPromiseRef.current) {
        setStatusMessage('FINALIZANDO FOTO...');
        const uploadedUrl = await uploadPromiseRef.current;
        if (uploadedUrl) {
          finalPhotoUrl = uploadedUrl;
          setPhotoUrl(uploadedUrl);
        }
      }

      // 1. Obter o usuário logado para capturar o ID se disponível
      const { data: { user: authUser } } = await supabase.auth.getUser();

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
      
      const packageData = {
        condominium_id: user.condominium_id,
        recipient_id: targetResident.id,
        unit_number: unitNumber || targetResident.unidade || '',
        carrier,
        tracking_code: trackingNumber,
        notes: finalNotes,
        photo_url: finalPhotoUrl,
        received_by: user.id,
        received_at: new Date().toISOString(),
        pickup_code: finalPickupCode,
        pickup_token: finalPickupToken,
        status: 'received', // Valor aceito pelo banco conforme requisito
        whatsapp_notified: shouldOpenWhatsAppNow, 
        whatsapp_sent: shouldOpenWhatsAppNow,
        whatsapp_status: shouldOpenWhatsAppNow ? 'enviado' : (targetResident.telefone ? 'pending' : 'no_recipient'),
        whatsapp_message: directMessage
      };

      console.log("[SALVAMENTO] Objeto final:", packageData);

      const { data: newPackage, error: insertError } = await supabase
        .from('packages')
        .insert([packageData])
        .select('*')
        .single();

      if (insertError) {
        console.error("[ERRO_CRITICO] Falha ao inserir no banco:", insertError);
        throw new Error(insertError.message);
      }

      if (!newPackage) {
        throw new Error('Erro ao confirmar salvamento da encomenda.');
      }

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
          condominio_id: user.condominium_id || '',
          usuario_id: user.id,
          usuario_nome: user.full_name,
          usuario_perfil: user.role,
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
          const link = getWhatsAppLink(targetResident.telefone, directMessage, finalPhotoUrl);
          window.open(link, '_blank');
        } catch (linkErr) {
          console.error('Erro ao abrir link do WhatsApp:', linkErr);
        }
      }

      // FLUXO DE ESTABILIDADE: Highlight, Scroll e Reset sem câmera auto se abrir WhatsApp
      setIsHighlighting(true);
      setTimeout(() => setIsHighlighting(false), 1000);
      setBlockAutoCamera(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Limpar campos
      resetForm();
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
                <span className={`text-[9px] font-medium uppercase tracking-tight whitespace-nowrap px-3 py-1 rounded-full border ${getCurrentPorter() === 'Selecione o Porteiro' ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-emerald-600 bg-emerald-50 border-emerald-200'}`}>
                  {getCurrentPorter() === 'Selecione o Porteiro' ? '👤 SELECIONE O PORTEIRO' : `👤 ${getCurrentPorter().toUpperCase()}`}
                </span>
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
              {/* Photo Preview */}
              {photoUrl && (
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
                    onClick={(e) => { e.preventDefault(); resetForm(); }}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-black/40 backdrop-blur-sm rounded-lg text-[10px] text-white font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-black/60 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Tirar nova foto
                  </button>
                </div>
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
                               placeholder="Casa / Unidade..."
                               value={searchTerm}
                               onChange={(e) => setSearchTerm(e.target.value)}
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
                              className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl transition-all outline-none text-lg text-gray-900 placeholder:text-gray-400"
                            />
                          </div>
                        )}
                      </div>

                      {/* Search Results / Intelligent Suggestions */}
                      {matchingResidents.length > 0 && (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 pb-2 scroll-smooth custom-scrollbar">
                          <div className="flex items-center gap-2 px-1 mb-2">
                             <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                               {isManualUnitSearch ? `Moradores da Casa ${searchTerm}` : (!searchTerm ? 'Moradores (A-Z)' : 'Moradores sugeridos')}
                             </p>
                          </div>
                          
                          {matchingResidents.slice(0, 10).map(({ resident, score }, index) => {
                            // Destaque para o primeiro da lista se houver score relevante
                            const isBest = searchTerm && index === 0 && score >= 70;
                            
                            return (
                              <button
                                key={resident.id}
                                type="button"
                                onClick={() => {
                                  // Seleciona e salva automaticamente a encomenda após a escolha do morador
                                  handleSelectResident(resident);
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
                      
                      {searchTerm.length >= 2 && matchingResidents.length === 0 && (
                        <div className="py-8 space-y-4">
                          <div className="bg-white rounded-2xl p-6 border-2 border-dashed border-gray-200 text-center">
                            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Search className="w-6 h-6 text-gray-400" />
                            </div>
                            <h3 className="text-gray-900 font-bold mb-1">Nenhum morador encontrado</h3>
                            <p className="text-gray-500 text-sm mb-6">Tente uma das opções abaixo para continuar:</p>
                            
                            <div className="grid grid-cols-1 gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsManualUnitSearch(false);
                                  setSearchTerm('');
                                }}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-indigo-50 text-indigo-700 rounded-xl font-bold hover:bg-indigo-100 transition-all border border-indigo-100"
                              >
                                <Search className="w-5 h-5" />
                                Buscar por nome
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsManualUnitSearch(true);
                                  setSearchTerm('');
                                }}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-emerald-50 text-emerald-700 rounded-xl font-bold hover:bg-emerald-100 transition-all border border-emerald-100"
                              >
                                <Hash className="w-5 h-5" />
                                Registrar por nº da casa
                              </button>
                              <button
                                type="button"
                                onClick={() => resetForm()}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all border border-gray-200"
                              >
                                <Camera className="w-5 h-5" />
                                Tirar nova foto
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
                        <CheckCircle className={`w-5 h-5 ${isFemale(selectedResident.nome) ? 'text-violet-400' : 'text-indigo-400'}`} />
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
                      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Detalhes Opcionais</h2>
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
      </div>
    </div>
  </div>
);
}