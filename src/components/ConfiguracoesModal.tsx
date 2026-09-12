import React, { useState, useEffect, useMemo } from 'react';
import {
  Usuario,
  UserRole,
  TipoTurno,
  CategoriaContato,
  ContatoEvidencia,
  Prisma,
  PrismaEstado,
  Condominio,
  Paridade12x36,
  PortariaStatusResponse,
} from '../types';
import { CORES_DISPONIVEIS, getCorConfig } from '../constants/cores';
import { OPCOES_12X36 } from '../utils/turnoUtils';
import { PrismaVisual } from './PrismaVisual';
import { api } from '../services/api';
import { sortPrismasNumericos } from '../utils/prismaSort';
import {
  X,
  Settings,
  Users,
  Layers,
  Phone,
  Building2,
  Plus,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Check,
  Shield,
  UserCheck,
  UserX,
  AlertCircle,
  Eye,
  EyeOff,
  Clock,
  Trash2,
  MessageSquare,
  Moon,
  Sun,
  Briefcase,
  Monitor,
  Smartphone,
  KeyRound,
  Copy,
  RotateCcw,
  Unlock,
  Sparkles,
  Lock,
} from 'lucide-react';

interface ConfiguracoesModalProps {
  isOpen: boolean;
  onClose: () => void;
  condominioId: string;
  usuarioAtual: Usuario;
  onRefreshData: () => Promise<void>;
  onOpenHistoricoById?: (prismaId: string) => void;
  onOpenAlterarSenha?: () => void;
  deviceMode?: 'PORTARIA' | 'NORMAL';
  onChangeDeviceMode?: (mode: 'PORTARIA' | 'NORMAL') => void;
}

type TabType = 'CONDOMINIOS';
type CondominioSubTab = 'DADOS' | 'USUARIOS' | 'PRISMAS' | 'CONTATOS';

