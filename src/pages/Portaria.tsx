import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
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
  Image as ImageIcon
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { getResidentAddressLines, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';
import { getCurrentPorter, setManualPorter, clearManualPorter } from '../lib/porterUtils';

import toast from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'motion/react';
import { sendWhatsAppMessage, getWhatsAppLink, generatePickupCode, prepareWhatsAppNotification } from '../services/whatsappService';
import { CondominiumSettings } from '../types';

import PackageItem from '../components/portaria/PackageItem';
import ResidentCard from '../components/portaria/ResidentCard';

interface PortariaProps {
  user: Profile;
}

export default function Portaria({ user }: PortariaProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [residents, setResidents] = useState<Morador[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [notifyAfter, setNotifyAfter] = useState(() => {
    return localStorage.getItem('notify_after_registration') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('notify_after_registration', notifyAfter.toString());
  }, [notifyAfter]);

  const [activeTab, setActiveTab] = useState<'pending' | 'delivered' | 'all' | 'residents'>('pending');
  const [activeResidentMenu, setActiveResidentMenu] = useState<string | null>(null);
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
  const [currentPorter, setCurrentPorter] = useState(getCurrentPorter());
  const [showPorterModal, setShowPorterModal] = useState(false);
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

  // 7. Função única para processar/filtrar encomendas que precisam de aviso
  const getPackagesNeedingNotification = (pkgList: Package[]) => {
  if (!pkgList || pkgList.length === 0) return [];

  return pkgList.filter(p => {
    if (p.whatsapp_notified) return false;
    if (p.status === 'delivered') return false;
    if (!p.recipient_id) return false;

    const resident = residents.find(r => r.id === p.recipient_id);
    if (!resident || !resident.telefone || resident.telefone.replace(/\D/g, '').length < 10) return false;

    return true;
  });
};

  // Single Source of Truth for Pending Notifications
  const pendingNoticesCount = useMemo(() => {
    // Usar a mesma função robusta de filtragem para garantir precisão absoluta
    const list = getPackagesNeedingNotification(packages);
    return list.length;
  }, [packages, residents]);

  // Função única para decidir se existem notificações reais pendentes
  const hasPendingNotifications = () => {
    return pendingNoticesCount > 0;
  };

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

  const processNextInQueue = async (currentIndex: number) => {
    const current = notifyQueue[currentIndex];
    if (!current) return;

    const { resident, packages: pkgBatch } = current;
    const pkgIds = pkgBatch.map((p: any) => p.id);
    const now = new Date().toISOString();

    // Setup message and codes
    let groupCode = pkgBatch.find((p: any) => p.pickup_code)?.pickup_code;
    let groupToken = pkgBatch.find((p: any) => p.pickup_token)?.pickup_token;
    if (!groupCode) groupCode = generatePickupCode();
    if (!groupToken) groupToken = Math.random().toString(36).substring(2, 15);

    const message = prepareWhatsAppNotification(
      resident,
      condoName,
      groupCode,
      undefined,
      groupToken,
      pkgBatch.length,
      'disponivel',
      undefined,
      undefined,
      pkgBatch[0]?.photo_url
    );

    const link = getWhatsAppLink(resident.telefone, message, pkgBatch[0]?.photo_url);

    // 1. Atualizar banco e estado local IMEDIATAMENTE (antes de abrir o link)
    try {
      const nowString = new Date().toISOString();
      const pkgIds = pkgBatch.map(p => p.id);
      console.log('pkgBatch:', pkgBatch);
      console.log('pkgIds:', pkgIds);
      const { error: updateError } = await supabase
        .from('packages')
        .update({ 
          whatsapp_notified: true,
          whatsapp_sent: true,
          notified_at: nowString,
          whatsapp_status: 'enviado',
          last_notification_at: nowString,
          whatsapp_sent_at: nowString,
          whatsapp_message: message,
          pickup_code: groupCode,
          pickup_token: groupToken
        })
        .in('id', pkgIds);
        console.log('updateError:', updateError);
      
      if (updateError) {
        console.error('Erro ao atualizar pacotes no banco:', updateError);
      } else {
        console.log('Atualizado no banco:', pkgIds);
      }
      
      // Atualizar estado local IMEDIATAMENTE
      setPackages(prev => prev.map(p => pkgIds.includes(p.id) ? { 
        ...p, 
        whatsapp_status: 'enviado', 
        whatsapp_notified: true,
        whatsapp_sent: true,
        notified_at: nowString,
        whatsapp_sent_at: nowString,
        last_notification_at: nowString, 
        pickup_code: groupCode,
        pickup_token: groupToken,
        whatsapp_message: message
      } : p));
      
      // Sincronizar com o banco para garantir sincronia total
      // fetchData();
    } catch (e) {
      console.error('Exceção crítica no processo de notificação:', e);
    }

    // 2. Abrir WhatsApp após garantir atualização no banco (o catch não trava o window.open se o usuário preferir)
    window.open(link, '_blank');
    setNotifyQueue(prev =>
  prev.filter((_, index) => index !== currentIndex)
);
    // REGRA OBRIGATÓRIA: Avançar ou fechar a fila imediatamente ao clicar, 
    // garantindo que o item suma da "lista de notificações" instantaneamente
    if (currentIndex + 1 < notifyQueue.length) {
      setNotifyIndex(prev => prev + 1);
    } else {
      // Se era o último, encerramos a fila de visualização
      setNotifyIndex(notifyQueue.length);
      setTimeout(() => {
        setIsNotifyingAll(false);
        setModoEnvio(null);
        toast.success('Todas as notificações foram processadas!');
      }, 500);
    }

    setIsWaitingForReturn(true);
  };

  const handleNotifyAll = () => {
    // 7. Usar a mesma regra da função de contagem
    const pendentesAviso = getPackagesNeedingNotification(packages)

    if (pendentesAviso.length === 0) {
      feedback.error();
      toast.error('Nenhuma encomenda pendente de aviso encontrada.');
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
    pendentesAviso.forEach(pkg => {
      const residentId = pkg.recipient_id;
      if (!residentId) return;
      if (!groups[residentId]) {
        groups[residentId] = {
          resident: residents.find(r => r.id === residentId),
          packages: []
        };
      }
      groups[residentId].packages.push(pkg);
    });

    const queue = Object.values(groups).filter(g => g.resident && g.resident.telefone);
    
    if (queue.length === 0) {
      toast.error('Nenhuma encomenda possui morador com telefone válido.');
      return;
    }

    setNotifyQueue(queue);
    setNotifyIndex(0);
    setIsNotifyingAll(true);
    setModoEnvio('mass_manual');
  };

  const fetchCondoName = async () => {
    if (!user.condominium_id) return;
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .select('name')
        .eq('id', user.condominium_id)
        .maybeSingle();
      
      if (error) throw error;
      if (data) setCondoName(data.name);
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

  useEffect(() => {
    // Migration: Set whatsapp_status to 'pendente' for all received packages that have null or 'pending' status
    const migrateStatuses = async () => {
      if (!user?.condominium_id) return;
      try {
        // 1. Migrar 'pending' e 'notified' de volta para 'received' (para compatibilidade com constraint do banco)
        await supabase
          .from('packages')
          .update({ status: 'received' })
          .eq('condominium_id', user.condominium_id)
          .in('status', ['pending', 'notified']);

        // 2. Inicializar whatsapp_notified para registros antigos baseados no whatsapp_status
        const notifiedStatuses = ['sent', 'enviado', 'delivered', 'read'];
        await supabase
          .from('packages')
          .update({ whatsapp_notified: true, whatsapp_sent: true })
          .eq('condominium_id', user.condominium_id)
          .in('whatsapp_status', notifiedStatuses)
          .is('whatsapp_notified', null);
        
        await supabase
          .from('packages')
          .update({ whatsapp_notified: false, whatsapp_sent: false })
          .eq('condominium_id', user.condominium_id)
          .is('whatsapp_notified', null);

        // 3. Manter compatibilidade com status legados
        await supabase
          .from('packages')
          .update({ whatsapp_status: 'pending' })
          .eq('condominium_id', user.condominium_id)
          .in('status', ['received', 'pending'])
          .is('whatsapp_status', null);
          
      } catch (err) {
        console.error('Erro ao processar migração de status:', err);
      }
    };
    migrateStatuses();
  }, [user.condominium_id]);

  // Removed individualNotifyData state as per request for direct flows
  const handleDirectNotify = async (pkg: any) => {
    const resident = residents.find(r => r.id === pkg.recipient_id);
    
    if (!resident) {
      toast.error('Morador não encontrado');
      return;
    }

    try {
      // Busca todas as encomendas que ainda não foram notificadas para esse morador usando a regra unificada
      const moradorPackages = getPackagesNeedingNotification(packages).filter(p => p.recipient_id === resident.id);
      
      if (moradorPackages.length === 0) {
        feedback.error();
        toast.error('Não há novas encomendas para notificar');
        return;
      }

      // Garante pickup_code/token
      let pickupCode = pkg.pickup_code;
      if (!pickupCode) pickupCode = generatePickupCode();
      const pickupToken = pkg.pickup_token || Math.random().toString(36).substring(2, 8).toUpperCase();

      const message = prepareWhatsAppNotification(
        resident,
        condoName || 'Condomínio',
        pickupCode,
        undefined,
        pickupToken,
        moradorPackages.length || 1,
        'disponivel',
        undefined,
        undefined,
        pkg.photo_url // Foto da encomenda clicada
      );

      if (!message) throw new Error('Não foi possível preparar a mensagem');

      const pkgIds = moradorPackages.map(p => p.id);
      const nowString = new Date().toISOString();

      // REGRA OBRIGATÓRIA: Abrir WhatsApp imediatamente (antes do await para evitar bloqueio de popup)
      const whatsappLink = getWhatsAppLink(resident.telefone, message, pkg.photo_url);
      window.open(whatsappLink, '_blank');
      
      // REGRA OBRIGATÓRIA: Atualizar status no banco EM SEGUIDA
      const { error } = await supabase
        .from('packages')
        .update({ 
          whatsapp_notified: true,
          whatsapp_sent: true,
          notified_at: nowString,
          whatsapp_status: 'enviado',
          whatsapp_sent_at: nowString,
          last_notification_at: nowString,
          whatsapp_message: message,
          pickup_code: pickupCode,
          pickup_token: pickupToken
        })
        .in('id', pkgIds);

      if (error) {
        console.error('Erro ao atualizar pacotes no banco:', error);
      }
      
      // Atualização local imediata
      setPackages(prev => prev.map(p => pkgIds.includes(p.id) ? { 
        ...p, 
        whatsapp_status: 'enviado',
        whatsapp_notified: true,
        whatsapp_sent: true,
        notified_at: nowString,
        whatsapp_sent_at: nowString,
        last_notification_at: nowString,
        whatsapp_message: message,
        pickup_code: pickupCode,
        pickup_token: pickupToken
      } : p));

      setLastNotifiedPackageId(pkg.package_id || pkg.id);
      setIsWaitingForReturn(true);
      toast.success('WhatsApp aberto para ' + resident.nome);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao processar notificação');
    }
  };

  const getWhatsAppBadge = (status: string, pkg?: any) => {
    // PRIORIDADE ABSOLUTA: whatsapp_sent / whatsapp_notified
    const isActuallySent = pkg 
      ? (pkg.whatsapp_sent === true || pkg.whatsapp_notified === true)
      : ['sent', 'enviado', 'delivered', 'read'].includes((status || '').toLowerCase());
    
    if (isActuallySent) {
      return (
        <div className="flex items-center gap-2 px-5 py-0.5 text-emerald-600 transition-all cursor-default opacity-90 hover:opacity-100 bg-emerald-50/50 rounded-full border border-emerald-100">
          <span className="text-[12px] font-black uppercase tracking-wide">💬 Avisado</span>
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
        <span className="text-[10px] font-black uppercase tracking-tight">💬 Avisar Morador</span>
      </motion.div>
    );
  };

  // QR Scanning State
  const [isScanning, setIsScanning] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [qrScanStatus, setQrScanStatus] = useState<'idle' | 'scanning' | 'validating' | 'success' | 'error'>('idle');
  const [qrPackage, setQrPackage] = useState<Package | null>(null);
  const [viewQrPackage, setViewQrPackage] = useState<Package | null>(null);
  const [retrievalMethod, setRetrievalMethod] = useState<'qr_code' | 'manual'>('qr_code');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [isDeliverySuccess, setIsDeliverySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPackageRef = useRef<Package | null>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);
  const isScanningRef = useRef(false);

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
        setIsWaitingForReturn(false);
        
        if (isNotifyingAll) {
          // No modo queue, o avanço do index já acontece no clique. 
          // O handleFocus pode servir para garantir sincronia ou fechar se acabou.
          const pendentesNoBanco = latestPackages.filter(p => !p.whatsapp_notified && p.status === 'received');
          
          if (pendentesNoBanco.length === 0) {
            setNotifyIndex(notifyQueue.length);
            toast.success('Todas as notificações pendentes foram enviadas.', { icon: '✅' });
          } else if (notifyIndex >= notifyQueue.length) {
            // Fila local acabou mas banco ainda tem? Recalcular se necessário ou apenas fechar.
            setIsNotifyingAll(false);
          }
        } else {
          // Lógica de avanço automático para o próximo card (individual)
          // Verificamos o próximo pendente na lista filtrada ATUAL
          
          setTimeout(() => {
            const lowerSearch = searchTerm.toLowerCase();
            const nextPkg = latestPackages.find(p => {
              const matchesTab = activeTab === 'pending' ? p.status === 'received' : 
                               activeTab === 'delivered' ? p.status === 'delivered' : true;
              const matchesSearch = !searchTerm || (
                p.unidade?.toLowerCase().includes(lowerSearch) ||
                p.tracking_code?.toLowerCase().includes(lowerSearch) ||
                p.carrier?.toLowerCase().includes(lowerSearch) ||
                p.moradores?.nome?.toLowerCase().includes(lowerSearch)
              );
              
              return matchesTab && matchesSearch && !p.whatsapp_notified && p.status === 'received';
            });

            if (nextPkg) {
              const elementId = `package-${nextPkg.package_id || nextPkg.id}`;
              const element = document.getElementById(elementId);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Feedback visual de destaque
                element.classList.add('ring-4', 'ring-emerald-500', 'ring-offset-4', 'transition-all');
                setTimeout(() => element.classList.remove('ring-4', 'ring-emerald-500', 'ring-offset-4'), 2000);
              }
            } else {
              toast.success('Todas as notificações pendentes foram enviadas.', { icon: '✅' });
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
    if (isScanning && !qrPackage && !showManualInput && cameraStarted) {
      startScanning();
    } else {
      stopScanning();
    }
    return () => stopScanning();
  }, [isScanning, qrPackage, showManualInput, cameraStarted]);

  const handleBatchSend = async () => {
    if (batchPackages.length === 0) return;

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
            if (!pToken) pToken = Math.random().toString(36).substring(2, 15);

            const finalMessage = prepareWhatsAppNotification(
              resident,
              condoName,
              pCode,
              pkg.carrier,
              pToken,
              1,
              'disponivel',
              undefined,
              undefined,
              pkg.photo_url
            ) || pkg.whatsapp_message || `Olá, ${resident.nome}! Sua encomenda chegou na portaria. Código: ${pCode}`;

            const result = await sendWhatsAppMessage(resident.telefone, finalMessage, user.condominium_id, {
              api_url: condoSettings.api_url,
              api_token: condoSettings.api_token,
              instance_id: condoSettings.instance_id,
              whatsapp_provider: condoSettings.whatsapp_provider,
              photo_url: pkg.photo_url
            });
            
            if (result.status_envio === 'sucesso') {
              const nowString = new Date().toISOString();
              // Atualização local imediata para o contador refletir na hora
              setPackages(prev => prev.map(p => p.id === pkg.id ? { 
                ...p, 
                whatsapp_status: 'enviado', 
                whatsapp_notified: true,
                whatsapp_sent: true,
                notified_at: nowString,
                whatsapp_sent_at: nowString,
                last_notification_at: nowString,
                pickup_code: pCode,
                pickup_token: pToken
              } : p));
              setPackages(prev =>
  prev.filter(p => p.id ! == pkg.id)
); 
              const { error: updateError } = await supabase
                .from('packages')
                .update({ 
                  whatsapp_notified: true,
                  whatsapp_sent: true,
                  notified_at: nowString,
                  whatsapp_status: 'enviado',
                  last_notification_at: nowString,
                  whatsapp_sent_at: nowString,
                  whatsapp_message: finalMessage,
                  pickup_code: pCode,
                  pickup_token: pToken
                })
                .eq('id', pkg.id);
              
              if (updateError) {
                console.error('Erro ao atualizar pacote', updateError);
                throw updateError;
              }
              console.log('Atualizado no banco:', pkg.id);
              successCount++;
            } else {
              throw new Error(result.error || 'Erro na resposta da API');
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
          const { error: updateError } = await supabase
            .from('packages')
            .update({ 
              whatsapp_status: resident?.telefone ? 'error' : 'no_recipient'
            })
            .eq('id', pkg.id);
          
          if (updateError) console.error('Erro ao atualizar status de erro:', updateError);
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
      fetchData();
    } else {
      setBatchStep('manual_list');
    }
  };

  const handleManualSent = async (pkgId: string) => {
    try {
      const nowString = new Date().toISOString();
      const { error } = await supabase
        .from('packages')
        .update({ 
          whatsapp_notified: true,
          whatsapp_sent: true,
          notified_at: nowString,
          whatsapp_status: 'enviado',
          last_notification_at: nowString,
          whatsapp_sent_at: nowString
        })
        .eq('id', pkgId);
      
      if (error) {
        console.error('Erro ao atualizar pacote', error);
      } else {
        console.log('Atualizado no banco:', pkgId);
      }
      
      setPackages(prev => prev.map(p => p.id === pkgId ? { 
        ...p, 
        whatsapp_status: 'enviado', 
        whatsapp_notified: true,
        whatsapp_sent: true,
        notified_at: nowString,
        whatsapp_sent_at: nowString,
        last_notification_at: nowString
      } : p));
      
      if (manualIndex + 1 >= batchPackages.length) {
        toast.success('Todos os avisos foram processados!');
        setShowBatchModal(false);
        setBatchStep('confirm');
      } else {
        setManualIndex(prev => prev + 1);
      }

      fetchData();
      toast.success('Status atualizado!');
    } catch (error) {
      toast.error('Erro ao atualizar status');
    }
  };

  const handleSkipManual = () => {
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
      setQrScanStatus('scanning');
      const scanner = new Html5Qrcode("qr-reader");
      
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
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
    } catch (err) {
      console.error("Erro ao iniciar câmera:", err);
      toast.error("Não foi possível acessar a câmera");
      setIsScanning(false);
    } finally {
      isTransitioningRef.current = false;
    }
  };

  const stopScanning = async () => {
    if (isTransitioningRef.current) {
      // If transitioning, wait a bit and try again or just skip if it's already stopping
      // For simplicity, we'll just wait for the current transition to finish
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
    try {
      const scanMethod: 'qr_code' | 'code' = (resultOrMethod === 'code') ? 'code' : 'qr_code';
      const cleanText = decodedText.trim();
      setQrScanStatus('validating');
      await stopScanning();

      let searchId = '';
      let searchCode = '';
      let searchToken = '';

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(cleanText);
        if (parsed && typeof parsed === 'object') {
          searchId = parsed.id || '';
          searchCode = parsed.code || '';
          searchToken = parsed.token || '';
        } else {
          // Not an object, treat as raw text
          searchToken = cleanText;
          searchCode = cleanText;
          searchId = cleanText;
        }
      } catch (e) {
        // Not a valid JSON, treat as raw text
        searchToken = cleanText;
        searchCode = cleanText;
        searchId = cleanText;
      }

      // Construct OR query parts
      const orParts = [];
      if (searchToken) orParts.push(`pickup_token.eq."${searchToken}"`);
      if (searchCode) orParts.push(`pickup_code.eq."${searchCode}"`);
      
      // Only add ID search if it looks like a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (searchId && uuidRegex.test(searchId)) {
        orParts.push(`id.eq."${searchId}"`);
      }

      if (orParts.length === 0) {
        feedback.error();
        toast.error('Conteúdo do QR Code inválido');
        setQrScanStatus('error');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      // The QR code contains the package ID, token or 4-digit pickup code
      const { data: packagesFound, error: rpcError } = await supabase
        .from('packages')
        .select('*, moradores(nome, unidade, unit_type, block, street), package_id:id, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .or(orParts.join(','))
        .eq('status', 'received');

      if (rpcError) {
        console.error("Erro ao buscar encomenda por QR:", rpcError);
        toast.error('Erro na busca: ' + rpcError.message);
        setQrScanStatus('error');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      if (!packagesFound || packagesFound.length === 0) {
        setQrScanStatus('error');
        toast.error('Encomenda não encontrada');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      const data = packagesFound[0];
      setQrPackage(data);
      setQrScanStatus('success');
      
      // Requisito: passar o objeto diretamente para o handleDeliver para evitar estado "stale" e garantir baixa coletiva
      setTimeout(() => {
        handleDeliver(data.package_id || data.id, scanMethod, undefined, data);
      }, 50);
    } catch (err) {
      console.error("Erro ao processar QR:", err);
      setQrScanStatus('error');
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
        // Mas como usamos 'unit_type', o comando no supabase seria:
        const { error } = await supabase
          .from('moradores')
          .update({ unit_type: 'Casa' })
          .eq('condominium_id', user.condominium_id)
          .eq('unit_type', 'apto');
        
        if (!error) {
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
        const { error } = await supabase
          .from('moradores')
          .update(moradorData)
          .eq('id', editingResident.id);

        if (error) throw error;
        toast.success('Morador atualizado com sucesso!');
      } else {
        const { error } = await supabase
          .from('moradores')
          .insert([moradorData]);

        if (error) throw error;
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

    try {
      setLoading(true);
      
      // Soft delete: inativa o morador na tabela moradores
      const { error: errorMorador } = await supabase
        .from('moradores')
        .update({ ativo: false })
        .eq('id', residentToDelete.id);

      if (errorMorador) throw errorMorador;

      // Também tenta inativar na tabela profiles caso exista um usuário vinculado
      await supabase
        .from('profiles')
        .update({ active: false })
        .eq('id', residentToDelete.id);

      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'MORADOR_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'moradores',
        registro_id: residentToDelete.id,
        descricao: `Morador desativado/excluído: ${residentToDelete.nome}`,
        metodo: 'MANUAL',
        dados_antes: residentToDelete,
        dados_depois: { ativo: false }
      });

      toast.success('Morador excluído com sucesso!');
      setResidentToDelete(null);
      fetchData();
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
      
      const { error } = await supabase
        .from('moradores')
        .update({ ativo: newStatus })
        .eq('id', resident.id);

      if (error) throw error;

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
    
    try {
      if (!silent) setLoading(true);
      
      // Primeiro busca as configurações para saber se o modo leve está ativado
      const { data: settingsData } = await supabase
        .from('condominium_settings')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .maybeSingle();
      
      setCondoSettings(settingsData);
 
       // Busca encomendas e moradores
       let pkgQuery = supabase
         .from('packages')
         .select('*, moradores(nome, unidade, unit_type, block, street), package_id:id, unit_label:unit_number')
         .eq('condominium_id', user.condominium_id)
         .order('received_at', { ascending: false });
 
       const [pkgResult, resResult] = await Promise.all([
        pkgQuery,
        supabase
          .from('moradores')
          .select('id, nome, unidade, unit_type, telefone, block, street, ativo')
          .eq('condominium_id', user.condominium_id)
          .eq('ativo', true)
          .order('nome')
      ]);

      if (pkgResult.error) {
        console.error('Erro ao buscar encomendas:', pkgResult.error);
      } else {
        const pkgs = pkgResult.data || [];
        setPackages(pkgs);
        
        // Sincronizar batchPackages para notificações automáticas usando a regra robusta
       // const pendentesAviso = getPackagesNeedingNotification(pkgs)
      }

      if (resResult.error) {
        console.error('Erro ao buscar moradores:', resResult.error);
      } else {
        setResidents(resResult.data || []);
      }

      // Só mostramos erro se ambos falharem
      if (pkgResult.error && resResult.error) {
        toast.error('Erro ao carregar dados da portaria');
      }

      return {
        packages: pkgResult.data || [],
        residents: resResult.data || []
      };

    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      return { packages: [], residents: [] };
    } finally {
      setLoading(false);
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

      // Converter base64 para Blob
      const res = await fetch(finalBase64);
      const blob = await res.blob();
      
      // Nome de arquivo único para evitar colisões
      const fileName = `delivery_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

      // Upload para a raiz do bucket 'packages' (mais seguro)
      const { error: uploadError } = await supabase.storage
        .from('packages')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Erro no upload Supabase:", uploadError);
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('packages')
        .getPublicUrl(fileName);

      if (!publicUrl) throw new Error("Não foi possível gerar a URL pública da foto");

      return publicUrl;
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

  const handleDeliver = async (pkgId: string, method: 'manual' | 'qr_code' | 'photo' | 'foto' | 'code' | 'CÓDIGO' | 'CONFIRMADO_PELO_MORADOR' = 'manual', photoOverride?: string, packageData?: Package) => {
    if (!pkgId) {
      toast.error('ID da encomenda não encontrado');
      return;
    }

    // Usar dados passados ou do estado
    const activePackage = packageData || qrPackage;

    try {
      setQrScanStatus('validating');
      
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      
      const photoToUse = photoOverride || deliveryPhoto;
      let finalPhotoUrl = null;
      let finalMethod = method;

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

      // REQUISITO CRÍTICO: Buscar TODOS os registros com o mesmo código/token para baixa coletiva
      let idsToUpdate: string[] = [pkgId];
      let pickupToken = activePackage?.pickup_token;
      let pickupCode = activePackage?.pickup_code;

      const { data: relatedPackages } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .in('status', ['received', 'pending'])
        .or(pickupToken ? `pickup_token.eq.${pickupToken}` : `pickup_code.eq.${pickupCode},recipient_id.eq.${activePackage?.recipient_id}`);

      if (relatedPackages && relatedPackages.length > 0) {
        idsToUpdate = relatedPackages.map(p => p.id);
      }

      const { error: updateError } = await supabase
        .from('packages')
        .update({ 
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          delivery_method: finalMethod,
          ...(authUser?.id ? { delivered_by: authUser.id } : {}),
          entregue_por: currentPorter,
          pickup_qr_code: 'used',
          delivered_to_name: 'Morador (Confirmado)',
          ...(finalPhotoUrl ? { delivery_photo_url: finalPhotoUrl } : {}),
          notes: idsToUpdate.length > 1 ? 'Retirada coletiva via código' : undefined
        })
        .in('id', idsToUpdate);

      if (updateError) throw updateError;
      
      // Atualização local imediata
      const now = new Date().toISOString();
      setPackages(prev => prev.map(p => idsToUpdate.includes(p.id) ? { 
        ...p, 
        status: 'delivered',
        delivered_at: now,
        delivery_method: finalMethod,
        entregue_por: currentPorter,
        delivered_by: authUser?.id,
        delivery_photo_url: finalPhotoUrl || p.delivery_photo_url
      } : p));

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

      // VALIDAR SE AINDA EXISTE PENDENTE COM ESSE CÓDIGO (Anti-Update-Gap)
      const { data: remainingPending } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .in('status', ['received', 'pending'])
        .or(pickupToken ? `pickup_token.eq.${pickupToken}` : `pickup_code.eq.${pickupCode},recipient_id.eq.${activePackage?.recipient_id}`);

      if (remainingPending && remainingPending.length > 0) {
        throw new Error('Algumas encomendas ainda constam como pendentes. Tente novamente.');
      }

      // Notificar morador sobre a retirada - DESATIVADO PARA NÃO ABRIR CHAT
      /*
      try {
        const residentToNotify = residents.find(r => r.id === activePackage?.recipient_id);
        if (residentToNotify) {
          const retiroMsg = prepareWhatsAppNotification(
            residentToNotify,
            condoName,
            pickupCode || '',
            undefined,
            pickupToken || '',
            idsToUpdate.length,
            'retirada',
            currentPorter,
            // ...
          );
        }
      } catch (notifyErr) {
        console.warn("Erro ao processar notificação de retirada:", notifyErr);
      }
      */
      
      const deliveredCount = idsToUpdate.length;

      // Som de confirmação de baixa - Abordagem estável
      playSuccessSound();

      // Aguardar o som iniciar antes de mostrar sucesso e resetar interface
    setTimeout(() => {
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
      
      // Atualizar dados e garantir que permaneça na aba de pendentes
      setQrPackage(null);
      setViewQrPackage(null);
      setQrScanStatus('idle');
      fetchData(); 
      setActiveTab('pending');
      
      // Manter o estado de sucesso visual por 2 segundos antes de fechar o modal e resetar variáveis de UI
      setTimeout(() => {
        setIsScanning(false);
        setIsDeliverySuccess(false);
        setDeliveryPhoto(null);
        setManualToken('');
        setShowManualInput(false);
        setCameraStarted(false);
      }, 2000);
    }, 50);

    } catch (error: any) {
      console.error('Erro ao entregar encomenda:', error);
      feedback.error();
      toast.error(`Erro: ${error.message || 'Falha ao confirmar entrega'}`);
      setQrScanStatus('success');
      return false;
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
        const key = pkg.pickup_token || pkg.pickup_code || pkg.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(pkg);
      }

      return Object.values(groups).map(group => {
        if (group.length === 1) return group[0];
        
        return {
          ...group[0],
          isGroup: true,
          packages: group,
          count: group.length
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
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-zinc-900 uppercase">PAINEL DA PORTARIA</h1>
          <div className="flex items-center justify-between gap-8 mt-1 border-b border-zinc-100 pb-2">
            <p className="text-zinc-500 font-medium truncate max-w-[60%] md:max-w-none">{condoName}</p>
            <button 
              onClick={() => setShowPorterModal(true)}
              className={`flex items-center gap-1.5 text-[10px] whitespace-nowrap px-3 py-1.5 rounded-full border transition-all active:scale-95 flex-shrink-0 ${
                currentPorter === 'Selecione o Porteiro' 
                  ? 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse' 
                  : 'text-zinc-500 bg-zinc-50 border-zinc-200 hover:bg-zinc-100'
              }`}
              title="Trocar Porteiro"
            >
              <span className="font-medium uppercase tracking-tight flex items-center gap-1.5">
                {currentPorter === 'Selecione o Porteiro' ? '👤 SELECIONE O PORTEIRO' : `👤 ${currentPorter.toUpperCase()}`}
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
                setRetrievalMethod('manual');
                setShowManualInput(true);
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
          {/* MODO DE NOTIFICAÇÃO - Versão padronizada: Altura igual aos botões superiores e mais compacta */}
          <div className="bg-white/90 backdrop-blur-md border border-zinc-100 py-2.5 px-6 rounded-2xl shadow-sm min-w-[320px] flex-1 md:flex-none mt-2 md:mt-0 flex flex-col justify-center min-h-[64px]">
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
          Pendentes ({pendingPackages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('delivered'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'delivered' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <CheckCircle className="w-5 h-5" />
          Retiradas ({deliveredPackages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('all'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <PackageIcon className="w-5 h-5" />
          Todas ({packages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('residents'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'residents' ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Users className="w-5 h-5" />
          MORADORES ({residents.length})
        </button>
      </div>

      {activeTab === 'residents' && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-8 flex flex-wrap gap-8">
          <div>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Total de Moradores</p>
            <p className="text-2xl font-bold text-blue-900">{residents.length}</p>
          </div>
          <div className="w-px h-10 bg-blue-200 hidden sm:block" />
          <div>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Total de Casas</p>
            <p className="text-2xl font-bold text-blue-900">
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

      {activeTab === 'residents' && (user.role === 'admin' || user.role === 'porteiro') && (
        <div className="flex justify-end mb-6">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              navigate('/profiles/new');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
          >
            <UserPlus className="w-5 h-5" />
            Adicionar Morador
          </button>
        </div>
      )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
          </div>
        ) : activeTab !== 'residents' ? (
          filteredPackages.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPackages.map((pkg: any) => (
                <PackageItem
                  key={pkg.package_id || pkg.id}
                  pkg={pkg}
                  getWhatsAppBadge={getWhatsAppBadge}
                  getDeliveryMethodLabel={getDeliveryMethodLabel}
                  onDeliver={(p) => {
                    setQrPackage(p);
                    setPackageToConfirm(p);
                    setShowConfirmDelivery(true);
                  }}
                  onDeliverWithPhoto={(p) => {
                    pendingPackageRef.current = p;
                    setQrPackage(p);
                    setRetrievalMethod('manual');
                    fileInputRef.current?.click();
                  }}
                  onCodeRetrieval={(p) => {
                    setQrPackage(p);
                    setRetrievalMethod('manual');
                    setShowManualInput(true);
                    setIsScanning(true);
                    setQrScanStatus('idle');
                  }}
                  onViewPhotos={(p) => {
                    const photos = p.packages
                      .filter((item: any) => item.photo_url)
                      .map((item: any) => ({
                        url: item.photo_url,
                        carrier: item.carrier,
                        received_at: item.received_at,
                        package: item
                      }));
                    
                    if (photos.length > 0) {
                      setViewGroupPhotos(photos);
                    } else {
                      toast.error('Nenhuma etiqueta com foto neste grupo');
                    }
                  }}
                  onViewLabel={(pkg) => {
                    setViewPhotoUrl(pkg.photo_url);
                    setViewPhotoPkg(pkg);
                  }}
                  onNotify={handleDirectNotify}
                  handleDeliver={handleDeliver}
                  setQrPackage={setQrPackage}
                />
              ))}
            </div>
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
        <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setViewPhotoUrl(null);
                setViewPhotoPkg(null);
              }}
              className="absolute -top-12 right-0 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all"
            >
              <Plus className="w-6 h-6 rotate-45" />
            </button>
            <img 
              src={viewPhotoUrl} 
              alt="Foto da etiqueta" 
              className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border-4 border-white/10"
              referrerPolicy="no-referrer"
            />
            <div className="mt-6 flex gap-4">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setViewPhotoUrl(null);
                  setViewPhotoPkg(null);
                }}
                className="bg-white text-zinc-900 px-8 py-3 rounded-xl font-bold hover:bg-zinc-100 transition-all"
              >
                Fechar
              </button>
              <a 
                href={viewPhotoUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
              >
                Abrir imagem original
              </a>
            </div>

            {viewPhotoPkg?.status === 'received' && (
              <div className="mt-8 flex flex-col items-center gap-4 bg-white/5 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/10 max-w-sm w-full animate-in slide-in-from-bottom-4 duration-500">
                <p className="text-white text-center text-sm font-medium leading-relaxed opacity-80">
                  Morador conferiu a encomenda pela foto. <br/>
                  Toque abaixo para confirmar o recebimento.
                </p>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!viewPhotoPkg) return;
                    await handleDeliver(viewPhotoPkg.package_id || viewPhotoPkg.id, 'CONFIRMADO_PELO_MORADOR', undefined, viewPhotoPkg);
                    setViewPhotoUrl(null);
                    setViewPhotoPkg(null);
                    toast.success('RECEBIMENTO CONFIRMADO');
                  }}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white py-5 rounded-2xl font-black text-xl shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3"
                >
                  <Check className="w-6 h-6" />
                  ENTREGAR
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery Modal for Group Photos */}
      <AnimatePresence>
        {viewGroupPhotos && (
          <div className="fixed inset-0 bg-black/95 z-[70] flex flex-col backdrop-blur-sm overflow-hidden">
            <div className="p-6 flex justify-between items-center bg-black/50 border-b border-white/10">
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
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
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
                  className="fixed inset-0 bg-black/98 z-[80] flex flex-col items-center justify-center p-4 md:p-12"
                >
                  <div className="absolute top-6 left-6 flex items-center gap-4 text-white">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">{viewGroupPhotos[currentPhotoIndex].carrier}</p>
                      <p className="text-zinc-500 text-xs">{formatSafeDateTime(viewGroupPhotos[currentPhotoIndex].received_at)}</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setViewPhotoUrl(null);
                      setViewPhotoPkg(null);
                    }}
                    className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-[90]"
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
                      {notifyQueue[notifyIndex].packages.length} Encomendas Pendentes
                    </div>
                  </div>

                  <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50">
                    <p className="text-xs text-emerald-800 font-medium italic">
                      "Olá, {notifyQueue[notifyIndex].resident.nome}! Você possui {notifyQueue[notifyIndex].packages.length} {notifyQueue[notifyIndex].packages.length > 1 ? 'encomendas disponíveis' : 'encomenda disponível'} para retirada na portaria."
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
                          <a
                            href={getWhatsAppLink(resident?.telefone || '', pkg.whatsapp_message || '')}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleManualSent(pkg.id)}
                            className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
                          >
                            <Send className="w-6 h-6" />
                            ENVIAR PRÓXIMO
                          </a>
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

      {/* Modal de Notificação Individual REMOVIDO para fluxo direto */}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <motion.div
            {...anim({
              initial: { opacity: 0, scale: 0.95, y: 20 },
              animate: { opacity: 1, scale: 1, y: 0 }
            })}
            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="p-8">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-zinc-900">
                    {editingResident ? 'Editar Morador' : 'Novo Morador'}
                  </h3>
                  <p className="text-zinc-500">Preencha os dados do morador</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsAddingResident(false);
                    setEditingResident(null);
                  }}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/95 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/10 relative"
            >
              <button 
                type="button"
                onClick={() => {
                  setShowConfirmDelivery(false);
                  setPackageToConfirm(null);
                  setIsConfirmingDelivery(false);
                }}
                className="absolute top-6 right-6 w-10 h-10 bg-zinc-100 hover:bg-zinc-200 rounded-full flex items-center justify-center text-zinc-500 transition-all z-10"
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
                    className="p-6 sm:p-8 text-center flex flex-col items-center"
                  >
                    <div className="mb-4">
                      <h2 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">ENTREGA</h2>
                    </div>

                    {packageToConfirm.photo_url && (
                      <div className="w-full bg-zinc-50 rounded-[2.5rem] overflow-hidden mb-4 flex items-center justify-center border border-zinc-100 shadow-sm min-h-[350px]">
                        <img 
                          src={packageToConfirm.photo_url} 
                          alt="Foto da encomenda" 
                          className="max-w-full max-h-[55vh] object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    <div className="mb-8">
                      <p className="text-zinc-800 text-base font-semibold max-w-[320px] mx-auto leading-tight">
                        Confira a encomenda antes de confirmar o recebimento.
                      </p>
                    </div>

                    <div className="space-y-6 flex flex-col items-center w-full">
                      <button
                        type="button"
                        disabled={isConfirmingDelivery}
                        onClick={async () => {
                          if (isConfirmingDelivery) return;
                          
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
                            await handleDeliver(
                              packageToConfirm.package_id || packageToConfirm.id, 
                              'CONFIRMADO_PELO_MORADOR' as any, 
                              undefined, 
                              packageToConfirm
                            );
                            
                            setIsConfirmingDelivery(false);
                            setIsDeliverySuccess(true);
                            
                            // Aguarda 2 segundos e fecha
                            setTimeout(() => {
                              setShowConfirmDelivery(false);
                              setIsDeliverySuccess(false);
                              setPackageToConfirm(null);
                            }, 2000);
                          } catch (err) {
                            setIsConfirmingDelivery(false);
                            // O erro já é tratado pelo handleDeliver/toast
                          }
                        }}
                        className="w-full bg-emerald-600 text-white py-10 px-8 rounded-[2.5rem] font-black text-xl hover:bg-emerald-500 transition-all shadow-2xl shadow-emerald-200 flex items-center justify-center gap-3 active:scale-95 group disabled:opacity-70 disabled:active:scale-100"
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
                        className="py-4 text-zinc-400 font-bold hover:text-red-500 transition-colors uppercase tracking-[0.3em] text-[10px]"
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

      <AnimatePresence>
        {showPorterModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-zinc-900">Selecionar Porteiro</h3>
                  <button onClick={() => setShowPorterModal(false)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                  {['Marcos', 'Izaias', 'Bruno', 'Marisa', 'Outro'].map((porter) => (
                    <button
                      key={porter}
                      onClick={() => {
                        setCurrentPorter(porter);
                        setManualPorter(porter);
                        setShowPorterModal(false);
                        toast.success(`Porteiro alterado para ${porter}`);
                      }}
                      className={`w-full py-4 px-6 rounded-2xl font-bold transition-all text-left flex items-center justify-between border ${
                        currentPorter === porter 
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                          : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-zinc-100 hover:border-zinc-200'
                      }`}
                    >
                      {porter}
                      {currentPorter === porter && <Check className="w-5 h-5" />}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowPorterModal(false)}
                  className="w-full mt-6 py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                >
                  Fechar
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
              {selectedGroup.packages.map((pkg: any, idx: number) => (
                <div key={pkg.id || idx} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
                    <PackageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 truncate">{pkg.carrier}</p>
                    <p className="text-xs text-zinc-500">Recebido em {formatSafeDateTime(pkg.received_at)}</p>
                    {pkg.tracking_code && (
                      <p className="text-[10px] font-mono text-zinc-400 mt-1 truncate">Etiqueta: {pkg.tracking_code}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={() => {
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
            <div className="p-6 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md border-b border-white/5">
              <div>
                <h3 className="text-white text-xl font-bold">
                  {qrPackage ? 'Confirmação de Entrega' : 'CÓDIGO DE RETIRADA'}
                </h3>
                <p className="text-zinc-400 text-xs">
                  {qrPackage ? 'Registre uma foto para confirmar a retirada' : 'Digite o código de 4 dígitos enviado ao morador'}
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
                }}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 relative flex flex-col items-center justify-center p-6">
              <AnimatePresence mode="wait">
                {!qrPackage && qrScanStatus !== 'success' && (
                  <motion.div 
                    key="scanner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-sm flex flex-col items-center"
                  >
                    {showManualInput ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full flex flex-col items-center"
                      >
                        <div className="bg-zinc-900/50 p-8 rounded-[32px] border border-white/10 w-full shadow-2xl backdrop-blur-md">
                          <div className="flex justify-between items-center mb-6">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] block">Código de Retirada</label>
                            <button 
                              onClick={() => setShowManualInput(false)}
                              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-emerald-500 transition-all border border-white/5"
                              title="Usar QR Code"
                            >
                              <QrCode className="w-6 h-6" />
                            </button>
                          </div>
                          
                          <div className="relative w-full">
                            <input 
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              value={manualToken}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                setManualToken(val);
                                if (val.length === 4) {
                                  onScanSuccess(val, 'code');
                                }
                              }}
                              placeholder="0000"
                              className="w-full bg-zinc-800/50 border-2 border-white/10 rounded-3xl px-4 py-12 text-white text-7xl font-black tracking-[0.3em] text-center outline-none focus:border-emerald-500 focus:ring-8 focus:ring-emerald-500/10 transition-all placeholder:text-zinc-800 shadow-2xl"
                            />
                            <div className="mt-10 flex flex-col items-center gap-2">
                               <p className="text-emerald-500 text-sm font-black uppercase tracking-[0.2em]">Pronto para digitar</p>
                               <p className="text-zinc-500 text-[10px] font-medium uppercase tracking-widest">O campo limpa automaticamente após o uso</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="relative w-full aspect-square bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col items-center justify-center">
                        {cameraStarted ? (
                          <>
                            <div id="qr-reader" className="w-full h-full"></div>
                            
                            {/* Scanner Frame Overlay */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                              <div className="w-64 h-64 relative">
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
                          </>
                        ) : (
                          <div className="flex flex-col items-center p-8 text-center">
                            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                              <QrCode className="w-12 h-12 text-emerald-500" />
                            </div>
                            <h4 className="text-white text-lg font-bold mb-2">Leitor de QR Code</h4>
                            <p className="text-zinc-500 text-sm mb-8">Clique no botão abaixo para ativar a câmera e escanear o código.</p>
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCameraStarted(true);
                              }}
                              className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/40 flex items-center gap-3"
                            >
                              <Camera className="w-5 h-5" />
                              ATIVAR CÂMERA
                            </button>
                          </div>
                        )}
                        
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowManualInput(true);
                          }}
                          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/60 hover:bg-black/80 text-white rounded-xl flex items-center gap-2 transition-all border border-white/10 backdrop-blur-md text-sm font-bold"
                        >
                          <Keyboard className="w-4 h-4" />
                          Digitar Código
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {qrPackage && (
                  <motion.div 
                    key="confirmation"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-sm"
                  >
                    <div className="bg-zinc-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
                          {isDeliverySuccess ? (
                            <div className="p-12 flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-300">
                              <div className="w-24 h-24 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center shadow-sm">
                                <CheckCircle className="w-14 h-14" />
                              </div>
                              <div className="text-center space-y-2">
                                <h3 className="text-2xl font-bold text-white">Entrega confirmada com sucesso</h3>
                                <p className="text-sm text-zinc-400">A baixa foi registrada com sucesso.</p>
                              </div>
                            </div>
                      ) : qrScanStatus === 'validating' ? (
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
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (qrPackage) {
                                    handleDeliver(qrPackage.package_id || qrPackage.id, retrievalMethod, undefined, qrPackage);
                                  }
                                }}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
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
                                setQrScanStatus('scanning'); 
                                startScanning(); 
                                setDeliveryPhoto(null);
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
                )}
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
    </div>
  );
}
