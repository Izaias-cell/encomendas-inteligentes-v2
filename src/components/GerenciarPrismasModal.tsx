import React, { useState } from 'react';
import { Prisma, PrismaEstado, Usuario } from '../types';
import { CORES_DISPONIVEIS, getCorConfig } from '../constants/cores';
import { PrismaVisual } from './PrismaVisual';
import { api } from '../services/api';
import { sortPrismasNumericos } from '../utils/prismaSort';
import {
  X,
  PlusCircle,
  Ban,
  CheckCircle,
  AlertCircle,
  Layers,
  Wrench,
  Trash2,
} from 'lucide-react';

interface GerenciarPrismasModalProps {
  isOpen: boolean;
  onClose: () => void;
  prismas: Prisma[];
  condominioId: string;
  usuarioAtual: Usuario;
  onUpdateSuccess: () => void;
}

export const GerenciarPrismasModal: React.FC<GerenciarPrismasModalProps> = ({
  isOpen,
  onClose,
  prismas,
  condominioId,
  usuarioAtual,
  onUpdateSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'LISTA' | 'NOVO'>('LISTA');
  const [tipoCadastro, setTipoCadastro] = useState<'INDIVIDUAL' | 'LOTE'>('INDIVIDUAL');
  const [novoNumero, setNovoNumero] = useState('');
  const [novaCorId, setNovaCorId] = useState('azul');
  const [loteNumeroInicial, setLoteNumeroInicial] = useState('1');
  const [loteQuantidade, setLoteQuantidade] = useState('40');
  const [loteCorId, setLoteCorId] = useState('azul');
  const [lotePadZero, setLotePadZero] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [prismaToDelete, setPrismaToDelete] = useState<Prisma | null>(null);
  const [isDeletingPrisma, setIsDeletingPrisma] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCadastrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNumero.trim()) {
      setErrorMessage('Informe o número do prisma.');
      return;
    }

    const corObj = CORES_DISPONIVEIS.find((c) => c.id === novaCorId) || CORES_DISPONIVEIS[0];

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.cadastrarPrisma({
        numero: novoNumero.trim(),
        corId: corObj.id,
        corNome: corObj.nome,
        condominioId,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });

      setSuccessMessage(`Prisma ${novoNumero} ${corObj.nome} cadastrado com sucesso!`);
      setNovoNumero('');
      onUpdateSuccess();
      setTimeout(() => {
        setActiveTab('LISTA');
        setSuccessMessage(null);
      }, 1200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao cadastrar prisma.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCadastrarLote = async (e: React.FormEvent) => {
    e.preventDefault();
    const numInicio = parseInt(loteNumeroInicial.trim(), 10);
    const qtd = parseInt(loteQuantidade.trim(), 10);

    if (isNaN(numInicio) || numInicio < 1) {
      setErrorMessage('O número inicial deve ser um número inteiro maior ou igual a 1.');
      return;
    }

    if (isNaN(qtd) || qtd < 1) {
      setErrorMessage('A quantidade de prismas deve ser de pelo menos 1.');
      return;
    }

    if (qtd > 100) {
      setErrorMessage('O limite máximo para cadastro em lote é de 100 prismas por vez.');
      return;
    }

    // Gera lista para validação prévia de conflito
    const numerosCalculados: string[] = [];
    for (let i = numInicio; i < numInicio + qtd; i++) {
      numerosCalculados.push(lotePadZero && i < 10 ? `0${i}` : `${i}`);
    }

    // Verifica se algum número já existe no condomínio entre os prismas ativos (não excluídos)
    const conflitos = prismas.filter(
      (p) => !p.excluido && numerosCalculados.includes(String(p.numero).trim())
    );

    if (conflitos.length > 0) {
      const listaConflitos = conflitos.map((c) => `Nº ${c.numero}`).join(', ');
      setErrorMessage(
        `Não foi possível cadastrar o lote porque o prisma ${listaConflitos} já existe neste condomínio.`
      );
      return;
    }

    const corObj = CORES_DISPONIVEIS.find((c) => c.id === loteCorId) || CORES_DISPONIVEIS[0];

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await api.cadastrarPrismasLote({
        numeros: numerosCalculados,
        numeroInicial: numInicio,
        quantidade: qtd,
        padZero: lotePadZero,
        corId: corObj.id,
        corNome: corObj.nome,
        condominioId,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });

      setSuccessMessage(
        `${res.totalCriados} prismas ${corObj.nome.toLowerCase()} cadastrados com sucesso! (Nº ${res.primeiro} até Nº ${res.ultimo})`
      );
      onUpdateSuccess();
      setTimeout(() => {
        setActiveTab('LISTA');
        setSuccessMessage(null);
      }, 1600);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao cadastrar lote de prismas.');
    } finally {
      setIsLoading(false);
    }
  };

  // Cálculo da pré-visualização em tempo real do lote
  const numInicioVal = parseInt(loteNumeroInicial.trim(), 10);
  const qtdVal = parseInt(loteQuantidade.trim(), 10);
  const isLoteValido =
    !isNaN(numInicioVal) && numInicioVal >= 1 && !isNaN(qtdVal) && qtdVal >= 1 && qtdVal <= 100;

  const lotePreviewNumeros = isLoteValido
    ? Array.from({ length: Math.min(qtdVal, 100) }, (_, i) => {
        const n = numInicioVal + i;
        return lotePadZero && n < 10 ? `0${n}` : `${n}`;
      })
    : [];

  const lotePrimeiro = lotePreviewNumeros[0] || '';
  const loteUltimo = lotePreviewNumeros[lotePreviewNumeros.length - 1] || '';
  const loteCorObj = CORES_DISPONIVEIS.find((c) => c.id === loteCorId) || CORES_DISPONIVEIS[0];

  const handleToggleIndisponivel = async (prisma: Prisma) => {
    const tornarIndisponivel = prisma.estado !== PrismaEstado.INDISPONIVEL;
    const motivo = tornarIndisponivel
      ? prompt('Informe o motivo da indisponibilidade (ex: Danificado, Manutenção, Perda):')
      : undefined;

    if (tornarIndisponivel && motivo === null) return; // user cancelled prompt

    setIsLoading(true);
    try {
      await api.toggleIndisponivel({
        prismaId: prisma.id,
        tornarIndisponivel,
        motivo: motivo || undefined,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
        condominioId,
      });
      onUpdateSuccess();
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar estado do prisma.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDeletePrisma = async () => {
    if (!prismaToDelete) return;
    try {
      setIsDeletingPrisma(true);
      setDeleteError(null);
      await api.excluirPrisma({
        prismaId: prismaToDelete.id,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
        condominioId,
      });
      onUpdateSuccess();
      setPrismaToDelete(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Não foi possível excluir o prisma. Tente novamente.');
    } finally {
      setIsDeletingPrisma(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">Administração de Prismas Físicos</h2>
              <span className="text-xs text-slate-400">
                Cadastro, manutenção e gestão do inventário de prismas
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-200 px-5 pt-3 gap-3 bg-slate-50">
          <button
            onClick={() => setActiveTab('LISTA')}
            className={`pb-2.5 text-xs font-black uppercase tracking-wide border-b-2 transition-all cursor-pointer ${
              activeTab === 'LISTA'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Inventário ({prismas.length})
          </button>
          <button
            onClick={() => setActiveTab('NOVO')}
            className={`pb-2.5 text-xs font-black uppercase tracking-wide border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'NOVO'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Cadastrar Novo Prisma
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Confirmação de Exclusão de Prisma */}
          {prismaToDelete && (
            <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl space-y-3 shadow-md animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                <div className="flex items-center gap-2 text-rose-800 font-bold text-xs sm:text-sm">
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  <span>EXCLUIR PRISMA DA CONFIGURAÇÃO FÍSICA?</span>
                </div>
                <button
                  onClick={() => {
                    if (!isDeletingPrisma) {
                      setPrismaToDelete(null);
                      setDeleteError(null);
                    }
                  }}
                  className="text-slate-400 hover:text-slate-700 text-xs p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {deleteError && (
                <div className="p-2.5 bg-rose-100 border border-rose-300 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">Identificação do Prisma a ser excluído:</div>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Prisma {prismaToDelete.numero}</span>
                    <span
                      className="w-3 h-3 rounded-full border border-slate-300"
                      style={{ backgroundColor: getCorConfig(prismaToDelete.corId || prismaToDelete.corNome).hex }}
                    />
                    <span className="text-slate-600">({prismaToDelete.corNome})</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">ID: {prismaToDelete.id}</div>
                </div>
                <PrismaVisual numero={prismaToDelete.numero} corIdOrNome={prismaToDelete.corNome} size="md" />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isDeletingPrisma}
                  onClick={() => {
                    setPrismaToDelete(null);
                    setDeleteError(null);
                  }}
                  className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 text-xs rounded-xl font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isDeletingPrisma}
                  onClick={handleConfirmDeletePrisma}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow cursor-pointer transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeletingPrisma ? 'Excluindo...' : 'Excluir'}</span>
                </button>
              </div>
            </div>
          )}
          {activeTab === 'NOVO' ? (
            <div className="space-y-4 max-w-md mx-auto py-2">
              {/* Alternador de Modo de Cadastro */}
              <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  id="btn-modo-cadastro-individual"
                  onClick={() => {
                    setTipoCadastro('INDIVIDUAL');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-black uppercase rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    tipoCadastro === 'INDIVIDUAL'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Cadastro Individual
                </button>
                <button
                  type="button"
                  id="btn-modo-cadastro-lote"
                  onClick={() => {
                    setTipoCadastro('LOTE');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-black uppercase rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    tipoCadastro === 'LOTE'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Cadastro em Lote
                </button>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              {tipoCadastro === 'INDIVIDUAL' ? (
                <form onSubmit={handleCadastrar} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                      Número do Prisma *
                    </label>
                    <input
                      type="text"
                      id="input-novo-numero-individual"
                      required
                      value={novoNumero}
                      onChange={(e) => setNovoNumero(e.target.value)}
                      placeholder="Ex: 08, 12, 50, 99..."
                      className="w-full p-3 text-base font-black bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-indigo-600 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                      Cor do Prisma *
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {CORES_DISPONIVEIS.map((cor) => {
                        const isSelected = novaCorId === cor.id;
                        return (
                          <button
                            key={cor.id}
                            type="button"
                            id={`btn-cor-individual-${cor.id}`}
                            onClick={() => setNovaCorId(cor.id)}
                            className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500'
                                : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                          >
                            <span
                              className="w-4 h-4 rounded-full shadow-inner"
                              style={{ backgroundColor: cor.hex }}
                            />
                            <span className="text-xs font-bold text-slate-800">{cor.nome}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    💡 <strong>Regra de Identidade:</strong> É permitido cadastrar o mesmo número com cores diferentes (ex: 08 Azul e 08 Vermelho). Cada prisma recebe um ID técnico único no banco.
                  </div>

                  <button
                    type="submit"
                    id="btn-salvar-novo-prisma"
                    disabled={isLoading || !novoNumero.trim()}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm rounded-xl shadow transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Salvar Novo Prisma</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleCadastrarLote} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                        Número Inicial *
                      </label>
                      <input
                        type="number"
                        id="input-lote-numero-inicial"
                        required
                        min={1}
                        value={loteNumeroInicial}
                        onChange={(e) => setLoteNumeroInicial(e.target.value)}
                        placeholder="Ex: 1"
                        className="w-full p-3 text-base font-black bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-indigo-600 outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Início da sequência (ex: 1)</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                        Quantidade *
                      </label>
                      <input
                        type="number"
                        id="input-lote-quantidade"
                        required
                        min={1}
                        max={100}
                        value={loteQuantidade}
                        onChange={(e) => setLoteQuantidade(e.target.value)}
                        placeholder="Ex: 40"
                        className="w-full p-3 text-base font-black bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-indigo-600 outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Até 100 prismas por lote</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <input
                      type="checkbox"
                      id="check-lote-pad-zero"
                      checked={lotePadZero}
                      onChange={(e) => setLotePadZero(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="check-lote-pad-zero" className="text-xs text-slate-700 font-semibold cursor-pointer select-none">
                      Formatar com 2 dígitos (ex: 01, 02 ... 09, 10 ... 40)
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                      Cor dos Prismas do Lote *
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {CORES_DISPONIVEIS.map((cor) => {
                        const isSelected = loteCorId === cor.id;
                        return (
                          <button
                            key={cor.id}
                            type="button"
                            id={`btn-lote-cor-${cor.id}`}
                            onClick={() => setLoteCorId(cor.id)}
                            className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500'
                                : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                          >
                            <span
                              className="w-4 h-4 rounded-full shadow-inner"
                              style={{ backgroundColor: cor.hex }}
                            />
                            <span className="text-xs font-bold text-slate-800">{cor.nome}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pré-visualização do Lote */}
                  <div className="p-3.5 bg-indigo-50/80 border border-indigo-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-900 uppercase tracking-wide">
                        Pré-visualização do Lote
                      </span>
                      {isLoteValido && (
                        <span className="text-[11px] font-bold text-indigo-700 bg-white px-2 py-0.5 rounded-full border border-indigo-200">
                          {qtdVal} prismas
                        </span>
                      )}
                    </div>

                    {isLoteValido ? (
                      <div className="space-y-2">
                        <div className="text-sm font-bold text-indigo-950">
                          Serão criados {qtdVal} prismas {loteCorObj.nome}: Nº {lotePrimeiro} até Nº {loteUltimo}.
                        </div>
                        <div className="flex flex-wrap gap-1 items-center pt-1 border-t border-indigo-100">
                          {lotePreviewNumeros.slice(0, 8).map((num) => (
                            <span
                              key={num}
                              className="text-[11px] font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-slate-800"
                            >
                              {num}
                            </span>
                          ))}
                          {lotePreviewNumeros.length > 8 && (
                            <span className="text-xs text-indigo-600 font-bold px-1">
                              ... até Nº {loteUltimo}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic">
                        Informe o número inicial e a quantidade válidos para gerar a pré-visualização.
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    id="btn-salvar-lote-prismas"
                    disabled={isLoading || !isLoteValido}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm rounded-xl shadow transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Layers className="w-4 h-4" />
                    <span>{isLoading ? 'Cadastrando Lote...' : `Cadastrar Lote (${isLoteValido ? qtdVal : 0} Prismas)`}</span>
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sortPrismasNumericos(prismas).map((prisma) => {
                  const cor = getCorConfig(prisma.corId || prisma.corNome);
                  const isIndisponivel = prisma.estado === PrismaEstado.INDISPONIVEL;

                  return (
                    <div
                      key={prisma.id}
                      className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-2 shadow-2xs hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PrismaVisual
                          numero={prisma.numero}
                          corIdOrNome={prisma.corNome}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-black text-slate-900 block leading-tight truncate">
                            {prisma.numero} — {prisma.corNome.toUpperCase()}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 truncate block">
                            {prisma.id} • {prisma.estado}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {prisma.estado === PrismaEstado.DISPONIVEL && (
                          <button
                            onClick={() => handleToggleIndisponivel(prisma)}
                            className="text-[11px] font-bold text-rose-700 hover:bg-rose-50 px-2 py-1 rounded border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Colocar em manutenção"
                          >
                            <Wrench className="w-3 h-3" />
                            Manutenção
                          </button>
                        )}

                        {prisma.estado === PrismaEstado.INDISPONIVEL && (
                          <button
                            onClick={() => handleToggleIndisponivel(prisma)}
                            className="text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded border border-emerald-200 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Reativar para disponível"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Reativar
                          </button>
                        )}

                        <button
                          id={`btn-gerenciar-excluir-prisma-${prisma.id}`}
                          onClick={() => {
                            setDeleteError(null);
                            setPrismaToDelete(prisma);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                          title="Excluir Prisma da Configuração Física"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
