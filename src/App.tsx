import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Prisma,
  PrismaEstado,
  Movimentacao,
  Turno,
  Usuario,
  Condominio,
  DashboardStats,
  UserRole,
  TipoSessao,
} from './types';
import { api, DashboardResponse, getStoredStationSession } from './services/api';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { ActionSelector, MainActionTab } from './components/ActionSelector';
import { PrismaCard } from './components/PrismaCard';
import { EntregaModal } from './components/EntregaModal';
import { ReceberView } from './components/ReceberView';
import { PrismasEmAbertoView } from './components/PrismasEmAbertoView';
import { BuscaView } from './components/BuscaView';
import { UltimasMovimentacoes } from './components/UltimasMovimentacoes';
import { PassagemTurnoModal } from './components/PassagemTurnoModal';
import { PrismaHistoricoModal } from './components/PrismaHistoricoModal';
import { GerenciarPrismasModal } from './components/GerenciarPrismasModal';
import { AuditoriaModal } from './components/AuditoriaModal';
import { ConcorrenciaModal } from './components/ConcorrenciaModal';
import { ConfiguracoesModal } from './components/ConfiguracoesModal';
import { AlterarSenhaModal } from './components/AlterarSenhaModal';
import { EditarCondominioModal } from './components/EditarCondominioModal';
import { FloatingPortariaWindow } from './components/FloatingPortariaWindow';
import { EscolhaModoDispositivoModal, DeviceUsageMode } from './components/EscolhaModoDispositivoModal';
import { playSuccessSound } from './utils/sound';
import { identificarOperadorEmOperacao } from './utils/turnoUtils';
import { copyToClipboard, formatMensagemEntrega, formatMensagemRecolhimento, extrairNumeroCasaValido, formatarCasaExibicao } from './utils/clipboardUtils';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

