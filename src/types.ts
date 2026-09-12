export enum PrismaEstado {
  DISPONIVEL = 'DISPONIVEL',
  EM_USO = 'EM_USO',
  PENDENTE = 'PENDENTE',
  INDISPONIVEL = 'INDISPONIVEL',
}

export enum MovimentacaoTipo {
  ENTREGA = 'ENTREGA',
  DEVOLUCAO = 'DEVOLUCAO',
  PENDENCIA_ABERTA = 'PENDENCIA_ABERTA',
  PENDENCIA_RESOLVIDA = 'PENDENCIA_RESOLVIDA',
  INDISPONIBILIDADE = 'INDISPONIBILIDADE',
  CORRECAO = 'CORRECAO',
}

export enum UserRole {
  PORTEIRO = 'PORTEIRO',
  SINDICO = 'SINDICO',
  ADMIN = 'ADMIN',
}

export enum TipoTurno {
  TURNO_12X36 = '12X36',
  COMERCIAL = 'COMERCIAL',
  PERSONALIZADO = 'PERSONALIZADO',
}

export enum TipoAcesso {
  PORTARIA = 'PORTARIA',
  ADMIN = 'ADMIN',
  SINDICO = 'SINDICO',
}

export enum TipoSessao {
  PORTARIA = 'PORTARIA',
  ADMIN = 'ADMIN',
  SINDICO = 'SINDICO',
}

export const DEFAULT_PORTARIA_STATION_ID = 'PORTARIA-01';

export enum Paridade12x36 {
  IMPAR = 'IMPAR', // DIAS ÍMPARES (ex: 19, 21, 23, 25...)
  PAR = 'PAR',     // DIAS PARES (ex: 20, 22, 24, 26...)
}

export enum CategoriaContato {
  SINDICO = 'SINDICO',
  PORTARIA = 'PORTARIA',
  GRUPO_PORTARIA = 'GRUPO_PORTARIA',
  OUTRO = 'OUTRO',
}

