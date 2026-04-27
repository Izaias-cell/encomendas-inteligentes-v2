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
  ArrowRight
} from 'lucide-react';
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

type Step = 'camera' | 'manual';

const QUICK_OBSERVATIONS = [
  'Caixa frágil',
  'Pacote grande',
  'Envelope',
  'Alimento/Perecível',
  'Geladeira',
  'Mercado Livre'
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
  const [isManualUnitSearch, setIsManualUnitSearch] = useState(false);
  const [allCondoResidents, setAllCondoResidents] = useState<Morador[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [condoSettings, setCondoSettings] = useState<CondominiumSettings | null>(null);
  const [foundPartialData, setFoundPartialData] = useState(false);
  const [isAiSearch, setIsAiSearch] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Lendo etiqueta...');
  const [allResidents, setAllResidents] = useState<Morador[]>([]);
  const [isWaitingForReturn, setIsWaitingForReturn] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<'alta' | 'media' | 'baixa' | null>(null);
  const [debugOcrImage, setDebugOcrImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraStabilizing, setIsCameraStabilizing] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<any>(null);

  const APP_VERSION = "2.2.0-diag";
  const BUILD_TIME = "2026-04-27 07:25";
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
    if (step === 'camera' && !photoUrl && !cameraActive) {
      startCamera();
    }
    return () => stopCamera();
  }, [step, photoUrl]);

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
    // Garantir que qualquer stream anterior seja encerrado antes de iniciar um novo
    stopCamera();
    setIsCameraStabilizing(true);
    
    try {
      let stream: MediaStream;
      
      // 1. Tenta identificar a câmera traseira pelo label (mais robusto em alguns Androids)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        // Procura labels que indiquem câmera traseira
        const backCamera = videoDevices.find(device => {
          const label = device.label.toLowerCase();
          return label.includes('back') || label.includes('traseira') || label.includes('rear') || label.includes('environment');
        });

        if (backCamera) {
          console.log("Câmera traseira identificada por ID:", backCamera.label);
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: backCamera.deviceId },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              // Adicionamos frameRate ideal para estabilidade
              frameRate: { ideal: 30, max: 60 }
            },
            audio: false
          });
        } else {
          // Se não achar por label, tenta o modo padrão environment
          throw new Error("Nenhuma câmera traseira identificada por label");
        }
      } catch (labelErr) {
        console.warn("Falha ao selecionar por label ou ID. Usando facingMode...", labelErr);
        // Fallback robusto usando facingMode
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: { exact: 'environment' },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 }
            }, 
            audio: false 
          });
        } catch (err) {
          console.warn("Retrying camera with ideal environment mode...");
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'environment',
              width: { ideal: 1920, min: 1080 },
              height: { ideal: 1080, min: 720 }
            }, 
            audio: false 
          });
        }
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);

        // Aguarda estabilização
        setTimeout(() => {
          setIsCameraStabilizing(false);
          
          // Tenta aplicar foco contínuo e exposição automática
          const track = stream.getVideoTracks()[0];
          if (track.applyConstraints) {
            track.applyConstraints({
              advanced: [
                { focusMode: 'continuous' } as any,
                { exposureMode: 'continuous' } as any
              ]
            }).catch(e => console.warn('Constraints not supported:', e));
          }
        }, 600);
      }
    } catch (err) {
      console.error("Erro ao acessar câmera:", err);
      toast.error("Não foi possível acessar a câmera. Use o modo manual.");
      setStep('manual');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
      setFlashOn(false);
    }
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
    if (!videoRef.current || !canvasRef.current || isCameraStabilizing) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    if (context) {
      // Filtros leves para melhorar contraste em etiquetas (sem compressão)
      context.filter = 'contrast(112%) brightness(108%)';
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Qualidade máxima (1.0) para garantir fidelidade total entre ambientes
      const quality = 1.0;
      const base64 = canvas.toDataURL('image/jpeg', quality);
      
      // Calcular tamanho real para diagnóstico
      const sizeBytes = Math.round((base64.length * (3/4)) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0));
      const sizeKB = Math.round(sizeBytes / 1024);

      console.log(`[DEBUG_OCR] Image Captured: ${canvas.width}x${canvas.height}, Size: ${sizeKB}KB, Quality: ${quality}`);

      setDiagnosticInfo({
        version: APP_VERSION,
        buildTime: BUILD_TIME,
        environment: ENVIRONMENT,
        width: canvas.width,
        height: canvas.height,
        sizeKB: sizeKB,
        mimeType: 'image/jpeg',
        quality: quality,
        capturedAt: new Date().toLocaleTimeString(),
        nativeResolution: `${video.videoWidth}x${video.videoHeight}`
      });

      stopCamera();
      
      // 1. Salvar a imagem final no estado e debug
      setPhotoUrl(base64);
      setDebugOcrImage(base64); 
      setStep('manual');
      setIsOcrLoading(true);
      setStatusMessage('Preparando imagem...');

      // 2. Aguardar a imagem estar completamente pronta/carregada (delay de segurança de 500ms)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3. Somente depois chamar o OCR usando a imagem final salva
      setStatusMessage('Buscando dados da etiqueta...');
      processImageWithWait(base64);
    }
  };

  const processingRef = useRef(false);

  const processImageWithWait = async (base64: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsOcrLoading(true);
    
    // Limpa estados de detecção anterior para evitar confusão/artefatos, especialmente em retentativas
    setRecipientName('');
    setUnitNumber('');
    setMatchingResidents([]);
    setSelectedResident(null);
    setOcrConfidence(null);
    setIsAiSearch(false);
    setIsManualUnitSearch(false);

    try {
      setStatusMessage('Processando...');
      let finalBase64 = base64;

      // 1. Inicia upload em paralelo
      const uploadPromise = (async () => {
        try {
          const storageBase64 = base64;

          const res = await fetch(storageBase64);
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
          }
        } catch (storageErr) {
          console.error('Erro no upload paralelo:', storageErr);
        }
      })();

      // 2. Leitura inteligente com Gemini
      const ocrPromise = (async () => {
        try {
          setStatusMessage('Analisando...');
          setDiagnosticInfo((prev: any) => ({ ...prev, ocrStatus: 'PROCESSANDO...', ocrError: null }));
          const parsedData = await extractBasicText(finalBase64);
          
          if (parsedData) {
            setDiagnosticInfo((prev: any) => ({
              ...prev,
              ocrStatus: 'SUCESSO',
              rawOcrText: parsedData.texto_bruto,
              detectedName: parsedData.nome_detectado,
              detectedHouse: parsedData.casa_detectada,
              confidence: parsedData.confianca,
              ocrTimestamp: new Date().toLocaleTimeString()
            }));

            const nameToUse = parsedData.nome_detectado;
            const unitToUse = parsedData.casa_detectada;
            const confidence = parsedData.confianca as 'alta' | 'media' | 'baixa';
            
            setOcrConfidence(confidence);

            // Só preencher o que é essencial para busca
            if (nameToUse) setRecipientName(nameToUse);
            if (unitToUse) setUnitNumber(unitToUse);
            
            if ((nameToUse || unitToUse) && user?.condominium_id) {
              const matches = await findMatchingResidents(
                user.condominium_id,
                unitToUse || '',
                nameToUse || ''
              );

              if (matches.length > 0) {
                const topMatch = matches[0];
                setMatchingResidents(matches.slice(0, 5));
                setIsAiSearch(true);
                
                // Se tivermos alta confiança na extração e um match razoável
                if (topMatch.score >= 180 && confidence === 'alta') {
                  handleSelectResident(topMatch.resident);
                } else {
                  // Se for sugestão, preenchemos o termo de busca para mostrar os cards
                  setSearchTerm(nameToUse || unitToUse || '');
                  // Se encontrou algo, garantimos que não fique em 'baixa' total
                  if (confidence === 'baixa') setOcrConfidence('media');
                }
              } else if (unitToUse) {
                // Se identificou a casa mas não achou morador exato, mostra moradores daquela casa
                setSearchTerm(unitToUse);
                setIsManualUnitSearch(true);
                
                // Buscar moradores desta unidade manualmente para mostrar nos cards
                const normalizedUnitSearch = unitToUse.toLowerCase().replace(/[^0-9]/g, '');
                const houseMatches = allResidents
                  .filter(r => (r.unidade || '').toLowerCase().includes(normalizedUnitSearch))
                  .map(r => ({ resident: r, score: 100 }));
                
                if (houseMatches.length > 0) {
                  setMatchingResidents(houseMatches);
                  // Se encontrou moradores na casa, não é confiança 'baixa'
                  setOcrConfidence('media');
                }
              }
            } else if (confidence === 'baixa') {
              // Se não achou nada e a confiança é baixa, forçamos o estado de baixa
              setOcrConfidence('baixa');
            }
          } else {
            setOcrConfidence('baixa');
          }
        } catch (err: any) {
          console.error("Erro no OCR promise:", err);
          setDiagnosticInfo((prev: any) => ({
            ...prev,
            ocrStatus: 'ERRO',
            ocrError: err?.message || String(err),
            ocrTimestamp: new Date().toLocaleTimeString()
          }));
          setOcrConfidence('baixa');
        }
        return true;
      })();

      // Aguarda OCR ou 20 segundos para não desistir antes da IA terminar
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 20000));
      
      const raceResult = await Promise.race([
        ocrPromise.then(() => 'success'),
        timeoutPromise
      ]);

      if (raceResult === 'timeout') {
        console.warn("OCR timeout atingido (20s)");
        setDiagnosticInfo((prev: any) => ({
          ...prev,
          ocrStatus: 'TIMEOUT',
          ocrError: 'A IA demorou mais de 20s para responder. Verifique sua conexão ou tente novamente.',
          ocrTimestamp: new Date().toLocaleTimeString()
        }));
        
        // Se deu timeout, forçamos o estado de baixa para liberar o preenchimento manual após o tempo limite
        if (!ocrConfidence) {
          setOcrConfidence('baixa');
        }
      }

      setIsOcrLoading(false);
      setStep('manual');
      
      // Se após o timeout/OCR ainda não tivermos confiança definida, assume baixa se nada foi achado
      setOcrConfidence(prev => {
        if (!prev && !recipientName && !unitNumber) return 'baixa';
        return prev;
      });

      await uploadPromise;
    } catch (err) {
      console.warn("[IA APOIO] Erro no processamento:", err);
      setStep('manual');
      setIsOcrLoading(false);
    } finally {
      processingRef.current = false;
      setIsOcrLoading(false);
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
        
        // Auto-select if extremely high confidence (exact match)
        const topMatch = matches[0];
        if (topMatch.score >= 180 && searchTerm.length >= 3 && !isAiSearch) {
          handleSelectResident(topMatch.resident);
          // Notificação de sucesso removida conforme solicitado
        }
      } else {
        setMatchingResidents([]);
      }
    };

    const timer = setTimeout(searchResidents, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, user?.condominium_id, selectedResident, allResidents, foundPartialData, isAiSearch]);

  const handleSelectResident = async (resident: Morador) => {
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
      toast.error('Erro ao carregar foto: ' + error.message);
      setStep('camera');
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep('camera');
    setSelectedResident(null);
    setRecipientName('');
    setUnitNumber('');
    setUnitType('');
    setCarrier('');
    setTrackingNumber('');
    setNotes('');
    setPhotoUrl('');
    setSearchTerm('');
    setIsManualUnitSearch(false);
    setMatchingResidents([]);
    setPickupCode(generatePickupCode());
    setFoundPartialData(false);
    setIsAiSearch(false);
    setLoading(false);
    setIsSaving(false);
    setIsOcrLoading(false);
    setOcrConfidence(null);
    setDebugOcrImage(null);
    setStatusMessage('Lendo dados...');
    
    // Forçar reinicialização da câmera se estivermos voltando para o step camera
    if (step !== 'camera') {
      setTimeout(() => startCamera(), 100);
    }
  };

  const handleSubmit = async (e?: React.FormEvent, directResident?: Morador, shouldNotify: boolean = false) => {
    if (e) e.preventDefault();
    
    if (isSaving) return;

    const targetResident = directResident || selectedResident;
    
    if (!targetResident || !user) {
      toast.error('Selecione um morador para continuar');
      setLoading(false);
      setIsSaving(false);
      return;
    }

    toast.loading('Registrando encomenda...', { id: 'saving-package' });
    setLoading(true);
    setIsSaving(true);
    try {
      // Obter o usuário logado para capturar o ID se disponível (opcional)
      const { data: { user: authUser } } = await supabase.auth.getUser();

      // 0. Verificar se o morador já tem encomendas pendentes para agrupar
      const { data: existingPackages } = await supabase
        .from('packages')
        .select('id, pickup_code, pickup_token')
        .eq('recipient_id', targetResident.id)
        .eq('status', 'received')
        .order('received_at', { ascending: false });

      const hasExisting = existingPackages && existingPackages.length > 0;
      
      // Tenta encontrar um token e código já existentes no grupo
      const existingToken = existingPackages?.find(p => p.pickup_token)?.pickup_token;
      const existingCode = existingPackages?.find(p => p.pickup_code)?.pickup_code;

      const finalPickupCode = existingCode || pickupCode;
      const finalPickupToken = existingToken || (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
      const totalPackages = (existingPackages?.length || 0) + 1;

      // Se houver encomendas existentes, garantir que todas tenham o mesmo token e código
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

      // 1. Preparar a notificação
      const directMessage = prepareWhatsAppNotification(
        targetResident,
        condoName,
        finalPickupCode,
        carrier,
        finalPickupToken,
        totalPackages,
        'disponivel',
        undefined,
        undefined,
        photoUrl
      ) || `Olá, ${targetResident.nome}! Sua encomenda chegou na portaria. Código: ${finalPickupCode}`;

    // 2. Salvar a encomenda no Supabase
      const packageData = {
        condominium_id: user.condominium_id,
        recipient_id: targetResident.id,
        recipient_name_raw: recipientName || targetResident.nome,
        unit_number: unitNumber || targetResident.unidade || '',
        unit_type: unitType || targetResident.unit_type || '',
        unit_number_val: targetResident.unidade,
        block: targetResident.block || targetResident.bloco,
        tower: targetResident.tower || targetResident.lote,
        complement: targetResident.observacoes,
        carrier,
        tracking_code: trackingNumber,
        notes,
        photo_url: photoUrl,
        received_by: user.id,
        received_at: new Date().toISOString(),
        porter_name: getCurrentPorter(), // Nome legível para auditoria rápida
        recebido_por: getCurrentPorter(), // Novo campo solicitado
        created_by: user.id,
        ...(authUser?.id ? { registered_by: authUser.id } : {}),
        pickup_code: finalPickupCode,
        pickup_token: finalPickupToken,
        pickup_qr_code: 'active',
        qr_code_generated_at: new Date().toISOString(),
        status: 'received',
        whatsapp_status: targetResident.telefone ? 'pendente' : 'no_recipient',
        whatsapp_message: directMessage
      };

      const { data: newPackage, error: insertError } = await supabase
        .from('packages')
        .insert([packageData])
        .select()
        .single();

      if (insertError) {
        console.error('Erro ao inserir encomenda:', insertError);
        toast.error('Erro ao salvar encomenda: ' + (insertError.message || 'Erro desconhecido'), { id: 'saving-package' });
        setLoading(false);
        setIsSaving(false);
        return;
      }

      if (!newPackage) {
        toast.error('Erro ao recuperar encomenda salva', { id: 'saving-package' });
        setLoading(false);
        setIsSaving(false);
        return;
      }

      // 3. Notificação via WhatsApp (Apenas se solicitado e morador tiver telefone)
      if (shouldNotify && targetResident.telefone) {
        // Verifica se a API está configurada e ativa
        const apiActive = condoSettings?.whatsapp_mode === 'api_automatica' && 
                        condoSettings?.api_url && 
                        condoSettings?.api_token;

        if (apiActive) {
          try {
            const result = await sendWhatsAppMessage(targetResident.telefone, directMessage, user.condominium_id, {
              api_url: condoSettings?.api_url,
              api_token: condoSettings?.api_token,
              instance_id: condoSettings?.instance_id,
              whatsapp_provider: condoSettings?.whatsapp_provider,
              photo_url: photoUrl
            });
            
            if (result.status_envio === 'sucesso') {
              const now = new Date().toISOString();
              await supabase
                .from('packages')
                .update({ 
                  whatsapp_status: 'enviado', 
                  last_notification_at: now,
                  whatsapp_sent_at: now,
                  notification_mode: 'api'
                })
                .eq('id', newPackage.id);
              
              toast.success('Notificação enviada via WhatsApp', { icon: '📱' });
            } else {
              console.warn('Falha no envio da Z-API:', result.error);
              toast.error('Aviso: Falha no envio automático do WhatsApp', { duration: 3000 });
            }
          } catch (err) {
            console.error('Erro no envio automático:', err);
            toast.error('Erro ao conectar com API de WhatsApp');
          }
        }

        // Fallback manual apenas se explicitamente em modo manual
        if (condoSettings?.whatsapp_mode === 'manual_assistido' || !apiActive) {
          const whatsappLink = getWhatsAppLink(targetResident.telefone, directMessage, photoUrl || undefined);
          
          setIsWaitingForReturn(true); // Ativa detecção de retorno para abrir câmera
          window.open(whatsappLink, '_blank');
        }
      }

      // Log action
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
          descricao: `Encomenda cadastrada para ${targetResident.nome} - ${targetResident.unidade}`,
          metodo: photoUrl ? 'OCR' : 'MANUAL'
        });
      } catch (logErr) {
        console.warn('Erro ao logar ação:', logErr);
      }

      toast.success('Encomenda registrada', { id: 'saving-package' });
      resetForm();
    } catch (error: any) {
      toast.error('Erro inesperado: ' + error.message, { id: 'saving-package' });
      setIsSaving(false);
    } finally {
      setLoading(false);
      setIsSaving(false);
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
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button 
            onClick={() => {
              setLoading(false);
              setIsSaving(false);
              setIsOcrLoading(false);
              if (step === 'manual') {
                resetForm();
              } else {
                navigate('/portaria');
              }
            }}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 leading-tight text-center">
            {step === 'camera' ? 'Capturar Encomenda' : 'Registrar Encomenda'}
            <div className="flex items-center justify-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${getCurrentPorter() === 'Selecione o Porteiro' ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200' : 'text-emerald-600'}`}>
                Porteiro: {getCurrentPorter()}
              </span>
            </div>
            <div className="mt-1 text-[8px] text-gray-400 font-medium uppercase tracking-[0.2em]">
              v2.1 - OCR atualizado
            </div>
          </h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
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
                    className="w-full h-full object-cover"
                  />
                  {cameraActive && (
                    <button
                      onClick={toggleFlash}
                      className="absolute top-4 right-4 p-3 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors z-20"
                      type="button"
                    >
                      {flashOn ? <Zap className="w-6 h-6 text-yellow-400 fill-yellow-400" /> : <ZapOff className="w-6 h-6" />}
                    </button>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-12">
                    <div className="w-full aspect-[4/3] border-2 border-white/50 rounded-2xl relative">
                      {/* Cantos reforçados para o guia */}
                      <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-indigo-500 rounded-tl-lg" />
                      <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-indigo-500 rounded-tr-lg" />
                      <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-indigo-500 rounded-bl-lg" />
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-indigo-500 rounded-br-lg" />
                      
                      {/* Texto de instrução no guia */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50 text-[10px] font-bold uppercase tracking-widest text-center whitespace-nowrap">
                        Enquadre a etiqueta aqui
                      </div>
                    </div>
                  </div>

                  <div className="absolute bottom-8 left-0 right-0 flex justify-center px-8 gap-4">
                    <button
                      onClick={capturePhoto}
                      disabled={isCameraStabilizing || isOcrLoading}
                      className={`w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all ${isCameraStabilizing || isOcrLoading ? 'opacity-50 scale-90' : 'opacity-100'}`}
                    >
                      {isCameraStabilizing || isOcrLoading ? (
                         <div className="w-12 h-12 border-4 border-gray-100 rounded-full border-t-indigo-600 animate-spin" />
                      ) : (
                         <div className="w-16 h-16 border-4 border-gray-900 rounded-full" />
                      )}
                    </button>
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
                <p className="text-sm text-amber-800">
                  Certifique-se de que o nome do morador e a unidade estejam bem visíveis na foto.
                </p>
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
                      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Morador</h2>
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
                      {isOcrLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                          <div className="relative">
                            <div className="w-16 h-16 border-4 border-indigo-100 rounded-full" />
                            <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent animate-spin absolute inset-0 rounded-full" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Sparkles className="w-6 h-6 text-indigo-600 animate-pulse" />
                            </div>
                          </div>
                          <div className="max-w-[200px]">
                            <p className="text-gray-900 font-bold animate-pulse">{statusMessage}</p>
                            <p className="text-gray-500 text-xs mt-1">Aguardando resposta da inteligência artificial...</p>
                          </div>
                        </div>
                      ) : (ocrConfidence === 'baixa' && matchingResidents.length === 0) ? (
                        <div className="py-2 space-y-4">
                          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 text-center">
                            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                              <AlertCircle className="w-6 h-6 text-amber-600" />
                            </div>
                            <h3 className="text-amber-900 font-bold mb-1">Dados não identificados</h3>
                            <p className="text-amber-700 text-sm mb-6">A IA não conseguiu ler com clareza. Escolha como prosseguir:</p>
                            
                            <div className="grid grid-cols-1 gap-3">
                              <button
                                type="button"
                                disabled={isOcrLoading}
                                onClick={async () => {
                                  if (photoUrl) {
                                    setIsOcrLoading(true);
                                    setOcrConfidence(null);
                                    setStatusMessage('Preparando imagem...');
                                    // Delay de segurança antes de reprocessar a mesma foto final
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                    processImageWithWait(photoUrl);
                                  }
                                }}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 disabled:opacity-50"
                              >
                                {isOcrLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                {isOcrLoading ? 'Lendo etiqueta...' : 'Tentar ler foto novamente'}
                              </button>
                              <button
                                type="button"
                                onClick={() => resetForm()}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100"
                              >
                                <Camera className="w-5 h-5" />
                                Tirar nova foto
                              </button>

                              {/* Debug de Imagem OCR (Somente se houver imagem de debug) */}
                              {debugOcrImage && (
                                <div className="mt-4 p-3 bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                                  <p className="text-[10px] font-bold text-zinc-400 uppercase mb-2">DEBUG: Imagem enviada para IA</p>
                                  <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
                                    <img src={debugOcrImage} alt="Debug OCR" className="w-full h-full object-contain" />
                                  </div>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setIsManualUnitSearch(true);
                                  setSearchTerm('');
                                  setOcrConfidence(null);
                                }}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-white text-emerald-700 rounded-xl font-bold hover:bg-emerald-50 transition-all border-2 border-emerald-100"
                              >
                                <Hash className="w-5 h-5 text-emerald-500" />
                                Registrar por nº da casa
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsManualUnitSearch(false);
                                  setSearchTerm('');
                                  setOcrConfidence(null);
                                }}
                                className="flex items-center justify-center gap-3 w-full py-4 bg-white text-indigo-700 rounded-xl font-bold hover:bg-indigo-50 transition-all border-2 border-indigo-100"
                              >
                                <Search className="w-5 h-5 text-indigo-500" />
                                Buscar por nome
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {ocrConfidence === 'baixa' && matchingResidents.length > 0 && (
                            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                              <p className="text-xs text-amber-800 font-medium">Possível leitura parcial. Verifique se o morador está na lista abaixo.</p>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsManualUnitSearch(false);
                            setSearchTerm('');
                          }}
                          className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${
                            !isManualUnitSearch 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          Busca por Nome
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsManualUnitSearch(true);
                            setSearchTerm('');
                          }}
                          className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${
                            isManualUnitSearch 
                              ? 'bg-indigo-600 text-white shadow-md' 
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          Por nº da Casa
                        </button>
                      </div>

                      <div className="relative">
                        {isManualUnitSearch ? (
                           <div className="relative">
                             <div className="absolute left-6 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                               <Hash className="w-5 h-5 text-indigo-600" />
                             </div>
                             <input
                               autoFocus
                               type="number"
                               inputMode="numeric"
                               placeholder="Digite o número da residência..."
                               value={searchTerm}
                               onChange={(e) => setSearchTerm(e.target.value)}
                               className="w-full pl-16 pr-4 py-5 bg-indigo-50/50 border-2 border-indigo-100 focus:border-indigo-500 focus:bg-white rounded-2xl transition-all outline-none text-2xl font-black text-indigo-900 placeholder:text-indigo-200"
                             />
                           </div>
                        ) : (
                          <>
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                              autoFocus
                              type="text"
                              placeholder="Nome ou número da casa..."
                              value={searchTerm}
                              onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setIsAiSearch(false);
                              }}
                              className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl transition-all outline-none text-lg"
                            />
                          </>
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
                                onClick={() => handleSelectResident(resident)}
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
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Card do Morador Selecionado (Clickable to save) */}
                      <button
                        type="button"
                        onClick={() => handleSubmit(undefined, undefined, true)}
                        disabled={loading || isOcrLoading}
                        className={`w-full px-4 py-5 rounded-2xl border-2 flex items-center justify-between shadow-sm transition-all active:scale-[0.97] text-left group ${
                          isFemale(selectedResident.nome) 
                            ? 'bg-violet-50 border-violet-100 text-violet-900 hover:bg-violet-100 hover:border-violet-200' 
                            : 'bg-indigo-50 border-indigo-100 text-indigo-900 hover:bg-indigo-100 hover:border-indigo-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
                            isFemale(selectedResident.nome) ? 'bg-violet-100 border-violet-200 group-hover:bg-violet-200' : 'bg-indigo-100 border-indigo-200 group-hover:bg-indigo-200'
                          }`}>
                            <User className={`w-5 h-5 ${isFemale(selectedResident.nome) ? 'text-violet-500' : 'text-indigo-600'}`} />
                          </div>
                          <div>
                            <p className="font-bold text-sm leading-none mb-1">{selectedResident.nome}</p>
                            <p className="text-[10px] font-medium opacity-70 mb-0.5">{formatResidentAddress(selectedResident)}</p>
                            <p className={`text-[9px] font-black uppercase tracking-widest ${isFemale(selectedResident.nome) ? 'text-violet-400' : 'text-indigo-400'}`}>Toque para Registrar</p>
                          </div>
                        </div>
                        {loading ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : <CheckCircle className={`w-5 h-5 ${isFemale(selectedResident.nome) ? 'text-violet-400' : 'text-indigo-400'}`} />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Package Details */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                      <Package className="w-5 h-5 text-emerald-600" />
                    </div>
                    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Dados da Entrega</h2>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tipo de Unidade
                      </label>
                      <select
                        value={unitType}
                        onChange={(e) => setUnitType(e.target.value)}
                        className="block w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-white"
                      >
                        <option value="">Selecione o tipo</option>
                        <option value="Apartamento">Apartamento</option>
                        <option value="Casa">Casa</option>
                        <option value="Lote">Lote</option>
                        <option value="Sala">Sala</option>
                        <option value="Bloco">Bloco</option>
                        <option value="Outro">Outro</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Observações Rápidas
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_OBSERVATIONS.map((obs) => (
                          <button
                            key={obs}
                            type="button"
                            onClick={() => toggleObservation(obs)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Outras Observações
                      </label>
                      <div className="relative">
                        <div className="absolute top-3 left-3 pointer-events-none">
                          <FileText className="h-5 w-5 text-gray-400" />
                        </div>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder="Digite aqui..."
                          className="block w-full pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pickup Code Info */}
                <div className="bg-indigo-900 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200 mb-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Hash className="w-5 h-5 text-indigo-300" />
                      <span className="text-sm font-semibold uppercase tracking-wider">Código de Retirada</span>
                    </div>
                    <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Gerado Automaticamente</span>
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    {pickupCode.split('').map((digit, i) => (
                      <div key={i} className="w-14 h-20 bg-white/20 rounded-2xl flex items-center justify-center text-5xl font-black border-2 border-white/30 shadow-lg">
                        {digit}
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-xs text-indigo-200 mt-4">
                    Este código será enviado ao morador via WhatsApp junto com o QR Code.
                  </p>
                </div>

                {/* Final Actions - SALVAR ENCOMENDA appears when resident is selected */}
                {selectedResident && (
                  <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-gray-200 z-50 animate-in fade-in slide-in-from-bottom-5">
                    <div className="max-w-2xl mx-auto">
                      <button
                        type="button"
                        disabled={loading || isOcrLoading}
                        onClick={() => handleSubmit(undefined, undefined, true)}
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

        {/* Botão de Diagnóstico (Discreto) */}
        <div className="fixed bottom-24 right-4 z-[60]">
          <button 
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="w-10 h-10 bg-black/20 backdrop-blur-md rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-black/40 transition-all border border-white/10"
            title="Modo Diagnóstico"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>

        <AnimatePresence>
          {showDiagnostics && diagnosticInfo && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed inset-x-4 bottom-24 top-20 z-[70] bg-black/95 rounded-3xl p-6 overflow-y-auto font-mono text-[10px] text-green-400 shadow-2xl border border-white/10"
            >
              <div className="flex justify-between items-center mb-6 border-b border-green-900/30 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-widest">Diagnóstico OCR</h2>
                </div>
                <button onClick={() => setShowDiagnostics(false)} className="text-white hover:bg-white/10 p-2 rounded-full transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <section className="bg-green-950/20 p-4 rounded-2xl border border-green-900/20">
                    <p className="text-white mb-3 font-bold text-xs flex items-center gap-2">
                      <CheckCircle className="w-3 h-3" /> [ AMBIENTE ]
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[9px] opacity-80">
                      <p>Versão App:</p> <p className="text-white">{diagnosticInfo.version}</p>
                      <p>Build Time:</p> <p className="text-white">{diagnosticInfo.buildTime}</p>
                      <p>Host:</p> <p className="text-white">{ENVIRONMENT.toUpperCase()}</p>
                      <p>Origin:</p> <p className="text-white">{window.location.origin.substring(0, 30)}...</p>
                    </div>
                  </section>

                  <section className="bg-green-950/20 p-4 rounded-2xl border border-green-900/20">
                    <p className="text-white mb-3 font-bold text-xs flex items-center gap-2">
                      <Camera className="w-3 h-3" /> [ IMAGEM FINAL ]
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[9px] opacity-80 mb-4">
                      <p>Resolução Foto:</p> <p className="text-white">{diagnosticInfo.width}x{diagnosticInfo.height}</p>
                      <p>Stream Nativo:</p> <p className="text-white">{diagnosticInfo.nativeResolution || '?'}</p>
                      <p>Tamanho Real:</p> <p className="text-white">{diagnosticInfo.sizeKB} KB</p>
                      <p>JPEG Quality:</p> <p className="text-white">{diagnosticInfo.quality * 100}%</p>
                      <p>Captura Local:</p> <p className="text-white">{diagnosticInfo.capturedAt}</p>
                    </div>
                    <div className="relative mt-2 border border-green-900/50 overflow-hidden rounded-xl bg-black">
                      <img src={debugOcrImage || ''} alt="Processada" className="w-full h-auto opacity-80" />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center text-[8px] text-white/50">
                        Cópia exata enviada para IA
                      </div>
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                  <section className="bg-green-950/20 p-4 rounded-2xl border border-green-900/20">
                    <p className="text-white mb-3 font-bold text-xs flex items-center gap-2">
                      <Sparkles className="w-3 h-3 text-yellow-400" /> [ RESPOSTA IA ]
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[9px] opacity-80 mb-4">
                      <p>Status Chamada:</p> 
                      <p className={`font-bold ${diagnosticInfo.ocrStatus === 'SUCESSO' ? 'text-green-400' : diagnosticInfo.ocrStatus === 'ERRO' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {diagnosticInfo.ocrStatus || 'AGUARDANDO'}
                      </p>
                      <p>Confiança:</p> <p className={`font-bold ${diagnosticInfo.confidence === 'alta' ? 'text-green-400' : 'text-yellow-400'}`}>{diagnosticInfo.confidence?.toUpperCase() || '...'}</p>
                      <p>IA Timestamp:</p> <p className="text-white">{diagnosticInfo.ocrTimestamp || 'Pendente'}</p>
                    </div>

                    {diagnosticInfo.ocrError && (
                      <div className="mb-4 bg-red-950/30 border border-red-900/50 p-2 rounded-lg text-red-300 text-[8px] leading-tight">
                        <p className="font-bold mb-1 tracking-wider">[ ERRO DETALHADO ]</p>
                        {diagnosticInfo.ocrError}
                      </div>
                    )}
                    
                    <div className="space-y-3">
                      <div>
                        <p className="text-white/40 text-[8px] uppercase font-bold mb-1">Nome Identificado</p>
                        <p className="text-xs text-yellow-300 font-bold bg-yellow-400/10 p-2 rounded-lg border border-yellow-400/20">
                          {diagnosticInfo.detectedName || 'vazio'}
                        </p>
                      </div>
                      <div>
                        <p className="text-white/40 text-[8px] uppercase font-bold mb-1">Casa Identificada</p>
                        <p className="text-xs text-yellow-300 font-bold bg-yellow-400/10 p-2 rounded-lg border border-yellow-400/20">
                          {diagnosticInfo.detectedHouse || 'vazio'}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="bg-green-950/20 p-4 rounded-2xl border border-green-900/20">
                    <p className="text-white mb-2 font-bold text-xs"> [ TEXTO EXTRAÍDO ] </p>
                    <div className="bg-black/50 p-3 rounded-xl border border-green-900/30 font-mono text-[9px] leading-relaxed max-h-[150px] overflow-y-auto text-green-500/80">
                      {diagnosticInfo.rawOcrText || 'Nenhum texto bruto disponível ainda.'}
                    </div>
                  </section>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}