function AppContent() {
  const { user: authUser, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();

  // State
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [condominioAtualId, setCondominioAtualId] = useState<string>(() => {
    return authUser?.condominioId || getStoredStationSession()?.condominioId || 'condo-1';
  });
  const [condominioAtual, setCondominioAtual] = useState<Condominio | undefined>();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [turnoAtivo, setTurnoAtivo] = useState<Turno | undefined>();
  const [stats, setStats] = useState<DashboardStats>({
    disponiveis: 0,
    emUso: 0,
    pendentes: 0,
    indisponiveis: 0,
    totalPrismas: 0,
  });
  const [prismas, setPrismas] = useState<Prisma[]>([]);
  const [ultimasMovimentacoes, setUltimasMovimentacoes] = useState<Movimentacao[]>([]);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<MainActionTab>('ENTREGAR');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<string | undefined>();
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Toast Helper
  const showToast = useCallback((msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 3500);
  }, []);

  // Modals state
  const [selectedPrismaEntrega, setSelectedPrismaEntrega] = useState<Prisma | null>(null);
  const [isSubmittingEntrega, setIsSubmittingEntrega] = useState<boolean>(false);
  const [rankingCasas, setRankingCasas] = useState<string[]>(['12', '17', '31', '42', '105', '208']);
  const [isReceberLoading, setIsReceberLoading] = useState<boolean>(false);
  const [historicoPrismaId, setHistoricoPrismaId] = useState<string | null>(null);
  const [isPassagemTurnoOpen, setIsPassagemTurnoOpen] = useState<boolean>(false);
  const [isGerenciamentoOpen, setIsGerenciamentoOpen] = useState<boolean>(false);
  const [isAuditoriaOpen, setIsAuditoriaOpen] = useState<boolean>(false);
  const [isConcorrenciaOpen, setIsConcorrenciaOpen] = useState<boolean>(false);
  const [isConfiguracoesOpen, setIsConfiguracoesOpen] = useState<boolean>(false);
  const [isAlterarSenhaOpen, setIsAlterarSenhaOpen] = useState<boolean>(false);
  const [isEditarCondominioOpen, setIsEditarCondominioOpen] = useState<boolean>(false);

  // Synchronize condominioAtualId with authUser if user is authenticated
  useEffect(() => {
    if (authUser?.condominioId) {
      setCondominioAtualId(authUser.condominioId);
    }
  }, [authUser]);

  // Device usage mode ('PORTARIA' | 'NORMAL') with localStorage persistence
  const [deviceMode, setDeviceMode] = useState<DeviceUsageMode>(() => {
    try {
      const saved = localStorage.getItem('prismas_device_mode');
      if (saved === 'PORTARIA' || saved === 'NORMAL') return saved as DeviceUsageMode;
    } catch {}
    return 'NORMAL';
  });

  // Modal de escolha de modo de uso do dispositivo (acionado no login da Portaria ou pelo Header)
  const [isEscolhaModoOpen, setIsEscolhaModoOpen] = useState<boolean>(false);

  // Modo Portaria inicializa como fechado para garantir que o Document PiP dependa sempre de ação explícita do usuário
  const [isModoPortariaOpen, setIsModoPortariaOpen] = useState<boolean>(false);

  // Rastreamento seguro do ciclo de vida da autenticação pós-login
  const initialAuthCheckedRef = useRef<boolean>(false);
  const prevUserRef = useRef<typeof authUser>(authUser);

  useEffect(() => {
    // Aguarda validação inicial do contexto de autenticação
    if (isAuthLoading) {
      return;
    }

    // Inicialização da sessão já existente (ex: recarregamento de página / cache restaurado)
    if (!initialAuthCheckedRef.current) {
      initialAuthCheckedRef.current = true;
      prevUserRef.current = authUser;

      if (authUser) {
        const isAdminOrSindico =
          authUser.role === UserRole.ADMIN ||
          authUser.role === UserRole.SINDICO ||
          authUser.tipoSessao === TipoSessao.ADMIN ||
          authUser.tipoSessao === TipoSessao.SINDICO;

        if (isAdminOrSindico) {
          // REGRA 1: ADMIN/SÍNDICO entra diretamente no Dashboard, sem modal ou pop-up
          setIsEscolhaModoOpen(false);
          setIsModoPortariaOpen(false);
        }
        // Para PORTARIA já restaurada: não abre o modal novamente (REGRA 6)
      }
      return;
    }

    // Caso o usuário deslogue
    if (!isAuthenticated || !authUser) {
      prevUserRef.current = null;
      setIsEscolhaModoOpen(false);
      return;
    }

    // Detecta se ocorreu um novo login explícito nesta sessão
    const isNovoLogin = !prevUserRef.current || prevUserRef.current.usuarioId !== authUser.usuarioId;
    prevUserRef.current = authUser;

    const isAdminOrSindico =
      authUser.role === UserRole.ADMIN ||
      authUser.role === UserRole.SINDICO ||
      authUser.tipoSessao === TipoSessao.ADMIN ||
      authUser.tipoSessao === TipoSessao.SINDICO;

    const isPortaria =
      authUser.role === UserRole.PORTEIRO ||
      authUser.tipoSessao === TipoSessao.PORTARIA;

    if (isAdminOrSindico) {
      // REGRA 1: ADMIN/SÍNDICO entra diretamente no Dashboard
      setIsEscolhaModoOpen(false);
      setIsModoPortariaOpen(false);
    } else if (isPortaria && isNovoLogin) {
      // REGRA 2: PORTARIA acabou de autenticar -> abre automaticamente a escolha "Como deseja utilizar?"
      setIsEscolhaModoOpen(true);
      setIsModoPortariaOpen(false);
    }
  }, [isAuthLoading, isAuthenticated, authUser]);

  // Estado da janela Document Picture-in-Picture (Always on Top)
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // Cópia e sincronização segura de estilos para o documento PiP
  const copyStylesToPip = (targetWindow: Window) => {
    try {
      const targetDoc = targetWindow.document;

      // 1. Copiar regras CSS e links de folhas de estilo
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          if (sheet.href) {
            const link = targetDoc.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            targetDoc.head.appendChild(link);
          } else if (sheet.cssRules) {
            const style = targetDoc.createElement('style');
            Array.from(sheet.cssRules).forEach((rule) => {
              style.appendChild(targetDoc.createTextNode(rule.cssText));
            });
            targetDoc.head.appendChild(style);
          }
        } catch (sheetErr) {
          // Proteção contra restrições de CORS em cssRules: clonar nó dono como fallback
          try {
            if (sheet.ownerNode) {
              targetDoc.head.appendChild(sheet.ownerNode.cloneNode(true));
            }
          } catch {}
        }
      });

      // 2. Clonar tags <style> e <link rel="stylesheet"> explícitas do <head>
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        try {
          if (node.tagName === 'LINK') {
            const href = (node as HTMLLinkElement).href;
            if (!targetDoc.querySelector(`link[href="${href}"]`)) {
              targetDoc.head.appendChild(node.cloneNode(true));
            }
          } else if (node.tagName === 'STYLE') {
            targetDoc.head.appendChild(node.cloneNode(true));
          }
        } catch {}
      });
    } catch (globalErr) {
      console.warn('Erro ao transferir estilos para a janela PiP:', globalErr);
    }
  };

  // Fechamento limpo do Modo Portaria e da janela PiP
  const handleCloseModoPortaria = useCallback(() => {
    if (pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {}
    }
    setPipWindow(null);
    setIsModoPortariaOpen(false);
    try {
      localStorage.setItem('prismas_device_mode', 'NORMAL');
    } catch {}
  }, [pipWindow]);

  // Abertura explícita do Modo Portaria via Document Picture-in-Picture (com fallback)
  const handleAbrirModoPortaria = useCallback(async () => {
    try {
      localStorage.setItem('prismas_portaria_minimized', 'true');
    } catch {}

    // 1. Mecanismo prioritário: Document Picture-in-Picture se suportado pelo navegador
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window && window.documentPictureInPicture) {
      try {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.focus();
          return;
        }

        const pip = await window.documentPictureInPicture.requestWindow({
          width: 380,
          height: 130,
        });

        copyStylesToPip(pip);

        pip.document.title = 'CONTROL PRISMA • Modo Portaria';
        pip.document.body.className = 'bg-slate-950 text-slate-100 font-sans antialiased m-0 p-0 overflow-hidden';

        const handlePiPClose = () => {
          setPipWindow(null);
          setIsModoPortariaOpen(false);
        };

        pip.addEventListener('pagehide', handlePiPClose, { once: true });

        setPipWindow(pip);
        setIsModoPortariaOpen(true);
        showToast('🛡️ Modo Portaria sobreposto ativado (Document PiP)');
        return;
      } catch (err) {
        console.warn('Document Picture-in-Picture não pôde ser iniciado, utilizando modo flutuante interno:', err);
      }
    }

    // 2. Fallback seguro: abre o Modo Portaria na tela da aplicação
    setIsModoPortariaOpen(true);
    showToast('🛡️ Modo Portaria ativado');
  }, [pipWindow, showToast]);

  // Redimensionamento nativo entre minimizado (380x130) e expandido (420x700) no Document PiP
  const handlePipResize = useCallback((minimized: boolean) => {
    if (!pipWindow || pipWindow.closed) return;

    try {
      if (minimized) {
        pipWindow.resizeTo(380, 130);
      } else {
        pipWindow.resizeTo(420, 700);
      }
    } catch (error) {
      console.warn('[PiP] Falha ao redimensionar janela:', error);
    }
  }, [pipWindow]);

  // Limpeza de janelas órfãs na desmontagem ou fechamento da aba principal
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pipWindow && !pipWindow.closed) {
        try {
          pipWindow.close();
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (pipWindow && !pipWindow.closed) {
        try {
          pipWindow.close();
        } catch {}
      }
    };
  }, [pipWindow]);

  // Fechamento automático da janela PiP em caso de logout
  useEffect(() => {
    if (!isAuthenticated && pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {}
      setPipWindow(null);
      setIsModoPortariaOpen(false);
    }
  }, [isAuthenticated, pipWindow]);

  const handleSelectDeviceMode = (mode: DeviceUsageMode) => {
    try {
      localStorage.setItem('prismas_device_mode', mode);
      if (mode === 'PORTARIA') {
        localStorage.setItem('prismas_portaria_minimized', 'true');
      }
    } catch {}
    setDeviceMode(mode);
    setIsEscolhaModoOpen(false);
    if (mode === 'PORTARIA') {
      handleAbrirModoPortaria();
    } else {
      handleCloseModoPortaria();
      showToast('💻 Modo Normal ativado');
    }
  };

  const handleChangeDeviceMode = (mode: DeviceUsageMode) => {
    try {
      localStorage.setItem('prismas_device_mode', mode);
      if (mode === 'PORTARIA') {
        localStorage.setItem('prismas_portaria_minimized', 'true');
      }
    } catch {}
    setDeviceMode(mode);
    if (mode === 'PORTARIA') {
      handleAbrirModoPortaria();
    } else {
      handleCloseModoPortaria();
      showToast('💻 Modo Normal ativado');
    }
  };

  // Check URL params for standalone pop-up mode (?mode=portaria-popup)
  const isPopUpUrlMode = useMemo(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('mode') === 'portaria-popup';
    }
    return false;
  }, []);

  const handleAbrirEmJanelaDesktop = () => {
    handleAbrirModoPortaria();
  };

  // Current Time Tick to automatically refresh identified operator every 30s
  const [currentTimeTick, setCurrentTimeTick] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeTick(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Environment Check (Settings area is enabled in development or for Admin/Síndico)
  const isDevEnvironment =
    Boolean((import.meta as any).env?.DEV) ||
    (import.meta as any).env?.MODE === 'development' ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname.includes('127.0.0.1') ||
        window.location.hostname.includes('ais-dev')));

  const isAdminOrSindico = Boolean(
    authUser && (
      authUser.role === UserRole.ADMIN ||
      authUser.role === UserRole.SINDICO ||
      authUser.tipoSessao === TipoSessao.ADMIN ||
      authUser.tipoSessao === TipoSessao.SINDICO
    )
  );

  const canAccessConfig = isAdminOrSindico;

  // Automatically identify the operator on duty based on current date, time, shift and parity
  const operadorIdentificado = useMemo(() => {
    return identificarOperadorEmOperacao(usuarios, currentTimeTick);
  }, [usuarios, currentTimeTick]);

  // Operational User: prefers authenticated user context if available, falls back to identified operator
  const usuarioAtual: Usuario = useMemo(() => {
    if (authUser) {
      const found = usuarios.find((u) => u.id === authUser.usuarioId);
      if (found) return found;
      return {
        id: authUser.usuarioId,
        condominioId: authUser.condominioId,
        nome: authUser.nome,
        role: authUser.role,
        cargo: authUser.role === UserRole.PORTEIRO ? 'Portaria' : authUser.role,
        ativo: true,
      };
    }

    if (operadorIdentificado.status === 'OK' && operadorIdentificado.operador) {
      return operadorIdentificado.operador;
    }
    
    if (operadorIdentificado.status === 'CONFLITO') {
      return {
        id: 'usr-conflito-escala',
        condominioId: condominioAtualId,
        nome: 'Conflito de Escala',
        role: UserRole.PORTEIRO,
        cargo: 'Conflito de Escala',
        ativo: false,
      };
    }

    return {
      id: 'usr-nao-identificado',
      condominioId: condominioAtualId,
      nome: 'Porteiro Não Identificado',
      role: UserRole.PORTEIRO,
      cargo: 'Plantão Não Definido',
      ativo: false,
    };
  }, [authUser, usuarios, operadorIdentificado, condominioAtualId]);

  // Fetch Dashboard Data
  const loadDashboard = useCallback(
    async (showLoading = false) => {
      if (showLoading) setIsRefreshing(true);
      try {
        const data: DashboardResponse = await api.getStatus(condominioAtualId);
        
        try {
          if (data.condominio) {
            if (data.condominio.nome) {
              localStorage.setItem(`condo_nome_${condominioAtualId}`, data.condominio.nome);
            }
            if (data.condominio.endereco) {
              localStorage.setItem(`condo_endereco_${condominioAtualId}`, data.condominio.endereco);
            }
          }
        } catch {
          // Ignore localStorage errors
        }

        setCondominios(data.condominios);
        setCondominioAtual(data.condominio);
        setUsuarios(data.usuarios);
        setTurnoAtivo(data.turnoAtivo);
        setStats(data.stats);
        setPrismas(data.prismas);
        setUltimasMovimentacoes(data.ultimasMovimentacoes);
        if (data.rankingCasas && data.rankingCasas.length > 0) {
          setRankingCasas(data.rankingCasas);
        }
        setIsOnline(true);
        setErrorMessage(null);
        return data;
      } catch (err: any) {
        console.warn('Dashboard sync temporary notice:', err?.message || err);
        setIsOnline(false);
        if (showLoading) {
          setErrorMessage(
            err.message || '⚠️ Não foi possível conectar ao servidor. Verifique a conexão com a internet.'
          );
        }
        return null;
      } finally {
        if (showLoading) setIsRefreshing(false);
      }
    },
    [condominioAtualId]
  );

  // Initial load and periodic poll
  useEffect(() => {
    loadDashboard(true);
    const interval = setInterval(() => {
      loadDashboard(false);
    }, 4000); // 4-second gentle sync

    const handleOnline = () => {
      setIsOnline(true);
      loadDashboard(true);
    };

    const handleFocus = () => {
      loadDashboard(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadDashboard]);

  // FLUXO ENTREGAR PRISMA (ENTREGA + CÓPIA AUTOMÁTICA CONDICIONAL)
  const handleConfirmEntrega = async (params: {
    prismaId: string;
    casa: string;
    fotoEvidenciaUrl?: string;
  }) => {
    setIsSubmittingEntrega(true);
    try {
      const res = await api.entregarPrisma({
        prismaId: params.prismaId,
        casa: params.casa,
        fotoEvidenciaUrl: params.fotoEvidenciaUrl,
      });

      setSelectedPrismaEntrega(null);
      playSuccessSound();

      // Cópia automática se habilitado para o condomínio
      const deveCopiar = condominioAtual?.mostrarMensagem !== false;
      let msgCopiada: string | null = null;
      if (deveCopiar && res.prisma) {
        const msgWhatsapp = formatMensagemEntrega(res.prisma.numero, res.prisma.corNome, params.casa);
        const copied = await copyToClipboard(msgWhatsapp);
        if (copied) {
          msgCopiada = msgWhatsapp;
        }
      }

      if (msgCopiada) {
        showToast(`✅ Entrega registrada • Mensagem copiada ("${msgCopiada}")`);
      } else {
        showToast(`✅ Prisma ${res.prisma.numero} (${res.prisma.corNome}) entregue para ${params.casa}!`);
      }

      // Atualização imediata local do ranking inteligente
      const numValido = extrairNumeroCasaValido(params.casa);
      if (numValido !== null) {
        const casaFmt = formatarCasaExibicao(numValido);
        setRankingCasas((prev) => {
          const semAtual = prev.filter((c) => c !== casaFmt);
          return [casaFmt, ...semAtual].slice(0, 6);
        });
      }

      await loadDashboard(false);
    } catch (err: any) {
      if (err.status === 409) {
        await loadDashboard(false);
        throw new Error(
          err.message || '⚠️ Prisma não está mais disponível. A lista foi atualizada.'
        );
      }
      throw err;
    } finally {
      setIsSubmittingEntrega(false);
    }
  };

  // FLUXO RECEBER PRISMA (RECOLHIMENTO: MODO CONTÍNUO PELO CARD vs FLUXO INDIVIDUAL PELO BOTÃO)
  const handleReceberPrisma = async (
    prismaId: string,
    options?: { origin?: 'CARD' | 'BUTTON' }
  ) => {
    const origin = options?.origin || 'BUTTON';
    setIsReceberLoading(true);
    try {
      const prismaAntes = prismas.find((p) => p.id === prismaId);
      const res = await api.receberPrisma({
        prismaId,
      });

      // 1. Som de sucesso leve
      playSuccessSound();

      // 2. Cópia automática da mensagem se habilitado para o condomínio
      const casaRecolhida =
        res.movimentacao?.casa ||
        prismaAntes?.casaAtual ||
        res.prisma?.casaAtual ||
        '';

      const deveCopiar = condominioAtual?.mostrarMensagem !== false;
      let msgCopiada: string | null = null;
      if (deveCopiar && res.prisma) {
        const msgWhatsapp = formatMensagemRecolhimento(res.prisma.numero, res.prisma.corNome, casaRecolhida);
        const copied = await copyToClipboard(msgWhatsapp);
        if (copied) {
          msgCopiada = msgWhatsapp;
        }
      }

      // 3. Confirmação visual discreta
      if (msgCopiada) {
        showToast(`✓ Recolhimento registrado • Mensagem copiada ("${msgCopiada}")`);
      } else {
        showToast(`✓ Recolhimento registrado (Prisma ${res.prisma.numero} ${res.prisma.corNome})`);
      }

      const freshData = await loadDashboard(false);

      // 4. Distinção determinística:
      // CARD -> BAIXA -> RECOLHER (permanece em 'RECEBER' se ainda houver prismas em uso; se for 0 prismas, retorna para 'ENTREGAR')
      // BOTÃO -> BAIXA -> DISPONÍVEIS (retorna para 'ENTREGAR')
      if (origin === 'CARD') {
        const remainingInUse = freshData
          ? freshData.prismas.filter((p) => p.estado === PrismaEstado.EM_USO).length
          : prismas.filter((p) => p.estado === PrismaEstado.EM_USO && p.id !== prismaId).length;

        if (remainingInUse === 0) {
          setActiveTab('ENTREGAR');
        } else {
          setActiveTab('RECEBER');
        }
      } else {
        setActiveTab('ENTREGAR');
      }
    } catch (err: any) {
      if (err.status === 409) {
        await loadDashboard(false);
        alert(err.message || '⚠️ Prisma já foi devolvido ou não está em uso.');
      } else {
        alert(err.message || 'Erro ao receber prisma.');
      }
      throw err;
    } finally {
      setIsReceberLoading(false);
    }
  };

  // REGISTRAR PENDÊNCIA
  const handleRegistrarPendencia = async (prismaId: string, motivo: string) => {
    try {
      await api.registrarPendencia({
        prismaId,
        motivo,
      });
      showToast('⚠️ Pendência registrada com sucesso.');
      await loadDashboard(false);
    } catch (err: any) {
      alert(err.message || 'Erro ao registrar pendência.');
    }
  };

  // RESOLVER PENDÊNCIA
  const handleResolverPendencia = async (
    prismaId: string,
    novoEstado: string,
    justificativa: string
  ) => {
    try {
      await api.resolverPendencia({
        prismaId,
        novoEstado,
        justificativa,
      });
      showToast('✅ Pendência resolvida e registrada na auditoria.');
      await loadDashboard(false);
    } catch (err: any) {
      alert(err.message || 'Erro ao resolver pendência.');
    }
  };

  // ASSUMIR TURNO
  const handleConfirmAssumirTurno = async (params: {
    porteiroId: string;
    porteiroNome: string;
    nomeTurno: string;
    notasPassagem?: string;
  }) => {
    try {
      const res = await api.assumirTurno({
        ...params,
      });
      showToast(`🟢 Turno assumido por ${params.porteiroNome} (${res.prismasEmUso} em uso)!`);
      await loadDashboard(false);
    } catch (err: any) {
      alert(err.message || 'Erro ao assumir turno.');
    }
  };

  // List calculations
  const prismasDisponiveis = prismas.filter((p) => p.estado === PrismaEstado.DISPONIVEL);
  const prismasEmUso = prismas.filter((p) => p.estado === PrismaEstado.EM_USO);

  // While validating initial session state from HttpOnly cookie
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 font-sans">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Carregando Controle de Prismas...</span>
      </div>
    );
  }

  // If user is not authenticated, render LoginScreen
  if (!isAuthenticated) {
    return (
      <LoginScreen
        usuarios={usuarios}
        condominioNome={condominioAtual?.nome || 'Condomínio'}
        condominioId={condominioAtualId}
      />
    );
  }

  // If opened directly as a pop-up window in desktop browser (?mode=portaria-popup)
  if (isPopUpUrlMode) {
    return (
      <div className="min-h-screen bg-slate-950 p-2 flex items-center justify-center font-sans antialiased selection:bg-blue-600 selection:text-white">
        <FloatingPortariaWindow
          condominioAtual={condominioAtual}
          operadorIdentificado={operadorIdentificado}
          usuarioAtual={usuarioAtual}
          stats={stats}
          prismas={prismas}
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            setSelectedFilter(undefined);
            if (tab !== 'BUSCAR') setSearchTerm('');
          }}
          searchTerm={searchTerm}
          onSearchChange={(term) => setSearchTerm(term)}
          onCloseSearch={() => {
            setSearchTerm('');
            setActiveTab('ENTREGAR');
          }}
          onSelectPrismaEntrega={(p) => setSelectedPrismaEntrega(p)}
          onReceberPrisma={handleReceberPrisma}
          isReceberLoading={isReceberLoading}
          onRegistrarPendencia={handleRegistrarPendencia}
          onResolverPendencia={handleResolverPendencia}
          onOpenHistoricoById={(id) => setHistoricoPrismaId(id)}
          isOnline={isOnline}
          isRefreshing={isRefreshing}
          onRefresh={() => loadDashboard(true)}
          onClose={() => {
            if (window.opener) {
              window.close();
            } else {
              window.location.search = '';
            }
          }}
          ultimasMovimentacoes={ultimasMovimentacoes}
          isStandalonePopup={true}
        />

        {/* Entrega Modal inside Popup */}
        <EntregaModal
          prisma={selectedPrismaEntrega}
          onClose={() => setSelectedPrismaEntrega(null)}
          onConfirmEntrega={handleConfirmEntrega}
          isLoading={isSubmittingEntrega}
          quickHouses={rankingCasas}
        />

        {/* Prisma Histórico Modal inside Popup */}
        <PrismaHistoricoModal
          prismaId={historicoPrismaId}
          onClose={() => setHistoricoPrismaId(null)}
          usuarioAtual={usuarioAtual}
          condominioId={condominioAtualId}
          onUpdateSuccess={() => loadDashboard(false)}
        />
      </div>
    );
  }

  // AMBIENTE DO MODO PORTARIA (Com Document PiP quando ativo ou tela exclusiva como fallback)
  if (isModoPortariaOpen) {
    const portariaContent = (
      <div className="w-full h-full min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-blue-600 selection:text-white relative overflow-hidden">
        <FloatingPortariaWindow
          condominioAtual={condominioAtual}
          operadorIdentificado={operadorIdentificado}
          usuarioAtual={usuarioAtual}
          stats={stats}
          prismas={prismas}
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            setSelectedFilter(undefined);
            if (tab !== 'BUSCAR') setSearchTerm('');
          }}
          searchTerm={searchTerm}
          onSearchChange={(term) => setSearchTerm(term)}
          onCloseSearch={() => {
            setSearchTerm('');
            setActiveTab('ENTREGAR');
          }}
          onSelectPrismaEntrega={(p) => setSelectedPrismaEntrega(p)}
          onReceberPrisma={handleReceberPrisma}
          isReceberLoading={isReceberLoading}
          onRegistrarPendencia={handleRegistrarPendencia}
          onResolverPendencia={handleResolverPendencia}
          onOpenHistoricoById={(id) => setHistoricoPrismaId(id)}
          isOnline={isOnline}
          isRefreshing={isRefreshing}
          onRefresh={() => loadDashboard(true)}
          onClose={handleCloseModoPortaria}
          onAbrirEmJanelaDesktop={undefined}
          onToggleMinimize={handlePipResize}
          onOpenGerenciamento={() => setIsGerenciamentoOpen(true)}
          ultimasMovimentacoes={ultimasMovimentacoes}
          isStandalonePopup={Boolean(pipWindow)}
        />

        {/* Modal de Entrega */}
        <EntregaModal
          prisma={selectedPrismaEntrega}
          onClose={() => setSelectedPrismaEntrega(null)}
          onConfirmEntrega={handleConfirmEntrega}
          isLoading={isSubmittingEntrega}
          quickHouses={rankingCasas}
        />

        {/* Modal de Histórico do Prisma */}
        <PrismaHistoricoModal
          prismaId={historicoPrismaId}
          onClose={() => setHistoricoPrismaId(null)}
          usuarioAtual={usuarioAtual}
          condominioId={condominioAtualId}
          onUpdateSuccess={() => loadDashboard(false)}
        />

        {/* Gerenciamento de Prismas no Modo Portaria */}
        <GerenciarPrismasModal
          isOpen={isGerenciamentoOpen}
          onClose={() => setIsGerenciamentoOpen(false)}
          prismas={prismas}
          condominioId={condominioAtualId}
          usuarioAtual={usuarioAtual}
          onUpdateSuccess={() => loadDashboard(false)}
        />

        {/* Toast Notificação de Sucesso */}
        {successToast && (
          <div
            id="global-success-toast-portaria"
            className="fixed bottom-4 right-4 z-50 p-3.5 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 text-xs sm:text-sm font-bold flex items-center gap-2 animate-in slide-in-from-bottom-5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
        )}
      </div>
    );

    // Se o Document Picture-in-Picture estiver ativo com janela aberta, transporta o conteúdo para a janela PiP
    if (pipWindow && !pipWindow.closed) {
      return (
        <>
          {createPortal(portariaContent, pipWindow.document.body)}
          {/* Interface de apoio na aba principal */}
          <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans antialiased text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-3xl shadow-xl shadow-blue-500/30 mb-4 border border-blue-400/40">
              🛡️
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide uppercase mb-2">
              MODO PORTARIA EM JANELA SOBREPOSTA
            </h1>
            <p className="text-sm text-blue-200 max-w-md mb-6 leading-relaxed">
              A interface da Portaria está aberta e sempre visível sobre outros programas (Document Picture-in-Picture). Você pode operar entregas e gerenciar prismas diretamente nela.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                id="btn-focar-janela-pip"
                onClick={() => {
                  if (pipWindow && !pipWindow.closed) {
                    pipWindow.focus();
                  }
                }}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-xs font-black tracking-wide uppercase transition-all shadow-md shadow-blue-600/30 cursor-pointer"
              >
                Focar Janela Sobreposta
              </button>
              <button
                type="button"
                id="btn-fechar-pip-voltar-normal"
                onClick={handleCloseModoPortaria}
                className="px-4 py-2.5 bg-slate-800 hover:bg-rose-900/60 active:bg-rose-900 border border-slate-700 hover:border-rose-500 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Fechar e Retornar ao Modo Normal
              </button>
            </div>
          </div>
        </>
      );
    }

    // Fallback: caso PiP não esteja ativo, renderiza na janela principal normalmente
    return portariaContent;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* Top Header */}
      <Header
        condominioAtual={condominioAtual}
        condominios={condominios}
        onSelectCondominio={(id) => setCondominioAtualId(id)}
        onOpenEditarCondominio={() => setIsEditarCondominioOpen(true)}
        turnoAtivo={turnoAtivo}
        operadorIdentificado={operadorIdentificado}
        authUser={authUser}
        onLogout={logout}
        onOpenPassagemTurno={() => setIsPassagemTurnoOpen(true)}
        onOpenAuditoria={() => setIsAuditoriaOpen(true)}
        onOpenGerenciamento={() => setIsGerenciamentoOpen(true)}
        onOpenConcorrenciaSim={() => setIsConcorrenciaOpen(true)}
        onOpenConfiguracoes={canAccessConfig ? () => setIsConfiguracoesOpen(true) : undefined}
        onOpenAlterarSenha={() => setIsAlterarSenhaOpen(true)}
        isDevEnvironment={isDevEnvironment}
        isOnline={isOnline}
        onRefresh={() => loadDashboard(true)}
        isRefreshing={isRefreshing}
        isModoPortariaActive={isModoPortariaOpen}
        onToggleModoPortaria={() => {
          if (isModoPortariaOpen) {
            handleCloseModoPortaria();
          } else {
            handleAbrirModoPortaria();
          }
        }}
      />

      {/* Main Single Operational Screen Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2.5 sm:p-4 lg:p-5 space-y-2.5 sm:space-y-3.5">
        {/* Error / Offline Alert */}
        {errorMessage && (
          <div
            id="global-error-banner"
            className="p-3 bg-rose-50 border-2 border-rose-300 rounded-xl text-rose-900 text-xs sm:text-sm font-semibold flex items-center justify-between gap-2 shadow-sm animate-in fade-in"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => loadDashboard(true)}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {/* Success Toast */}
        {successToast && (
          <div
            id="global-success-toast"
            className="fixed bottom-4 right-4 z-50 p-3.5 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 text-xs sm:text-sm font-bold flex items-center gap-2 animate-in slide-in-from-bottom-5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
        )}

        {/* 1. GRADE OPERACIONAL 2x2 (EM USO, PENDENTES, DISPONÍVEL, RECOLHER) + BUSCAR */}
        <ActionSelector
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            setSelectedFilter(undefined);
            if (tab !== 'BUSCAR') {
              setSearchTerm('');
            }
          }}
          countDisponiveis={stats.disponiveis}
          countEmUso={stats.emUso}
          countPendentes={stats.pendentes}
          prismasEmUso={prismasEmUso}
          prismasPendentes={prismas.filter((p) => p.estado === PrismaEstado.PENDENTE)}
          searchTerm={searchTerm}
          onSearchChange={(term) => setSearchTerm(term)}
          onCloseSearch={() => {
            setSearchTerm('');
            setActiveTab('ENTREGAR');
          }}
        />

        {/* 3. PRIMARY OPERATIONAL STAGE */}
        <div id="main-operational-stage" className="min-h-[300px]">
          {/* TAB 1: FLUXO ENTREGAR PRISMA */}
          {activeTab === 'ENTREGAR' && (
            <div id="view-entrega-prisma" className="space-y-2.5">
              {prismasDisponiveis.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-5">
                  <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-2 opacity-80" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-800">
                    Nenhum prisma disponível no momento!
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    Todos os prismas estão em uso ou pendentes de devolução.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5 sm:gap-2 md:gap-2.5">
                  {prismasDisponiveis.map((p) => (
                    <PrismaCard
                      key={p.id}
                      prisma={p}
                      variant="entrega"
                      onClick={() => setSelectedPrismaEntrega(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FLUXO RECEBER PRISMA */}
          {activeTab === 'RECEBER' && (
            <ReceberView
              prismasEmUso={prismasEmUso}
              onReceberPrisma={handleReceberPrisma}
              isLoading={isReceberLoading}
              onOpenHistorico={(prisma) => setHistoricoPrismaId(prisma.id)}
            />
          )}

          {/* TAB 3: PRISMAS PENDENTES */}
          {activeTab === 'PENDENTES' && (
            <PrismasEmAbertoView
              prismas={prismas}
              onReceberPrisma={handleReceberPrisma}
              onRegistrarPendencia={handleRegistrarPendencia}
              onResolverPendencia={handleResolverPendencia}
              onOpenHistorico={(prisma) => setHistoricoPrismaId(prisma.id)}
              usuarioAtual={usuarioAtual}
              isLoading={isReceberLoading}
            />
          )}

          {/* TAB 4: BUSCA RÁPIDA */}
          {activeTab === 'BUSCAR' && (
            <BuscaView
              prismas={prismas}
              movimentacoes={ultimasMovimentacoes}
              termo={searchTerm}
              onOpenHistorico={(prisma) => setHistoricoPrismaId(prisma.id)}
              onOpenHistoricoById={(id) => setHistoricoPrismaId(id)}
            />
          )}
        </div>

        {/* 4. COMPACT RECENT MOVEMENTS FEED (ALWAYS ACCESSIBLE AT BOTTOM) */}
        <UltimasMovimentacoes
          movimentacoes={ultimasMovimentacoes}
          onOpenHistoricoById={(id) => setHistoricoPrismaId(id)}
          onOpenAuditoria={() => setIsAuditoriaOpen(true)}
        />
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 py-3 text-center text-xs">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            Sistema de Controle de Prismas V1 • {condominioAtual?.nome || 'Condomínio'}
          </span>
          <span className="text-[11px] text-slate-400">
            «Simples na tela. Rápido na operação. Forte no controle. Rastreável na auditoria.»
          </span>
        </div>
      </footer>

      {/* MODALS */}
      {/* 1. Entrega Modal */}
      <EntregaModal
        prisma={selectedPrismaEntrega}
        onClose={() => setSelectedPrismaEntrega(null)}
        onConfirmEntrega={handleConfirmEntrega}
        isLoading={isSubmittingEntrega}
        quickHouses={rankingCasas}
      />

      {/* 2. Passagem de Turno Modal */}
      <PassagemTurnoModal
        isOpen={isPassagemTurnoOpen}
        onClose={() => setIsPassagemTurnoOpen(false)}
        turnoAtivo={turnoAtivo}
        prismasEmUso={prismasEmUso}
        usuarios={usuarios}
        usuarioAtual={usuarioAtual}
        onConfirmAssumirTurno={handleConfirmAssumirTurno}
        isLoading={false}
      />

      {/* 3. Prisma Histórico Modal */}
      <PrismaHistoricoModal
        prismaId={historicoPrismaId}
        onClose={() => setHistoricoPrismaId(null)}
        usuarioAtual={usuarioAtual}
        condominioId={condominioAtualId}
        onUpdateSuccess={() => loadDashboard(false)}
      />

      {/* 4. Gerenciamento de Prismas (Síndico/Admin) */}
      <GerenciarPrismasModal
        isOpen={isGerenciamentoOpen}
        onClose={() => setIsGerenciamentoOpen(false)}
        prismas={prismas}
        condominioId={condominioAtualId}
        usuarioAtual={usuarioAtual}
        onUpdateSuccess={() => loadDashboard(false)}
      />

      {/* 5. Auditoria Completa Modal */}
      <AuditoriaModal
        isOpen={isAuditoriaOpen}
        onClose={() => setIsAuditoriaOpen(false)}
        condominioId={condominioAtualId}
      />

      {/* 6. Simulador de Concorrência Multi-Dispositivo */}
      <ConcorrenciaModal
        isOpen={isConcorrenciaOpen}
        onClose={() => setIsConcorrenciaOpen(false)}
        prismas={prismas}
        condominioId={condominioAtualId}
        onSuccess={() => loadDashboard(false)}
      />

      {/* 7. Configurações do Sistema */}
      {canAccessConfig && (
        <ConfiguracoesModal
          isOpen={isConfiguracoesOpen}
          onClose={() => setIsConfiguracoesOpen(false)}
          condominioId={condominioAtualId}
          usuarioAtual={usuarioAtual}
          onRefreshData={() => loadDashboard(false)}
          onOpenHistoricoById={(id) => setHistoricoPrismaId(id)}
          onOpenAlterarSenha={() => setIsAlterarSenhaOpen(true)}
          deviceMode={deviceMode}
          onChangeDeviceMode={handleChangeDeviceMode}
        />
      )}

      {/* Modal Alterar Minha Senha (SÍNDICO) */}
      <AlterarSenhaModal
        isOpen={isAlterarSenhaOpen}
        onClose={() => setIsAlterarSenhaOpen(false)}
        onSuccess={(msg) => showToast(`✅ ${msg}`)}
      />

      {/* 8. Editar Condomínio Modal */}
      <EditarCondominioModal
        isOpen={isEditarCondominioOpen}
        onClose={() => setIsEditarCondominioOpen(false)}
        condominio={condominioAtual}
        usuarioAtual={usuarioAtual}
        onSuccess={(condoAtualizado) => {
          setCondominioAtual(condoAtualizado);
          showToast('✅ Informações do condomínio atualizadas com sucesso!');
          loadDashboard(false);
        }}
      />

      {/* 9. Modal de Primeira Execução: Escolha do Modo de Uso do Dispositivo (PC) */}
      <EscolhaModoDispositivoModal
        isOpen={isEscolhaModoOpen}
        onSelectMode={handleSelectDeviceMode}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