export interface ContatoEvidencia {
  id: string;
  condominioId: string;
  nome: string;
  categoria: CategoriaContato;
  telefoneOuWhatsapp: string;
  identificador?: string;
  ativo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type OperadorStatus = 'OK' | 'SEM_PORTEIRO' | 'CONFLITO';

export interface OperadorIdentificado {
  status: OperadorStatus;
  operador?: Usuario;
  conflitoUsuarios?: Usuario[];
  mensagem?: string;
  horarioAtual: string; // "HH:MM"
}

export interface CorConfig {
  id: string;
  nome: string;
  hex: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  badgeBg: string;
}

export interface Prisma {
  id: string; // Ex: PR-000001 (técnico único)
  numero: string; // Ex: "08", "11", "15" (pode repetir com cor diferente)
  corId: string; // Ex: "azul", "vermelho", "amarelo", "verde"
  corNome: string; // Ex: "Azul", "Vermelho", "Amarelo", "Verde"
  estado: PrismaEstado;
  condominioId: string;
  ativo: boolean; // ATIVO / INATIVO (ex: extraviado/desativado)
  excluido?: boolean; // Exclusão lógica para preservação de histórico
  dataExclusao?: string;
  usuarioExclusaoId?: string;
  usuarioExclusaoNome?: string;
  motivoInativacao?: string;
  observacao?: string;
  movimentacaoAtualId?: string;
  casaAtual?: string;
  horarioEntregaAtual?: string;
  porteiroEntregaAtual?: string;
  fotoEntregaAtual?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Movimentacao {
  id: string;
  condominioId: string;
  prismaId: string;
  prismaNumero: string;
  prismaCorNome: string;
  tipo: MovimentacaoTipo;
  casa: string;
  usuarioId: string;
  usuarioNome: string;
  turnoId: string;
  turnoNome: string;
  dataHora: string;
  fotoEvidenciaUrl?: string;
  estadoAnterior: PrismaEstado;
  estadoPosterior: PrismaEstado;
  movimentacaoAnteriorId?: string;
  encerrada: boolean;
  dataHoraEncerramento?: string;
  usuarioEncerramentoId?: string;
  usuarioEncerramentoNome?: string;
  motivoCorrecao?: string;
  motivoPendencia?: string;
}

export interface AuditoriaLog {
  id: string;
  condominioId: string;
  acao: string;
  prismaId?: string;
  prismaNumero?: string;
  prismaCorNome?: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioCargo: string;
  turnoId: string;
  turnoNome: string;
  dataHora: string;
  detalhes: string;
  dadosAnteriores?: any;
  dadosNovos?: any;
}

export interface Turno {
  id: string;
  condominioId: string;
  nome: string; // Ex: "Turno Diurno (06h - 18h)"
  porteiroId: string;
  porteiroNome: string;
  inicio: string;
  fim?: string;
  ativo: boolean;
  prismasEmUsoNaAssuncao: number;
  notasPassagem?: string;
}

export interface Usuario {
  id: string;
  condominioId: string;
  nome: string;
  role: UserRole;
  cargo: string;
  ativo: boolean;
  matricula?: string;
  tipoTurno?: TipoTurno;
  opcaoTurno12x36?: string; // Ex: "07:00-19:00", "08:00-20:00", "19:00-07:00", "06:00-18:00", "18:00-06:00"
  paridade12x36?: Paridade12x36; // 'IMPAR' | 'PAR'
  horaInicio?: string; // "HH:MM", ex: "07:00"
  horaFim?: string; // "HH:MM", ex: "19:00"
  excluido?: boolean; // Exclusão lógica / arquivamento com preservação do histórico
  createdAt?: string;
  updatedAt?: string;
}

export interface Condominio {
  id: string;
  nome: string;
  endereco: string;
  codigoPortariaAtual?: string | null;
  mostrarMensagem?: boolean;
  ativo?: boolean;
}

export interface DashboardStats {
  disponiveis: number;
  emUso: number;
  pendentes: number;
  indisponiveis: number;
  totalPrismas: number;
}

export interface CredencialAcesso {
  id: string;
  usuarioId: string;
  condominioId: string;
  tipoAcesso: TipoAcesso;
  identificador: string;
  senhaHash?: string | null;
  pinHash?: string | null;
  ativo: boolean;
  bloqueado: boolean;
  tentativasInvalidas: number;
  ultimoLogin?: string | null;
  ultimoBloqueio?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CredencialAcessoSanitizada {
  id: string;
  usuarioId: string;
  condominioId: string;
  tipoAcesso: TipoAcesso;
  identificador: string;
  ativo: boolean;
  bloqueado: boolean;
  tentativasInvalidas: number;
  ultimoLogin?: string | null;
  ultimoBloqueio?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface JwtSessionPayload {
  sub: string; // usuarioId
  condominioId: string;
  role: UserRole;
  tipoSessao: TipoSessao;
  stationId?: string;
  nome: string;
  iat?: number;
  exp?: number;
}

export interface SubstituicaoPlantao {
  condominioId: string;
  usuarioId: string;
  usuarioNome: string;
  substituidoPorId?: string;
  substituidoPorNome?: string;
  motivo?: string;
  inicio: string;
}

export interface PlantaoStatusResponse {
  status: OperadorStatus;
  operadorEscala?: Usuario;
  operadorAtivo?: {
    id: string;
    nome: string;
    cargo?: string;
    horaInicio?: string;
    horaFim?: string;
    isSubstituicao: boolean;
    motivoSubstituicao?: string;
  };
  substituicaoAtiva?: SubstituicaoPlantao | null;
  horarioAtual: string;
  mensagem?: string;
}

export interface AuthUserContext {
  usuarioId: string;
  condominioId: string;
  role: UserRole;
  nome: string;
  tipoSessao: TipoSessao;
  stationId?: string;
}

export interface PortariaStatusResponse {
  success: boolean;
  codigo: string;
  ativo: boolean;
  bloqueado: boolean;
  tentativasInvalidas: number;
  ultimoLogin?: string | null;
  condominioId: string;
}

export interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}

export interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
  onenter: ((this: DocumentPictureInPicture, ev: Event) => any) | null;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}