export const ConfiguracoesModal: React.FC<ConfiguracoesModalProps> = ({
  isOpen,
  onClose,
  condominioId,
  usuarioAtual,
  onRefreshData,
  onOpenHistoricoById,
  onOpenAlterarSenha,
  deviceMode = 'NORMAL',
  onChangeDeviceMode,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('CONDOMINIOS');
  const [subTab, setSubTab] = useState<CondominioSubTab>('DADOS');

  // ==================== State: Usuários ====================
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [isUserFormOpen, setIsUserFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formCargo, setFormCargo] = useState('');
  const [formRole, setFormRole] = useState<UserRole>(UserRole.PORTEIRO);
  const [formMatricula, setFormMatricula] = useState('');
  const [formTipoTurno, setFormTipoTurno] = useState<TipoTurno>(TipoTurno.TURNO_12X36);
  const [formOpcao12x36, setFormOpcao12x36] = useState<string>('07:00-19:00');
  const [formParidade12x36, setFormParidade12x36] = useState<Paridade12x36>(Paridade12x36.IMPAR);
  const [formHoraInicio, setFormHoraInicio] = useState<string>('07:00');
  const [formHoraFim, setFormHoraFim] = useState<string>('19:00');
  const [formIdentificador, setFormIdentificador] = useState<string>('');
  const [formSenhaInicial, setFormSenhaInicial] = useState<string>('');
  const [formConfirmarSenha, setFormConfirmarSenha] = useState<string>('');
  const [showFormPassword, setShowFormPassword] = useState<boolean>(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [userToDelete, setUserToDelete] = useState<Usuario | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [deleteUserError, setDeleteUserError] = useState<string | null>(null);

  // ==================== State: Prismas ====================
  const [prismas, setPrismas] = useState<Prisma[]>([]);
  const [loadingPrismas, setLoadingPrismas] = useState(false);
  const [filtroPrisma, setFiltroPrisma] = useState('');
  const [isPrismaFormOpen, setIsPrismaFormOpen] = useState(false);
  const [selectedNumero, setSelectedNumero] = useState<string>('01');
  const [customNumero, setCustomNumero] = useState<string>('');
  const [selectedCorId, setSelectedCorId] = useState<string>('vermelho');
  const [prismaError, setPrismaError] = useState<string | null>(null);
  const [isSavingPrisma, setIsSavingPrisma] = useState(false);
  const [deactivatingPrisma, setDeactivatingPrisma] = useState<Prisma | null>(null);
  const [motivoExtravio, setMotivoExtravio] = useState('');
  const [prismaToDelete, setPrismaToDelete] = useState<Prisma | null>(null);
  const [isDeletingPrisma, setIsDeletingPrisma] = useState(false);
  const [deletePrismaError, setDeletePrismaError] = useState<string | null>(null);

  // Usuário com perfil administrativo (Síndico/Admin) para autorização das configurações
  const adminOrSindicoUser: Usuario = useMemo(() => {
    if (usuarioAtual.role === UserRole.ADMIN || usuarioAtual.role === UserRole.SINDICO) {
      return usuarioAtual;
    }
    const sindicoOuAdmin = usuarios.find(
      (u) => (u.role === UserRole.ADMIN || u.role === UserRole.SINDICO) && !u.excluido
    );
    if (sindicoOuAdmin) return sindicoOuAdmin;
    return {
      id: 'usr-admin',
      condominioId,
      nome: 'Administrador do Sistema',
      role: UserRole.ADMIN,
      cargo: 'Administrador',
      ativo: true,
    };
  }, [usuarioAtual, usuarios, condominioId]);

  const canGerenciarExclusaoPrisma = true;

  // ==================== State: Contatos ====================
  const [contatos, setContatos] = useState<ContatoEvidencia[]>([]);
  const [loadingContatos, setLoadingContatos] = useState(false);
  const [filtroContato, setFiltroContato] = useState('');
  const [isContatoFormOpen, setIsContatoFormOpen] = useState(false);
  const [editingContato, setEditingContato] = useState<ContatoEvidencia | null>(null);
  const [contatoNome, setContatoNome] = useState('');
  const [contatoCategoria, setContatoCategoria] = useState<CategoriaContato>(CategoriaContato.PORTARIA);
  const [contatoTelefone, setContatoTelefone] = useState('');
  const [contatoIdentificador, setContatoIdentificador] = useState('');
  const [contatoError, setContatoError] = useState<string | null>(null);
  const [isSavingContato, setIsSavingContato] = useState(false);

  // ==================== State: Condomínio ====================
  const [condominioNome, setCondominioNome] = useState('');
  const [condominioEndereco, setCondominioEndereco] = useState('');
  const [mostrarMensagem, setMostrarMensagem] = useState(true);
  const [isSavingCondominio, setIsSavingCondominio] = useState(false);
  const [condominioSuccessMsg, setCondominioSuccessMsg] = useState<string | null>(null);
  const [condominioError, setCondominioError] = useState<string | null>(null);

  // ==================== State: Código da Portaria ====================
  const [portariaStatus, setPortariaStatus] = useState<PortariaStatusResponse | null>(null);
  const [loadingPortariaStatus, setLoadingPortariaStatus] = useState(false);
  const [showPortariaCodigo, setShowPortariaCodigo] = useState(false);
  const [isConfirmGerarCodigoOpen, setIsConfirmGerarCodigoOpen] = useState(false);
  const [isGerandoCodigo, setIsGerandoCodigo] = useState(false);
  const [codigoGeradoModal, setCodigoGeradoModal] = useState<string | null>(null);
  const [codigoCopied, setCodigoCopied] = useState(false);
  const [isDesbloqueandoPortaria, setIsDesbloqueandoPortaria] = useState(false);
  const [portariaActionMsg, setPortariaActionMsg] = useState<string | null>(null);
  const [portariaActionError, setPortariaActionError] = useState<string | null>(null);

  // Initial Numbers 01 to 30 for quick selection
  const quickNumbers = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'));

  // Load Data
  const carregarUsuarios = async () => {
    setLoadingUsuarios(true);
    try {
      const res = await api.getUsuarios(condominioId);
      setUsuarios(res.usuarios);
    } catch (err: any) {
      console.error('Erro ao carregar usuários:', err);
    } finally {
      setLoadingUsuarios(false);
    }
  };

  const carregarPrismas = async () => {
    setLoadingPrismas(true);
    try {
      const res = await api.getTodosPrismas(condominioId);
      setPrismas(res.prismas);
    } catch (err: any) {
      console.error('Erro ao carregar prismas:', err);
    } finally {
      setLoadingPrismas(false);
    }
  };

  const carregarContatos = async () => {
    setLoadingContatos(true);
    try {
      const res = await api.getContatos(condominioId);
      setContatos(res.contatos || []);
    } catch (err: any) {
      console.error('Erro ao carregar contatos:', err);
    } finally {
      setLoadingContatos(false);
    }
  };

  const carregarCondominio = async () => {
    try {
      const data = await api.getStatus(condominioId);
      if (data.condominio) {
        setCondominioNome(data.condominio.nome);
        setCondominioEndereco(data.condominio.endereco);
        setMostrarMensagem(data.condominio.mostrarMensagem !== false);
      }
    } catch (err: any) {
      console.error('Erro ao carregar condomínio:', err);
    }
  };

  const carregarPortariaStatus = async () => {
    try {
      setLoadingPortariaStatus(true);
      const status = await api.getCodigoPortariaStatus(condominioId);
      if (status) {
        setPortariaStatus(status);
      }
    } catch (err: any) {
      console.error('Erro ao carregar status do código da portaria:', err);
    } finally {
      setLoadingPortariaStatus(false);
    }
  };

  const handleGerarNovoCodigo = async () => {
    if (usuarioAtual?.role !== UserRole.ADMIN) {
      setPortariaActionError('Apenas o Administrador possui permissão para gerar novos códigos de acesso da portaria.');
      return;
    }
    try {
      setIsGerandoCodigo(true);
      setPortariaActionError(null);
      const res = await api.gerarNovoCodigoPortaria(condominioId);
      if (res.success && res.codigo) {
        setCodigoGeradoModal(res.codigo);
        setIsConfirmGerarCodigoOpen(false);
        setPortariaActionMsg('Novo Código de Acesso da Portaria gerado com sucesso! O código anterior foi imediatamente invalidado.');
        await carregarPortariaStatus();
        await onRefreshData();
      }
    } catch (err: any) {
      setPortariaActionError(err.message || 'Erro ao gerar novo código da portaria.');
    } finally {
      setIsGerandoCodigo(false);
    }
  };

  const handleDesbloquearPortaria = async () => {
    if (usuarioAtual?.role !== UserRole.ADMIN) {
      setPortariaActionError('Apenas o Administrador possui permissão para desbloquear a estação da portaria.');
      return;
    }
    try {
      setIsDesbloqueandoPortaria(true);
      setPortariaActionError(null);
      const res = await api.desbloquearPortariaCodigo(condominioId);
      if (res.success) {
        setPortariaActionMsg('Acesso da Portaria desbloqueado com sucesso!');
        await carregarPortariaStatus();
        await onRefreshData();
      }
    } catch (err: any) {
      setPortariaActionError(err.message || 'Erro ao desbloquear acesso da portaria.');
    } finally {
      setIsDesbloqueandoPortaria(false);
    }
  };

  const handleCopyCodigo = (code: string) => {
    navigator.clipboard.writeText(code);
    setCodigoCopied(true);
    setTimeout(() => setCodigoCopied(false), 3000);
  };

  // Guarda defensiva obrigatória: apenas ADMIN e SÍNDICO podem acessar ou carregar configurações
  const isAuthorized = Boolean(
    usuarioAtual &&
      (usuarioAtual.role === UserRole.ADMIN || usuarioAtual.role === UserRole.SINDICO)
  );

  useEffect(() => {
    if (isOpen && isAuthorized) {
      carregarUsuarios();
      carregarPrismas();
      carregarContatos();
      carregarCondominio();
      carregarPortariaStatus();
    }
  }, [isOpen, isAuthorized, condominioId]);

  // ==================== Usuários Handlers ====================
  const handleOpenNewUser = () => {
    setEditingUser(null);
    setFormNome('');
    setFormCargo('Porteiro');
    setFormRole(UserRole.PORTEIRO);
    setFormMatricula('');
    setFormTipoTurno(TipoTurno.TURNO_12X36);
    setFormOpcao12x36('07:00-19:00');
    setFormParidade12x36(Paridade12x36.IMPAR);
    setFormHoraInicio('07:00');
    setFormHoraFim('19:00');
    setFormIdentificador('');
    setFormSenhaInicial('');
    setFormConfirmarSenha('');
    setShowFormPassword(false);
    setUserError(null);
    setIsUserFormOpen(true);
  };

  const handleEditUser = (u: Usuario) => {
    setEditingUser(u);
    setFormNome(u.nome);
    setFormCargo(u.cargo);
    setFormRole(u.role);
    setFormMatricula(u.matricula || '');
    setFormTipoTurno(u.tipoTurno || TipoTurno.TURNO_12X36);
    setFormOpcao12x36(u.opcaoTurno12x36 || '07:00-19:00');
    setFormParidade12x36(u.paridade12x36 || Paridade12x36.IMPAR);
    setFormHoraInicio(u.horaInicio || '07:00');
    setFormHoraFim(u.horaFim || '19:00');
    setUserError(null);
    setIsUserFormOpen(true);
  };

  const handleSelect12x36Option = (opId: string) => {
    setFormOpcao12x36(opId);
    const found = OPCOES_12X36.find((o) => o.id === opId);
    if (found) {
      setFormHoraInicio(found.horaInicio);
      setFormHoraFim(found.horaFim);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNome.trim()) {
      setUserError('Nome do usuário é obrigatório.');
      return;
    }
    if (!formHoraInicio || !formHoraFim) {
      setUserError('Horário de início e término são obrigatórios.');
      return;
    }

    try {
      setIsSavingUser(true);
      setUserError(null);

      if (editingUser) {
        await api.editarUsuario({
          id: editingUser.id,
          nome: formNome.trim(),
          cargo: formCargo.trim(),
          role: formRole,
          matricula: formMatricula.trim() || undefined,
          tipoTurno: formTipoTurno,
          opcaoTurno12x36: formTipoTurno === TipoTurno.TURNO_12X36 ? formOpcao12x36 : undefined,
          paridade12x36: formTipoTurno === TipoTurno.TURNO_12X36 ? formParidade12x36 : undefined,
          horaInicio: formHoraInicio,
          horaFim: formHoraFim,
          condominioId,
          adminId: usuarioAtual.id,
          adminNome: usuarioAtual.nome,
        });
      } else {
        // Validação estrita para o perfil SÍNDICO
        if (formRole === UserRole.SINDICO) {
          if (!formIdentificador.trim()) {
            setUserError('Identificador / Usuário de login é obrigatório para o perfil Síndico.');
            return;
          }
          if (!formSenhaInicial) {
            setUserError('A senha inicial é obrigatória para o perfil Síndico.');
            return;
          }
          if (formSenhaInicial.length < 8) {
            setUserError('A senha deve possuir no mínimo 8 caracteres.');
            return;
          }
          if (formSenhaInicial.length > 128) {
            setUserError('A senha não pode ultrapassar 128 caracteres.');
            return;
          }
          if (formSenhaInicial !== formConfirmarSenha) {
            setUserError('As senhas não coincidem.');
            return;
          }
        }

        await api.cadastrarUsuario({
          nome: formNome.trim(),
          cargo: formCargo.trim() || (formRole === UserRole.SINDICO ? 'Síndico' : 'Porteiro'),
          role: formRole,
          matricula: formMatricula.trim() || undefined,
          tipoTurno: formTipoTurno,
          opcaoTurno12x36: formTipoTurno === TipoTurno.TURNO_12X36 ? formOpcao12x36 : undefined,
          paridade12x36: formTipoTurno === TipoTurno.TURNO_12X36 ? formParidade12x36 : undefined,
          horaInicio: formHoraInicio,
          horaFim: formHoraFim,
          condominioId,
          adminId: usuarioAtual.id,
          adminNome: usuarioAtual.nome,
          identificador: formRole === UserRole.SINDICO ? formIdentificador.trim() : undefined,
          senhaInicial: formRole === UserRole.SINDICO ? formSenhaInicial : undefined,
        });

        // Limpa campos de credenciais após cadastro bem-sucedido
        setFormIdentificador('');
        setFormSenhaInicial('');
        setFormConfirmarSenha('');
        setShowFormPassword(false);
      }

      await carregarUsuarios();
      await onRefreshData();
      setIsUserFormOpen(false);
    } catch (err: any) {
      setUserError(err.message || 'Erro ao salvar usuário.');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleToggleUserStatus = async (u: Usuario) => {
    try {
      await api.toggleStatusUsuario({
        id: u.id,
        ativo: !u.ativo,
        condominioId,
        adminId: usuarioAtual.id,
        adminNome: usuarioAtual.nome,
      });
      await carregarUsuarios();
      await onRefreshData();
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar status do usuário.');
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      setIsDeletingUser(true);
      setDeleteUserError(null);
      await api.excluirUsuario(userToDelete.id, condominioId, usuarioAtual.id, usuarioAtual.nome);
      await carregarUsuarios();
      await onRefreshData();
      setUserToDelete(null);
    } catch (err: any) {
      setDeleteUserError(err.message || 'Erro ao excluir usuário.');
    } finally {
      setIsDeletingUser(false);
    }
  };

  // ==================== Prismas Handlers ====================
  const handleSavePrisma = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeroFinal = (customNumero.trim() || selectedNumero).trim();
    if (!numeroFinal) {
      setPrismaError('Selecione ou digite o número do prisma.');
      return;
    }

    const corConfig = getCorConfig(selectedCorId);

    try {
      setIsSavingPrisma(true);
      setPrismaError(null);

      await api.cadastrarPrisma({
        numero: numeroFinal,
        corId: corConfig.id,
        corNome: corConfig.nome,
        condominioId,
        usuarioId: adminOrSindicoUser.id,
        usuarioNome: adminOrSindicoUser.nome,
      });

      await carregarPrismas();
      await onRefreshData();
      setIsPrismaFormOpen(false);
      setCustomNumero('');
    } catch (err: any) {
      setPrismaError(err.message || 'Erro ao cadastrar prisma.');
    } finally {
      setIsSavingPrisma(false);
    }
  };

  const handleTogglePrismaStatus = async (prisma: Prisma) => {
    if (prisma.ativo) {
      setDeactivatingPrisma(prisma);
      setMotivoExtravio('');
    } else {
      try {
        await api.toggleStatusPrisma({
          prismaId: prisma.id,
          ativo: true,
          condominioId,
          usuarioId: adminOrSindicoUser.id,
          usuarioNome: adminOrSindicoUser.nome,
        });
        await carregarPrismas();
        await onRefreshData();
      } catch (err: any) {
        alert(err.message || 'Erro ao reativar prisma.');
      }
    }
  };

  const handleConfirmDeactivation = async () => {
    if (!deactivatingPrisma) return;
    try {
      await api.toggleStatusPrisma({
        prismaId: deactivatingPrisma.id,
        ativo: false,
        motivoInativacao: motivoExtravio.trim() || 'Desativado/Extraviado pela administração',
        condominioId,
        usuarioId: adminOrSindicoUser.id,
        usuarioNome: adminOrSindicoUser.nome,
      });
      await carregarPrismas();
      await onRefreshData();
      setDeactivatingPrisma(null);
      setMotivoExtravio('');
    } catch (err: any) {
      alert(err.message || 'Erro ao inativar prisma.');
    }
  };

  const handleConfirmDeletePrisma = async () => {
    if (!prismaToDelete) return;
    const deletedId = prismaToDelete.id;
    try {
      setIsDeletingPrisma(true);
      setDeletePrismaError(null);
      await api.excluirPrisma({
        prismaId: deletedId,
        usuarioId: adminOrSindicoUser.id,
        usuarioNome: adminOrSindicoUser.nome,
        condominioId,
      });
      // Atualização imediata: remove o card localmente para feedback instantâneo sem card fantasma
      setPrismas((prev) => prev.filter((p) => p.id !== deletedId));
      setPrismaToDelete(null);
      await carregarPrismas();
      await onRefreshData();
    } catch (err: any) {
      setDeletePrismaError(err.message || 'Não foi possível excluir o prisma. Tente novamente.');
    } finally {
      setIsDeletingPrisma(false);
    }
  };

  // ==================== Contatos Handlers ====================
  const handleOpenNewContato = () => {
    setEditingContato(null);
    setContatoNome('');
    setContatoCategoria(CategoriaContato.PORTARIA);
    setContatoTelefone('');
    setContatoIdentificador('');
    setContatoError(null);
    setIsContatoFormOpen(true);
  };

  const handleEditContato = (c: ContatoEvidencia) => {
    setEditingContato(c);
    setContatoNome(c.nome);
    setContatoCategoria(c.categoria);
    setContatoTelefone(c.telefoneOuWhatsapp);
    setContatoIdentificador(c.identificador || '');
    setContatoError(null);
    setIsContatoFormOpen(true);
  };

  const handleSaveContato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contatoNome.trim()) {
      setContatoError('Nome do contato é obrigatório.');
      return;
    }
    if (!contatoTelefone.trim()) {
      setContatoError('Telefone ou WhatsApp é obrigatório.');
      return;
    }

    try {
      setIsSavingContato(true);
      setContatoError(null);

      if (editingContato) {
        await api.editarContato({
          id: editingContato.id,
          nome: contatoNome.trim(),
          categoria: contatoCategoria,
          telefoneOuWhatsapp: contatoTelefone.trim(),
          identificador: contatoIdentificador.trim() || undefined,
          condominioId,
          usuarioId: usuarioAtual.id,
          usuarioNome: usuarioAtual.nome,
        });
      } else {
        await api.cadastrarContato({
          nome: contatoNome.trim(),
          categoria: contatoCategoria,
          telefoneOuWhatsapp: contatoTelefone.trim(),
          identificador: contatoIdentificador.trim() || undefined,
          condominioId,
          usuarioId: usuarioAtual.id,
          usuarioNome: usuarioAtual.nome,
        });
      }

      await carregarContatos();
      setIsContatoFormOpen(false);
    } catch (err: any) {
      setContatoError(err.message || 'Erro ao salvar contato.');
    } finally {
      setIsSavingContato(false);
    }
  };

  const handleToggleContatoStatus = async (c: ContatoEvidencia) => {
    try {
      await api.toggleStatusContato({
        id: c.id,
        ativo: !c.ativo,
        condominioId,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });
      await carregarContatos();
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar status do contato.');
    }
  };

  const handleDeleteContato = async (c: ContatoEvidencia) => {
    if (!window.confirm(`Deseja remover o contato "${c.nome}"?`)) return;
    try {
      await api.excluirContato(c.id, condominioId);
      await carregarContatos();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir contato.');
    }
  };

  // ==================== Condomínio Handlers ====================
  const handleSaveCondominio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!condominioNome.trim()) {
      setCondominioError('O nome do condomínio não pode ficar em branco.');
      return;
    }

    try {
      setIsSavingCondominio(true);
      setCondominioError(null);
      setCondominioSuccessMsg(null);

      const res = await api.atualizarCondominio(condominioId, {
        nome: condominioNome.trim(),
        endereco: condominioEndereco.trim(),
        mostrarMensagem,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });

      if (res.success && res.condominio) {
        try {
          if (res.condominio.nome) {
            localStorage.setItem(`condo_nome_${condominioId}`, res.condominio.nome);
          }
          if (res.condominio.endereco) {
            localStorage.setItem(`condo_endereco_${condominioId}`, res.condominio.endereco);
          }
        } catch {
          // Ignore localStorage errors
        }
        setCondominioSuccessMsg('Informações do condomínio salvas permanentemente com sucesso!');
        await onRefreshData();
        setTimeout(() => setCondominioSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setCondominioError(err.message || 'Erro ao atualizar condomínio.');
    } finally {
      setIsSavingCondominio(false);
    }
  };

  const handleToggleMostrarMensagem = async (novoValor: boolean) => {
    setMostrarMensagem(novoValor);
    try {
      const res = await api.atualizarCondominio(condominioId, {
        nome: condominioNome.trim() || undefined,
        endereco: condominioEndereco.trim() || undefined,
        mostrarMensagem: novoValor,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });
      if (res.success) {
        setCondominioSuccessMsg(
          novoValor
            ? '✓ Cópia automática de mensagens ATIVADA para este condomínio.'
            : '✓ Cópia automática de mensagens DESATIVADA para este condomínio.'
        );
        await onRefreshData();
        setTimeout(() => setCondominioSuccessMsg(null), 3500);
      }
    } catch (err: any) {
      setCondominioError(err.message || 'Erro ao alterar configuração de mensagens.');
      setMostrarMensagem(!novoValor); // Reverter
    }
  };

  // Filters
  const usuariosFiltrados = usuarios.filter((u) => {
    const term = filtroUsuario.toLowerCase();
    return (
      u.nome.toLowerCase().includes(term) ||
      u.cargo.toLowerCase().includes(term) ||
      (u.matricula && u.matricula.toLowerCase().includes(term))
    );
  });

  const prismasFiltrados = useMemo(() => {
    const term = filtroPrisma.toLowerCase();
    const list = prismas.filter((p) => {
      return (
        p.numero.toLowerCase().includes(term) ||
        p.corNome.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term)
      );
    });
    return sortPrismasNumericos(list);
  }, [prismas, filtroPrisma]);

  const contatosFiltrados = contatos.filter((c) => {
    const term = filtroContato.toLowerCase();
    return (
      c.nome.toLowerCase().includes(term) ||
      c.telefoneOuWhatsapp.toLowerCase().includes(term) ||
      c.categoria.toLowerCase().includes(term)
    );
  });

  if (!isOpen || !isAuthorized) return null;

  return (
    <div
      id="modal-configuracoes-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        id="modal-configuracoes-container"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Modal Top Bar */}
        <div className="p-3.5 sm:p-4 bg-slate-800/80 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  CONFIGURAÇÕES DO SISTEMA
                </h2>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-black uppercase">
                  Ambiente DEV
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Gestão completa de Usuários, Prismas, Contatos Diretos e Condomínio
              </p>
            </div>
          </div>

          <button
            id="btn-fechar-configuracoes"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="bg-slate-950 px-3 sm:px-4 border-b border-slate-800 flex items-center justify-between gap-3 overflow-x-auto">
          <div className="flex gap-2 sm:gap-3">
            <button
              id="tab-config-condominios"
              onClick={() => setActiveTab('CONDOMINIOS')}
              className={`flex items-center gap-2 py-3 px-3.5 border-b-2 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'CONDOMINIOS'
                  ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>CONDOMÍNIOS</span>
            </button>
          </div>

          <div className="text-right hidden sm:flex items-center gap-2 py-2">
            <span className="text-[11px] text-slate-400">Contexto Atual:</span>
            <span className="text-xs font-bold text-blue-300 uppercase bg-slate-900 px-2.5 py-1 rounded-md border border-slate-800">
              {condominioNome || 'Condomínio'}
            </span>
          </div>
        </div>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          {/* Sub-Navigation for CONDOMÍNIOS */}
          <div className="bg-slate-950 p-2 sm:p-2.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                id="subtab-condominio-dados"
                onClick={() => setSubTab('DADOS')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  subTab === 'DADOS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>DADOS DO CONDOMÍNIO</span>
              </button>

              <button
                id="subtab-condominio-usuarios"
                onClick={() => setSubTab('USUARIOS')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  subTab === 'USUARIOS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>USUÁRIOS & TURNOS</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                  {usuarios.length}
                </span>
              </button>

              <button
                id="subtab-condominio-prismas"
                onClick={() => setSubTab('PRISMAS')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  subTab === 'PRISMAS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>PRISMAS FÍSICOS</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                  {prismas.length}
                </span>
              </button>

              <button
                id="subtab-condominio-contatos"
                onClick={() => setSubTab('CONTATOS')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  subTab === 'CONTATOS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>CONTATOS DIRETOS</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-300">
                  {contatos.length}
                </span>
              </button>
            </div>
          </div>

          {/* ========================================================
              SUB-TAB 1: DADOS DO CONDOMÍNIO (FONTE OFICIAL) + CÓDIGO DA PORTARIA
             ======================================================== */}
          {subTab === 'DADOS' && (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Card 1: Dados Oficiais do Condomínio */}
              <div className="p-4 sm:p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">
                      DADOS OFICIAIS DO CONDOMÍNIO
                    </h3>
                    <p className="text-xs text-slate-400">
                      Esta é a <strong className="text-blue-300 font-bold">fonte oficial</strong> do nome exibido no cabeçalho operacional.
                    </p>
                  </div>
                </div>

                {condominioSuccessMsg && (
                  <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                    <span>{condominioSuccessMsg}</span>
                  </div>
                )}

                {condominioError && (
                  <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                    <span>{condominioError}</span>
                  </div>
                )}

                <form onSubmit={handleSaveCondominio} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Nome do Condomínio <span className="text-rose-400">*</span>
                    </label>
                    <input
                      id="input-config-nome-condominio"
                      type="text"
                      value={condominioNome}
                      onChange={(e) => setCondominioNome(e.target.value)}
                      placeholder="Nome do condomínio"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none transition-all"
                      required
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Exemplo: "Condomínio Belle Ville" ou "Residencial Bela Vista".
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Endereço Completo / Referência (Opcional)
                    </label>
                    <input
                      id="input-config-endereco-condominio"
                      type="text"
                      value={condominioEndereco}
                      onChange={(e) => setCondominioEndereco(e.target.value)}
                      placeholder="Ex: Rua Santo Agostinho, 419"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none transition-all"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-400" />
                      <span>Sincronizado diretamente com o cabeçalho</span>
                    </div>

                    <button
                      id="btn-salvar-condominio-config"
                      type="submit"
                      disabled={isSavingCondominio}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow cursor-pointer transition-all"
                    >
                      <Check className="w-4 h-4" />
                      <span>{isSavingCondominio ? 'Salvando...' : 'Salvar Alterações'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Card: Mensagens de Entrega e Recolhimento */}
              <div className="p-4 sm:p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">
                        MENSAGENS DE ENTREGA E RECOLHIMENTO
                      </h3>
                      <p className="text-xs text-slate-400">
                        Configuração de cópia automática para a área de transferência deste condomínio.
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center self-start sm:self-auto px-2.5 py-1 text-xs font-black rounded-lg border ${
                      mostrarMensagem
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {mostrarMensagem ? 'MOSTRAR MENSAGEM: ON' : 'MOSTRAR MENSAGEM: OFF'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-900/80 rounded-xl border border-slate-800 gap-4">
                  <div className="space-y-1.5 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">
                        MOSTRAR MENSAGEM
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          mostrarMensagem
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {mostrarMensagem ? 'ATIVADO (ON)' : 'DESATIVADO (OFF)'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Quando ativado, o sistema copiará automaticamente a mensagem de entrega e recolhimento do prisma.
                    </p>
                    <div className="text-[11px] text-slate-400 font-mono pt-1">
                      Exemplos: <span className="text-emerald-400 font-semibold">CASA 426 RETIROU PRISMA 11.</span> • <span className="text-emerald-400 font-semibold">CASA 426 ENTREGOU PRISMA 11.</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="btn-toggle-mostrar-mensagem-config"
                    onClick={() => handleToggleMostrarMensagem(!mostrarMensagem)}
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      mostrarMensagem ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                    role="switch"
                    aria-checked={mostrarMensagem}
                    title="Alternar cópia automática de mensagens"
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        mostrarMensagem ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Card 2: Código de Acesso Exclusivo da Portaria */}
              <div className="p-4 sm:p-5 bg-slate-950 border border-blue-500/30 rounded-2xl space-y-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">
                          CÓDIGO DE ACESSO DA PORTARIA
                        </h3>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          Estação / Condomínio
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Código exclusivo compartilhado para desbloquear o terminal da Portaria deste condomínio.
                      </p>
                    </div>
                  </div>

                  {portariaStatus && (
                    <div>
                      {portariaStatus.bloqueado ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          <Lock className="w-3.5 h-3.5" />
                          BLOQUEADO ({portariaStatus.tentativasInvalidas || 0} erros)
                        </span>
                      ) : portariaStatus.ativo ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          ATIVO / PRONTO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          INATIVO
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {portariaActionMsg && (
                  <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                      <span>{portariaActionMsg}</span>
                    </div>
                    <button
                      onClick={() => setPortariaActionMsg(null)}
                      className="text-emerald-400 hover:text-emerald-200 text-xs font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                )}

                {portariaActionError && (
                  <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                      <span>{portariaActionError}</span>
                    </div>
                    <button
                      onClick={() => setPortariaActionError(null)}
                      className="text-rose-400 hover:text-rose-200 text-xs font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                )}

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Código Atual da Estação
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xl sm:text-2xl font-bold tracking-widest text-blue-400 bg-slate-950 px-4 py-2 rounded-xl border border-slate-700 select-all">
                          {showPortariaCodigo
                            ? portariaStatus?.codigo || 'CP-123456'
                            : '••••••••'}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowPortariaCodigo(!showPortariaCodigo)}
                            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
                            title={showPortariaCodigo ? 'Ocultar código' : 'Revelar código'}
                          >
                            {showPortariaCodigo ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyCodigo(portariaStatus?.codigo || 'CP-123456')}
                            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer text-xs font-semibold"
                            title="Copiar código para a área de transferência"
                          >
                            {codigoCopied ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-400" />
                                <span className="text-emerald-400">Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {usuarioAtual?.role === UserRole.ADMIN && (
                      <div className="flex flex-wrap items-center gap-2">
                        {portariaStatus?.bloqueado && (
                          <button
                            type="button"
                            onClick={handleDesbloquearPortaria}
                            disabled={isDesbloqueandoPortaria}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition-all shadow cursor-pointer disabled:opacity-50"
                          >
                            <Unlock className="w-4 h-4" />
                            <span>{isDesbloqueandoPortaria ? 'Desbloqueando...' : 'Desbloquear Acesso'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setIsConfirmGerarCodigoOpen(true)}
                          disabled={isGerandoCodigo}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Gerar Novo Código</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-blue-950/40 border border-blue-500/20 rounded-xl text-[11px] text-slate-300 leading-relaxed space-y-1">
                    <p className="font-semibold text-blue-300 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-400" />
                      Regra do Modelo Operacional da Portaria:
                    </p>
                    <p className="text-slate-400">
                      • Porteiros <strong>NÃO</strong> utilizam PIN ou login individual.
                    </p>
                    <p className="text-slate-400">
                      • O código acima identifica a <strong>estação do condomínio</strong>. O operador de plantão é reconhecido automaticamente pela escala de trabalho em tempo real.
                    </p>
                    <p className="text-slate-400">
                      • Ao gerar um novo código, o código anterior é <strong>invalidado imediatamente</strong> em todos os terminais.
                    </p>
                  </div>
                </div>
              </div>

              {/* Card 3: Modo de Uso do Dispositivo (PC) */}
              <div className="p-4 sm:p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <Monitor className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                      Modo de Uso deste Dispositivo (PC)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Altere a forma de apresentação da interface neste computador sem apagar nenhum dado ou configuração.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    id="btn-config-modo-portaria"
                    onClick={() => onChangeDeviceMode?.('PORTARIA')}
                    className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                      deviceMode === 'PORTARIA'
                        ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/30'
                        : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        deviceMode === 'PORTARIA'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Monitor className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">
                          🖥️ Modo Portaria (PRISMAS)
                        </span>
                        {deviceMode === 'PORTARIA' && (
                          <span className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px]">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                        Janela compacta (400×680px) arrastável e minimizável para dividir espaço na tela com WhatsApp.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="btn-config-modo-normal"
                    onClick={() => onChangeDeviceMode?.('NORMAL')}
                    className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                      deviceMode === 'NORMAL'
                        ? 'bg-blue-950/70 border-blue-500 ring-2 ring-blue-500/30'
                        : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        deviceMode === 'NORMAL'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">
                          📱 Modo Normal
                        </span>
                        {deviceMode === 'NORMAL' && (
                          <span className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px]">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                        Interface completa com tela cheia para administração ou visualização padrão.
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              SUB-TAB 2: USUÁRIOS & TURNOS
             ======================================================== */}
          {subTab === 'USUARIOS' && (
            <div className="space-y-4">
              {/* Actions Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={filtroUsuario}
                    onChange={(e) => setFiltroUsuario(e.target.value)}
                    placeholder="Filtrar por nome, cargo ou matrícula..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {onOpenAlterarSenha && usuarioAtual?.role === UserRole.SINDICO && (
                    <button
                      type="button"
                      id="btn-alterar-senha-sindico-config"
                      onClick={onOpenAlterarSenha}
                      className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-xs font-bold px-3 py-2 rounded-xl shadow cursor-pointer transition-all"
                      title="Alterar minha senha de acesso"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      <span>ALTERAR MINHA SENHA</span>
                    </button>
                  )}
                  <button
                    id="btn-novo-usuario"
                    onClick={handleOpenNewUser}
                    className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow cursor-pointer transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>CADASTRAR USUÁRIO</span>
                  </button>
                </div>
              </div>

              {/* Form Modal / Inline Form for User */}
              {isUserFormOpen && (
                <div className="p-4 bg-slate-950 border border-blue-500/40 rounded-2xl space-y-3.5 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-400" />
                      <span>{editingUser ? 'EDITAR USUÁRIO & TURNO' : 'NOVO USUÁRIO DA OPERAÇÃO'}</span>
                    </h3>
                    <button
                      onClick={() => setIsUserFormOpen(false)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {userError && (
                    <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{userError}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveUser} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Nome Completo <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={formNome}
                          onChange={(e) => setFormNome(e.target.value)}
                          placeholder="Ex: Carlos Oliveira"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Perfil / Cargo
                        </label>
                        <select
                          value={formRole}
                          onChange={(e) => {
                            const r = e.target.value as UserRole;
                            setFormRole(r);
                            if (r === UserRole.PORTEIRO) setFormCargo('Porteiro');
                            else if (r === UserRole.SINDICO) setFormCargo('Síndico');
                            else setFormCargo('Administrador');
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none cursor-pointer"
                        >
                          <option value={UserRole.PORTEIRO}>Porteiro (Operacional)</option>
                          <option value={UserRole.SINDICO}>Síndico (Gestão)</option>
                          <option value={UserRole.ADMIN}>Administrador (Controle Total)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Matrícula / ID Interno (Opcional)
                        </label>
                        <input
                          type="text"
                          value={formMatricula}
                          onChange={(e) => setFormMatricula(e.target.value)}
                          placeholder="Ex: P-101"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Credencial de Acesso ao Sistema (Perfil SÍNDICO) */}
                    {!editingUser && formRole === UserRole.SINDICO && (
                      <div className="p-3.5 bg-slate-900/90 border border-blue-500/40 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-blue-300 flex items-center gap-1.5 uppercase tracking-wider">
                            <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                            <span>Credencial de Acesso ao Sistema</span>
                          </label>
                          <span className="text-[11px] text-slate-400">
                            Acesso individual para gestão e auditoria
                          </span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                            Identificador / Usuário de Login <span className="text-rose-400">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-sindico-identificador"
                            value={formIdentificador}
                            onChange={(e) => setFormIdentificador(e.target.value)}
                            placeholder="Ex: sindico.belleville"
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                            required
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Identificador único utilizado no login (aba ADMIN / SÍNDICO).
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                              Senha Inicial <span className="text-rose-400">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type={showFormPassword ? 'text' : 'password'}
                                id="input-sindico-senha-inicial"
                                value={formSenhaInicial}
                                onChange={(e) => setFormSenhaInicial(e.target.value)}
                                placeholder="Mínimo 8 caracteres"
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => setShowFormPassword(!showFormPassword)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                                title={showFormPassword ? 'Ocultar senha' : 'Ver senha'}
                              >
                                {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                              Confirmar Senha <span className="text-rose-400">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type={showFormPassword ? 'text' : 'password'}
                                id="input-sindico-confirmar-senha"
                                value={formConfirmarSenha}
                                onChange={(e) => setFormConfirmarSenha(e.target.value)}
                                placeholder="Repita a senha inicial"
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                                required
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Shift / Plantão Configuration */}
                    <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wider">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Configuração de Turno / Plantão Operacional</span>
                        </label>
                        <span className="text-[11px] text-slate-400">
                          Utilizado na identificação automática do operador
                        </span>
                      </div>

                      {/* Tipo de Turno Selector */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFormTipoTurno(TipoTurno.TURNO_12X36);
                            handleSelect12x36Option(formOpcao12x36 || '07:00-19:00');
                          }}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            formTipoTurno === TipoTurno.TURNO_12X36
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold">12x36</div>
                          <div className="text-[10px] text-slate-400">Opções padronizadas</div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFormTipoTurno(TipoTurno.COMERCIAL);
                            setFormHoraInicio('08:00');
                            setFormHoraFim('18:00');
                          }}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            formTipoTurno === TipoTurno.COMERCIAL
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold">COMERCIAL</div>
                          <div className="text-[10px] text-slate-400">Horário flexível de expediente</div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFormTipoTurno(TipoTurno.PERSONALIZADO);
                          }}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            formTipoTurno === TipoTurno.PERSONALIZADO
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold">PERSONALIZADO</div>
                          <div className="text-[10px] text-slate-400">Qualquer horário específico</div>
                        </button>
                      </div>

                      {/* 12x36 Sub-Options */}
                      {formTipoTurno === TipoTurno.TURNO_12X36 && (
                        <div className="space-y-3 pt-1">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Selecione a escala de horário 12x36:
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {OPCOES_12X36.map((op) => (
                                <button
                                  key={op.id}
                                  type="button"
                                  onClick={() => handleSelect12x36Option(op.id)}
                                  className={`p-2 rounded-lg border text-left text-xs transition-all flex items-center justify-between cursor-pointer ${
                                    formOpcao12x36 === op.id
                                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 font-bold'
                                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                                  }`}
                                >
                                  <span>{op.label}</span>
                                  {op.atravessaMeiaNoite ? (
                                    <Moon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                                  ) : (
                                    <Sun className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* DIA DO PLANTÃO (PARIDADE DO CALENDÁRIO) */}
                          <div className="p-3 bg-slate-950 border border-amber-500/30 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                                <span>DIA DO PLANTÃO (PARIDADE)</span>
                                <span className="text-rose-400">*</span>
                              </label>
                              <span className="text-[10px] text-slate-400">
                                Baseado no dia do calendário
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <button
                                id="btn-select-dias-impares"
                                type="button"
                                onClick={() => setFormParidade12x36(Paridade12x36.IMPAR)}
                                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                  formParidade12x36 === Paridade12x36.IMPAR
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-100 ring-2 ring-amber-500/50 shadow-md font-bold'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                }`}
                              >
                                <div className="text-xs flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${formParidade12x36 === Paridade12x36.IMPAR ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
                                  <span>DIAS ÍMPARES</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">
                                  Plantão nos dias 19, 21, 23, 25, 27, 29, 31, 01...
                                </div>
                              </button>

                              <button
                                id="btn-select-dias-pares"
                                type="button"
                                onClick={() => setFormParidade12x36(Paridade12x36.PAR)}
                                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                  formParidade12x36 === Paridade12x36.PAR
                                    ? 'bg-blue-500/20 border-blue-400 text-blue-100 ring-2 ring-blue-500/50 shadow-md font-bold'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                }`}
                              >
                                <div className="text-xs flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${formParidade12x36 === Paridade12x36.PAR ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`} />
                                  <span>DIAS PARES</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">
                                  Plantão nos dias 20, 22, 24, 26, 28, 30, 02...
                                </div>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Configurable Start / End times for Comercial & Personalizado */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                            Horário de Início (HH:MM) <span className="text-rose-400">*</span>
                          </label>
                          <input
                            type="time"
                            value={formHoraInicio}
                            onChange={(e) => setFormHoraInicio(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                            Horário de Término (HH:MM) <span className="text-rose-400">*</span>
                          </label>
                          <input
                            type="time"
                            value={formHoraFim}
                            onChange={(e) => setFormHoraFim(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                            required
                          />
                        </div>
                      </div>

                      {formHoraInicio && formHoraFim && formHoraInicio > formHoraFim && (
                        <div className="p-2 bg-indigo-950/40 border border-indigo-700/50 rounded-lg text-[11px] text-indigo-300 flex items-center gap-2">
                          <Moon className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                          <span>
                            Turno noturno detectado: atravessa a meia-noite ({formHoraInicio} às {formHoraFim}).
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsUserFormOpen(false)}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-semibold cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingUser}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow cursor-pointer transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isSavingUser ? 'Salvando...' : 'Salvar Usuário'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Users List */}
              <div className="space-y-2">
                {loadingUsuarios ? (
                  <div className="p-8 text-center text-xs text-slate-400">Carregando usuários...</div>
                ) : usuariosFiltrados.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 bg-slate-950 rounded-2xl border border-slate-800">
                    Nenhum usuário encontrado com os filtros atuais.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {usuariosFiltrados.map((u) => {
                      const isNoturno = u.horaInicio && u.horaFim && u.horaInicio > u.horaFim;
                      return (
                        <div
                          key={u.id}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            u.ativo
                              ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                              : 'bg-slate-950/30 border-slate-900 opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs sm:text-sm text-white">
                                  {u.nome}
                                </span>
                                {u.matricula && (
                                  <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                                    {u.matricula}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    u.role === UserRole.PORTEIRO
                                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                      : u.role === UserRole.SINDICO
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  }`}
                                >
                                  {u.role}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">{u.cargo}</p>
                            </div>

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                u.ativo
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {u.ativo ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </div>

                          {/* Turno Info Badge */}
                          <div className="mt-2.5 pt-2 border-t border-slate-900 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                              {isNoturno ? (
                                <Moon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                              ) : (
                                <Sun className="w-3 h-3 text-amber-400 flex-shrink-0" />
                              )}
                              <span className="font-semibold text-slate-200">
                                {u.tipoTurno || '12x36'}:
                              </span>
                              <span className="text-amber-300 font-mono font-semibold">
                                {u.horaInicio && u.horaFim
                                  ? `${u.horaInicio} às ${u.horaFim}`
                                  : 'Horário não configurado'}
                              </span>
                              {u.tipoTurno === TipoTurno.TURNO_12X36 && u.paridade12x36 && (
                                <span
                                  className={`text-[9px] px-1.5 py-0.2 rounded font-black tracking-wide uppercase ${
                                    u.paridade12x36 === Paridade12x36.IMPAR
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  }`}
                                >
                                  {u.paridade12x36 === Paridade12x36.IMPAR ? 'DIAS ÍMPARES' : 'DIAS PARES'}
                                </span>
                              )}
                              {isNoturno && (
                                <span className="text-[9px] text-indigo-300 bg-indigo-950/70 px-1 py-0.2 rounded font-bold">
                                  Noturno
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleEditUser(u)}
                                className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="Editar Usuário"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleUserStatus(u)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  u.ativo
                                    ? 'text-amber-400 hover:bg-amber-950/50'
                                    : 'text-emerald-400 hover:bg-emerald-950/50'
                                }`}
                                title={u.ativo ? 'Desativar Usuário' : 'Ativar Usuário'}
                              >
                                {u.ativo ? (
                                  <UserX className="w-3.5 h-3.5" />
                                ) : (
                                  <UserCheck className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setUserToDelete(u);
                                  setDeleteUserError(null);
                                }}
                                className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                                title="Excluir Usuário"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================
              SUB-TAB 3: PRISMAS FÍSICOS
             ======================================================== */}
          {subTab === 'PRISMAS' && (
            <div className="space-y-4">
              {/* Actions Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={filtroPrisma}
                    onChange={(e) => setFiltroPrisma(e.target.value)}
                    placeholder="Filtrar por número ou cor..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <button
                  id="btn-novo-prisma"
                  onClick={() => {
                    setPrismaError(null);
                    setIsPrismaFormOpen(true);
                  }}
                  className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow cursor-pointer transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>CADASTRAR NOVO PRISMA</span>
                </button>
              </div>

              {/* Form Modal / Inline Form for Prisma */}
              {isPrismaFormOpen && (
                <div className="p-4 bg-slate-950 border border-blue-500/40 rounded-2xl space-y-3.5 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" />
                      <span>CADASTRAR PRISMA FÍSICO (NÚMERO + COR)</span>
                    </h3>
                    <button
                      onClick={() => setIsPrismaFormOpen(false)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {prismaError && (
                    <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{prismaError}</span>
                    </div>
                  )}

                  <form onSubmit={handleSavePrisma} className="space-y-4">
                    {/* Number selection */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        1. Selecione o Número (Base 01 a 30) ou Digite outro
                      </label>
                      <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-slate-900 rounded-xl border border-slate-800">
                        {quickNumbers.map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => {
                              setSelectedNumero(num);
                              setCustomNumero('');
                            }}
                            className={`py-1.5 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                              selectedNumero === num && !customNumero
                                ? 'bg-blue-600 text-white shadow'
                                : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Ou número personalizado:</span>
                        <input
                          type="text"
                          value={customNumero}
                          onChange={(e) => setCustomNumero(e.target.value)}
                          placeholder="Ex: 35, 102"
                          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Color selection */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        2. Selecione a Cor do Prisma Físico
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {CORES_DISPONIVEIS.map((cor) => (
                          <button
                            key={cor.id}
                            type="button"
                            onClick={() => setSelectedCorId(cor.id)}
                            className={`p-2 rounded-xl border flex items-center gap-2.5 text-xs font-bold transition-all cursor-pointer ${
                              selectedCorId === cor.id
                                ? 'bg-slate-800 border-blue-500 text-white shadow-md'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            <span
                              className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                              style={{ backgroundColor: cor.hex }}
                            />
                            <span>{cor.nome}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Preview */}
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div className="text-xs text-slate-400">
                        Identidade do Prisma a ser criado:
                        <span className="block text-sm font-bold text-white mt-0.5">
                          Prisma {customNumero || selectedNumero} - {getCorConfig(selectedCorId).nome}
                        </span>
                      </div>
                      <PrismaVisual
                        numero={customNumero || selectedNumero}
                        corId={selectedCorId}
                        size="md"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsPrismaFormOpen(false)}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-semibold cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingPrisma}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow cursor-pointer transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isSavingPrisma ? 'Salvando...' : 'Salvar Prisma'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Deactivation Modal Prompt */}
              {deactivatingPrisma && (
                <div className="p-4 bg-rose-950/40 border border-rose-700/60 rounded-2xl space-y-3 shadow-xl">
                  <div className="flex items-center gap-2 text-rose-300 font-bold text-xs sm:text-sm">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>
                      Inativar Prisma {deactivatingPrisma.numero} ({deactivatingPrisma.corNome})?
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    O prisma não ficará mais disponível para novas entregas, mas todo o seu histórico
                    passado será 100% preservado.
                  </p>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Motivo da Inativação (Ex: Extraviado, Quebrado, Desativado):
                    </label>
                    <input
                      type="text"
                      value={motivoExtravio}
                      onChange={(e) => setMotivoExtravio(e.target.value)}
                      placeholder="Ex: Prisma danificado em manutenção"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDeactivatingPrisma(null)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmDeactivation}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow cursor-pointer"
                    >
                      Confirmar Inativação
                    </button>
                  </div>
                </div>
              )}

              {/* Modal de Confirmação de Exclusão de Prisma (Restrito a Administrador e Síndico) */}
              {prismaToDelete && (
                <div className="p-4 bg-rose-950/50 border border-rose-600/70 rounded-2xl space-y-3.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-rose-800/40 pb-2">
                    <div className="flex items-center gap-2 text-rose-300 font-bold text-xs sm:text-sm">
                      <Trash2 className="w-4 h-4 text-rose-400" />
                      <span>EXCLUIR PRISMA DA CONFIGURAÇÃO FÍSICA?</span>
                    </div>
                    <button
                      onClick={() => {
                        if (!isDeletingPrisma) {
                          setPrismaToDelete(null);
                          setDeletePrismaError(null);
                        }
                      }}
                      className="text-slate-400 hover:text-white text-xs p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {deletePrismaError && (
                    <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{deletePrismaError}</span>
                    </div>
                  )}

                  <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400">Identificação do Prisma a ser excluído:</div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Prisma {prismaToDelete.numero}</span>
                        <span
                          className="w-3 h-3 rounded-full border border-white/30"
                          style={{ backgroundColor: getCorConfig(prismaToDelete.corId).hex }}
                        />
                        <span className="text-slate-300">({prismaToDelete.corNome})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">ID: {prismaToDelete.id}</div>
                    </div>
                    <PrismaVisual numero={prismaToDelete.numero} corId={prismaToDelete.corId} size="md" />
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-950/70 p-3 rounded-xl border border-rose-900/40 space-y-1">
                    <p className="font-semibold text-rose-200">
                      ⚠️ Este prisma será removido da configuração do condomínio.
                    </p>
                    <p className="text-slate-400 text-[11px]">
                      Caso este prisma possua movimentações, fotos ou histórico passado, todos os registros anteriores permanecerão 100% preservados e auditáveis no sistema.
                    </p>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isDeletingPrisma}
                      onClick={() => {
                        setPrismaToDelete(null);
                        setDeletePrismaError(null);
                      }}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs rounded-xl font-semibold cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={isDeletingPrisma}
                      onClick={handleConfirmDeletePrisma}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg cursor-pointer transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isDeletingPrisma ? 'Excluindo...' : 'Excluir'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Prismas Grid */}
              <div className="space-y-2">
                {loadingPrismas ? (
                  <div className="p-8 text-center text-xs text-slate-400">Carregando prismas...</div>
                ) : prismasFiltrados.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 bg-slate-950 rounded-2xl border border-slate-800">
                    Nenhum prisma encontrado com os filtros atuais.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {prismasFiltrados.map((p) => {
                      const cor = getCorConfig(p.corId);
                      return (
                        <div
                          key={p.id}
                          className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                            p.ativo
                              ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                              : 'bg-slate-950/30 border-slate-900 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <PrismaVisual numero={p.numero} corId={p.corId} size="sm" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm text-white">
                                  Prisma {p.numero}
                                </span>
                                <span
                                  className="w-2.5 h-2.5 rounded-full border border-white/20"
                                  style={{ backgroundColor: cor.hex }}
                                  title={p.corNome}
                                />
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                ID: {p.id} • {p.corNome}
                              </div>
                              {!p.ativo && p.motivoInativacao && (
                                <div className="text-[10px] text-rose-400 italic mt-0.5">
                                  {p.motivoInativacao}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {onOpenHistoricoById && (
                              <button
                                onClick={() => onOpenHistoricoById(p.id)}
                                className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="Ver Histórico do Prisma"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => handleTogglePrismaStatus(p)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                p.ativo
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30'
                              }`}
                              title={p.ativo ? 'Clique para inativar' : 'Clique para reativar'}
                            >
                              {p.ativo ? 'ATIVO' : 'INATIVO'}
                            </button>

                            {canGerenciarExclusaoPrisma && (
                              <button
                                id={`btn-excluir-prisma-${p.id}`}
                                onClick={() => {
                                  setDeletePrismaError(null);
                                  setPrismaToDelete(p);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-400 bg-slate-900 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                                title="Excluir Prisma Físico (Administrador / Síndico)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================
              SUB-TAB 4: CONTATOS DIRETOS
             ======================================================== */}
          {subTab === 'CONTATOS' && (
            <div className="space-y-4">
              {/* Actions Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={filtroContato}
                    onChange={(e) => setFiltroContato(e.target.value)}
                    placeholder="Filtrar contatos ou números..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <button
                  id="btn-novo-contato"
                  onClick={handleOpenNewContato}
                  className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow cursor-pointer transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>CADASTRAR CONTATO DIRETO</span>
                </button>
              </div>

              {/* Form Modal / Inline Form for Contact */}
              {isContatoFormOpen && (
                <div className="p-4 bg-slate-950 border border-blue-500/40 rounded-2xl space-y-3.5 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <Phone className="w-4 h-4 text-blue-400" />
                      <span>{editingContato ? 'EDITAR CONTATO DIRETO' : 'NOVO CONTATO DIRETO'}</span>
                    </h3>
                    <button
                      onClick={() => setIsContatoFormOpen(false)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {contatoError && (
                    <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{contatoError}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveContato} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Nome do Contato ou Grupo <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={contatoNome}
                          onChange={(e) => setContatoNome(e.target.value)}
                          placeholder="Ex: Síndica Marina / Grupo Segurança Portaria"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Categoria
                        </label>
                        <select
                          value={contatoCategoria}
                          onChange={(e) => setContatoCategoria(e.target.value as CategoriaContato)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none cursor-pointer"
                        >
                          <option value={CategoriaContato.SINDICO}>Síndico(a)</option>
                          <option value={CategoriaContato.PORTARIA}>Portaria</option>
                          <option value={CategoriaContato.GRUPO_PORTARIA}>Grupo da Portaria (WhatsApp)</option>
                          <option value={CategoriaContato.OUTRO}>Outro Contato</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Telefone / WhatsApp <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={contatoTelefone}
                          onChange={(e) => setContatoTelefone(e.target.value)}
                          placeholder="Ex: (11) 98765-4321 ou +5511987654321"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Identificador / Observação (Opcional)
                        </label>
                        <input
                          type="text"
                          value={contatoIdentificador}
                          onChange={(e) => setContatoIdentificador(e.target.value)}
                          placeholder="Ex: @grupo_seguranca_noturno"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsContatoFormOpen(false)}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-semibold cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingContato}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow cursor-pointer transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isSavingContato ? 'Salvando...' : 'Salvar Contato'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Contatos List */}
              <div className="space-y-2">
                {loadingContatos ? (
                  <div className="p-8 text-center text-xs text-slate-400">Carregando contatos...</div>
                ) : contatosFiltrados.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 bg-slate-950 rounded-2xl border border-slate-800">
                    Nenhum contato cadastrado.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {contatosFiltrados.map((c) => (
                      <div
                        key={c.id}
                        className={`p-3.5 rounded-2xl border transition-all ${
                          c.ativo
                            ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                            : 'bg-slate-950/30 border-slate-900 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs sm:text-sm text-white">
                                {c.nome}
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  c.categoria === CategoriaContato.SINDICO
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : c.categoria === CategoriaContato.GRUPO_PORTARIA
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}
                              >
                                {c.categoria === CategoriaContato.SINDICO
                                  ? 'Síndico'
                                  : c.categoria === CategoriaContato.GRUPO_PORTARIA
                                  ? 'Grupo Portaria'
                                  : 'Portaria'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-slate-300 font-mono">
                              <MessageSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              <span>{c.telefoneOuWhatsapp}</span>
                              {c.identificador && (
                                <span className="text-[10px] text-slate-400 font-sans">
                                  ({c.identificador})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleToggleContatoStatus(c)}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                c.ativo
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                              title={c.ativo ? 'Desativar Contato' : 'Ativar Contato'}
                            >
                              {c.ativo ? 'ATIVO' : 'INATIVO'}
                            </button>

                            <button
                              onClick={() => handleEditContato(c)}
                              className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                              title="Editar Contato"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleDeleteContato(c)}
                              className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                              title="Excluir Contato"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================
            MODAL DE CONFIRMAÇÃO DE GERAÇÃO DE NOVO CÓDIGO DA PORTARIA
           ======================================================== */}
        {isConfirmGerarCodigoOpen && usuarioAtual?.role === UserRole.ADMIN && (
          <div
            id="modal-confirmar-gerar-codigo-portaria"
            className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in"
          >
            <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="bg-amber-950/80 border-b border-amber-800/60 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-amber-300">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Gerar Novo Código de Portaria</h3>
                    <p className="text-[11px] text-amber-300">Confirmação de Segurança</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsConfirmGerarCodigoOpen(false)}
                  disabled={isGerandoCodigo}
                  className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs text-slate-300">
                <p className="leading-relaxed">
                  Tem certeza que deseja gerar um novo código de acesso para a Portaria deste condomínio?
                </p>

                <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-[11px] space-y-1.5">
                  <p className="font-bold flex items-center gap-1.5 text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    Atenção: Invalidação Imediata
                  </p>
                  <p>
                    • O código de acesso atual da portaria será <strong>invalidado imediatamente</strong>.
                  </p>
                  <p>
                    • Qualquer terminal de portaria que tentar entrar com o código antigo será recusado.
                  </p>
                  <p>
                    • A equipe da portaria precisará utilizar o <strong>novo código gerado</strong> para abrir a estação.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsConfirmGerarCodigoOpen(false)}
                  disabled={isGerandoCodigo}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleGerarNovoCodigo}
                  disabled={isGerandoCodigo}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
                >
                  {isGerandoCodigo ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Gerando...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>GERAR NOVO CÓDIGO</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            MODAL DE SUCESSO: NOVO CÓDIGO DA PORTARIA GERADO
           ======================================================== */}
        {codigoGeradoModal && (
          <div
            id="modal-sucesso-codigo-portaria-gerado"
            className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in"
          >
            <div className="w-full max-w-md bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="bg-emerald-950/90 border-b border-emerald-800/60 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-emerald-300">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Novo Código da Portaria Criado!</h3>
                    <p className="text-[11px] text-emerald-300">Acesso da estação atualizado</p>
                  </div>
                </div>
                <button
                  onClick={() => setCodigoGeradoModal(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 text-center space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  O novo código de acesso exclusivo da Portaria para este condomínio é:
                </p>

                <div className="bg-slate-950 border border-emerald-500/40 p-4 rounded-2xl shadow-inner inline-flex flex-col items-center gap-2 w-full">
                  <span className="font-mono text-3xl font-extrabold tracking-widest text-emerald-400 select-all">
                    {codigoGeradoModal}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Código Compartilhado da Estação
                  </span>
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => handleCopyCodigo(codigoGeradoModal)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg cursor-pointer transition-all"
                  >
                    {codigoCopied ? (
                      <>
                        <Check className="w-4 h-4 text-white" />
                        <span>Copiado com Sucesso!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar Novo Código</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-normal">
                  Informe este código aos porteiros e operadores do condomínio para realizarem o acesso ao terminal.
                </p>
              </div>

              <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setCodigoGeradoModal(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE USUÁRIO
           ======================================================== */}
        {userToDelete && (
          <div
            id="modal-confirmar-exclusao-usuario"
            className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in"
          >
            <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="bg-rose-950/80 border-b border-rose-800/60 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-rose-300">
                  <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Excluir Usuário</h3>
                    <p className="text-[11px] text-rose-300">Confirmação de segurança</p>
                  </div>
                </div>
                <button
                  onClick={() => setUserToDelete(null)}
                  disabled={isDeletingUser}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs text-slate-300">
                {deleteUserError && (
                  <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{deleteUserError}</span>
                  </div>
                )}

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
                  <div className="font-bold text-white text-sm">{userToDelete.nome}</div>
                  <div className="text-slate-400 text-[11px]">
                    Cargo: <strong className="text-slate-300">{userToDelete.role}</strong>
                    {userToDelete.turnoNome && (
                      <span> • Turno: {userToDelete.turnoNome} ({userToDelete.horaInicio} - {userToDelete.horaFim})</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-[11px] space-y-1">
                  <p className="font-bold flex items-center gap-1.5 text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Integridade de Auditoria Preservada:
                  </p>
                  <p>
                    O usuário será removido da lista de operadores ativos. Todo o histórico de turnos, entregas, recolhimentos e registros de auditoria permanecerá <strong>100% íntegro e arquivado</strong> para consultas fiscais e administrativas.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setUserToDelete(null)}
                  disabled={isDeletingUser}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  id="btn-confirmar-excluir-usuario-modal"
                  type="button"
                  onClick={handleConfirmDeleteUser}
                  disabled={isDeletingUser}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
                >
                  {isDeletingUser ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Excluindo...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>CONFIRMAR EXCLUSÃO</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
