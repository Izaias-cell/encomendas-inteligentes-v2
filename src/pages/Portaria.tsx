import { getPackageItemCount, sumPackageItems, normalizeResidentPhone, getPackagesNeedingNotification as getPackagesNeedingNotificationUtil, isPackageNotificationConfirmed, isPackageDelivered, shouldShowOperationalNotifyHeader, getPackageNotificationBadgeState, getConfirmedPackagesForResend, parseQrScanInput, validateQrScanResult } from '../lib/packageUtils';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Profile, Morador } from '../types';
import { feedback } from '../lib/feedback';
import { 
  Package as PackageIcon, 
  Plus, 
  Loader2, 
  Search, 
  Users, 
  CheckCircle, 
  Clock, 
  User, 
  Home, 
  Truck, 
  Calendar,
  QrCode,
  ArrowRight,
  X,
  Check,
  Hash,
  Keyboard,
  Phone,
  Building2,
  Smartphone,
  AlertCircle,
  UserPlus,
  Edit,
  Save,
  MessageSquare,
  MessageCircle,
  Camera,
  Eye,
  Trash2,
  MoreVertical,
  Power,
  Send,
  Zap,
  Layers,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  FileSpreadsheet,
  Volume2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { getResidentAddressLines, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';
import { getCurrentPorter, setManualPorter, clearManualPorter } from '../lib/porterUtils';
import { 
  getActivePlantao, 
  setActivePlantao as saveActivePlantao, 
  clearActivePlantao, 
  isTimeInShift, 
  isPlantaoExpired,
  findEligiblePorterForShift,
  PlantaoAtivo 
} from '../lib/plantaoUtils';

import toast from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'motion/react';
import { getWhatsAppLink, generatePickupCode, prepareWhatsAppNotification } from '../services/whatsappService';
import { executeManualSendConfirmation, executePortariaAutoSend } from '../services/whatsappConfirmationService';
import { recordCondoActivity, fetchCondoActivity, subscribeCondoActivity, shouldShowInactivityAlert, CondoActivityAction, CondoActivitySubscription } from '../services/activitySyncService';
import { CondominiumSettings } from '../types';

import PackageItem from '../components/portaria/PackageItem';
import ResidentCard from '../components/portaria/ResidentCard';
import ResidentImporterModal from '../components/ResidentImporterModal';
import { api, generateSecureToken } from '../lib/apiClient';

interface PortariaProps {
  user: Profile;
}

const KNOWN_CARRIERS = [
  'Shopee',
  'Mercado Livre',
  'Amazon',
  'Correios',
  'TikTok Shop',
  'Shein',
  'Magalu',
  'Jadlog',
  'Loggi'
];

const extractKnownCarrier = (notes?: string): string => {
  if (!notes) return '';
  const lower = notes.toLowerCase();
  const found = KNOWN_CARRIERS.find(c => lower.includes(c.toLowerCase()));
  return found || '';
};

export default function Portaria({ user }: PortariaProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [residents, setResidents] = useState<Morador[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchSeqRef = useRef(0);
  const recentlyConfirmedNotifiedRef = useRef<Map<string, { fields: Record<string, any>; ts: number }>>(new Map());
  const markRecentlyConfirmedNotified = useCallback((ids: string[], fields: Record<string, any>) => {
    const ts = Date.now();
    ids.filter(Boolean).forEach(id => {
      recentlyConfirmedNotifiedRef.current.set(id, { fields, ts });
    });
  }, []);
  const [searchTerm, setSearchTerm] = useState('');
  const [notifyAfter, setNotifyAfter] = useState(() => {
    return localStorage.getItem('notify_after_registration') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('notify_after_registration', notifyAfter.toString());
  }, [notifyAfter]);

  const [activeTab, setActiveTab] = useState<'pending' | 'delivered' | 'all' | 'residents'>('pending');
  const [hasMoreDelivered, setHasMoreDelivered] = useState(true);
  const [isLoadingMoreDelivered, setIsLoadingMoreDelivered] = useState(false);
  const [activeResidentMenu, setActiveResidentMenu] = useState<string | null>(null);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const navigate = useNavigate();

  // Batch WhatsApp State
  const [isBatchSending, setIsBatchSending] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [condoSettings, setCondoSettings] = useState<CondominiumSettings | null>(null);
  const [batchMode, setBatchMode] = useState<'api' | 'manual'>('api');
  const [batchStep, setBatchStep] = useState<'confirm' | 'sending' | 'manual_list' | 'finished'>('confirm');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [manualIndex, setManualIndex] = useState(0);
  const [batchPackages, setBatchPackages] = useState<Package[]>([]);
  const [notificationSuccess, setNotificationSuccess] = useState(false);
  const [condoName, setCondoName] = useState('');
  const [currentPorter, setCurrentPorter] = useState(() => getCurrentPorter(user?.condominium_id));
  const [showPorterModal, setShowPorterModal] = useState(false);

  // Shift Management States (FASE 3, 4, 5, 6, 7 & 8)
  const [activePlantao, setActivePlantaoState] = useState<PlantaoAtivo | null>(() => getActivePlantao(user?.condominium_id));
  const [porteirosList, setPorteirosList] = useState<Profile[]>([]);
  const [showShiftModal, setShowShiftModal] = useState<boolean>(() => {
    const current = getActivePlantao(user?.condominium_id);
    return !current || isPlantaoExpired(current);
  });
  const [isShiftExpired, setIsShiftExpired] = useState<boolean>(false);

  // Substitution State (FASE 7)
  const [showSubstitutionModal, setShowSubstitutionModal] = useState<boolean>(false);
  const [showSubstituteFormModal, setShowSubstituteFormModal] = useState<boolean>(false);
  const [substituteFormName, setSubstituteFormName] = useState<string>('');
  const [substituteFormDoc, setSubstituteFormDoc] = useState<string>('');
  const [substituteFormPhone, setSubstituteFormPhone] = useState<string>('');
  const [substituteFormObs, setSubstituteFormObs] = useState<string>('');
  const [selectedSubstituto, setSelectedSubstituto] = useState<Profile | null>(null);
  const [selectedSubstituido, setSelectedSubstituido] = useState<Profile | null>(null);
  const [motivoSubstituicao, setMotivoSubstituicao] = useState<string>('Troca de Turno');
  const [obsSubstituicao, setObsSubstituicao] = useState<string>('');

  const autoActivatePlantao = (porteiro: Profile) => {
    const newPlantao: PlantaoAtivo = {
      id: porteiro.id,
      condominium_id: user?.condominium_id || '',
      porteiro_id: porteiro.id,
      porteiro_nome: porteiro.full_name,
      horario_inicio: porteiro.horario_inicio || '00:00',
      horario_fim: porteiro.horario_fim || '23:59',
      started_at: new Date().toISOString(),
      substituicao: {
        is_substituicao: false
      }
    };

    saveActivePlantao(newPlantao);
    setActivePlantaoState(newPlantao);
    setCurrentPorter(porteiro.full_name);
    setManualPorter(porteiro.full_name, user?.condominium_id);
    setShowShiftModal(false);
    setShowPorterModal(false);
    setIsShiftExpired(false);

    registrarAuditoria({
      condominio_id: user?.condominium_id || '',
      usuario_id: user?.id || '',
      usuario_nome: user?.full_name || 'Porteiro',
      usuario_perfil: user?.role || 'porteiro',
      tipo_evento: 'INICIO_PLANTAO',
      acao: 'CREATE',
      tabela_afetada: 'profiles',
      registro_id: porteiro.id,
      descricao: `Início automático do plantão por escala (${porteiro.escala_tipo === 'impar' ? 'Dia Ímpar' : porteiro.escala_tipo === 'par' ? 'Dia Par' : 'Diário'}): ${porteiro.full_name} (${porteiro.horario_inicio || '00:00'} às ${porteiro.horario_fim || '23:59'})`,
      metodo: 'SISTEMA'
    }).catch(() => {});
  };

  const fetchPorteiros = async () => {
    if (!user?.condominium_id) return;
    try {
      const res = await api.get(`/api/operational/context?condominiumId=${encodeURIComponent(user.condominium_id)}`);
      const data = res.ok ? (res.data?.porters || []) : null;

      if (data) {
        setPorteirosList(data);

        // Identificação automática por escala (Ímpar/Par/Diário)
        const current = getActivePlantao(user.condominium_id);
        if (!current || isPlantaoExpired(current)) {
          const { eligiblePorter, count } = findEligiblePorterForShift(data, new Date(), user.condominium_id);
          if (eligiblePorter && count === 1) {
            autoActivatePlantao(eligiblePorter);
          } else {
            setActivePlantaoState(null);
            setCurrentPorter('Selecione o Porteiro');
            setShowShiftModal(true);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao buscar porteiros:', err);
    }
  };

  useEffect(() => {
    if (user?.condominium_id) {
      const current = getActivePlantao(user.condominium_id);
      setActivePlantaoState(current);
      setCurrentPorter(getCurrentPorter(user.condominium_id));
      setShowShiftModal(!current || isPlantaoExpired(current));
      fetchPorteiros();
    }
  }, [user?.condominium_id]);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      const current = getActivePlantao(user?.condominium_id);
      if (current) {
        if (isPlantaoExpired(current)) {
          // Plantão expirou: tenta identificar automaticamente o próximo porteiro da escala
          const { eligiblePorter, count } = findEligiblePorterForShift(porteirosList, new Date(), user?.condominium_id);
          if (eligiblePorter && count === 1) {
            autoActivatePlantao(eligiblePorter);
          } else {
            setActivePlantaoState(null);
            setCurrentPorter('Selecione o Porteiro');
            setIsShiftExpired(true);
            setShowShiftModal(true);
          }
        } else {
          setIsShiftExpired(false);
        }
      } else {
        const { eligiblePorter, count } = findEligiblePorterForShift(porteirosList, new Date(), user?.condominium_id);
        if (eligiblePorter && count === 1) {
          autoActivatePlantao(eligiblePorter);
        } else {
          setActivePlantaoState(null);
          setCurrentPorter('Selecione o Porteiro');
          setShowShiftModal(true);
        }
      }
    }, 15000);

    return () => clearInterval(checkInterval);
  }, [user?.condominium_id, porteirosList]);

  const handleSelectPlantao = (porteiro: Profile) => {
    const now = new Date();
    const inShift = isTimeInShift(now, porteiro.horario_inicio, porteiro.horario_fim);

    if (!inShift) {
      setSelectedSubstituto(porteiro);
      setShowSubstitutionModal(true);
      return;
    }

    const newPlantao: PlantaoAtivo = {
      id: porteiro.id,
      condominium_id: user?.condominium_id || '',
      porteiro_id: porteiro.id,
      porteiro_nome: porteiro.full_name,
      horario_inicio: porteiro.horario_inicio || '00:00',
      horario_fim: porteiro.horario_fim || '23:59',
      started_at: new Date().toISOString(),
      substituicao: {
        is_substituicao: false
      }
    };

    saveActivePlantao(newPlantao);
    setActivePlantaoState(newPlantao);
    setCurrentPorter(porteiro.full_name);
    setManualPorter(porteiro.full_name, user?.condominium_id);
    setShowShiftModal(false);
    setShowPorterModal(false);
    setIsShiftExpired(false);

    registrarAuditoria({
      condominio_id: user?.condominium_id || '',
      usuario_id: user?.id || '',
      usuario_nome: user?.full_name || 'Porteiro',
      usuario_perfil: user?.role || 'porteiro',
      tipo_evento: 'INICIO_PLANTAO',
      acao: 'CREATE',
      tabela_afetada: 'profiles',
      registro_id: porteiro.id,
      descricao: `Início do plantão assumido por ${porteiro.full_name} (${porteiro.horario_inicio || '00:00'} às ${porteiro.horario_fim || '23:59'})`,
      metodo: 'SISTEMA'
    }).catch(() => {});

    toast.success(`Plantão iniciado com sucesso! Porteiro responsável: ${porteiro.full_name} 🕒`);
  };

  const handleConfirmSubstitutoTemporario = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = substituteFormName.trim();
    const cleanDoc = substituteFormDoc.trim();

    if (!cleanName) {
      toast.error("Por favor, informe o Nome Completo do porteiro substituto.");
      return;
    }
    if (!cleanDoc) {
      toast.error("Por favor, informe o Documento (RG/CPF) do porteiro substituto.");
      return;
    }

    const tempId = `sub_${Date.now()}`;
    const now = new Date();
    const currentHourStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newPlantao: PlantaoAtivo = {
      id: tempId,
      condominium_id: user?.condominium_id || '',
      porteiro_id: tempId,
      porteiro_nome: cleanName,
      horario_inicio: activePlantao?.horario_inicio || currentHourStr,
      horario_fim: activePlantao?.horario_fim || '23:59',
      started_at: now.toISOString(),
      substituicao: {
        is_substituicao: true,
        substituido_id: activePlantao?.porteiro_id || undefined,
        substituido_nome: activePlantao?.porteiro_nome || undefined,
        motivo: 'Porteiro Substituto (Cobertura de Ausência)',
        observacoes: `Doc: ${cleanDoc}${substituteFormPhone ? ` | Tel: ${substituteFormPhone}` : ''}${substituteFormObs ? ` | Obs: ${substituteFormObs}` : ''}`
      }
    };

    saveActivePlantao(newPlantao);
    setActivePlantaoState(newPlantao);
    setCurrentPorter(cleanName);
    setManualPorter(cleanName, user?.condominium_id);

    setShowSubstituteFormModal(false);
    setShowShiftModal(false);
    setShowPorterModal(false);
    setIsShiftExpired(false);

    // Limpa formulário
    setSubstituteFormName('');
    setSubstituteFormDoc('');
    setSubstituteFormPhone('');
    setSubstituteFormObs('');

    // Auditoria de segurança e rastreabilidade
    registrarAuditoria({
      condominio_id: user?.condominium_id || '',
      usuario_id: user?.id || '',
      usuario_nome: user?.full_name || 'Porteiro',
      usuario_perfil: user?.role || 'porteiro',
      tipo_evento: 'SUBSTITUICAO_PLANTAO',
      acao: 'CREATE',
      tabela_afetada: 'plantao_ativo',
      registro_id: tempId,
      descricao: `Porteiro Substituto assumiu o plantão: ${cleanName} (Doc: ${cleanDoc}). Titular anterior: ${activePlantao?.porteiro_nome || 'Nenhum'}. Operado por: ${user?.full_name || 'Usuário Autenticado'}.`,
      metodo: 'SISTEMA'
    }).catch(() => {});

    toast.success(`Porteiro Substituto ${cleanName.toUpperCase()} assumiu o plantão com sucesso! 🔁`);
  };

  const handleConfirmSubstitution = () => {
    if (!selectedSubstituto) return;

    const newPlantao: PlantaoAtivo = {
      id: selectedSubstituto.id,
      condominium_id: user?.condominium_id || '',
      porteiro_id: selectedSubstituto.id,
      porteiro_nome: selectedSubstituto.full_name,
      horario_inicio: selectedSubstituto.horario_inicio || '00:00',
      horario_fim: selectedSubstituto.horario_fim || '23:59',
      started_at: new Date().toISOString(),
      substituicao: {
        is_substituicao: true,
        substituido_id: selectedSubstituido?.id,
        substituido_nome: selectedSubstituido?.full_name,
        motivo: motivoSubstituicao,
        observacoes: obsSubstituicao
      }
    };

    saveActivePlantao(newPlantao);
    setActivePlantaoState(newPlantao);
    setCurrentPorter(selectedSubstituto.full_name);
    setManualPorter(selectedSubstituto.full_name, user?.condominium_id);
    setShowSubstitutionModal(false);
    setShowShiftModal(false);
    setShowPorterModal(false);
    setIsShiftExpired(false);

    registrarAuditoria({
      condominio_id: user?.condominium_id || '',
      usuario_id: user?.id || '',
      usuario_nome: user?.full_name || 'Porteiro',
      usuario_perfil: user?.role || 'porteiro',
      tipo_evento: 'SUBSTITUICAO_PLANTAO',
      acao: 'CREATE',
      tabela_afetada: 'profiles',
      registro_id: selectedSubstituto.id,
      descricao: `Substituição de plantão registrada: Substituto ${selectedSubstituto.full_name}${selectedSubstituido ? ` (no lugar de ${selectedSubstituido.full_name})` : ''}. Motivo: ${motivoSubstituicao}. Obs: ${obsSubstituicao || 'Nenhuma'}`,
      metodo: 'SISTEMA'
    }).catch(() => {});

    toast.success(`Substituição de plantão registrada! Porteiro: ${selectedSubstituto.full_name} 🔁`);
  };

  useEffect(() => {
    if (currentPorter === 'Selecione o Porteiro') {
      setShowPorterModal(true);
    }
  }, [currentPorter]);
  const [showConfirmDelivery, setShowConfirmDelivery] = useState(false);
  const [isConfirmingDelivery, setIsConfirmingDelivery] = useState(false);
  const [packageToConfirm, setPackageToConfirm] = useState<Package | null>(null);

  // Pulse animation state for "TIRAR FOTO" button
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    const triggerPulse = () => {
      setPulseKey(prev => prev + 1);
    };
    
    // Initial trigger
    const timer = setTimeout(triggerPulse, 500);

    window.addEventListener('focus', triggerPulse);
    return () => {
      window.removeEventListener('focus', triggerPulse);
      clearTimeout(timer);
    };
  }, []);

  // 7. Função única para processar/filtrar encomendas que precisam de aviso (sem descartar silenciosamente)
  const getPackagesNeedingNotification = useCallback((pkgList: Package[], includeIncompletePhone: boolean = true) => {
    return getPackagesNeedingNotificationUtil(pkgList, residents, includeIncompletePhone);
  }, [residents]);

  // Single Source of Truth for Pending Notifications (soma real de itens/encomendas)
  const pendingNoticesCount = useMemo(() => {
    const list = getPackagesNeedingNotification(packages, true);
    return sumPackageItems(list);
  }, [packages, residents]);

  // ITEM 2: Contagem de MORADORES distintos pendentes de notificação
  const pendingResidentsCount = useMemo(() => {
    const list = getPackagesNeedingNotification(packages, true);
    const distinctResidentIds = new Set<string>();
    list.forEach(p => {
      const resId = p.recipient_id || (p as any).moradores?.id;
      if (resId) distinctResidentIds.add(resId);
    });
    return distinctResidentIds.size;
  }, [packages, residents]);

  // ITEM 2: Rastreamento de inatividade compartilhado por condomínio no modo APÓS REGISTRO
  const lastSendActivityTimestampRef = useRef<number>(Date.now());
  const [showInactivityAlert, setShowInactivityAlert] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activitySubRef = useRef<CondoActivitySubscription | null>(null);

  const applyRemoteActivityTimestamp = useCallback((ts: number) => {
    if (!Number.isFinite(ts) || ts <= 0) return;
    if (ts > lastSendActivityTimestampRef.current) {
      lastSendActivityTimestampRef.current = ts;
      try {
        localStorage.setItem('last_send_activity_timestamp', ts.toString());
      } catch (e) {}
    }
    if (!shouldShowInactivityAlert({
      lastActivityTimestamp: lastSendActivityTimestampRef.current,
      now: Date.now(),
      pendingCount: pendingResidentsCount,
      notifyAfter
    })) {
      setShowInactivityAlert(false);
    }
  }, [pendingResidentsCount, notifyAfter]);

  // Inicialização síncrona + sincronização compartilhada no servidor/Supabase por condomínio
  useEffect(() => {
    const saved = localStorage.getItem('last_send_activity_timestamp');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    if (!isNaN(parsed) && parsed > 0) {
      lastSendActivityTimestampRef.current = parsed;
    } else {
      try {
        localStorage.setItem('last_send_activity_timestamp', lastSendActivityTimestampRef.current.toString());
      } catch (e) {}
    }

    if (!user?.condominium_id) return;
    fetchCondoActivity({ condominiumId: user.condominium_id }).then((res) => {
      if (res.ok && res.lastActivityTimestamp) {
        applyRemoteActivityTimestamp(res.lastActivityTimestamp);
      }
    }).catch(() => {});
  }, [user?.condominium_id, applyRemoteActivityTimestamp]);

  // Inscrição Realtime isolada por condominiumId (Broadcast de atividade + mudanças na tabela packages)
  useEffect(() => {
    if (!user?.condominium_id) return;
    const sub = subscribeCondoActivity({
      condominiumId: user.condominium_id,
      onRemoteActivity: (ts) => {
        applyRemoteActivityTimestamp(ts);
      },
      onPackagesChanged: () => {
        fetchData(true);
      }
    });
    activitySubRef.current = sub;
    return () => {
      sub.unsubscribe();
      activitySubRef.current = null;
    };
  }, [user?.condominium_id, applyRemoteActivityTimestamp]);

  // Helper síncrono + sincronização remota compartilhada (sem alterar status da encomenda)
  const recordSendActivity = useCallback((action: CondoActivityAction = 'FILA_ACAO', packageId?: string) => {
    const now = Date.now();
    lastSendActivityTimestampRef.current = now;
    try {
      localStorage.setItem('last_send_activity_timestamp', now.toString());
    } catch (e) {
      console.warn('Erro ao salvar timestamp de atividade:', e);
    }
    setShowInactivityAlert(false);

    if (user?.condominium_id) {
      recordCondoActivity({
        condominiumId: user.condominium_id,
        action,
        userId: user.id,
        userName: (currentPorter && currentPorter !== 'Selecione o Porteiro') ? currentPorter : (user.full_name || 'Porteiro'),
        userRole: user.role || 'porteiro',
        packageId,
        timestamp: now,
        realtimeBroadcastFn: (payload) => activitySubRef.current?.broadcast(payload)
      }).catch(() => {});
    }
  }, [user?.condominium_id, user?.id, user?.full_name, user?.role, currentPorter]);

  // Estado da confirmação explícita de envio no WhatsApp
  const [resendingPackageKey, setResendingPackageKey] = useState<string | null>(null);
  const [isConfirmingWhatsApp, setIsConfirmingWhatsApp] = useState(false);
  const [confirmWhatsAppError, setConfirmWhatsAppError] = useState<string | null>(null);
  const [pendingWhatsAppConfirm, setPendingWhatsAppConfirm] = useState<{
    resident: any;
    packageIds: string[];
    residentName: string;
    unit: string;
    totalItems: number;
    pickupCode: string;
    pickupToken: string;
    message: string;
    isQueue?: boolean;
    queueIndex?: number;
    isBatchManual?: boolean;
    batchManualIndex?: number;
    isResend?: boolean;
    existingNotifiedAt?: string;
    existingWhatsappSentAt?: string;
  } | null>(null);
  const pendingWhatsAppConfirmRef = useRef(pendingWhatsAppConfirm);
  pendingWhatsAppConfirmRef.current = pendingWhatsAppConfirm;

  // PARTE 1: Nível de volume configurável com base no nível atual (ponto de partida = 1.0x, nunca reinicia do mínimo)
  const [alertVolumeMultiplier, setAlertVolumeMultiplier] = useState<number>(() => {
    const saved = localStorage.getItem('alert_sound_volume_multiplier');
    const parsed = saved ? parseFloat(saved) : NaN;
    return !isNaN(parsed) && parsed >= 1.0 ? parsed : 1.0;
  });
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const bellClickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bellLastClickTimeRef = useRef<number>(0);

  // Função para tocar alerta sonoro altamente perceptível (dupla sequência com volume encorpado ajustável)
  const playAlertSound = useCallback((testMultiplier?: number) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const mult = testMultiplier !== undefined ? testMultiplier : alertVolumeMultiplier;

      const playChime = (freq: number, start: number, dur: number, baseVol = 0.50) => {
        // Oscilador principal
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

        // Oscilador harmônico secundário (oitava fundamental suave) para dar corpo e penetração acústica na guarita
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(freq / 2, ctx.currentTime + start);

        // Aplica o multiplicador a partir do nível atual, com teto seguro de 0.98 para evitar distorção
        const actualVol = Math.min(baseVol * mult, 0.98);
        gain.gain.setValueAtTime(actualVol, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);

        subGain.gain.setValueAtTime(actualVol * 0.35, ctx.currentTime + start);
        subGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        subOsc.connect(subGain);
        subGain.connect(ctx.destination);

        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
        subOsc.start(ctx.currentTime + start);
        subOsc.stop(ctx.currentTime + start + dur);
      };
      // Sequência 1 com timbre encorpado e cadência compassada
      playChime(587.33, 0.00, 0.30, 0.50);  // D5
      playChime(739.99, 0.28, 0.32, 0.55);  // F#5
      playChime(880.00, 0.56, 0.58, 0.60);  // A5
      // Sequência 2 (repetição de reforço com presença sonora nítida)
      playChime(587.33, 1.00, 0.30, 0.50);  // D5
      playChime(739.99, 1.28, 0.32, 0.55);  // F#5
      playChime(880.00, 1.56, 0.70, 0.65);  // A5

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([350, 200, 350, 200, 500]);
      }
    } catch (e) {
      console.warn('Alerta sonoro não reproduzido:', e);
    }
  }, [alertVolumeMultiplier]);
  // Lista de encomendas com telefone incompleto
  const incompletePhoneCount = useMemo(() => {
    const list = getPackagesNeedingNotification(packages, true);
    return list.filter(p => {
      const resident = residents.find(r => r.id === p.recipient_id) || (p as any).moradores;
      if (!resident || !resident.telefone) return true;
      return normalizeResidentPhone(resident.telefone).isIncomplete;
    }).length;
  }, [packages, residents]);

  // Função única para decidir se existem notificações reais pendentes
  const hasPendingNotifications = () => {
    return pendingNoticesCount > 0;
  };

  // Estado do Alerta Periódico (repete a cada 3 min, com silenciador de 5 min)
  const [isAlertSnoozed, setIsAlertSnoozed] = useState(false);
  const snoozeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Silencia temporariamente por 5 minutos (Item 5)
  const handleSnoozeAlert = () => {
    setIsAlertSnoozed(true);
    toast.success('Alerta sonoro silenciado por 5 minutos.', { icon: '🔕' });
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    snoozeTimerRef.current = setTimeout(() => {
      setIsAlertSnoozed(false);
    }, 5 * 60 * 1000); // 5 minutos exatos
  };

  // Cancela o silenciamento imediatamente e reativa o som (Item 4)
  const handleUnSnoozeAlert = () => {
    setIsAlertSnoozed(false);
    if (snoozeTimerRef.current) {
      clearTimeout(snoozeTimerRef.current);
      snoozeTimerRef.current = null;
    }
    toast.success('Alerta sonoro reativado.', { icon: '🔔' });
    // Se estiver em modo de alerta, reproduz o som imediatamente como confirmação
    if (showInactivityAlert) {
      playAlertSound();
    }
  };

  // Alterna o silenciamento no toque simples (Item 4: 1º toque silencia, toque subsequente cancela)
  const handleToggleSnooze = () => {
    if (isAlertSnoozed) {
      handleUnSnoozeAlert();
    } else {
      handleSnoozeAlert();
    }
  };

  // Handler do Sininho com diferenciação de TOQUE SIMPLES (silenciar/reativar) e 2 TOQUES RÁPIDOS (controle de volume)
  const handleBellClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const DOUBLE_TAP_DELAY_MS = 350; // janela de duplo toque rápido
    const timeSinceLast = now - bellLastClickTimeRef.current;

    if (timeSinceLast < DOUBLE_TAP_DELAY_MS) {
      // DUPLO TOQUE RÁPIDO DETECTADO: Abre controle pequeno de volume (Item 6)
      if (bellClickTimerRef.current) {
        clearTimeout(bellClickTimerRef.current);
        bellClickTimerRef.current = null;
      }
      bellLastClickTimeRef.current = 0;
      setShowVolumePopup(prev => !prev);
    } else {
      // PRIMEIRO TOQUE: Aguarda brevemente para verificar se é duplo toque rápido
      bellLastClickTimeRef.current = now;
      if (bellClickTimerRef.current) clearTimeout(bellClickTimerRef.current);
      bellClickTimerRef.current = setTimeout(() => {
        // TOQUE SIMPLES CONFIRMADO: Alterna entre Silenciar (5 min) e Reativar Som (Item 4 e 5)
        handleToggleSnooze();
        bellClickTimerRef.current = null;
        bellLastClickTimeRef.current = 0;
      }, DOUBLE_TAP_DELAY_MS);
    }
  };

  const handleIncreaseVolume = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Aumenta o volume a partir do nível atual (+25% por toque, até 2.25x máximo)
    setAlertVolumeMultiplier(prev => {
      const next = Math.min(Math.round((prev + 0.25) * 100) / 100, 2.25);
      localStorage.setItem('alert_sound_volume_multiplier', next.toString());
      toast.success('Volume do alerta: ' + Math.round(next * 100) + '% 🔊', { id: 'vol-toast', duration: 2500 });
      // Toca bipe de teste no novo volume para confirmação auditiva imediata
      playAlertSound(next);
      return next;
    });
  };
  // Observador de Inatividade de Envio no modo APÓS REGISTRO (3 min / 180.000 ms inatividade -> Alerta -> repete a cada 3 min)
  useEffect(() => {
    // Se não há moradores pendentes ou não está no modo APÓS REGISTRO, encerra completamente o ciclo
    if (!notifyAfter || pendingResidentsCount === 0) {
      setShowInactivityAlert(false);
      try {
        localStorage.removeItem('last_send_activity_timestamp');
      } catch (e) {}
      return;
    }

    const evaluateInactivity = () => {
      let baseTs = lastSendActivityTimestampRef.current;
      const savedTs = localStorage.getItem('last_send_activity_timestamp');
      if (savedTs) {
        const parsedTs = parseInt(savedTs, 10);
        if (!isNaN(parsedTs) && parsedTs > baseTs) {
          baseTs = parsedTs;
          lastSendActivityTimestampRef.current = parsedTs;
        }
      }

      const active = shouldShowInactivityAlert({
        lastActivityTimestamp: baseTs,
        now: Date.now(),
        pendingCount: pendingResidentsCount,
        notifyAfter
      });
      setShowInactivityAlert(active);
    };

    const syncAndCheckInactivity = async () => {
      evaluateInactivity();
      if (user?.condominium_id) {
        const remote = await fetchCondoActivity({ condominiumId: user.condominium_id }).catch(() => null);
        if (remote?.ok && remote.lastActivityTimestamp) {
          applyRemoteActivityTimestamp(remote.lastActivityTimestamp);
          evaluateInactivity();
        }
      }
    };

    // Executa verificação imediata na montagem/retorno
    syncAndCheckInactivity();

    // ITEM 3: Reavaliação imediata quando a tela/aba volta a ficar visível (Page Visibility API e window focus)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncAndCheckInactivity();
      }
    };
    const handleWindowFocus = () => {
      syncAndCheckInactivity();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    // Avaliação local a cada 5s e reconciliação remota periódica a cada 10s
    const checkInterval = setInterval(evaluateInactivity, 5000);
    const remoteSyncInterval = setInterval(syncAndCheckInactivity, 10000);

    let repeatSoundInterval: NodeJS.Timeout | null = null;

    // Se atingiu os 3 minutos (180.000 ms) de inatividade:
    if (showInactivityAlert && !isAlertSnoozed) {
      playAlertSound();
      // Repete o alerta sonoro a cada 3 minutos se continuar sem envio
      repeatSoundInterval = setInterval(() => {
        playAlertSound();
      }, 3 * 60 * 1000);
    }

    return () => {
      clearInterval(checkInterval);
      clearInterval(remoteSyncInterval);
      if (repeatSoundInterval) clearInterval(repeatSoundInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [notifyAfter, pendingResidentsCount, isAlertSnoozed, showInactivityAlert, playAlertSound, user?.condominium_id, applyRemoteActivityTimestamp]);

  // Notificar Todos queue state
  const [isNotifyingAll, setIsNotifyingAll] = useState(false);
  const [isWaitingForReturn, setIsWaitingForReturn] = useState(false);
  const [lastNotifiedPackageId, setLastNotifiedPackageId] = useState<string | null>(null);
  const [notifyQueue, setNotifyQueue] = useState<any[]>([]);
  const [notifyIndex, setNotifyIndex] = useState(0);
  const [modoEnvio, setModoEnvio] = useState<'individual' | 'batch' | 'mass_manual' | null>(null);

  // Timer para fechamento automático da fila de notificações (Mensagem Final)
  useEffect(() => {
    let closeTimer: NodeJS.Timeout | null = null;
    
    // Se a fila terminou e o modal está aberto, fecha automaticamente após 1.5s
    if (isNotifyingAll && notifyQueue.length > 0 && notifyIndex >= notifyQueue.length) {
      closeTimer = setTimeout(() => {
        setIsNotifyingAll(false);
        setNotifyQueue([]);
        setNotifyIndex(0);
        setModoEnvio(null);
        fetchData();
        
        // Show success state on the button
        setNotificationSuccess(true);
        setTimeout(() => setNotificationSuccess(false), 3000);
      }, 1500);
    }

    return () => {
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [isNotifyingAll, notifyIndex, notifyQueue.length]);

  const handleConfirmWhatsAppSent = async (confirmData: {
    resident: any;
    packageIds: string[];
    residentName: string;
    unit: string;
    totalItems: number;
    pickupCode: string;
    pickupToken: string;
    message: string;
    isQueue?: boolean;
    queueIndex?: number;
    isBatchManual?: boolean;
    batchManualIndex?: number;
    isResend?: boolean;
    existingNotifiedAt?: string;
    existingWhatsappSentAt?: string;
  }) => {
    if (isConfirmingWhatsApp) return;
    setIsConfirmingWhatsApp(true);
    setConfirmWhatsAppError(null);

    try {
      const {
        packageIds,
        pickupCode,
        pickupToken,
        message,
        residentName,
        isQueue,
        queueIndex,
        isBatchManual,
        isResend,
        existingNotifiedAt,
        existingWhatsappSentAt
      } = confirmData;

      // 1 & 2. Persistência no Supabase com verificação completa do retorno — estado local e fila só atualizam APÓS confirmação do banco
      const result = await executeManualSendConfirmation({
        packageIds,
        condominiumId: user?.condominium_id,
        pickupCode,
        pickupToken,
        message,
        ...(isResend && existingNotifiedAt ? { notifiedAt: existingNotifiedAt } : {}),
        ...(isResend && existingWhatsappSentAt ? { whatsappSentAt: existingWhatsappSentAt } : {}),
        onConfirmedLocalState: (fields) => {
          markRecentlyConfirmedNotified(packageIds, fields);
          setPackages(prev => prev.map(p => packageIds.includes(p.id) ? {
            ...p,
            ...fields
          } : p));
        }
      });

      if (!result.ok) {
        const errMessage = result.error || (isResend
          ? 'Erro ao registrar reenvio no banco de dados. A notificação anterior permanece mantida.'
          : 'Erro ao salvar confirmação no banco de dados. A encomenda permanece pendente.');
        console.error('Erro ao atualizar pacotes no banco:', errMessage);
        setConfirmWhatsAppError(errMessage);
        toast.error(errMessage, { duration: 5000 });
        return;
      }

      // 3. Registrar atividade compartilhada (condomínio isolado) e limpar alerta sonoro
      recordSendActivity('WHATSAPP_CONFIRMADO', packageIds[0]);

      // 4. Se estiver em fila, avança para o próximo ou encerra se for o último
      if (isQueue && typeof queueIndex === 'number') {
        const curIdx = queueIndex;
        if (curIdx + 1 < notifyQueue.length) {
          setNotifyIndex(prev => prev + 1);
        } else {
          setNotifyIndex(notifyQueue.length);
          setTimeout(() => {
            setIsNotifyingAll(false);
            setModoEnvio(null);
            toast.success('Todas as notificações foram confirmadas!');
          }, 500);
        }
      }

      if (isBatchManual) {
        if (manualIndex + 1 >= batchPackages.length) {
          setShowBatchModal(false);
          setBatchStep('confirm');
          toast.success('Todos os avisos foram processados!');
        } else {
          setManualIndex(prev => prev + 1);
        }
      }

      setConfirmWhatsAppError(null);
      setPendingWhatsAppConfirm(null);
      toast.success(isResend ? `Reenvio confirmado para ${residentName}! 💬` : `Envio confirmado para ${residentName}! 💬`);
      await fetchData(true);
    } catch (e: any) {
      const errMessage = e instanceof Error ? e.message : 'Erro ao processar confirmação de envio';
      console.error('Erro ao confirmar envio:', e);
      setConfirmWhatsAppError(errMessage);
      toast.error('Erro ao processar confirmação de envio. Tente novamente.');
    } finally {
      setIsConfirmingWhatsApp(false);
    }
  };

  const handleCancelWhatsAppSent = () => {
    if (isConfirmingWhatsApp) return;
    const wasResend = Boolean(pendingWhatsAppConfirm?.isResend);
    // NÃO altera o banco de dados. No envio inicial permanece pendente; no reenvio preserva a notificação já confirmada.
    recordSendActivity('WHATSAPP_CANCELADO', pendingWhatsAppConfirm?.packageIds?.[0]);
    setConfirmWhatsAppError(null);
    setPendingWhatsAppConfirm(null);
    toast(
      wasResend
        ? 'Reenvio não confirmado. A notificação anterior permanece mantida.'
        : 'Envio não confirmado. A encomenda permanece pendente de aviso.',
      {
        icon: 'ℹ️',
        duration: 4000
      }
    );
  };

  const processNextInQueue = async (currentIndex: number) => {
    const current = notifyQueue[currentIndex];
    if (!current) return;

    const { resident, packages: pkgBatch } = current;
    const pkgIds = pkgBatch.map((p: any) => p.id);

    // Setup message and codes
    let groupCode = pkgBatch.find((p: any) => p.pickup_code)?.pickup_code;
    let groupToken = pkgBatch.find((p: any) => p.pickup_token)?.pickup_token;
    if (!groupCode) groupCode = generatePickupCode();
    if (!groupToken) groupToken = generateSecureToken(16);

    // Contagem física canônica (idêntica à bolinha da Portaria): soma de todas as pendências ativas do morador
    const allPendingForResident = packages.filter((p: any) => p.recipient_id === resident.id && p.status !== 'delivered');
    const totalPhysicalPending = sumPackageItems(allPendingForResident.length > 0 ? allPendingForResident : pkgBatch);

    const message = prepareWhatsAppNotification(
      resident,
      condoName,
      groupCode,
      undefined,
      groupToken,
      totalPhysicalPending || 1,
      'disponivel',
      undefined,
      undefined,
      pkgBatch[0]?.photo_url
    );

    const link = getWhatsAppLink(resident.telefone, message, pkgBatch[0]?.photo_url);

    // 1. Abrir WhatsApp em nova aba (antes de qualquer await para evitar popup blocker)
    window.open(link, '_blank');

    // Registra atividade de abertura sem marcar encomenda como enviada
    recordSendActivity('WHATSAPP_ABERTO', pkgIds[0]);

    // 2. Exibir confirmação explícita — NÃO atualiza banco antes da confirmação do porteiro
    setConfirmWhatsAppError(null);
    setPendingWhatsAppConfirm({
      resident,
      packageIds: pkgIds,
      residentName: resident.nome,
      unit: formatPackageUnit(pkgBatch[0]),
      totalItems: totalPhysicalPending || 1,
      pickupCode: groupCode,
      pickupToken: groupToken,
      message,
      isQueue: true,
      queueIndex: currentIndex
    });

    setIsWaitingForReturn(true);
  };

  // Regra 5: Ao clicar em AVISAR MORADOR, ir DIRETAMENTE para a lista de pendências sem modal intermediário
  const handleGoToPendingResidents = () => {
    // 1. Muda a aba para pendentes
    setActiveTab('pending');
    // 2. Limpa qualquer termo de busca para exibir todas as pendências
    setSearchTerm('');
    // 3. Rola suavemente até a lista de encomendas/moradores pendentes
    window.scrollTo({ top: 350, behavior: 'smooth' });
    toast('Lista de encomendas pendentes aberta para envio.', { icon: '📦' });
  };

  const handleNotifyAll = () => {
    if (!notifyAfter) {
      toast('O botão AVISAR MORADOR atua exclusivamente no modo APÓS REGISTRO.');
      return;
    }
    // 7. Usar a regra da função de contagem (mantendo todas na fila)
    const pendentesAviso = getPackagesNeedingNotification(packages, true);

    if (pendentesAviso.length === 0) {
      feedback.error();
      toast('Não há encomendas pendentes de aviso no momento.');
      return;
    }

    // Determine mode
    const apiActive = condoSettings?.whatsapp_mode === 'api_automatica' && 
                     condoSettings?.api_url && 
                     condoSettings?.api_token;

    if (apiActive) {
      handleBatchSend();
      return;
    }

    // Manual flow grouping logic (aggregated by resident)
    const groups: { [key: string]: any } = {};
    const unnotifiable: string[] = [];

    pendentesAviso.forEach(pkg => {
      const residentId = pkg.recipient_id;
      if (!residentId) return;
      
      const res = residents.find(r => r.id === residentId) || (pkg as any).moradores;
      if (!groups[residentId]) {
        groups[residentId] = {
          resident: res,
          packages: []
        };
      }
      groups[residentId].packages.push(pkg);
      
      const phoneCheck = normalizeResidentPhone(res?.telefone);
      if (phoneCheck.isIncomplete || !phoneCheck.isValid) {
        if (res?.nome && !unnotifiable.includes(res.nome)) {
          unnotifiable.push(res.nome);
        }
      }
    });

    const queue = Object.values(groups).filter(g => {
      const phoneCheck = normalizeResidentPhone(g.resident?.telefone);
      return phoneCheck.isValid;
    });
    
    if (queue.length === 0) {
      feedback.error();
      if (unnotifiable.length > 0) {
        toast.error(`Telefone incompleto (${unnotifiable.slice(0, 2).join(', ')}). Corrija o telefone para enviar.`, {
          duration: 6000,
          icon: '⚠️'
        });
      } else {
        toast.error('Nenhuma encomenda possui morador com telefone válido.');
      }
      return;
    }

    if (unnotifiable.length > 0) {
      toast('Algumas encomendas têm telefone incompleto e ficaram fora do envio automático.', {
        icon: '⚠️',
        duration: 5000
      });
    }

    setNotifyQueue(queue);
    setNotifyIndex(0);
    setIsNotifyingAll(true);
    setModoEnvio('mass_manual');
  };

  const fetchCondoName = async () => {
    if (!user.condominium_id) return;
    try {
      const res = await api.get(`/api/operational/context?condominiumId=${encodeURIComponent(user.condominium_id)}`);
      if (!res.ok) throw new Error(res.error || 'Erro ao buscar condomínio');
      if (res.data?.condominium?.name) setCondoName(res.data.condominium.name);
    } catch (error) {
      console.error('Erro ao buscar nome do condomínio:', error);
    }
  };

  useEffect(() => {
    if (user?.condominium_id) {
      fetchData();
      fetchCondoName();
    }
  }, [user?.condominium_id]);

  // Removed individualNotifyData state as per request for direct flows
  const handleDirectNotify = async (pkg: any, options?: { allowFromDeliveryGuard?: boolean }) => {
    if (!notifyAfter && !options?.allowFromDeliveryGuard) {
      return;
    }

    if (isPackageDelivered(pkg)) {
      toast('Esta encomenda já foi entregue anteriormente.');
      return;
    }

    const resident = residents.find(r => r.id === pkg.recipient_id) || (pkg as any).moradores;
    
    if (!resident) {
      toast.error('Morador não encontrado');
      return;
    }

    try {
      // Busca todas as encomendas que ainda não foram notificadas para esse morador usando a regra unificada
      const fromState = getPackagesNeedingNotification(packages, true).filter(p => p.recipient_id === resident.id);
      const fromClicked = pkg.isGroup && Array.isArray(pkg.packages)
        ? pkg.packages.filter((p: any) => p.status !== 'delivered' && !p.delivered_at && !isPackageNotificationConfirmed(p))
        : (pkg.status !== 'delivered' && !pkg.delivered_at && !isPackageNotificationConfirmed(pkg) ? [pkg] : []);
      const mergedMap = new Map<string, any>();
      [...fromState, ...fromClicked].forEach((item: any) => {
        if (item?.id) mergedMap.set(item.id, item);
      });
      const moradorPackages = Array.from(mergedMap.values());
      
      if (moradorPackages.length === 0) {
        feedback.error();
        toast.error('Esta encomenda já foi notificada anteriormente.');
        return;
      }

      // Validação contextual de telefone antes de disparar
      const phoneCheck = normalizeResidentPhone(resident.telefone);
      if (phoneCheck.isIncomplete || !phoneCheck.phone) {
        feedback.error();
        toast.error('Telefone incompleto - clique para corrigir e enviar', {
          duration: 5000,
          icon: '⚠️'
        });
        return;
      }

      // Garante pickup_code/token
      let pickupCode = pkg.pickup_code;
      if (!pickupCode) pickupCode = generatePickupCode();
      const pickupToken = pkg.pickup_token || generateSecureToken(16);

      // Contagem física canônica (idêntica à bolinha da Portaria): soma de todas as pendências ativas do morador
      const allPendingForResident = packages.filter((p: any) => p.recipient_id === resident.id && p.status !== 'delivered');
      const totalPhysicalPending = sumPackageItems(allPendingForResident.length > 0 ? allPendingForResident : moradorPackages);

      const message = prepareWhatsAppNotification(
        resident,
        condoName || 'Condomínio',
        pickupCode,
        undefined,
        pickupToken,
        totalPhysicalPending || 1,
        'disponivel',
        undefined,
        undefined,
        pkg.photo_url // Foto da encomenda clicada
      );

      if (!message) throw new Error('Não foi possível preparar a mensagem');

      const pkgIds = moradorPackages.map(p => p.id);

      // Abre WhatsApp imediatamente para evitar bloqueio de popup
      const whatsappLink = getWhatsAppLink(resident.telefone, message, pkg.photo_url);
      window.open(whatsappLink, '_blank');

      // Registra atividade de abertura do WhatsApp sem marcar como enviada
      recordSendActivity('WHATSAPP_ABERTO', pkg.id);
      
      // NÃO atualiza banco de dados nem estado local antes da confirmação do porteiro!
      // Exibe modal explícito de confirmação de envio
      setConfirmWhatsAppError(null);
      setPendingWhatsAppConfirm({
        resident,
        packageIds: pkgIds,
        residentName: resident.nome,
        unit: formatPackageUnit(pkg),
        totalItems: totalPhysicalPending || 1,
        pickupCode,
        pickupToken,
        message,
        isQueue: false
      });

      setLastNotifiedPackageId(pkg.package_id || pkg.id);
      setIsWaitingForReturn(true);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao processar notificação');
    }
  };

  const handleResendNotify = async (pkg: any) => {
    if (resendingPackageKey || isConfirmingWhatsApp) return;

    if (isPackageDelivered(pkg)) {
      toast('Esta encomenda já foi entregue anteriormente.');
      return;
    }

    const confirmedPackages = getConfirmedPackagesForResend(pkg);
    if (confirmedPackages.length === 0) {
      feedback.error();
      toast.error('Esta encomenda ainda não possui notificação confirmada.');
      return;
    }

    if (pkg.isGroup && !isPackageNotificationConfirmed(pkg)) {
      toast('Há itens ainda pendentes de aviso neste grupo. Use "Avisar Morador" para concluir o grupo.');
      return;
    }

    const resident = residents.find(r => r.id === pkg.recipient_id) || (pkg as any).moradores;
    if (!resident) {
      toast.error('Morador não encontrado');
      return;
    }

    const phoneCheck = normalizeResidentPhone(resident.telefone);
    if (phoneCheck.isIncomplete || !phoneCheck.phone) {
      feedback.error();
      toast.error('Telefone incompleto - clique para corrigir e reenviar', {
        duration: 5000,
        icon: '⚠️'
      });
      return;
    }

    const leadPkg = confirmedPackages[0];
    const pickupCode = leadPkg.pickup_code || pkg.pickup_code || generatePickupCode();
    const pickupToken = leadPkg.pickup_token || pkg.pickup_token || generateSecureToken(16);
    const existingNotifiedAt = leadPkg.notified_at || leadPkg.whatsapp_sent_at || pkg.notified_at || pkg.whatsapp_sent_at;
    const existingWhatsappSentAt = leadPkg.whatsapp_sent_at || leadPkg.notified_at || pkg.whatsapp_sent_at || pkg.notified_at;

    const confirmedIds = confirmedPackages.map((p: any) => p.id).filter(Boolean);
    if (confirmedIds.length === 0) return;

    const allPendingForResident = packages.filter((p: any) => p.recipient_id === resident.id && p.status !== 'delivered');
    const totalPhysicalPending = sumPackageItems(allPendingForResident.length > 0 ? allPendingForResident : confirmedPackages);

    const message = prepareWhatsAppNotification(
      resident,
      condoName || 'Condomínio',
      pickupCode,
      leadPkg.carrier || pkg.carrier,
      pickupToken,
      totalPhysicalPending || 1,
      'disponivel',
      undefined,
      undefined,
      leadPkg.photo_url || pkg.photo_url
    );

    if (!message) {
      toast.error('Não foi possível preparar a mensagem de reenvio.');
      return;
    }

    const apiActive = condoSettings?.whatsapp_mode === 'api_automatica' &&
      Boolean(condoSettings?.api_url) &&
      Boolean(condoSettings?.api_token);

    if (apiActive) {
      const cardKey = pkg.package_id || pkg.id;
      setResendingPackageKey(cardKey);
      try {
        const autoResult = await executePortariaAutoSend({
          phone: resident.telefone,
          message,
          condominiumId: user.condominium_id,
          packageId: leadPkg.id,
          packageIds: confirmedIds,
          pickupCode,
          pickupToken,
          notifiedAt: existingNotifiedAt,
          whatsappSentAt: existingWhatsappSentAt,
          config: {
            api_url: condoSettings.api_url,
            api_token: condoSettings.api_token,
            instance_id: condoSettings.instance_id,
            whatsapp_provider: condoSettings.whatsapp_provider,
            photo_url: leadPkg.photo_url || pkg.photo_url
          },
          onConfirmedLocalState: (fields) => {
            markRecentlyConfirmedNotified(confirmedIds, fields);
            setPackages(prev => prev.map(p => confirmedIds.includes(p.id) ? {
              ...p,
              ...fields
            } : p));
          }
        });

        if (autoResult.ok) {
          recordSendActivity('WHATSAPP_CONFIRMADO', leadPkg.id);
          toast.success(`Reenvio automático confirmado para ${resident.nome}! 💬`);
          await fetchData(true);
        } else {
          // Nunca reverte uma encomenda já confirmada para pendente em caso de falha na API
          feedback.error();
          toast.error('Falha ao reenviar via API automática. A notificação anterior permanece mantida.');
        }
      } catch (err) {
        console.error('Erro ao reenviar via API automática:', err);
        feedback.error();
        toast.error('Erro ao reenviar via API automática. A notificação anterior permanece mantida.');
      } finally {
        setResendingPackageKey(null);
      }
      return;
    }

    try {
      const whatsappLink = getWhatsAppLink(resident.telefone, message, leadPkg.photo_url || pkg.photo_url);
      window.open(whatsappLink, '_blank');

      recordSendActivity('WHATSAPP_ABERTO', leadPkg.id);

      setConfirmWhatsAppError(null);
      setPendingWhatsAppConfirm({
        resident,
        packageIds: confirmedIds,
        residentName: resident.nome,
        unit: formatPackageUnit(pkg),
        totalItems: totalPhysicalPending || 1,
        pickupCode,
        pickupToken,
        message,
        isQueue: false,
        isResend: true,
        existingNotifiedAt,
        existingWhatsappSentAt
      });

      setLastNotifiedPackageId(pkg.package_id || pkg.id);
      setIsWaitingForReturn(true);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao iniciar reenvio pelo WhatsApp.');
    }
  };

  const getWhatsAppBadge = (status: string, pkg?: any) => {
    const badgeState = getPackageNotificationBadgeState(pkg, {
      notifyAfter,
      showInactivityAlert,
      interactive: true,
      rawStatus: status
    });

    if (badgeState.kind === 'confirmed') {
      return (
        <div className="flex items-center gap-2 px-5 py-0.5 text-emerald-600 transition-all cursor-default opacity-90 hover:opacity-100 bg-emerald-50/50 rounded-full border border-emerald-100">
          <span className="text-[12px] font-black uppercase tracking-wide">{badgeState.label}</span>
        </div>
      );
    }

    if (badgeState.kind === 'delivered_unnotified' || !badgeState.label) {
      return null;
    }

    if (badgeState.kind === 'auto_pending') {
      return (
        <div
          className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 text-zinc-600 rounded-full border border-zinc-200 cursor-default"
          title="Envio configurado no modo Automático"
        >
          <span className="text-[10px] font-bold uppercase tracking-tight">{badgeState.label}</span>
        </div>
      );
    }

    return (
      <motion.div 
        animate={{ 
          scale: [1, 1.05, 1],
        }}
        transition={{ 
          duration: 1.5, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pkg) handleDirectNotify(pkg);
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 transition-all cursor-pointer hover:bg-red-100 rounded-full border border-red-200 shadow-sm"
        title="Clique para avisar o morador"
      >
        <span className="text-[10px] font-black uppercase tracking-tight">{badgeState.label}</span>
      </motion.div>
    );
  };

  // QR Scanning State
  const [isScanning, setIsScanning] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [qrScanStatus, setQrScanStatus] = useState<'idle' | 'scanning' | 'validating' | 'success' | 'error'>('idle');
  const [qrPackage, setQrPackage] = useState<Package | null>(null);
  const [viewQrPackage, setViewQrPackage] = useState<Package | null>(null);
  const [retrievalMethod, setRetrievalMethod] = useState<'qr_code' | 'manual'>('qr_code');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [isDeliverySuccess, setIsDeliverySuccess] = useState(false);
  const [deliveredToType, setDeliveredToType] = useState<'resident' | 'authorized'>('resident');
  const [authorizedName, setAuthorizedName] = useState('');
  const [authorizedDoc, setAuthorizedDoc] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const pendingPackageRef = useRef<Package | null>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);
  const isScanningRef = useRef(false);
  const isProcessingScanRef = useRef(false);
  const isDeliveringRef = useRef(false);
  const lastFailedQrRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });

  const playSuccessSound = () => {
    feedback.success();
  };

  const anim = (props: any) => props;

  useEffect(() => {
    const handleFocus = async () => {
      console.log('[Portaria] Janela focada, recarregando dados...');
      const result = await fetchData(true); // Silent refresh
      if (!result) return;
      const { packages: latestPackages } = result;
      
      if (isWaitingForReturn) {
        const pendingModal = pendingWhatsAppConfirmRef.current;
        setIsWaitingForReturn(false);
        recordSendActivity('WHATSAPP_RETORNO', pendingModal?.packageIds?.[0] || lastNotifiedPackageId || undefined);

        // Enquanto a modal de confirmação explícita aguarda resposta do porteiro,
        // o retorno da aba/janela NÃO conclui fila, NÃO avança card e NÃO fecha modal em lote.
        if (pendingModal) {
          return;
        }
        
        if (isNotifyingAll) {
          // No modo queue, o avanço do index ocorre SOMENTE após confirmação no banco.
          const pendentesNoBanco = latestPackages.filter(p => !isPackageNotificationConfirmed(p) && p.status !== 'delivered');
          
          if (pendentesNoBanco.length === 0) {
            setNotifyIndex(notifyQueue.length);
            toast.success('Todas as notificações pendentes foram enviadas.', { icon: '✅' });
          } else if (notifyIndex >= notifyQueue.length) {
            setIsNotifyingAll(false);
          }
        } else {
          // Lógica de avanço automático para o próximo card apenas quando não há confirmação pendente
          setTimeout(() => {
            const lowerSearch = searchTerm.toLowerCase();
            const nextPkg = latestPackages.find(p => {
              const matchesTab = activeTab === 'pending' ? p.status !== 'delivered' : 
                               activeTab === 'delivered' ? p.status === 'delivered' : true;
              const matchesSearch = !searchTerm || (
                p.unidade?.toLowerCase().includes(lowerSearch) ||
                p.tracking_code?.toLowerCase().includes(lowerSearch) ||
                p.carrier?.toLowerCase().includes(lowerSearch) ||
                p.moradores?.nome?.toLowerCase().includes(lowerSearch)
              );
              
              return matchesTab && matchesSearch && !isPackageNotificationConfirmed(p) && p.status !== 'delivered';
            });

            if (nextPkg) {
              const elementId = `package-${nextPkg.package_id || nextPkg.id}`;
              const element = document.getElementById(elementId);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.classList.add('ring-4', 'ring-emerald-500', 'ring-offset-4', 'transition-all');
                setTimeout(() => element.classList.remove('ring-4', 'ring-emerald-500', 'ring-offset-4'), 2000);
              }
            }
          }, 150);
        }
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user?.condominium_id, isNotifyingAll, isWaitingForReturn, notifyQueue.length, notifyIndex, activeTab, searchTerm]);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'residents') {
      setActiveTab('residents');
    }
  }, [window.location.search]);

  useEffect(() => {
    if (isScanning && !qrPackage && cameraStarted && !isDeliverySuccess) {
      startScanning();
    } else {
      void stopScanning();
    }
    return () => {
      void stopScanning();
    };
  }, [isScanning, qrPackage, cameraStarted, isDeliverySuccess]);

  const handleBatchSend = async () => {
    if (!notifyAfter || batchPackages.length === 0) return;

    const mode = condoSettings?.whatsapp_mode === 'api_automatica' ? 'api' : 'manual';
    setBatchMode(mode);
    setBatchProgress({ current: 0, total: batchPackages.length });
    setManualIndex(0);

    if (mode === 'api') {
      // Validar configuração
      if (!condoSettings?.api_url || !condoSettings?.api_token) {
        toast.error('API não configurada. Usando envio manual.');
        setBatchMode('manual');
        setBatchStep('manual_list');
        return;
      }

      setBatchStep('sending');
      setIsBatchSending(true);
      
      let successCount = 0;
      let errorCount = 0;
      let fallbackTriggered = false;

      for (let i = 0; i < batchPackages.length; i++) {
        const pkg = batchPackages[i];
        setBatchProgress(prev => ({ ...prev, current: i + 1 }));

        const resident = residents.find(r => r.id === pkg.recipient_id);
        
        if (resident?.telefone) {
          try {
            // Garante que existe código de retirada
            let pCode = pkg.pickup_code;
            let pToken = pkg.pickup_token;
            if (!pCode) pCode = generatePickupCode();
            if (!pToken) pToken = generateSecureToken(16);

            // Contagem física canônica (idêntica à bolinha da Portaria): soma de todas as pendências ativas do morador
            const residentPending = packages.filter((p: any) => p.recipient_id === resident.id && p.status !== 'delivered');
            const totalPhysicalPending = sumPackageItems(residentPending.length > 0 ? residentPending : [pkg]);

            const finalMessage = prepareWhatsAppNotification(
              resident,
              condoName,
              pCode,
              pkg.carrier,
              pToken,
              totalPhysicalPending || 1,
              'disponivel',
              undefined,
              undefined,
              pkg.photo_url
            ) || pkg.whatsapp_message || `Olá, ${resident.nome}! Sua encomenda chegou na portaria. Código: ${pCode}`;

            // Sequência obrigatória (9 etapas):
            // 1. API -> 2. Resposta -> 3. status_envio==='sucesso' -> 4. !error -> 5. HTTP 200/201 ->
            // 6. Supabase update -> 7. Verificar error -> 8. Atualizar setPackages SOMENTE após confirmação -> 9. Sucesso
            const autoResult = await executePortariaAutoSend({
              phone: resident.telefone,
              message: finalMessage,
              condominiumId: user.condominium_id,
              packageId: pkg.id,
              pickupCode: pCode,
              pickupToken: pToken,
              config: {
                api_url: condoSettings.api_url,
                api_token: condoSettings.api_token,
                instance_id: condoSettings.instance_id,
                whatsapp_provider: condoSettings.whatsapp_provider,
                photo_url: pkg.photo_url
              },
              onConfirmedLocalState: (fields) => {
                markRecentlyConfirmedNotified([pkg.id], fields);
                setPackages(prev => prev.map(p => p.id === pkg.id ? {
                  ...p,
                  ...fields
                } : p));
              }
            });

            if (autoResult.ok) {
              console.log('Atualizado no banco:', pkg.id);
              recordSendActivity('WHATSAPP_CONFIRMADO', pkg.id);
              successCount++;
            } else {
              throw new Error(autoResult.error || 'Erro ou falha na confirmação do envio/banco de dados');
            }
          } catch (error) {
            console.error('Falha na API:', error);
            toast.error('Falha na API. Mudando para envio manual assistido.');
            fallbackTriggered = true;
            
            // Log fallback
            await registrarAuditoria({
              condominio_id: user.condominium_id || '',
              usuario_id: user.id,
              usuario_nome: user.full_name,
              usuario_perfil: user.role,
              tipo_evento: 'WHATSAPP_FALLBACK',
              acao: 'UPDATE',
              tabela_afetada: 'encomendas',
              registro_id: pkg.id,
              descricao: `Fallback no envio de WhatsApp para Encomenda ${pkg.id}`,
              metodo: 'API_FALLBACK',
              dados_antes: { mode: 'api' },
              dados_depois: { mode: 'manual', error: error instanceof Error ? error.message : String(error) }
            });

            break; // Interromper envio automático
          }
        } else {
          const waRes = await api.post('/api/operational/packages/whatsapp-status', {
            packageIds: [pkg.id],
            fields: {
              whatsapp_status: resident?.telefone ? 'error' : 'no_recipient'
            },
            condominiumId: user.condominium_id
          });

          if (!waRes.ok) console.error('Erro ao atualizar status de erro:', waRes.error);
          errorCount++;
        }
      }

      setIsBatchSending(false);
      
      if (fallbackTriggered) {
        setBatchMode('manual');
        setBatchStep('manual_list');
      } else {
        if (successCount > 0) toast.success(`${successCount} avisos enviados via API!`);
        if (errorCount > 0) toast.error(`${errorCount} avisos falharam.`);
        setShowBatchModal(false);
        
        // Show success state on the button
        setNotificationSuccess(true);
        setTimeout(() => setNotificationSuccess(false), 3000);
      }
      await fetchData(true);
    } else {
      setBatchStep('manual_list');
    }
  };

  const handleManualSent = async (pkgId: string) => {
    try {
      const result = await executeManualSendConfirmation({
        packageIds: [pkgId],
        condominiumId: user?.condominium_id,
        onConfirmedLocalState: (fields) => {
          markRecentlyConfirmedNotified([pkgId], fields);
          setPackages(prev => prev.map(p => p.id === pkgId ? {
            ...p,
            ...fields
          } : p));
        }
      });

      if (!result.ok) {
        console.error('Erro ao atualizar pacote', result.error);
        toast.error(result.error || 'Erro ao salvar confirmação no banco de dados. A encomenda permanece pendente.');
        return;
      }

      console.log('Atualizado no banco:', pkgId);
      recordSendActivity('WHATSAPP_CONFIRMADO', pkgId);

      if (manualIndex + 1 >= batchPackages.length) {
        toast.success('Todos os avisos foram processados!');
        setShowBatchModal(false);
        setBatchStep('confirm');
      } else {
        setManualIndex(prev => prev + 1);
      }

      await fetchData(true);
      toast.success('Status atualizado!');
    } catch (error) {
      toast.error('Erro ao atualizar status');
    }
  };

  const handleSkipManual = () => {
    recordSendActivity('WHATSAPP_CANCELADO', batchPackages[manualIndex]?.id);
    if (manualIndex + 1 >= batchPackages.length) {
      setBatchStep('finished');
    } else {
      setManualIndex(prev => prev + 1);
    }
  };

  const startScanning = async () => {
    if (isTransitioningRef.current || !isScanningRef.current) return;
    try {
      isTransitioningRef.current = true;
      setCameraError(null);
      setQrScanStatus('scanning');

      // Aguarda montagem do container #qr-reader quando o modal abre
      let readerEl: HTMLElement | null = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        if (!isScanningRef.current) return;
        readerEl = document.getElementById('qr-reader');
        if (readerEl) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      if (!readerEl || !isScanningRef.current) return;

      if (qrScannerRef.current) {
        try {
          if (qrScannerRef.current.isScanning) {
            await qrScannerRef.current.stop();
          }
          qrScannerRef.current.clear();
        } catch (e) {
          // ignore cleanup of prior instance
        }
        qrScannerRef.current = null;
      }

      const scanner = new Html5Qrcode("qr-reader");
      const config = { fps: 10, qrbox: { width: 220, height: 220 } };
      await scanner.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
      );
      
      if (!isScanningRef.current) {
        try {
          if (scanner.isScanning) {
            await scanner.stop();
          }
          scanner.clear();
        } catch (e) {
          // ignore
        }
        return;
      }
      
      qrScannerRef.current = scanner;
    } catch (err: any) {
      console.error("Erro ao iniciar câmera:", err);
      const errMsg = String(err?.message || '').toLowerCase();
      const friendlyMsg = (err?.name === 'NotAllowedError' || errMsg.includes('permission') || errMsg.includes('denied'))
        ? 'Permissão da câmera negada. Digite o código de 4 dígitos abaixo.'
        : 'Câmera indisponível neste dispositivo. Digite o código de 4 dígitos abaixo.';
      setCameraError(friendlyMsg);
      setCameraStarted(false);
      setQrScanStatus('idle');
      // Mantém o modal aberto para preservar o fluxo manual simultâneo de 4 dígitos
    } finally {
      isTransitioningRef.current = false;
    }
  };

  const stopScanning = async () => {
    if (isTransitioningRef.current) {
      let attempts = 0;
      while (isTransitioningRef.current && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }

    if (qrScannerRef.current) {
      try {
        isTransitioningRef.current = true;
        if (qrScannerRef.current.isScanning) {
          await qrScannerRef.current.stop();
        }
        try {
          qrScannerRef.current.clear();
        } catch (e) {
          // ignore clear errors if already cleared
        }
        qrScannerRef.current = null;
      } catch (err) {
        console.error("Erro ao parar câmera:", err);
      } finally {
        isTransitioningRef.current = false;
      }
    }
  };

  const onScanSuccess = async (decodedText: string, resultOrMethod?: any) => {
    if (isProcessingScanRef.current || isDeliveringRef.current) return;
    const scanMethod: 'qr_code' | 'code' = (resultOrMethod === 'code') ? 'code' : 'qr_code';
    const rawTrimmed = String(decodedText || '').trim();
    if (
      scanMethod === 'qr_code' &&
      rawTrimmed &&
      lastFailedQrRef.current.text === rawTrimmed &&
      Date.now() - lastFailedQrRef.current.ts < 2500
    ) {
      return;
    }
    isProcessingScanRef.current = true;
    let shouldResetScannerToCamera = false;

    try {
      const parsed = parseQrScanInput(decodedText);
      setRetrievalMethod(scanMethod === 'code' ? 'manual' : 'qr_code');

      if (!parsed.isQrFormatValid || !parsed.lookupTerm) {
        if (scanMethod === 'qr_code') {
          lastFailedQrRef.current = { text: rawTrimmed, ts: Date.now() };
        }
        feedback.error();
        toast.error('Conteúdo do QR Code inválido');
        setQrPackage(null);
        setQrScanStatus('error');
        await stopScanning();
        shouldResetScannerToCamera = scanMethod === 'qr_code';
        return;
      }

      // 1º sinal sonoro (Portaria): QR Code reconhecido pelo leitor da câmera
      // Indica exclusivamente captura da leitura, antes da validação e da baixa no servidor
      if (scanMethod === 'qr_code') {
        feedback.qrRecognized();
      }

      setQrScanStatus('validating');
      await stopScanning();

      const lookupRes = await api.get(
        `/api/operational/packages?status=all&lookup=${encodeURIComponent(parsed.lookupTerm)}&condominiumId=${encodeURIComponent(user.condominium_id)}`
      );

      if (!lookupRes.ok) {
        console.error("Erro ao buscar encomenda por QR:", lookupRes.error);
        if (scanMethod === 'qr_code') {
          lastFailedQrRef.current = { text: rawTrimmed, ts: Date.now() };
        }
        feedback.error();
        toast.error('Erro na busca: ' + (lookupRes.error || 'Falha de comunicação'));
        setQrPackage(null);
        setQrScanStatus('error');
        shouldResetScannerToCamera = scanMethod === 'qr_code';
        return;
      }

      const nowMs = Date.now();
      const rawFound = lookupRes.data?.packages || [];
      const packagesFound = rawFound.map((p: any) => {
        const recent = p?.id ? recentlyConfirmedNotifiedRef.current.get(p.id) : undefined;
        if (recent && nowMs - recent.ts <= 15000 && !isPackageNotificationConfirmed(p)) {
          return { ...p, ...recent.fields };
        }
        return p;
      });

      const validation = validateQrScanResult({
        parsed,
        matchedPackages: packagesFound,
        expectedCondoId: user.condominium_id,
        scanMethod
      });

      if (!validation.ok || !validation.targetPackage) {
        if (scanMethod === 'qr_code') {
          lastFailedQrRef.current = { text: rawTrimmed, ts: Date.now() };
        }
        // Nunca preenche qrPackage em falhas/bloqueios, evitando exibir botão manual de confirmação
        setQrPackage(null);
        if (scanMethod === 'code') {
          setManualToken('');
        }

        if (validation.reason === 'unnotified' && validation.packageData) {
          setQrScanStatus('error');
          guideToNotification(validation.packageData);
          shouldResetScannerToCamera = scanMethod === 'qr_code';
          return;
        }

        feedback.error();
        toast.error(validation.message || 'QR Code inválido ou encomenda não encontrada');
        setQrScanStatus('error');
        shouldResetScannerToCamera = scanMethod === 'qr_code';
        return;
      }

      const data = validation.targetPackage;
      setQrPackage(data);
      setQrScanStatus('validating');

      // Executa baixa automática imediatamente (sem exigir clique em botão de confirmação)
      const deliveredOk = await handleDeliver(data.package_id || data.id, scanMethod, undefined, data);
      if (!deliveredOk && scanMethod === 'qr_code') {
        lastFailedQrRef.current = { text: rawTrimmed, ts: Date.now() };
      } else if (deliveredOk) {
        lastFailedQrRef.current = { text: '', ts: 0 };
      }
    } catch (err) {
      console.error("Erro ao processar QR:", err);
      if (scanMethod === 'qr_code') {
        lastFailedQrRef.current = { text: rawTrimmed, ts: Date.now() };
      }
      feedback.error();
      toast.error('Erro ao validar QR Code. Tente novamente.');
      setQrPackage(null);
      setQrScanStatus('error');
      shouldResetScannerToCamera = scanMethod === 'qr_code';
    } finally {
      isProcessingScanRef.current = false;
      if (shouldResetScannerToCamera) {
        setTimeout(() => {
          if (!isDeliveringRef.current && isScanningRef.current) {
            setQrScanStatus('scanning');
            if (cameraStarted) void startScanning();
          }
        }, 1500);
      }
    }
  };

  const onScanFailure = (error: any) => {
    // Ignore scan failures as they happen frequently during scanning
  };

  const handleManualToken = async () => {
    if (!manualToken.trim()) return;
    await onScanSuccess(manualToken.trim(), 'code');
  };

  const [editingResident, setEditingResident] = useState<Morador | null>(null);
  const [isAddingResident, setIsAddingResident] = useState(false);
  const [residentToDelete, setResidentToDelete] = useState<Morador | null>(null);
  const [residentForm, setResidentForm] = useState({
    full_name: '',
    phone: '',
    unit_type: localStorage.getItem('last_resident_unit_type') || 'Casa',
    unidade: '',
    block: '',
    street: '',
    tower: '',
    complement: ''
  });

  const openNewResidentModal = () => {
    setEditingResident(null);
    setResidentForm({
      full_name: '',
      phone: '',
      unit_type: '',
      unidade: '',
      block: '',
      street: '',
      tower: '',
      complement: ''
    });
    setIsAddingResident(true);
  };

  const handleEditResident = (resident: Morador) => {
    setEditingResident(resident);
    setResidentForm({
      full_name: resident.nome || '',
      phone: resident.telefone || '',
      unit_type: resident.unit_type || '',
      unidade: resident.unidade || '',
      block: resident.block || resident.bloco || '',
      street: resident.street || '',
      tower: resident.lote || '',
      complement: resident.observacoes || ''
    });
  };

  useEffect(() => {
    // REQUISITO: Corrigir banco de dados para registros existentes (Casa vs Apto)
    const fixDatabaseRecords = async () => {
      if (!user?.condominium_id) return;
      const key = `db_fixed_${user.condominium_id}`;
      if (localStorage.getItem(key)) return;

      try {
        // Corrigir registros 'apto' para 'Casa' ou 'Apartamento' se possível
        // Mas o pedido é específico: 'apto' -> 'casa' se for o caso
        // Aqui vamos seguir a instrução literal: update moradores set tipo_residencia = 'casa' where tipo_residencia = 'apto'
        const fixRes = await api.post('/api/operational/moradores/fix-unit-type', {
          condominiumId: user.condominium_id
        });
        
        if (fixRes.ok) {
          localStorage.setItem(key, 'true');
          console.log('Base de moradores corrigida com sucesso.');
          fetchData();
        }
      } catch (err) {
        console.error('Erro ao corrigir base:', err);
      }
    };

    if (user?.role === 'admin' || user?.role === 'sindico') {
      fixDatabaseRecords();
    }
  }, [user]);

  const handleSaveResident = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const unitTypeToSave = residentForm.unit_type || 'Casa';
      localStorage.setItem('last_resident_unit_type', unitTypeToSave);

      const moradorData = {
        nome: residentForm.full_name,
        unidade: residentForm.unidade,
        unit_type: unitTypeToSave,
        block: residentForm.block,
        bloco: residentForm.block,
        street: residentForm.street,
        lote: residentForm.tower,
        telefone: residentForm.phone,
        observacoes: residentForm.complement,
        condominium_id: user.condominium_id,
        ativo: true
      };

      if (editingResident) {
        const res = await api.patch(`/api/operational/moradores/${editingResident.id}`, moradorData);
        if (!res.ok) throw new Error(res.error || 'Erro ao atualizar morador');
        toast.success('Morador atualizado com sucesso!');
      } else {
        const res = await api.post('/api/operational/moradores', moradorData);
        if (!res.ok) throw new Error(res.error || 'Erro ao cadastrar morador');
        toast.success('Morador cadastrado com sucesso!');
      }
      
      setEditingResident(null);
      setIsAddingResident(false);
      setResidentForm({
        full_name: '',
        phone: '',
        unit_type: unitTypeToSave,
        unidade: '',
        block: '',
        street: '',
        tower: '',
        complement: ''
      });
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar morador:', error);
      toast.error('Erro ao salvar morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // handleIndividualNotifySend was removed to be handled directly by handleDirectNotify

  const handleDeleteResident = (resident: Morador) => {
    setResidentToDelete(resident);
  };

  const confirmDeleteResident = async () => {
    if (!residentToDelete) return;

    const targetId = residentToDelete.id;
    const targetName = residentToDelete.nome;
    try {
      setLoading(true);
      
      // Soft delete: inativa o morador na tabela moradores (e perfil vinculado no servidor)
      const delRes = await api.patch(`/api/operational/moradores/${targetId}`, {
        ativo: false,
        condominiumId: user.condominium_id
      });

      if (!delRes.ok) throw new Error(delRes.error || 'Erro ao desativar morador');

      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'MORADOR_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'moradores',
        registro_id: targetId,
        descricao: `Morador desativado: ${targetName}`,
        metodo: 'MANUAL',
        dados_antes: residentToDelete,
        dados_depois: { ativo: false }
      });

      // Atualização otimista imediata do estado local de moradores
      setResidents(prev => prev.filter(r => r.id !== targetId));
      setResidentToDelete(null);
      toast.success(`Morador ${targetName} desativado com sucesso!`);
      await fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir morador:', error);
      toast.error('Erro ao excluir morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleResidentStatus = async (resident: Morador) => {
    try {
      setLoading(true);
      const newStatus = !resident.ativo;
      
      const statusRes = await api.patch(`/api/operational/moradores/${resident.id}`, {
        ativo: newStatus,
        condominiumId: user.condominium_id
      });

      if (!statusRes.ok) throw new Error(statusRes.error || 'Erro ao alterar status do morador');

      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: newStatus ? 'MORADOR_ATIVADO' : 'MORADOR_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'moradores',
        registro_id: resident.id,
        descricao: `Morador ${newStatus ? 'ativado' : 'desativado'}: ${resident.nome}`,
        metodo: 'MANUAL',
        dados_antes: resident,
        dados_depois: { ativo: newStatus }
      });

      toast.success(`Morador ${newStatus ? 'ativado' : 'desativado'} com sucesso!`);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao alterar status do morador:', error);
      toast.error('Erro ao alterar status: ' + error.message);
    } finally {
      setLoading(false);
      setActiveResidentMenu(null);
    }
  };

  const getDeliveryMethodLabel = (method?: string) => {
    switch (method) {
      case 'manual': return 'MANUAL';
      case 'qr_code': return 'QR CODE';
      case 'code':
      case 'CÓDIGO':
      case 'pickup_code': return 'CÓDIGO';
      case 'photo':
      case 'foto': return 'RETIRADA COM FOTO';
      case 'CONFIRMADO_PELO_MORADOR': return 'CONFIRMADO PELO MORADOR';
      default: return '-';
    }
  };

  const fetchData = async (silent = false) => {
    if (!user?.condominium_id) return;
    const seq = ++fetchSeqRef.current;

    try {
      if (!silent) setLoading(true);
      
      const condoIdEnc = encodeURIComponent(user.condominium_id);
      const PENDING_PAGE_SIZE = 1000;

      const fetchAllPending = async () => {
        const seen = new Map<string, any>();
        let offset = 0;
        let lastOk = true;
        let lastErr: string | undefined;

        for (let page = 0; page < 50; page++) {
          const res = await api.get<{ packages?: any[]; totalCount?: number }>(
            `/api/operational/packages?status=pending&offset=${offset}&limit=${PENDING_PAGE_SIZE}&condominiumId=${condoIdEnc}`
          );
          if (!res.ok) {
            lastOk = false;
            lastErr = res.error;
            break;
          }
          const batch = Array.isArray(res.data?.packages) ? res.data.packages : [];
          for (const item of batch) {
            if (item?.id) seen.set(item.id, item);
          }
          const totalCount = typeof res.data?.totalCount === 'number' ? res.data.totalCount : undefined;
          if (batch.length < PENDING_PAGE_SIZE || (totalCount !== undefined && seen.size >= totalCount)) {
            break;
          }
          offset += PENDING_PAGE_SIZE;
        }
        return { ok: lastOk, error: lastErr, packages: Array.from(seen.values()) };
      };

      const [ctxRes, pendingRes, deliveredRes] = await Promise.all([
        api.get(`/api/operational/context?condominiumId=${condoIdEnc}`),
        fetchAllPending(),
        api.get(`/api/operational/packages?status=delivered&limit=50&condominiumId=${condoIdEnc}`)
      ]);

      // Evita que requisições antigas sobrescrevam dados mais recentes ou confirmações locais recém-salvas
      if (seq !== fetchSeqRef.current) {
        return;
      }

      if (ctxRes.ok && ctxRes.data) {
        if (ctxRes.data.settings !== undefined) setCondoSettings(ctxRes.data.settings);
        if (ctxRes.data.condominium?.name) setCondoName(ctxRes.data.condominium.name);
        setResidents(ctxRes.data.moradores || []);
      } else {
        console.error('Erro ao buscar contexto operacional:', ctxRes.error);
      }

      const pendingList = pendingRes.ok ? pendingRes.packages : [];
      const deliveredList = deliveredRes.ok ? (deliveredRes.data?.packages || []) : [];

      if (!pendingRes.ok) {
        console.error('Erro ao buscar encomendas pendentes:', pendingRes.error);
      }
      if (!deliveredRes.ok) {
        console.error('Erro ao buscar encomendas entregues:', deliveredRes.error);
      } else {
        setHasMoreDelivered(deliveredList.length >= 50);
      }

      const nowMs = Date.now();
      for (const [k, entry] of recentlyConfirmedNotifiedRef.current.entries()) {
        if (nowMs - entry.ts > 15000) {
          recentlyConfirmedNotifiedRef.current.delete(k);
        }
      }

      const mergeConfirmedOverlay = (pkg: any) => {
        const recent = pkg?.id ? recentlyConfirmedNotifiedRef.current.get(pkg.id) : undefined;
        if (!recent) return pkg;
        if (isPackageNotificationConfirmed(pkg)) {
          recentlyConfirmedNotifiedRef.current.delete(pkg.id);
          return pkg;
        }
        return { ...pkg, ...recent.fields };
      };

      const pkgs = [
        ...pendingList.map(mergeConfirmedOverlay),
        ...deliveredList
      ];
      setPackages(pkgs);

      // Só mostramos erro se todos falharem
      if (!pendingRes.ok && !deliveredRes.ok && !ctxRes.ok) {
        toast.error('Erro ao carregar dados da portaria');
      }

      return {
        packages: pkgs,
        residents: ctxRes.data?.moradores || []
      };

    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      return { packages: [], residents: [] };
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  };

  const loadMoreDelivered = async () => {
    if (!user?.condominium_id || isLoadingMoreDelivered) return;
    setIsLoadingMoreDelivered(true);
    try {
      const currentDeliveredCount = packages.filter(p => p.status === 'delivered').length;
      const res = await api.get(
        `/api/operational/packages?status=delivered&offset=${currentDeliveredCount}&limit=50&condominiumId=${encodeURIComponent(user.condominium_id)}`
      );

      if (!res.ok) throw new Error(res.error || 'Erro ao carregar mais encomendas');
      const data = res.data?.packages || [];
      if (data.length > 0) {
        setPackages(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          return [...prev, ...data.filter((p: any) => !existingIds.has(p.id))];
        });
        setHasMoreDelivered(data.length >= 50);
      } else {
        setHasMoreDelivered(false);
      }
    } catch (e) {
      console.error("Erro ao carregar mais entregues:", e);
      toast.error("Erro ao carregar mais encomendas");
    } finally {
      setIsLoadingMoreDelivered(false);
    }
  };

  const uploadDeliveryPhoto = async (base64: string) => {
    try {
      let finalBase64 = base64;

      // Compressão obrigatória para reduzir peso no mobile
      try {
        const { compressImage } = await import('../lib/imageUtils');
        finalBase64 = await compressImage(base64, 800, 0.6);
      } catch (err) {
        console.warn('Falha ao comprimir imagem, enviando original:', err);
      }

      const uploadRes = await api.post('/api/operational/upload-photo', {
        imageBase64: finalBase64,
        folder: 'delivery-photos'
      });

      if (!uploadRes.ok || !uploadRes.data?.publicUrl) {
        throw new Error(uploadRes.error || "Não foi possível gerar a URL pública da foto");
      }

      return uploadRes.data.publicUrl;
    } catch (err: any) {
      console.error("Erro detalhado no upload da foto:", err);
      throw new Error(err.message || "Falha ao enviar imagem para o servidor");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Ensure modal is open and in validating state immediately
      setIsScanning(true);
      setQrScanStatus('validating');
      setIsDeliverySuccess(false);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const photoData = reader.result as string;
          setDeliveryPhoto(photoData);
          
          // Inicia salvamento automático após tirar a foto
          const pkgId = qrPackage?.package_id || qrPackage?.id;
          if (pkgId) {
            handleDeliver(pkgId, 'foto', photoData, qrPackage || undefined);
          } else {
            setQrScanStatus('success');
          }
        } catch (err) {
          console.error("Erro no processamento da foto:", err);
          // Em caso de erro, mantém o modal aberto no estado de sucesso
          setQrScanStatus('success');
          toast.error('Erro ao processar foto. Tente novamente');
        }
      };
      reader.onerror = () => {
        setQrScanStatus('success');
        toast.error('Erro ao ler arquivo da foto.');
      };
      reader.readAsDataURL(file);
    }
  };

  // Regra de Segurança: Verifica se uma encomenda específica ou todas as encomendas de um lote já foram notificadas
  const isPackageNotified = (pkg: any): boolean => {
    return isPackageNotificationConfirmed(pkg);
  };

  // Item 8: Conduz o porteiro com precisão para o fluxo de notificação da encomenda bloqueada
  const guideToNotification = (pkg: any) => {
    feedback.error();
    toast.error('POR FAVOR ENVIE A NOTIFICAÇÃO PARA DAR BAIXA DA ENCOMENDA', {
      id: 'block-undelivered-notice',
      duration: 6000,
      icon: '⚠️'
    });

    // Se a encomenda tiver destinatário com telefone, oferece disparo imediato da notificação
    const resident = residents.find(r => r.id === (pkg.recipient_id || pkg.packages?.[0]?.recipient_id));
    if (resident && resident.telefone) {
      setTimeout(() => {
        toast((t) => (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold text-zinc-900">
              Deseja notificar {resident.nome} agora pelo WhatsApp?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  toast.dismiss(t.id);
                  handleDirectNotify(pkg.packages ? pkg.packages[0] : pkg, { allowFromDeliveryGuard: true });
                }}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 shadow-sm"
              >
                Sim, Notificar Agora
              </button>
              <button
                onClick={() => toast.dismiss(t.id)}
                className="px-3 py-1.5 bg-zinc-100 text-zinc-600 text-xs font-bold rounded-xl hover:bg-zinc-200"
              >
                Voltar
              </button>
            </div>
          </div>
        ), { id: 'guide-notify-action', duration: 10000 });
      }, 400);
    } else {
      // Direciona a aba para 'pending' para localizar os não notificados
      setActiveTab('pending');
    }
  };

