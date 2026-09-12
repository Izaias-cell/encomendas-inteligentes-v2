import React, { useState } from 'react';
import { Prisma, PrismaEstado } from '../types';
import { getCorConfig } from '../constants/cores';
import { api } from '../services/api';
import {
  X,
  Zap,
  Laptop,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

interface ConcorrenciaModalProps {
  isOpen: boolean;
  onClose: () => void;
  prismas: Prisma[];
  condominioId: string;
  onSuccess: () => void;
}

export const ConcorrenciaModal: React.FC<ConcorrenciaModalProps> = ({
  isOpen,
  onClose,
  prismas,
  condominioId,
  onSuccess,
}) => {
  const [selectedPrismaId, setSelectedPrismaId] = useState<string>(
    prismas.find((p) => p.estado === PrismaEstado.DISPONIVEL)?.id || prismas[0]?.id || ''
  );
  const [deviceAResult, setDeviceAResult] = useState<any>(null);
  const [deviceBResult, setDeviceBResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  if (!isOpen) return null;

  const prismaTarget = prismas.find((p) => p.id === selectedPrismaId);
  const cor = prismaTarget ? getCorConfig(prismaTarget.corId || prismaTarget.corNome) : null;

  const runSimultaneousDelivery = async () => {
    if (!selectedPrismaId || !prismaTarget) return;

    setIsRunning(true);
    setDeviceAResult(null);
    setDeviceBResult(null);
    setLogs([
      `Iniciando disparo simultâneo para o Prisma ${prismaTarget.numero} (${prismaTarget.corNome})...`,
    ]);

    // Promise.all with almost identical microsecond timing
    const promiseA = api
      .entregarPrisma({
        prismaId: selectedPrismaId,
        casa: 'Casa 101 (Dispositivo A - PC)',
        usuarioId: 'usr-1',
        usuarioNome: 'Porteiro PC',
        condominioId,
      })
      .then((res) => ({ success: true, data: res }))
      .catch((err) => ({ success: false, error: err.message, status: err.status }));

    const promiseB = api
      .entregarPrisma({
        prismaId: selectedPrismaId,
        casa: 'Casa 202 (Dispositivo B - Smartphone)',
        usuarioId: 'usr-2',
        usuarioNome: 'Porteiro Celular',
        condominioId,
      })
      .then((res) => ({ success: true, data: res }))
      .catch((err) => ({ success: false, error: err.message, status: err.status }));

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    setDeviceAResult(resA);
    setDeviceBResult(resB);

    const statusA = (resA as any).status || (resA.success ? 200 : 409);
    const statusB = (resB as any).status || (resB.success ? 200 : 409);

    const logMessages = [
      `Requisição Dispositivo A (PC): ${resA.success ? '✅ SUCESSO 200' : '❌ ERRO ' + statusA}`,
      `Requisição Dispositivo B (Celular): ${resB.success ? '✅ SUCESSO 200' : '❌ ERRO ' + statusB}`,
    ];

    if ((resA.success && !resB.success) || (!resA.success && resB.success)) {
      logMessages.push(
        '🛡️ REGRA ATÔMICA VALIDADA: O servidor permitiu estritamente 1 operação e barrou a duplicata com resposta controlada!'
      );
    }

    setLogs((prev) => [...prev, ...logMessages]);
    setIsRunning(false);
    onSuccess();
  };

  const handleResetData = async () => {
    setIsRunning(true);
    try {
      await api.resetTestData();
      setDeviceAResult(null);
      setDeviceBResult(null);
      setLogs(['Dados de teste restaurados para o padrão.']);
      onSuccess();
    } catch (e: any) {
      alert('Erro ao resetar: ' + e.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 font-bold">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">
                Simulador de Concorrência Multi-Dispositivo
              </h2>
              <span className="text-xs text-slate-400">
                Teste de estresse em tempo real para comprovar proteção contra duplicidade (PC vs Celular)
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

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Target Prism selector */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <label className="block text-xs font-bold text-slate-800 uppercase">
              Selecione o Prisma Alvo para o Teste:
            </label>
            <div className="flex items-center gap-3">
              <select
                value={selectedPrismaId}
                onChange={(e) => {
                  setSelectedPrismaId(e.target.value);
                  setDeviceAResult(null);
                  setDeviceBResult(null);
                }}
                className="flex-1 p-2.5 text-xs bg-white border border-slate-300 rounded-lg font-bold text-slate-900 outline-none"
              >
                {prismas.map((p) => (
                  <option key={p.id} value={p.id}>
                    Prisma {p.numero} — {p.corNome.toUpperCase()} (Estado: {p.estado})
                  </option>
                ))}
              </select>

              <button
                onClick={runSimultaneousDelivery}
                disabled={isRunning}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-black text-xs uppercase rounded-lg shadow transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isRunning ? (
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>Disparar Concorrência</span>
              </button>
            </div>
          </div>

          {/* Side by Side Device Simulation Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Dispositivo A - PC */}
            <div className="border-2 border-slate-200 rounded-2xl p-4 bg-slate-50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-blue-600" />
                    DISPOSITIVO A (PC PORTARIA)
                  </span>
                  <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">
                    Porteiro Carlos
                  </span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                  <p className="text-slate-500 text-[11px]">Tentando entregar para:</p>
                  <p className="font-bold text-slate-900">Casa 101</p>
                </div>
              </div>

              <div className="mt-4">
                {deviceAResult ? (
                  deviceAResult.success ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                      <div>
                        <p className="font-black">ENTREGA CONFIRMADA (200 OK)</p>
                        <p className="text-[11px]">Operação atômica realizada pelo PC com sucesso.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                      <div>
                        <p className="font-black">BLOQUEADO PELO BACKEND ({deviceAResult.status || 409})</p>
                        <p className="text-[11px]">{deviceAResult.error}</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-3 text-xs text-slate-400 border border-dashed rounded-xl">
                    Aguardando disparo do teste...
                  </div>
                )}
              </div>
            </div>

            {/* Dispositivo B - Celular */}
            <div className="border-2 border-slate-200 rounded-2xl p-4 bg-slate-50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-emerald-600" />
                    DISPOSITIVO B (CELULAR PORTARIA)
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">
                    Porteiro João
                  </span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                  <p className="text-slate-500 text-[11px]">Tentando entregar para:</p>
                  <p className="font-bold text-slate-900">Casa 202</p>
                </div>
              </div>

              <div className="mt-4">
                {deviceBResult ? (
                  deviceBResult.success ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                      <div>
                        <p className="font-black">ENTREGA CONFIRMADA (200 OK)</p>
                        <p className="text-[11px]">Operação atômica realizada pelo Celular com sucesso.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                      <div>
                        <p className="font-black">BLOQUEADO PELO BACKEND ({deviceBResult.status || 409})</p>
                        <p className="text-[11px]">{deviceBResult.error}</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-3 text-xs text-slate-400 border border-dashed rounded-xl">
                    Aguardando disparo do teste...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Test Logs and Verification */}
          {logs.length > 0 && (
            <div className="bg-slate-900 text-slate-200 p-3.5 rounded-xl text-xs font-mono space-y-1">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-1">
                <ShieldCheck className="w-4 h-4" />
                <span>Console de Resolução de Concorrência:</span>
              </div>
              {logs.map((log, idx) => (
                <div key={idx} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={handleResetData}
            disabled={isRunning}
            className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar Dados Iniciais
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