const isValidUuid = (id?: string | null): boolean => {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

  const handleDeliver = async (pkgId: string, method: 'manual' | 'qr_code' | 'photo' | 'foto' | 'code' | 'CÓDIGO' | 'CONFIRMADO_PELO_MORADOR' = 'manual', photoOverride?: string, packageData?: Package): Promise<boolean> => {
    if (!pkgId) {
      toast.error('ID da encomenda não encontrado');
      return false;
    }

    if (isDeliveringRef.current) {
      return false;
    }

    // Usar dados passados ou do estado
    const activePackage = packageData || qrPackage;

    // REGRA DE SEGURANÇA MANDATÓRIA (PARTE 2 & ITEM 8): Bloquear baixa se a encomenda (ou lote) ainda NÃO foi notificada
    if (activePackage && !isPackageNotified(activePackage)) {
      if (method === 'qr_code' || method === 'code' || method === 'CÓDIGO') {
        setQrPackage(null);
        setQrScanStatus('error');
      } else {
        setQrScanStatus('idle');
      }
      guideToNotification(activePackage);
      return false;
    }

    isDeliveringRef.current = true;
    try {
      setQrScanStatus('validating');
      
      const photoToUse = photoOverride || deliveryPhoto;
      let finalPhotoUrl = null;
      let finalMethod: any = method;

      if (photoToUse && photoToUse.startsWith('data:')) {
        try {
          finalPhotoUrl = await uploadDeliveryPhoto(photoToUse);
          finalMethod = 'foto';
        } catch (uploadErr: any) {
          console.error("Erro no upload da foto:", uploadErr);
          throw new Error(`Erro no upload da foto: ${uploadErr.message}`);
        }
      } else if (finalMethod === 'manual' && activePackage?.pickup_code) {
        finalMethod = 'CÓDIGO';
      } else if (finalMethod === 'code' || finalMethod === 'CÓDIGO') {
        finalMethod = 'CÓDIGO';
      }

      const pickupToken = activePackage?.pickup_token;
      const pickupCode = activePackage?.pickup_code;

      let requestedIds: string[] = [pkgId];
      const activePkgAny = activePackage as any;
      if (activePkgAny?.isGroup && activePkgAny?.packages && activePkgAny.packages.length > 0) {
        requestedIds = activePkgAny.packages.map((p: any) => p.id || p.package_id).filter(Boolean);
      }
      if (!requestedIds.includes(pkgId)) {
        requestedIds.push(pkgId);
      }

      const porterNameToSave = (currentPorter && currentPorter !== 'Selecione o Porteiro') ? currentPorter : user.full_name;

      let finalDeliveredToName = 'Morador (Confirmado)';
      if (deliveredToType === 'authorized') {
        finalDeliveredToName = `Pessoa Autorizada: ${authorizedName}${authorizedDoc ? ` - Doc: ${authorizedDoc}` : ''}`;
      } else {
        if (finalMethod === 'manual') {
          finalDeliveredToName = 'Morador (Manual)';
        } else if (finalMethod === 'CÓDIGO' || finalMethod === 'code') {
          finalDeliveredToName = 'Morador (Código)';
        } else if (finalMethod === 'foto' || finalMethod === 'photo') {
          finalDeliveredToName = 'Morador (Foto)';
        } else {
          finalDeliveredToName = 'Morador (Confirmado)';
        }
      }

      const deliverRes = await api.post('/api/operational/packages/deliver', {
        packageId: pkgId,
        packageIds: requestedIds,
        condominiumId: user.condominium_id,
        pickupToken,
        pickupCode,
        recipientId: activePackage?.recipient_id,
        deliveryMethod: finalMethod,
        deliveredToName: finalDeliveredToName,
        porterName: porterNameToSave,
        deliveryPhotoUrl: finalPhotoUrl,
      });

      if (!deliverRes.ok) {
        console.error("Erro ao atualizar status da encomenda:", deliverRes.error);
        if (deliverRes.status === 409 || (deliverRes.data as any)?.alreadyDelivered) {
          feedback.error();
          toast.error(deliverRes.error || 'Encomenda já foi entregue anteriormente.', { duration: 4000 });
          setQrPackage(null);
          setManualToken('');
          setQrScanStatus('idle');
          void fetchData(true);
          return false;
        }
        throw new Error(deliverRes.error || 'Falha ao confirmar entrega');
      }

      const idsToUpdate: string[] = deliverRes.data?.updatedIds || requestedIds;
      const validDeliveredBy = deliverRes.data?.delivered_by ?? (user?.id && isValidUuid(user.id) ? user.id : null);
      const now = deliverRes.data?.delivered_at || new Date().toISOString();

      // Atualização local imediata
      setPackages(prev => prev.map(p => idsToUpdate.includes(p.id) ? { 
         ...p, 
         status: 'delivered',
         delivered_at: now,
         delivery_method: deliverRes.data?.delivery_method || finalMethod,
         entregue_por: deliverRes.data?.entregue_por || porterNameToSave,
         delivered_by: validDeliveredBy,
         delivered_to_name: deliverRes.data?.delivered_to_name || finalDeliveredToName,
         delivery_photo_url: deliverRes.data?.delivery_photo_url || finalPhotoUrl || p.delivery_photo_url
       } : p));

      // 2º sinal sonoro (Portaria): toca SOMENTE após confirmação HTTP 200 do servidor
      if (finalMethod === 'qr_code') {
        feedback.deliveryConfirmed();
      } else {
        playSuccessSound();
      }

      // REGISTRAR AUDITORIA PARA CADA ENCOMENDA ENTREGUE
      try {
        const currentMethod = finalMethod as string;
        const metodoTraduzido = 
          currentMethod === 'qr_code' ? 'QR' : 
          currentMethod === 'CONFIRMADO_PELO_MORADOR' ? 'MORADOR' :
          (currentMethod === 'CÓDIGO' || currentMethod === 'code' || currentMethod === 'manual') ? 'CODIGO' : 'FOTO';

        const residentData = residents.find(r => r.id === activePackage?.recipient_id);

        for (const pkgToAuditId of idsToUpdate) {
          const descSuffix = idsToUpdate.length > 1 ? ' (Retirada Coletiva)' : '';
          
          await registrarAuditoria({
            condominio_id: user.condominium_id || '',
            usuario_id: user.id,
            usuario_nome: user.full_name,
            usuario_perfil: user.role,
            tipo_evento: 'ENCOMENDA_ENTREGUE',
            acao: 'UPDATE',
            tabela_afetada: 'encomendas',
            registro_id: pkgToAuditId,
            descricao: `Encomenda entregue via ${metodoTraduzido} para ${residentData?.full_name || residentData?.nome || 'Morador'} - ${residentData?.unidade || 'N/A'}${descSuffix}`,
            metodo: metodoTraduzido
          });
        }
      } catch (logErr) {
        console.warn('Erro ao registrar auditoria de entrega:', logErr);
      }

      setIsDeliverySuccess(true);
      toast.success(`Baixa concluída com sucesso`, { duration: 2500 });
      
      if (method === 'code' || method === 'CÓDIGO' || method === 'manual') {
        setManualToken('');
      }

      // Notificar Todos queue state
      setModoEnvio(null);
      setIsNotifyingAll(false);
      setShowBatchModal(false);
      setNotifyQueue([]);
      setNotifyIndex(0);

      // Resetar estados de quem está retirando
      setDeliveredToType('resident');
      setAuthorizedName('');
      setAuthorizedDoc('');
      
      // Atualizar dados e garantir que permaneça na aba de pendentes
      setQrPackage(null);
      setViewQrPackage(null);
      setQrScanStatus('idle');
      await fetchData(true); 
      setActiveTab('pending');
      
      setTimeout(() => {
        setIsScanning(false);
        setIsDeliverySuccess(false);
        setDeliveryPhoto(null);
        setManualToken('');
        setShowManualInput(false);
        setCameraStarted(false);
        setCameraError(null);
      }, 2000);

      return true;

    } catch (error: any) {
      console.error('Erro ao entregar encomenda:', error);
      feedback.error();
      toast.error(`Erro: ${error.message || 'Falha ao confirmar entrega'}`);
      if (method === 'qr_code' || method === 'code' || method === 'CÓDIGO') {
        setQrPackage(null);
        setQrScanStatus('error');
      } else {
        setQrScanStatus('idle');
      }
      return false;
    } finally {
      isDeliveringRef.current = false;
    }
  };

  const pendingPackages = useMemo(() => packages.filter(p => p.status !== 'delivered'), [packages]);
  const deliveredPackages = useMemo(() => packages.filter(p => p.status === 'delivered'), [packages]);

  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);
  const [viewPhotoPkg, setViewPhotoPkg] = useState<Package | null>(null);
  const [viewGroupPhotos, setViewGroupPhotos] = useState<any[] | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const filteredPackages = useMemo(() => {
    let basePackages = packages;
    if (activeTab === 'pending') basePackages = pendingPackages;
    if (activeTab === 'delivered') basePackages = deliveredPackages;

    const term = searchTerm.toLowerCase();
    const filtered = basePackages.filter((p: any) => 
      !term || 
      (p.moradores?.nome || "").toLowerCase().includes(term) ||
      p.unit_label?.toLowerCase().includes(term) ||
      p.carrier?.toLowerCase().includes(term) ||
      p.tracking_code?.toLowerCase().includes(term)
    );

    // Agrupamento para abas Pendentes e Retiradas
    if (activeTab === 'pending' || activeTab === 'delivered') {
      const groups: { [key: string]: any[] } = {};
      
      for (let i = 0; i < filtered.length; i++) {
        const pkg = filtered[i];
        const key = pkg.pickup_token ? `tok_${pkg.pickup_token}` : (pkg.recipient_id ? `rec_${pkg.recipient_id}_${pkg.pickup_code || 'pend'}` : (pkg.pickup_code ? `code_${pkg.pickup_code}` : pkg.id));
        if (!groups[key]) groups[key] = [];
        groups[key].push(pkg);
      }

      return Object.values(groups).map(group => {
        if (group.length === 1) return group[0];
        
        return {
          ...group[0],
          isGroup: true,
          packages: group,
          count: sumPackageItems(group)
        };
      });
    }

    return filtered;
  }, [packages, activeTab, searchTerm, pendingPackages, deliveredPackages]);

  const filteredResidents = useMemo(() => residents.filter(r => 
    r.ativo && (
      !searchTerm ||
      r.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.unidade?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  ), [residents, searchTerm]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex-1 min-w-0 w-full">
          <h1 className="text-3xl font-bold text-zinc-900 uppercase">PAINEL DA PORTARIA</h1>
          <div className="mt-1 border-b border-zinc-100 pb-2.5 flex flex-col items-start gap-1.5">
            <p className="text-zinc-500 font-medium break-words w-full">{condoName}</p>
            <button
              onClick={() => setShowShiftModal(true)}
              className={`inline-flex items-center gap-2 text-[11px] leading-snug whitespace-normal text-left max-w-full px-3.5 py-1.5 rounded-2xl border transition-all active:scale-95 font-bold ${
                !activePlantao || isShiftExpired || currentPorter === 'Selecione o Porteiro'
                  ? 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse shadow-sm'
                  : activePlantao?.substituicao?.is_substituicao
                  ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
              title="Gerenciar Plantão / Trocar Porteiro"
            >
              <span className="uppercase tracking-tight inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words">
                <span>👤 {activePlantao ? activePlantao.porteiro_nome.toUpperCase() : 'INICIAR PLANTÃO'}</span>
                {activePlantao && (
                  <span className="text-[9px] opacity-80 font-mono font-medium whitespace-nowrap">
                    ({activePlantao.horario_inicio} - {activePlantao.horario_fim})
                    {activePlantao.substituicao?.is_substituicao && ' 🔁'}
                  </span>
                )}
              </span>
            </button>
          </div>
          <p className="text-zinc-400 text-sm mt-2 flex items-center justify-between">
            <span>Agilidade no registro, recebimento e entrega!</span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-zinc-300">
              <Zap className={`w-3 h-3 ${condoSettings?.whatsapp_mode === 'api_automatica' ? 'text-emerald-400' : 'text-zinc-300'}`} />
              MODO: {condoSettings?.whatsapp_mode === 'api_automatica' ? 'AUTOMÁTICO (API)' : 'MANUAL'}
            </span>
          </p>
        </div>
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <div className="flex flex-1 md:flex-none gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setQrPackage(null);
                setManualToken('');
                setDeliveryPhoto(null);
                setCameraError(null);
                setIsDeliverySuccess(false);
                setRetrievalMethod('qr_code');
                setShowManualInput(false);
                setCameraStarted(true);
                setQrScanStatus('scanning');
                setIsScanning(true);
              }}
              className="w-full md:w-auto flex-1 bg-white text-zinc-900 px-6 py-4 rounded-2xl font-bold hover:bg-zinc-50 transition-all flex items-center justify-center gap-3 border border-zinc-200 shadow-sm"
            >
              <Hash className="w-6 h-6 text-emerald-600" />
              CÓDIGO DE RETIRADA
            </button>
          </div>
          <motion.button
            key={`photo-btn-pulse-${pulseKey}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              navigate('/packages/new');
            }}
            animate={{
              scale: [1, 1.05, 1],
              boxShadow: [
                "0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -2px rgba(16, 185, 129, 0.05)",
                "0 20px 25px -5px rgba(16, 185, 129, 0.3), 0 8px 10px -6px rgba(16, 185, 129, 0.15)",
                "0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -2px rgba(16, 185, 129, 0.05)"
              ]
            }}
            transition={{
              duration: 0.8,
              repeat: 2, // Total de 3 pulsos
              ease: "easeInOut"
            }}
            className="flex-1 md:flex-none bg-emerald-600 text-white px-6 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
          >
            <Plus className="w-6 h-6" />
            TIRAR FOTO
          </motion.button>
          {/* BOTÃO ÚNICO DE AVISAR MORADOR / ALERTA DE ESQUECIMENTO (exclusivo APÓS REGISTRO após ciclo de 3 min) */}
          {(() => {
            if (!shouldShowOperationalNotifyHeader({ notifyAfter, showInactivityAlert, pendingNoticesCount })) {
              return null;
            }

            const isAlertMode = notifyAfter && showInactivityAlert;

            return (
              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    // Regra 5: Leva DIRETAMENTE para a lista de moradores pendentes, sem modal intermediário
                    handleGoToPendingResidents();
                  }}
                  animate={{
                    scale: [1, 1.03, 1],
                    boxShadow: isAlertMode ? [
                      "0 0 0 0 rgba(239, 68, 68, 0.4)",
                      "0 0 0 10px rgba(239, 68, 68, 0)",
                      "0 0 0 0 rgba(239, 68, 68, 0.4)"
                    ] : [
                      "0 4px 6px -1px rgba(234, 88, 12, 0.2)",
                      "0 10px 15px -3px rgba(234, 88, 12, 0.4)",
                      "0 4px 6px -1px rgba(234, 88, 12, 0.2)"
                    ]
                  }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  className={`px-6 py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-3 shadow-xl ${isAlertMode ? "bg-red-600 hover:bg-red-700 text-white shadow-red-200 ring-4 ring-red-400/40 animate-pulse" : "bg-orange-600 hover:bg-orange-700 text-white shadow-orange-200 ring-2 ring-orange-400 ring-offset-2"}`}
                  title={isAlertMode ? 'Clique para ir diretamente aos moradores pendentes' : 'Avisar moradores'}
                >
                  {isAlertMode ? <AlertCircle className="w-6 h-6 animate-bounce" /> : <MessageSquare className="w-6 h-6" />}
                  <div className="text-left">
                    <span className="block text-xs uppercase tracking-wide">
                      {isAlertMode ? 'LEMBRETE! Envie as notificações aos moradores' : 'AVISAR MORADOR'}
                    </span>
                    <span className={`block text-[11px] font-medium ${isAlertMode ? "text-red-100" : "text-orange-100"}`}>
                      {pendingResidentsCount} {pendingResidentsCount === 1 ? 'morador pendente' : 'moradores pendentes'} ({pendingNoticesCount} {pendingNoticesCount === 1 ? 'encomenda' : 'encomendas'})
                    </span>
                  </div>
                </motion.button>

                {/* Botão do Sininho com 1 toque (silenciar) e 2 toques (controle discreto de volume) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleBellClick}
                    title={isAlertSnoozed ? 'Som silenciado (toque para reativar, 2x para volume)' : '1 toque: Silenciar som (5m) | 2 toques: Ajustar volume'}
                    className={`p-3 rounded-2xl border transition-all flex items-center gap-1.5 select-none ${
                      isAlertSnoozed
                        ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-sm'
                        : 'bg-white text-zinc-600 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50 shadow-sm'
                    }`}
                  >
                    <span>{isAlertSnoozed ? '🔕' : '🔔'}</span>
                    <span className="text-xs font-bold">{isAlertSnoozed ? 'Reativar (5m)' : 'Silenciar'}</span>
                  </button>

                  {/* Pequeno popover discreto de volume (abre somente no duplo toque) */}
                  {showVolumePopup && (
                    <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-zinc-200 shadow-2xl rounded-2xl p-3 min-w-[210px] animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-zinc-100">
                        <span className="text-[11px] font-black text-zinc-800 uppercase tracking-wider flex items-center gap-1">
                          <Volume2 className="w-3.5 h-3.5 text-emerald-600" /> Volume Alerta
                        </span>
                        <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {Math.round(alertVolumeMultiplier * 100)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mb-2.5 leading-tight">
                        Aumenta a partir do nível atual do sistema.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleIncreaseVolume}
                          className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                        >
                          <Volume2 className="w-3.5 h-3.5" /> AUMENTAR +
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowVolumePopup(false)}
                          className="p-2 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 transition-colors"
                          title="Fechar"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* MODO DE NOTIFICAÇÃO - Versão padronizada: Altura igual aos botões superiores e mais compacta */}
          <div className="bg-white/90 backdrop-blur-md border border-zinc-100 py-2.5 px-6 rounded-2xl shadow-sm w-full sm:w-auto sm:min-w-[320px] flex-1 md:flex-none mt-2 md:mt-0 flex flex-col justify-center min-h-[64px]">
            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] mb-1.5 text-center">
              MODO DE NOTIFICAÇÃO
            </h3>
            
            <div className="flex items-center justify-between gap-4">
              {/* Opção Esquerda */}
              <button 
                type="button"
                onClick={() => {
                  setNotifyAfter(false);
                  if (navigator.vibrate) navigator.vibrate(10);
                }}
                className={`flex-1 text-center transition-all ${!notifyAfter ? 'opacity-100 scale-105' : 'opacity-20 hover:opacity-40'}`}
              >
                <p className={`text-[12px] font-black leading-tight uppercase transition-colors ${!notifyAfter ? 'text-indigo-600' : 'text-zinc-900'}`}>
                  ENVIO AUTOMÁTICO
                </p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter mt-0">
                  Envia na hora
                </p>
              </button>

              {/* Switch Central */}
              <div 
                className="relative w-20 h-10 bg-zinc-100 rounded-full cursor-pointer p-1 shadow-inner shrink-0 flex items-center"
                onClick={() => {
                  setNotifyAfter(!notifyAfter);
                  if (navigator.vibrate) navigator.vibrate(15);
                }}
              >
                <div className="absolute inset-0 flex items-center justify-between px-3 pointer-events-none">
                  <div className={`w-1.5 h-1.5 rounded-full transition-colors ${!notifyAfter ? 'bg-indigo-600' : 'bg-zinc-300'}`} />
                  <div className={`w-1.5 h-1.5 rounded-full transition-colors ${notifyAfter ? 'bg-orange-600' : 'bg-zinc-300'}`} />
                </div>
                
                <motion.div
                  animate={{ x: notifyAfter ? 40 : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={`w-8 h-8 rounded-full shadow-lg flex items-center justify-center transition-colors relative z-10 ${notifyAfter ? 'bg-orange-600' : 'bg-indigo-600'}`}
                >
                  <motion.div 
                    animate={{ rotate: notifyAfter ? 180 : 0 }}
                    className="text-white"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </motion.div>
                </motion.div>
              </div>

              {/* Opção Direita */}
              <button 
                type="button"
                onClick={() => {
                  setNotifyAfter(true);
                  if (navigator.vibrate) navigator.vibrate(10);
                }}
                className={`flex-1 text-center transition-all ${notifyAfter ? 'opacity-100 scale-105' : 'opacity-20 hover:opacity-40'}`}
              >
                <p className={`text-[12px] font-black leading-tight uppercase transition-colors ${notifyAfter ? 'text-orange-600' : 'text-zinc-900'}`}>
                  APÓS REGISTRO
                </p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter mt-0">
                  Avisar depois
                </p>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-zinc-100 rounded-2xl mb-8 w-fit overflow-x-auto max-w-full">
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('pending'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'pending' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Clock className="w-5 h-5" />
          Pendentes ({sumPackageItems(pendingPackages)})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('delivered'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'delivered' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <CheckCircle className="w-5 h-5" />
          Retiradas ({sumPackageItems(deliveredPackages)})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('all'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <PackageIcon className="w-5 h-5" />
          Todas ({sumPackageItems(packages)})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('residents'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'residents' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Users className="w-5 h-5" />
          MORADORES ({residents.length})
        </button>
      </div>

      {activeTab === 'residents' && (
        <div className="bg-[#0f2b38]/5 border border-[#0f2b38]/15 rounded-2xl p-4 mb-8 flex flex-wrap gap-8">
          <div>
            <p className="text-[10px] font-bold text-[#1e495a] uppercase tracking-widest mb-1">Total de Moradores</p>
            <p className="text-2xl font-bold text-[#0a1e28]">{residents.length}</p>
          </div>
          <div className="w-px h-10 bg-[#0f2b38]/15 hidden sm:block" />
          <div>
            <p className="text-[10px] font-bold text-[#1e495a] uppercase tracking-widest mb-1">Total de Casas</p>
            <p className="text-2xl font-bold text-[#0a1e28]">
              {new Set(residents.filter(r => r.unidade).map(r => `${r.unidade}-${r.block || ''}-${r.street || ''}`)).size}
            </p>
          </div>
        </div>
      )}

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
          placeholder={activeTab !== 'residents' ? "Buscar por destinatário ou unidade..." : "Buscar morador por nome ou unidade..."}
        />
      </div>

      {activeTab === 'residents' && (
        <div className="flex justify-end mb-6">
          <div className="flex flex-col gap-2 w-full sm:w-auto items-stretch sm:items-end">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                navigate('/profiles/new');
              }}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
            >
              <UserPlus className="w-5 h-5" />
              Novo Morador
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setIsImporterOpen(true);
              }}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white border border-zinc-200 text-zinc-700 rounded-2xl font-bold hover:bg-zinc-50 transition-all shadow-sm"
            >
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              Importar Planilha
            </button>
          </div>
        </div>
      )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
          </div>
        ) : activeTab !== 'residents' ? (
          filteredPackages.length > 0 ? (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPackages.map((pkg: any) => (
                <PackageItem
                  key={pkg.package_id || pkg.id}
                  pkg={pkg}
                  getWhatsAppBadge={getWhatsAppBadge}
                  getDeliveryMethodLabel={getDeliveryMethodLabel}
                  onDeliver={(p) => {
                    if (!isPackageNotified(p)) {
                      guideToNotification(p);
                      return;
                    }
                    setDeliveredToType('resident');
                    setAuthorizedName('');
                    setAuthorizedDoc('');
                    setQrPackage(p);
                    setPackageToConfirm(p);
                    setShowConfirmDelivery(true);
                  }}
                  onDeliverWithPhoto={(p) => {
                    if (!isPackageNotified(p)) {
                      guideToNotification(p);
                      return;
                    }
                    setDeliveredToType('resident');
                    setAuthorizedName('');
                    setAuthorizedDoc('');
                    pendingPackageRef.current = p;
                    setQrPackage(p);
                    setRetrievalMethod('manual');
                    fileInputRef.current?.click();
                  }}
                  onCodeRetrieval={(p) => {
                    if (!isPackageNotified(p)) {
                      guideToNotification(p);
                      return;
                    }
                    setDeliveredToType('resident');
                    setAuthorizedName('');
                    setAuthorizedDoc('');
                    setQrPackage(p);
                    setRetrievalMethod('manual');
                    setShowManualInput(true);
                    setIsScanning(true);
                    setQrScanStatus('idle');
                  }}
                  onViewPhotos={(p) => {
                    // AJUSTE 1: Exibir fotos únicas/distintas do grupo (evita repetição se o lote compartilhar a mesma foto)
                    const seenUrls = new Set<string>();
                    const distinctPhotos: any[] = [];
                    (p.packages || []).forEach((item: any) => {
                      if (item.photo_url && !seenUrls.has(item.photo_url)) {
                        seenUrls.add(item.photo_url);
                        distinctPhotos.push({
                          url: item.photo_url,
                          carrier: item.carrier,
                          received_at: item.received_at,
                          package: item
                        });
                      }
                    });

                    if (distinctPhotos.length > 0) {
                      setViewGroupPhotos(distinctPhotos);
                    } else {
                      toast.error('Nenhuma etiqueta com foto neste grupo');
                    }
                  }}
                  onViewLabel={(pkg) => {
                    setViewPhotoUrl(pkg.photo_url);
                    setViewPhotoPkg(pkg);
                  }}
                  onNotify={handleDirectNotify}
                  onResend={handleResendNotify}
                  isResending={resendingPackageKey === (pkg.package_id || pkg.id)}
                  handleDeliver={handleDeliver}
                  setQrPackage={setQrPackage}
                />
              ))}
            </div>

            {activeTab === 'delivered' && hasMoreDelivered && (
              <div className="pt-4 flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreDelivered}
                  disabled={isLoadingMoreDelivered}
                  className="px-6 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm tracking-wide transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoadingMoreDelivered ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Carregando mais entregues...</span>
                    </>
                  ) : (
                    <span>Carregar mais entregues (+50)</span>
                  )}
                </button>
              </div>
            )}
            </>
          ) : (
          <div className="text-center py-20 bg-white rounded-[3rem] border-2 border-dashed border-zinc-100">
            <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
              <PackageIcon className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhuma encomenda encontrada</h3>
            <p className="text-zinc-500">Tente buscar por outro termo ou mude o filtro.</p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
            <h2 className="text-3xl font-bold text-zinc-900 uppercase">Moradores ({residents.length})</h2>
          </div>

          {filteredResidents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredResidents.map((resident) => (
                <ResidentCard
                  key={resident.id}
                  resident={resident}
                  activeResidentMenu={activeResidentMenu}
                  setActiveResidentMenu={setActiveResidentMenu}
                  onEdit={handleEditResident}
                  onDelete={handleDeleteResident}
                  onToggleStatus={toggleResidentStatus}
                  userRole={user.role}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
              <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum morador encontrado</h3>
              <p className="text-zinc-500">Tente buscar por outro nome ou unidade.</p>
            </div>
          )}
        </div>
      )}

      {/* Modal de Foto Individual */}
      {viewPhotoUrl && !viewGroupPhotos && (
        <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative max-w-5xl w-full h-[95vh] flex flex-col items-center justify-center">
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setViewPhotoUrl(null);
                setViewPhotoPkg(null);
              }}
              className="absolute top-2 right-2 sm:top-0 sm:right-0 text-white bg-white/20 hover:bg-white/30 p-2.5 rounded-full transition-all z-20 shadow-lg"
              title="Fechar visualização"
            >
              <Plus className="w-8 h-8 rotate-45" />
            </button>
            
            <div className="flex-1 w-full flex items-center justify-center overflow-hidden">
              <img 
                src={viewPhotoUrl} 
                alt="Foto da etiqueta" 
                className="max-w-full max-h-full object-contain rounded-3xl shadow-2xl border-2 border-white/10"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="mt-8 flex gap-4 w-full max-w-md">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setViewPhotoUrl(null);
                  setViewPhotoPkg(null);
                }}
                className="flex-1 bg-white/10 text-white border border-white/20 px-8 py-4 rounded-2xl font-bold hover:bg-white/20 transition-all backdrop-blur-md"
              >
                Fechar
              </button>
              <a 
                href={viewPhotoUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-1 bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                Abrir original
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Modal for Group Photos */}
      <AnimatePresence>
        {viewGroupPhotos && (
          <div className="fixed inset-0 bg-black/95 z-[70] flex flex-col backdrop-blur-sm overflow-hidden">
            <div className="p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] flex justify-between items-center bg-black/50 border-b border-white/10">
              <div>
                <h3 className="text-white text-xl font-bold uppercase tracking-tight">Etiquetas do Grupo</h3>
                <p className="text-zinc-400 text-xs">{viewGroupPhotos.length} fotos disponíveis</p>
              </div>
              <button 
                onClick={() => {
                  setViewGroupPhotos(null);
                  setViewPhotoUrl(null);
                  setViewPhotoPkg(null);
                }}
                className="p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                title="Fechar galeria"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-12 custom-scrollbar">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
                {viewGroupPhotos.map((photo, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => {
                      setViewPhotoUrl(photo.url);
                      setCurrentPhotoIndex(idx);
                    }}
                    className="group cursor-pointer"
                  >
                    <div className="relative aspect-[3/4] bg-zinc-900 rounded-3xl overflow-hidden border border-white/10 shadow-lg group-hover:scale-[1.02] transition-transform duration-300">
                      <img 
                        src={photo.url} 
                        alt={`Etiqueta ${idx + 1}`}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                        <p className="text-white text-xs font-bold">{photo.carrier}</p>
                        <p className="text-zinc-300 text-[10px]">{formatSafeDateTime(photo.received_at)}</p>
                      </div>
                      <div className="absolute top-3 right-3 bg-white/20 backdrop-blur-md p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                        <Eye className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Sub-modal Zoom for the gallery */}
            <AnimatePresence>
              {viewPhotoUrl && viewGroupPhotos && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/98 z-[80] flex flex-col items-center justify-center p-4 md:p-12 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
                >
                  <div className="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] flex items-center gap-3 text-white max-w-[calc(100%-5rem)]">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
                      <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" />
                    </div>
                    <div className="truncate">
                      <p className="font-bold text-base sm:text-lg truncate">{viewGroupPhotos[currentPhotoIndex].carrier}</p>
                      <p className="text-zinc-400 text-xs">{formatSafeDateTime(viewGroupPhotos[currentPhotoIndex].received_at)}</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setViewPhotoUrl(null);
                      setViewPhotoPkg(null);
                    }}
                    className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] w-11 h-11 sm:w-12 sm:h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-colors z-[90] shadow-lg"
                    title="Fechar zoom"
                  >
                    <X className="w-6 h-6" />
                  </button>

                  <div className="relative w-full h-full flex items-center justify-center group/nav">
                    {/* Previous Button */}
                    <button 
                      onClick={() => {
                        const newIndex = (currentPhotoIndex - 1 + viewGroupPhotos.length) % viewGroupPhotos.length;
                        setCurrentPhotoIndex(newIndex);
                        setViewPhotoUrl(viewGroupPhotos[newIndex].url);
                      }}
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-16 h-16 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md opacity-40 group-hover/nav:opacity-100 hover:scale-110"
                    >
                      <ChevronLeft className="w-8 h-8" />
                    </button>

                    {/* Next Button */}
                    <button 
                      onClick={() => {
                        const newIndex = (currentPhotoIndex + 1) % viewGroupPhotos.length;
                        setCurrentPhotoIndex(newIndex);
                        setViewPhotoUrl(viewGroupPhotos[newIndex].url);
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-16 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md opacity-40 group-hover/nav:opacity-100 hover:scale-110"
                    >
                      <ChevronRight className="w-8 h-8" />
                    </button>

                    <div className="max-w-5xl w-full h-full flex flex-col items-center justify-center">
                      <motion.img 
                        key={currentPhotoIndex}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        src={viewPhotoUrl} 
                        alt="Zoom da etiqueta"
                        className="max-w-full max-h-[85vh] object-contain rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.5)] border-4 border-white/10"
                        referrerPolicy="no-referrer"
                      />
                      
                      <div className="mt-8 flex items-center gap-3">
                        {viewGroupPhotos.map((_, i) => (
                          <div 
                            key={i} 
                            className={`h-1.5 rounded-full transition-all duration-300 ${i === currentPhotoIndex ? 'w-8 bg-emerald-500' : 'w-2 bg-white/20'}`}
                          />
                        ))}
                      </div>

                      {viewGroupPhotos[currentPhotoIndex].package?.status === 'received' && (
                        <div className="mt-8 flex flex-col items-center gap-3 bg-white/5 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 w-full max-w-sm animate-in slide-in-from-bottom-4">
                          <p className="text-white text-center text-sm font-medium opacity-70">
                            Morador conferiu a encomenda. Toque para confirmar.
                          </p>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.preventDefault();
                              const pkg = viewGroupPhotos[currentPhotoIndex].package;
                              if (!pkg) return;
                              await handleDeliver(pkg.package_id || pkg.id, 'CONFIRMADO_PELO_MORADOR', undefined, pkg);
                              setViewPhotoUrl(null);
                              setViewGroupPhotos(null);
                              toast.success('RECEBIMENTO CONFIRMADO');
                            }}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-xl font-black text-lg shadow-lg transition-all flex items-center justify-center gap-2"
                          >
                            <Check className="w-5 h-5" />
                            ENTREGAR
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      {/* Notificar Todos Modal (Manual Queue) */}
      <AnimatePresence>
        {isNotifyingAll && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl relative overflow-hidden"
            >
              {/* Progress Bar */}
              <div className="absolute top-0 left-0 h-1.5 bg-zinc-100 w-full">
                <motion.div 
                  className="h-full bg-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${(notifyIndex / notifyQueue.length) * 100}%` }}
                />
              </div>

              {notifyIndex < notifyQueue.length ? (
                <div className="space-y-6 pt-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Fila de Notificação</span>
                      <h3 className="text-2xl font-bold text-zinc-900">Avisar Moradores</h3>
                    </div>
                    <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg text-xs font-bold ring-1 ring-emerald-100">
                      {notifyIndex + 1} de {notifyQueue.length}
                    </div>
                  </div>

                  <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-100 text-center space-y-3">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm mx-auto mb-2 ring-1 ring-zinc-100">
                      <User className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-bold text-zinc-900">{notifyQueue[notifyIndex].resident.nome}</h4>
                    <p className="text-sm text-zinc-500 flex items-center justify-center gap-2">
                       <Smartphone className="w-4 h-4" />
                       {notifyQueue[notifyIndex].resident.telefone}
                    </p>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <Clock className="w-3 h-3" />
                      {(() => {
                        const curResident = notifyQueue[notifyIndex]?.resident;
                        const resPending = packages.filter((p: any) => p.recipient_id === curResident?.id && p.status !== 'delivered');
                        const totalCount = sumPackageItems(resPending.length > 0 ? resPending : notifyQueue[notifyIndex].packages);
                        return `${totalCount} ${totalCount > 1 ? 'Encomendas Pendentes' : 'Encomenda Pendente'}`;
                      })()}
                    </div>
                  </div>

                  <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50">
                    <p className="text-xs text-emerald-800 font-medium italic">
                      {(() => {
                        const curResident = notifyQueue[notifyIndex]?.resident;
                        const resPending = packages.filter((p: any) => p.recipient_id === curResident?.id && p.status !== 'delivered');
                        const totalCount = sumPackageItems(resPending.length > 0 ? resPending : notifyQueue[notifyIndex].packages);
                        return `"Olá, ${curResident?.nome}! Você possui ${totalCount} ${totalCount > 1 ? 'encomendas disponíveis' : 'encomenda disponível'} para retirada na portaria."`;
                      })()}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      autoFocus
                      onClick={() => processNextInQueue(notifyIndex)}
                      className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-3 animate-in fade-in zoom-in duration-300"
                    >
                      <Send className="w-5 h-5" />
                      ENVIAR WHATSAPP ({notifyIndex + 1}/{notifyQueue.length})
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          if (notifyIndex + 1 < notifyQueue.length) {
                            setNotifyIndex(prev => prev + 1);
                          } else {
                            // Ao pular o último, encerramos a fila e mostramos sucesso se nada mais restar
                            setNotifyIndex(notifyQueue.length);
                          }
                        }}
                        className="py-3 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all text-sm"
                      >
                        Pular este
                      </button>
                      <button
                        onClick={() => {
                          setIsNotifyingAll(false);
                          setModoEnvio(null);
                          setNotifyQueue([]);
                          setNotifyIndex(0);
                          fetchData();
                        }}
                        className="py-3 text-red-600 font-bold hover:bg-red-50 rounded-xl transition-all text-sm"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center space-y-6">
                  <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <CheckCircle className="w-12 h-12" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-zinc-900">Todas as notificações foram enviadas.</h3>
                    <p className="text-zinc-500 italic">Fechando automaticamente...</p>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação de Envio em Lote */}
      <AnimatePresence>
        {showBatchModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              {...anim({
                initial: { opacity: 0, scale: 0.95, y: 20 },
                animate: { opacity: 1, scale: 1, y: 0 },
                exit: { opacity: 0, scale: 0.95, y: 20 }
              })}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 text-center flex-shrink-0">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${batchMode === 'api' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  <MessageSquare className="w-10 h-10" />
                </div>
                
                <h3 className="text-2xl font-bold text-zinc-900 mb-2">
                  {batchStep === 'manual_list' ? 'Envio Manual Assistido' : 
                   batchStep === 'finished' ? 'Envio Concluído' : 'Enviar avisos em lote'}
                </h3>
                <p className="text-zinc-500 mb-4">
                  {batchStep === 'manual_list' 
                    ? `Siga o fluxo sequencial para enviar as mensagens.`
                    : batchStep === 'finished'
                    ? 'Todos os avisos foram processados com sucesso.'
                    : `Você tem ${pendingNoticesCount} mensagens pendentes para enviar.`}
                </p>

                {batchStep === 'manual_list' && (
                  <div className="mb-6">
                    <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        className="bg-emerald-600 h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${((manualIndex + 1) / batchPackages.length) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs font-bold text-zinc-400 mt-2 uppercase tracking-widest">
                      Mensagem {manualIndex + 1} de {batchPackages.length}
                    </p>
                  </div>
                )}

                {batchStep === 'sending' && (
                  <div className="mb-6">
                    <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        className="bg-emerald-600 h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs font-bold text-zinc-400 mt-2 uppercase tracking-widest">
                      Enviando via API... {batchProgress.current}/{batchProgress.total}
                    </p>
                  </div>
                )}
              </div>

              {batchStep === 'manual_list' && (
                <div className="flex-1 overflow-y-auto px-8 pb-8">
                  {(() => {
                    const pkg = batchPackages[manualIndex];
                    if (!pkg) return null;
                    const resident = residents.find(r => r.id === pkg.recipient_id);
                    
                    return (
                      <motion.div 
                        key={pkg.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-zinc-50 p-8 rounded-[2rem] border border-zinc-100 text-center"
                      >
                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 border border-zinc-100">
                          <User className="w-8 h-8 text-emerald-600" />
                        </div>
                        <h4 className="text-xl font-bold text-zinc-900 mb-1">
                          {pkg.moradores?.nome || 'Morador não identificado'}
                        </h4>
                        <p className="text-zinc-500 mb-4">{formatPackageUnit(pkg)}</p>
                        
                        {pkg.carrier && (
                          <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-zinc-100 text-xs font-bold text-zinc-600 mb-6">
                            <Truck className="w-3.5 h-3.5 text-blue-500" />
                            {pkg.carrier.toUpperCase()}
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              const currentResident = residents.find(r => r.id === pkg.recipient_id) || pkg.moradores;
                              if (currentResident) {
                                const residentPending = packages.filter((p: any) => p.recipient_id === currentResident.id && p.status !== 'delivered');
                                const totalPhysicalPending = sumPackageItems(residentPending.length > 0 ? residentPending : [pkg]);
                                const pCode = pkg.pickup_code || generatePickupCode();
                                const pToken = pkg.pickup_token || generateSecureToken(16);
                                const freshMsg = prepareWhatsAppNotification(
                                  currentResident,
                                  condoName || 'Condomínio',
                                  pCode,
                                  undefined,
                                  pToken,
                                  totalPhysicalPending || 1,
                                  'disponivel',
                                  undefined,
                                  undefined,
                                  pkg.photo_url
                                );
                                if (freshMsg) {
                                  const link = getWhatsAppLink(currentResident.telefone || '', freshMsg, pkg.photo_url);
                                  window.open(link, '_blank');
                                  recordSendActivity('WHATSAPP_ABERTO', pkg.id);
                                  const siblingUnnotifiedIds = Array.from(new Set(
                                    packages
                                      .filter((p: any) => p.recipient_id === currentResident.id && p.status !== 'delivered' && !isPackageNotificationConfirmed(p))
                                      .map((p: any) => p.id)
                                      .filter(Boolean)
                                  ));
                                  setConfirmWhatsAppError(null);
                                  setPendingWhatsAppConfirm({
                                    resident: currentResident,
                                    packageIds: siblingUnnotifiedIds.length > 0 ? siblingUnnotifiedIds : [pkg.id],
                                    residentName: currentResident.nome,
                                    unit: formatPackageUnit(pkg),
                                    totalItems: totalPhysicalPending || 1,
                                    pickupCode: pCode,
                                    pickupToken: pToken,
                                    message: freshMsg,
                                    isQueue: false,
                                    isBatchManual: true,
                                    batchManualIndex: manualIndex
                                  });
                                }
                              }
                            }}
                            className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200 cursor-pointer"
                          >
                            <Send className="w-6 h-6" />
                            ENVIAR WHATSAPP
                          </button>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleSkipManual}
                              className="bg-white text-zinc-600 py-4 rounded-2xl font-bold border border-zinc-200 hover:bg-zinc-50 transition-all"
                            >
                              PULAR
                            </button>
                            <button
                              onClick={() => {
                                setShowBatchModal(false);
                                setBatchStep('confirm');
                              }}
                              className="bg-white text-red-500 py-4 rounded-2xl font-bold border border-zinc-200 hover:bg-red-50 transition-all"
                            >
                              CANCELAR
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}
                </div>
              )}

              {batchStep === 'finished' && (
                <div className="p-8 pt-0 flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowBatchModal(false);
                      setBatchStep('confirm');
                    }}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                  >
                    FECHAR
                  </button>
                </div>
              )}

              <div className="p-8 pt-0 flex-shrink-0">
                <div className="grid grid-cols-1 gap-3">
                  {batchStep === 'confirm' && (
                    <button
                      onClick={handleBatchSend}
                      disabled={isBatchSending}
                      className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
                    >
                      {condoSettings?.whatsapp_mode === 'api_automatica' ? (
                        <>
                          <Zap className="w-5 h-5" />
                          INICIAR ENVIO AUTOMÁTICO
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          INICIAR ENVIO MANUAL
                        </>
                      )}
                    </button>
                  )}
                  
                  <button
                    onClick={() => {
                      setShowBatchModal(false);
                      setBatchStep('confirm');
                    }}
                    disabled={isBatchSending}
                    className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50"
                  >
                    {batchStep === 'manual_list' ? 'FECHAR' : 'CANCELAR'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação Explícita de Envio no WhatsApp */}
      <AnimatePresence>
        {pendingWhatsAppConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-950/75 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-zinc-200"
            >
              <div className="p-6 bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-center relative">
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-md">
                  <MessageSquare className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-black">
                  {pendingWhatsAppConfirm.isResend ? 'Confirmação de Reenvio' : 'Confirmação de Envio'}
                </h3>
                <p className="text-emerald-100 text-xs mt-1">
                  O WhatsApp foi aberto no navegador
                </p>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Destinatário</span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      {pendingWhatsAppConfirm.unit}
                    </span>
                  </div>
                  <div className="text-base font-bold text-zinc-900">
                    {pendingWhatsAppConfirm.residentName}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {pendingWhatsAppConfirm.totalItems} {pendingWhatsAppConfirm.totalItems === 1 ? 'encomenda' : 'encomendas'} • Código: <span className="font-mono font-bold text-zinc-800">{pendingWhatsAppConfirm.pickupCode}</span>
                  </div>
                </div>

                <div className="text-center py-1">
                  <p className="text-sm font-bold text-zinc-800">
                    A mensagem foi enviada com sucesso no WhatsApp?
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {pendingWhatsAppConfirm.isResend
                      ? 'Se você cancelou ou fechou sem enviar, clique em "Não" para manter a notificação anterior.'
                      : 'Se você cancelou ou fechou sem enviar, clique em "Não" para manter a encomenda na lista de pendências.'}
                  </p>
                </div>

                {confirmWhatsAppError && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-left flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-700">
                      <p className="font-bold">Falha ao confirmar no banco de dados</p>
                      <p className="mt-0.5">{confirmWhatsAppError} Tente novamente abaixo.</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isConfirmingWhatsApp}
                    onClick={() => handleCancelWhatsAppSent()}
                    className="w-full py-3.5 px-4 rounded-xl border border-zinc-200 text-zinc-700 font-bold hover:bg-zinc-100 disabled:opacity-60 transition-colors text-xs"
                  >
                    {pendingWhatsAppConfirm.isResend ? 'Não / Manter Como Estava' : 'Não / Continuar Pendente'}
                  </button>
                  <button
                    type="button"
                    disabled={isConfirmingWhatsApp}
                    onClick={() => handleConfirmWhatsAppSent(pendingWhatsAppConfirm)}
                    className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black shadow-lg shadow-emerald-600/30 transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isConfirmingWhatsApp ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        {confirmWhatsAppError
                          ? 'Tentar Novamente'
                          : (pendingWhatsAppConfirm.isResend ? 'Sim, Confirmar Reenvio' : 'Sim, Confirmar Envio')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Input de arquivo oculto para captura de foto de entrega */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {/* Modal de Cadastro/Edição de Morador */}
      {(isAddingResident || editingResident) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-zinc-900/80 backdrop-blur-sm overflow-y-auto">
          <motion.div
            {...anim({
              initial: { opacity: 0, scale: 0.95, y: 20 },
              animate: { opacity: 1, scale: 1, y: 0 }
            })}
            className="bg-white rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden my-auto max-h-[calc(100dvh-2rem)] flex flex-col"
          >
            <div className="p-6 sm:p-8 overflow-y-auto">
              <div className="flex justify-between items-center mb-6 sm:mb-8">
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold text-zinc-900">
                    {editingResident ? 'Editar Morador' : 'Novo Morador'}
                  </h3>
                  <p className="text-zinc-500 text-sm">Preencha os dados do morador</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsAddingResident(false);
                    setEditingResident(null);
                  }}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                  title="Fechar"
                >
                  <X className="w-6 h-6 text-zinc-400" />
                </button>
              </div>

              <form onSubmit={handleSaveResident} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    required
                    value={residentForm.full_name}
                    onChange={(e) => setResidentForm({ ...residentForm, full_name: e.target.value })}
                    className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    placeholder="Ex: João Silva"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Tipo de Unidade
                    </label>
                    <select
                      value={residentForm.unit_type}
                      onChange={(e) => setResidentForm({ ...residentForm, unit_type: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    >
                      <option value="">Selecione o tipo</option>
                      <option value="Apartamento">Apartamento</option>
                      <option value="Casa">Casa</option>
                      <option value="Sobrado">Sobrado</option>
                      <option value="Lote">Lote</option>
                      <option value="Sala">Sala</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Número da Unidade
                    </label>
                    <input
                      type="text"
                      required
                      value={residentForm.unidade}
                      onChange={(e) => setResidentForm({ ...residentForm, unidade: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: 101"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Bloco / Torre (Opcional)
                    </label>
                    <input
                      type="text"
                      value={residentForm.block}
                      onChange={(e) => setResidentForm({ ...residentForm, block: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: Bloco B"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Rua / Endereço Interno (Opcional)
                    </label>
                    <input
                      type="text"
                      value={residentForm.street}
                      onChange={(e) => setResidentForm({ ...residentForm, street: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: Rua das Palmeiras"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                    Telefone
                  </label>
                  <input
                    type="tel"
                    required
                    value={residentForm.phone}
                    onChange={(e) => setResidentForm({ ...residentForm, phone: e.target.value })}
                    className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-6 h-6" />
                      {editingResident ? 'Salvar Alterações' : 'Cadastrar Morador'}
                    </>
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal de Confirmação de Entrega */}
      <AnimatePresence>
        {showConfirmDelivery && packageToConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-zinc-900/95 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[2rem] sm:rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/10 relative my-auto max-h-[calc(100dvh-2rem)] flex flex-col"
            >
              <button 
                type="button"
                onClick={() => {
                  setShowConfirmDelivery(false);
                  setPackageToConfirm(null);
                  setIsConfirmingDelivery(false);
                }}
                className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 bg-zinc-100 hover:bg-zinc-200 rounded-full flex items-center justify-center text-zinc-500 transition-all z-10 shadow-sm"
                title="Fechar confirmação"
              >
                <X className="w-5 h-5" />
              </button>

              <AnimatePresence mode="wait">
                {isDeliverySuccess ? (
                  <motion.div
                    key="success-screen"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-12 text-center flex flex-col items-center justify-center min-h-[400px]"
                  >
                    <div className="w-24 h-24 bg-emerald-500 text-white rounded-full flex items-center justify-center mb-6 shadow-lg shadow-emerald-200">
                      <Check className="w-12 h-12" />
                    </div>
                    <h3 className="text-4xl font-black text-emerald-600 mb-2 uppercase tracking-tighter">
                      RECEBIMENTO CONFIRMADO
                    </h3>
                    <p className="text-zinc-400 font-medium tracking-widest uppercase text-xs">
                      Entrega registrada com sucesso
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="confirm-screen"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="flex flex-col flex-1 min-h-0 overflow-hidden w-full"
                  >
                    {/* CABEÇALHO FIXO */}
                    <div className="pt-6 px-6 pb-2 text-center flex-shrink-0">
                      <h2 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">ENTREGA</h2>
                    </div>

                    {/* CORPO CENTRAL ROLÁVEL */}
                    <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4 text-center custom-scrollbar">
                      {packageToConfirm.isGroup && packageToConfirm.packages && packageToConfirm.packages.length > 0 ? (
                        <div className="w-full max-h-[50vh] overflow-y-auto space-y-4 px-1 py-1 mb-4 custom-scrollbar text-left">
                          <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-3 text-center mb-2">
                            <p className="text-emerald-900 text-xs font-black uppercase tracking-wider">
                              Lote Coletivo: {sumPackageItems(packageToConfirm.packages)} Encomendas
                            </p>
                            <p className="text-[11px] text-emerald-700 font-medium">
                              Todas serão retiradas conjuntamente nesta operação.
                            </p>
                          </div>

                          {/* Foto única do lote ou fotos distintas */}
                          {(() => {
                            const distinctPhotos: string[] = [];
                            packageToConfirm.packages.forEach((item: any) => {
                              if (item.photo_url && !distinctPhotos.includes(item.photo_url)) {
                                distinctPhotos.push(item.photo_url);
                              }
                            });

                            if (distinctPhotos.length === 0) return null;

                            return (
                              <div className="space-y-3 mb-4">
                                {distinctPhotos.map((photoUrl, pIdx) => (
                                  <div key={pIdx} className="w-full bg-zinc-50 rounded-2xl overflow-hidden border border-zinc-200 shadow-xs flex items-center justify-center">
                                    <img
                                      src={photoUrl}
                                      alt={distinctPhotos.length > 1 ? `Foto do Lote ${pIdx + 1}` : "Foto do Lote"}
                                      className="w-full max-h-[220px] sm:max-h-[260px] object-contain bg-zinc-900/5 rounded-2xl"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          {/* Lista resumida e limpa das encomendas do lote (sem repetir fotos ou textos artificiais) */}
                          <div className="space-y-2">
                            {packageToConfirm.packages.map((pkgItem: any, idx: number) => {
                              const itemCarrier = pkgItem.carrier || extractKnownCarrier(pkgItem.notes);
                              return (
                                <div key={pkgItem.id || idx} className="bg-zinc-50 rounded-2xl p-3 border border-zinc-100 shadow-xs flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black flex items-center justify-center shrink-0">
                                      {idx + 1}
                                    </span>
                                    <div className="truncate">
                                      <p className="text-xs font-bold text-zinc-800 truncate">
                                        {itemCarrier ? itemCarrier.toUpperCase() : `Encomenda`}
                                      </p>
                                      {pkgItem.tracking_code && (
                                        <p className="text-[10px] font-mono text-zinc-500 truncate">S/N: {pkgItem.tracking_code}</p>
                                      )}
                                      {pkgItem.notes && (
                                        <p className="text-[10px] text-amber-700 italic truncate">{pkgItem.notes}</p>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-zinc-400 font-medium shrink-0">
                                    {formatSafeDateTime(pkgItem.received_at)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <>
                          {(() => {
                            const singleCarrier = packageToConfirm.carrier || extractKnownCarrier(packageToConfirm.notes);
                            if (!singleCarrier) return null;
                            return (
                              <div className="mb-4 inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-1.5 rounded-full border border-blue-100 text-xs font-bold shadow-xs">
                                <Truck className="w-3.5 h-3.5 text-blue-600" />
                                <span>{singleCarrier.toUpperCase()}</span>
                              </div>
                            );
                          })()}
                          {packageToConfirm.photo_url && (
                            <div className="w-full bg-zinc-50 rounded-2xl overflow-hidden mb-4 border border-zinc-100 shadow-xs flex items-center justify-center">
                              <img 
                                src={packageToConfirm.photo_url} 
                                alt="Foto da encomenda" 
                                className="w-full max-h-[220px] sm:max-h-[280px] object-contain bg-zinc-900/5 rounded-2xl"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          )}
                        </>
                      )}

                      <div className="mb-4">
                        <p className="text-zinc-800 text-base font-semibold max-w-[320px] mx-auto leading-tight">
                          {packageToConfirm.isGroup 
                            ? "Confira todas as encomendas do morador antes de confirmar a entrega coletiva."
                            : "Confira a encomenda antes de confirmar o recebimento."
                          }
                        </p>
                      </div>

                      <div className="w-full bg-zinc-50 border border-zinc-100 rounded-3xl p-5 mb-4 text-left space-y-4 shadow-sm">
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                          QUEM ESTÁ RETIRANDO?
                        </p>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setDeliveredToType('resident');
                            }}
                            className={`py-3 px-4 rounded-xl font-bold text-sm transition-all border ${
                              deliveredToType === 'resident'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                            }`}
                          >
                            Morador
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeliveredToType('authorized');
                            }}
                            className={`py-3 px-4 rounded-xl font-bold text-sm transition-all border ${
                              deliveredToType === 'authorized'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                            }`}
                          >
                            Pessoa Autorizada
                          </button>
                        </div>

                        {deliveredToType === 'authorized' && (
                          <div className="space-y-3 pt-2 animate-in fade-in duration-200">
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                                Nome da Pessoa Autorizada *
                              </label>
                              <input
                                type="text"
                                required
                                value={authorizedName}
                                onChange={(e) => setAuthorizedName(e.target.value)}
                                placeholder="Nome completo de quem retira"
                                className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-zinc-950 font-medium placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                                Documento (Opcional)
                              </label>
                              <input
                                type="text"
                                value={authorizedDoc}
                                onChange={(e) => setAuthorizedDoc(e.target.value)}
                                placeholder="RG, CPF ou outro documento"
                                className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-zinc-950 font-medium placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* RODAPÉ FIXO COM AS AÇÕES */}
                    <div className="p-4 sm:p-6 bg-white border-t border-zinc-100 flex-shrink-0 w-full flex flex-col items-center space-y-2">
                      <button
                        type="button"
                        disabled={isConfirmingDelivery || (deliveredToType === 'authorized' && !authorizedName.trim())}
                        onClick={async () => {
                          if (isConfirmingDelivery || !packageToConfirm) return;
                          
                          setIsConfirmingDelivery(true);
                          
                          // Feedback tátil e sonoro
                          try {
                            feedback.success();
                            if (navigator.vibrate) {
                              navigator.vibrate(50);
                            }
                          } catch (e) {
                            // Ignorar falhas de feedback
                          }

                          // Registra no banco
                          try {
                            const ok = await handleDeliver(
                              packageToConfirm.package_id || packageToConfirm.id, 
                              'CONFIRMADO_PELO_MORADOR' as any, 
                              undefined, 
                              packageToConfirm
                            );
                            
                            setIsConfirmingDelivery(false);
                            if (ok) {
                              setIsDeliverySuccess(true);
                              
                              // Aguarda 2 segundos e fecha
                              setTimeout(() => {
                                setShowConfirmDelivery(false);
                                setIsDeliverySuccess(false);
                                setPackageToConfirm(null);
                                setDeliveredToType('resident');
                                setAuthorizedName('');
                                setAuthorizedDoc('');
                              }, 2000);
                            }
                          } catch (err) {
                            setIsConfirmingDelivery(false);
                            // O erro já é tratado pelo handleDeliver/toast
                          }
                        }}
                        className="w-full bg-emerald-600 text-white py-4 sm:py-5 px-6 rounded-2xl font-black text-lg sm:text-xl hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-200 flex items-center justify-center gap-3 active:scale-95 group disabled:opacity-70 disabled:active:scale-100"
                      >
                        {isConfirmingDelivery ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Confirmando...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-6 h-6 group-hover:scale-110 transition-transform" />
                            ✅ CONFIRMAR RECEBIMENTO
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowConfirmDelivery(false);
                          setPackageToConfirm(null);
                          setIsConfirmingDelivery(false);
                        }}
                        className="py-2 text-zinc-400 font-bold hover:text-red-500 transition-colors uppercase tracking-[0.2em] text-[10px]"
                      >
                        Desistir / Voltar
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Início de Plantão / Seleção de Porteiro (FASE 3, 4, 5, 6, 7 & 8) */}
      <AnimatePresence>
        {(showPorterModal || showShiftModal) && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-zinc-900/80 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-zinc-100 my-auto max-h-[calc(100dvh-2rem)] flex flex-col"
            >
              <div className="p-6 md:p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-5">
                  <div className="flex-1 pr-2">
                    <h3 className="text-lg md:text-xl font-bold text-zinc-900 tracking-tight">
                      Início de Plantão / Operacional
                    </h3>
                    <p className="text-sm md:text-base font-semibold text-zinc-800 mt-2 mb-1 leading-snug">
                      Quem está assumindo o controle da portaria neste turno?
                    </p>
                  </div>
                  {activePlantao && !isShiftExpired && (
                    <button 
                      onClick={() => {
                        setShowPorterModal(false);
                        setShowShiftModal(false);
                      }} 
                      className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-400 shrink-0"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {isShiftExpired && (
                  <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 mb-4 text-xs text-amber-800 leading-relaxed flex items-start gap-2">
                    <Clock className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 animate-pulse" />
                    <span>
                      <strong>Turno Anterior Encerrado ({activePlantao?.horario_fim}).</strong>
                      Por favor, selecione quem está assumindo o novo plantão para continuar operando.
                    </span>
                  </div>
                )}

                {/* Item 9: Botão de Porteiro Substituto no Modal Existente */}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => setShowSubstituteFormModal(true)}
                    className="w-full p-3.5 rounded-2xl bg-amber-50 hover:bg-amber-100 border-2 border-dashed border-amber-300 text-amber-900 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-98 shadow-xs"
                  >
                    <Plus className="w-4 h-4 text-amber-600" />
                    <span>+ PORTEIRO SUBSTITUTO</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 my-4">
                  {porteirosList.length === 0 ? (
                    <div className="p-6 text-center text-zinc-400 bg-zinc-50 rounded-2xl">
                      <User className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
                      <p className="text-sm font-medium">Nenhum porteiro cadastrado neste condomínio.</p>
                      <p className="text-xs text-zinc-400 mt-1">Cadastre porteiros no menu "Usuários".</p>
                    </div>
                  ) : (
                    porteirosList.map((porteiro) => {
                      const now = new Date();
                      const inShift = isTimeInShift(now, porteiro.horario_inicio, porteiro.horario_fim);
                      const isCurrent = activePlantao?.porteiro_id === porteiro.id;

                      return (
                        <button
                          key={porteiro.id}
                          onClick={() => handleSelectPlantao(porteiro)}
                          className={`w-full p-4 rounded-2xl font-bold transition-all text-left flex flex-col gap-1.5 border relative ${
                            isCurrent
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950 ring-2 ring-emerald-500/20'
                              : inShift
                              ? 'bg-white border-zinc-200 hover:border-emerald-500 hover:bg-emerald-50/30'
                              : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-amber-50/50 hover:border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-bold text-sm text-zinc-900">{porteiro.full_name}</span>
                            {inShift ? (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                Escalado Agora
                              </span>
                            ) : (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                Fora da Escala
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs text-zinc-500 font-normal">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Horário: {porteiro.horario_inicio || '00:00'} às {porteiro.horario_fim || '23:59'}</span>
                          </div>

                          {isCurrent && (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold mt-1">
                              <Check className="w-4 h-4" />
                              <span>Plantão Ativo</span>
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {activePlantao && !isShiftExpired && (
                  <button
                    onClick={() => {
                      setShowPorterModal(false);
                      setShowShiftModal(false);
                    }}
                    className="w-full py-3.5 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-black transition-all text-sm"
                  >
                    Permanecer no Plantão Atual
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Específico para Porteiro Substituto (Itens 8, 9, 10, 11) */}
      <AnimatePresence>
        {showSubstituteFormModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-zinc-100 p-6 md:p-8"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-700">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-zinc-900">Porteiro Substituto</h3>
                    <p className="text-xs text-zinc-500">Cobertura temporária de plantão</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSubstituteFormModal(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 rounded-full hover:bg-zinc-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 mb-5 text-xs text-amber-800 leading-relaxed">
                Ao confirmar, <strong>o substituto assumirá imediatamente como responsável</strong> pelas novas encomendas e baixas deste plantão, sem ser adicionado à lista permanente.
              </div>

              <form onSubmit={handleConfirmSubstitutoTemporario} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={substituteFormName}
                    onChange={(e) => setSubstituteFormName(e.target.value)}
                    placeholder="Ex: Carlos da Silva"
                    className="w-full px-4 py-3 bg-zinc-50 rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1">
                    Documento (RG ou CPF) *
                  </label>
                  <input
                    type="text"
                    required
                    value={substituteFormDoc}
                    onChange={(e) => setSubstituteFormDoc(e.target.value)}
                    placeholder="Ex: 12.345.678-9 ou CPF"
                    className="w-full px-4 py-3 bg-zinc-50 rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1">
                    Telefone (Opcional)
                  </label>
                  <input
                    type="text"
                    value={substituteFormPhone}
                    onChange={(e) => setSubstituteFormPhone(e.target.value)}
                    placeholder="Ex: (11) 98765-4321"
                    className="w-full px-4 py-3 bg-zinc-50 rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1">
                    Observação (Opcional)
                  </label>
                  <input
                    type="text"
                    value={substituteFormObs}
                    onChange={(e) => setSubstituteFormObs(e.target.value)}
                    placeholder="Ex: Cobertura de ausência autorizada pelo síndico"
                    className="w-full px-4 py-3 bg-zinc-50 rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowSubstituteFormModal(false)}
                    className="flex-1 py-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold transition-all text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition-all text-sm shadow-md active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Assumir Plantão</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Substituição de Plantão (FASE 7) */}
      <AnimatePresence>
        {showSubstitutionModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-zinc-100 p-6 md:p-8"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-zinc-900">Substituição de Plantão</h3>
                  <p className="text-xs text-zinc-500">Porteiro fora da escala de horário atual</p>
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-5 text-xs text-amber-800 leading-relaxed">
                O porteiro <strong>{selectedSubstituto?.full_name}</strong> não está escalado para o horário de agora. Deseja registrar uma substituição oficial de plantão?
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Porteiro Substituto (Quem Assume)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={selectedSubstituto?.full_name || ''}
                    className="w-full px-4 py-3 bg-zinc-100 rounded-xl font-bold text-zinc-900 text-sm border border-zinc-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Porteiro Substituído (Titular do Horário)
                  </label>
                  <select
                    value={selectedSubstituido?.id || ''}
                    onChange={(e) => {
                      const found = porteirosList.find(p => p.id === e.target.value);
                      setSelectedSubstituido(found || null);
                    }}
                    className="w-full px-4 py-3 bg-white rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione quem está sendo substituído (Opcional)</option>
                    {porteirosList.filter(p => p.id !== selectedSubstituto?.id).map(p => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.horario_inicio} às {p.horario_fim})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Motivo da Substituição *
                  </label>
                  <select
                    value={motivoSubstituicao}
                    onChange={(e) => setMotivoSubstituicao(e.target.value)}
                    className="w-full px-4 py-3 bg-white rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Troca de Turno">Troca de Turno Entre Colegas</option>
                    <option value="Cobertura Especial">Cobertura Especial</option>
                    <option value="Atestado / Saúde">Atestado Médico / Saúde</option>
                    <option value="Falta Não Programada">Falta Não Programada</option>
                    <option value="Outro">Outro Motivo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    Observações (Opcional)
                  </label>
                  <input
                    type="text"
                    value={obsSubstituicao}
                    onChange={(e) => setObsSubstituicao(e.target.value)}
                    placeholder="Ex: Autorizado pelo Síndico"
                    className="w-full px-4 py-3 bg-white rounded-xl font-medium text-zinc-900 text-sm border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowSubstitutionModal(false)}
                  className="flex-1 py-3 px-4 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubstitution}
                  className="flex-1 py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all text-sm shadow-md"
                >
                  Confirmar e Iniciar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação de Exclusão de Morador */}
      <AnimatePresence>
        {residentToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Morador?</h3>
                <p className="text-zinc-500 mb-8">
                  Tem certeza que deseja excluir <strong>{residentToDelete.nome}</strong>? 
                  Ele não será removido permanentemente, apenas ocultado da lista ativa.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setResidentToDelete(null)}
                    className="py-3 px-4 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteResident}
                    disabled={loading}
                    className="py-3 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 disabled:opacity-50"
                  >
                    {loading ? 'Excluindo...' : 'Sim, Excluir'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {selectedGroup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] max-w-lg w-full p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">Itens do Grupo</h3>
                <p className="text-zinc-500">
                  Encomendas para {selectedGroup.moradores?.nome || 'Morador não identificado'}
                </p>
              </div>
              <button 
                onClick={() => setSelectedGroup(null)}
                className="w-10 h-10 bg-zinc-50 text-zinc-400 rounded-full flex items-center justify-center hover:bg-zinc-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 mb-8 custom-scrollbar">
              {selectedGroup.packages.map((pkg: any, idx: number) => {
                const itemCarrier = pkg.carrier || extractKnownCarrier(pkg.notes);
                return (
                <div key={pkg.id || idx} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
                    <PackageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 truncate flex items-center gap-1.5">
                      {itemCarrier ? (
                        <>
                          <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>{itemCarrier}</span>
                        </>
                      ) : (
                        <span>Encomenda</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">Recebido em {formatSafeDateTime(pkg.received_at)}</p>
                    {pkg.tracking_code && (
                      <p className="text-[10px] font-mono text-zinc-400 mt-1 truncate">Etiqueta: {pkg.tracking_code}</p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            <button 
              onClick={() => {
                if (!isPackageNotified(selectedGroup)) {
                  guideToNotification(selectedGroup);
                  return;
                }
                setDeliveredToType('resident');
                setAuthorizedName('');
                setAuthorizedDoc('');
                const pkg = selectedGroup;
                setSelectedGroup(null);
                pendingPackageRef.current = pkg;
                setQrPackage(pkg);
                setRetrievalMethod('manual');
                fileInputRef.current?.click();
              }}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-3"
            >
              <Camera className="w-5 h-5" />
              ENTREGAR TODAS ({selectedGroup.count})
            </button>
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      <AnimatePresence>
        {isScanning && (
          <div className="fixed inset-0 bg-zinc-950/90 z-50 flex flex-col overflow-hidden backdrop-blur-sm">
            {/* Header */}
            <div className="p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] flex justify-between items-center bg-zinc-900/50 backdrop-blur-md border-b border-white/5">
              <div>
                <h3 className="text-white text-xl font-bold">
                  {qrPackage ? 'Confirmação de Entrega' : 'CÓDIGO DE RETIRADA'}
                </h3>
                <p className="text-zinc-400 text-xs">
                  {qrPackage ? 'Registre uma foto para confirmar a retirada' : 'Aponte a câmera para o QR Code ou digite o código de 4 dígitos'}
                </p>
              </div>
              <button 
                type="button"
                onClick={async (e) => { 
                  e.preventDefault();
                  await stopScanning();
                  setIsScanning(false); 
                  setQrPackage(null); 
                  setQrScanStatus('idle'); 
                  setShowManualInput(false);
                  setManualToken('');
                  setCameraStarted(false);
                  setCameraError(null);
                }}
                className="p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                title="Fechar leitor"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 relative flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
              <AnimatePresence mode="wait">
                {isDeliverySuccess ? (
                  <motion.div 
                    key="delivery-success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-sm"
                  >
                    <div className="bg-zinc-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl p-12 flex flex-col items-center justify-center space-y-6 text-center">
                      <div className="w-24 h-24 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center shadow-sm">
                        <CheckCircle className="w-14 h-14" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-white">Entrega confirmada com sucesso</h3>
                        <p className="text-sm text-zinc-400">A baixa foi registrada com sucesso.</p>
                      </div>
                    </div>
                  </motion.div>
                ) : !qrPackage && qrScanStatus !== 'success' ? (
                  <motion.div 
                    key="scanner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-sm flex flex-col items-center gap-4"
                  >
                    {/* Leitor QR com abertura automática da câmera traseira */}
                    <div className="relative w-full aspect-square max-h-[280px] sm:max-h-[320px] bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col items-center justify-center">
                      {cameraStarted ? (
                        <>
                          <div id="qr-reader" className="w-full h-full"></div>
                          
                          {/* Scanner Frame Overlay */}
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            <div className="w-52 h-52 sm:w-56 sm:h-56 relative">
                              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-lg"></div>
                              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-lg"></div>
                              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-lg"></div>
                              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-lg"></div>
                              
                              {/* Scanning Line Animation */}
                              <motion.div 
                                animate={{ top: ['0%', '100%', '0%'] }}
                                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                className="absolute left-0 right-0 h-0.5 bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                              />
                            </div>
                          </div>

                          {/* Validating Overlay */}
                          {qrScanStatus === 'validating' && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                              <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
                              <p className="font-bold">Validando código...</p>
                            </div>
                          )}

                          <button 
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              manualInputRef.current?.focus();
                            }}
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 hover:bg-black/80 text-white rounded-xl flex items-center gap-2 transition-all border border-white/10 backdrop-blur-md text-xs font-bold"
                          >
                            <Keyboard className="w-3.5 h-3.5" />
                            Digitar Código
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center p-6 text-center">
                          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3 border border-white/10">
                            <QrCode className="w-8 h-8 text-emerald-500" />
                          </div>
                          <h4 className="text-white text-base font-bold mb-1">Leitor de QR Code</h4>
                          <p className="text-zinc-400 text-xs mb-4">
                            {cameraError || 'Clique abaixo para ativar a câmera traseira e escanear o código.'}
                          </p>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setCameraError(null);
                              setCameraStarted(true);
                            }}
                            className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/40 flex items-center gap-2 text-sm"
                          >
                            <Camera className="w-4 h-4" />
                            ATIVAR CÂMERA
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Campo de digitação manual de 4 dígitos exibido simultaneamente sem autoFocus */}
                    <div className="bg-zinc-900/80 p-4 sm:p-5 rounded-3xl border border-white/10 w-full shadow-2xl backdrop-blur-md">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] block">
                          Ou digite o código de 4 dígitos
                        </label>
                        {qrScanStatus === 'validating' && (
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                        )}
                      </div>
                      <input 
                        ref={manualInputRef}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={manualToken}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setManualToken(val);
                          if (val.length === 4) {
                            setRetrievalMethod('manual');
                            void onScanSuccess(val, 'code');
                          }
                        }}
                        placeholder="0000"
                        className="w-full bg-zinc-800/70 border-2 border-white/10 rounded-2xl px-4 py-3 text-white text-4xl font-black tracking-[0.35em] text-center outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-zinc-700 shadow-inner"
                      />
                    </div>
                  </motion.div>
                ) : qrPackage ? (
                  <motion.div 
                    key="confirmation"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-sm"
                  >
                    <div className="bg-zinc-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
                      {qrScanStatus === 'validating' ? (
                        <div className="p-12 flex flex-col items-center justify-center space-y-6">
                          <Loader2 className="w-12 h-12 animate-spin text-emerald-500" />
                          <div className="text-center space-y-2">
                            <h3 className="text-xl font-bold text-white">Salvando entrega...</h3>
                            <p className="text-sm text-zinc-400">Registrando baixa no sistema.</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="p-6 border-b border-white/5 bg-emerald-500/10">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-3 text-emerald-500">
                                <CheckCircle className="w-6 h-6" />
                                <span className="font-bold uppercase tracking-wider text-xs">Encomenda Localizada</span>
                              </div>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setQrPackage(null);
                                  setQrScanStatus('idle');
                                  setIsScanning(false);
                                  setDeliveryPhoto(null);
                                }}
                                className="p-1 hover:bg-white/10 rounded-lg text-zinc-400"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                            <h4 className="text-white text-2xl font-bold">
                              {qrPackage.moradores?.nome || 'Morador não identificado'}
                            </h4>
                          </div>
                          
                          <div className="p-6 space-y-4">
                            <div className="flex items-center gap-4 text-zinc-400">
                              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <Home className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Unidade</p>
                                <p className="text-white font-medium">{formatPackageUnit(qrPackage)}</p>
                              </div>
                            </div>

                            {/* QUEM ESTÁ RETIRANDO (CÂMERA/CÓDIGO SELECTOR) */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-left space-y-3">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                QUEM ESTÁ RETIRANDO?
                              </p>
                              
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeliveredToType('resident');
                                  }}
                                  className={`py-2 px-3 rounded-lg font-bold text-xs transition-all border ${
                                    deliveredToType === 'resident'
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                      : 'bg-transparent text-zinc-400 border-white/10 hover:bg-white/5'
                                  }`}
                                >
                                  Morador
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeliveredToType('authorized');
                                  }}
                                  className={`py-2 px-3 rounded-lg font-bold text-xs transition-all border ${
                                    deliveredToType === 'authorized'
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                      : 'bg-transparent text-zinc-400 border-white/10 hover:bg-white/5'
                                  }`}
                                >
                                  Pessoa Autorizada
                                </button>
                              </div>

                              {deliveredToType === 'authorized' && (
                                <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                                  <div>
                                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                                      Nome da Pessoa Autorizada *
                                    </label>
                                    <input
                                      type="text"
                                      required
                                      value={authorizedName}
                                      onChange={(e) => setAuthorizedName(e.target.value)}
                                      placeholder="Nome completo de quem retira"
                                      className="w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-xl text-white font-medium placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                                      Documento (Opcional)
                                    </label>
                                    <input
                                      type="text"
                                      value={authorizedDoc}
                                      onChange={(e) => setAuthorizedDoc(e.target.value)}
                                      placeholder="RG, CPF ou outro documento"
                                      className="w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-xl text-white font-medium placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            {deliveryPhoto && (
                              <div className="space-y-2">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Foto da Retirada</p>
                                <div className="relative aspect-video bg-white/5 rounded-2xl overflow-hidden border border-white/10">
                                  <img src={deliveryPhoto} className="w-full h-full object-cover" />
                                </div>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                  }}
                                  className="text-xs text-emerald-500 font-bold hover:underline"
                                >
                                  Refazer foto
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="p-6 bg-white/5 flex flex-col gap-3">
                            {qrPackage.delivery_method !== 'qr_code' && !qrPackage.pickup_code ? (
                              <div className="space-y-4">
                                {!deliveryPhoto ? (
                                  <>
                                    <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20 flex items-start gap-3">
                                      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                      <div>
                                        <p className="text-sm font-bold text-amber-500">Foto Obrigatória</p>
                                        <p className="text-xs text-amber-500/70">Esta encomenda não possui QR Code ou código. É necessário registrar uma foto para confirmar a retirada.</p>
                                      </div>
                                    </div>
                                    <button 
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        fileInputRef.current?.click();
                                      }}
                                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
                                    >
                                      <Camera className="w-5 h-5" />
                                      TIRAR FOTO PARA ENTREGA
                                    </button>
                                  </>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                      <button 
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          fileInputRef.current?.click();
                                        }}
                                        className="w-full py-4 bg-zinc-800 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all"
                                      >
                                        <Camera className="w-5 h-5" />
                                        Tirar outra foto
                                      </button>
                                      <p className="text-[10px] text-zinc-500 text-center uppercase font-bold tracking-widest">
                                        Salvamento automático ativado
                                      </p>
                                    </div>
                                )}
                              </div>
                            ) : (
                               <button 
                                type="button"
                                disabled={deliveredToType === 'authorized' && !authorizedName.trim()}
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (qrPackage) {
                                    handleDeliver(qrPackage.package_id || qrPackage.id, retrievalMethod, undefined, qrPackage);
                                  }
                                }}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50"
                              >
                                <Check className="w-5 h-5" />
                                Confirmar Retirada
                              </button>
                            )}
                            
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setQrPackage(null);
                                setManualToken('');
                                setCameraError(null);
                                setShowManualInput(false);
                                setRetrievalMethod('qr_code');
                                setDeliveryPhoto(null);
                                setQrScanStatus('scanning');
                                setCameraStarted(true);
                              }}
                              className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold transition-all"
                            >
                              Escanear outro
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* View QR Modal (For Testing) */}
      <AnimatePresence>
        {viewQrPackage && (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
            <motion.div 
              {...anim({
                initial: { scale: 0.9, opacity: 0 },
                animate: { scale: 1, opacity: 1 },
                exit: { scale: 0.9, opacity: 0 }
              })}
              className="bg-white rounded-[2.5rem] max-w-sm w-full p-8 text-center shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-zinc-900">QR Code da Encomenda</h3>
                <button 
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setViewQrPackage(null);
                  }}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
              
              <p className="text-zinc-500 text-sm mb-6">Use este QR Code para testar o leitor de portaria.</p>
              
              <div className="bg-zinc-50 p-6 rounded-3xl border-2 border-dashed border-zinc-200 mb-6">
                <div className="bg-white p-4 rounded-2xl shadow-sm inline-block mb-4">
                  <QRCodeSVG 
                    value={JSON.stringify({
                      id: viewQrPackage.id,
                      code: viewQrPackage.pickup_code,
                      token: viewQrPackage.pickup_token
                    })} 
                    size={200} 
                  />
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Código de Retirada</span>
                  <span className="text-2xl font-black text-emerald-600 tracking-widest">{viewQrPackage.pickup_code}</span>
                </div>
              </div>

              <div className="text-left bg-zinc-50 p-4 rounded-xl mb-6">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Destinatário</p>
                <p className="text-sm font-bold text-zinc-900">
                  {viewQrPackage.moradores?.nome || 'Morador não identificado'}
                </p>
                <p className="text-xs text-zinc-500">{formatPackageUnit(viewQrPackage)}</p>
              </div>

              <button 
                className="w-full bg-zinc-900 text-white py-4 rounded-xl font-bold hover:bg-zinc-800 transition-all" 
                onClick={() => setViewQrPackage(null)}
              >
                Fechar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ResidentImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        user={user}
        onImportComplete={fetchData}
      />
    </div>
  );
}
