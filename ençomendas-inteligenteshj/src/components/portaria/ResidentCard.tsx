import React from 'react';
import { User, MoreVertical, Edit, Phone, Home, Building2, Trash2, Power, AlertCircle } from 'lucide-react';
import { Morador } from '../../types';
import { formatResidentAddress } from '../../lib/residentUtils';

interface ResidentCardProps {
  resident: Morador;
  activeResidentMenu: string | null;
  setActiveResidentMenu: (id: string | null) => void;
  onEdit: (resident: Morador) => void;
  onDelete: (resident: Morador) => void;
  onToggleStatus: (resident: Morador) => void;
  userRole: string;
}

const ResidentCard: React.FC<ResidentCardProps> = ({ 
  resident, 
  activeResidentMenu, 
  setActiveResidentMenu,
  onEdit,
  onDelete,
  onToggleStatus,
  userRole
}) => {
  const hasValidResidence = Boolean(resident.unidade && String(resident.unidade).trim().length > 0);
  const hasPhone = Boolean(resident.telefone && String(resident.telefone).trim().length > 0);
  const isPendingWhatsApp = hasValidResidence && !hasPhone;

  return (
    <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group relative">
      <div className="flex justify-between items-start mb-4">
        <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
          <User className="w-6 h-6" />
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">
          {!resident.ativo && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700">
              Inativo
            </span>
          )}
          
          {/* Badge PENDENTE: apenas se tiver residência válida e não tiver WhatsApp */}
          {isPendingWhatsApp && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              PENDENTE
            </span>
          )}

          {/* Badge de Inconsistência caso falte residência */}
          {!hasValidResidence && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Sem Residência
            </span>
          )}

          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700">
            Morador
          </span>
          <div className="relative">
            <button
              onClick={() => setActiveResidentMenu(activeResidentMenu === resident.id ? null : resident.id)}
              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
              title="Ações"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {activeResidentMenu === resident.id && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setActiveResidentMenu(null)}
                />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-zinc-100 py-2 z-20 overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
                  <button
                    onClick={() => {
                      onEdit(resident);
                      setActiveResidentMenu(null);
                    }}
                    className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                  >
                    <Edit className="w-4 h-4 text-emerald-600" />
                    Editar Morador
                  </button>

                  {(userRole === 'admin' || userRole === 'sindico') && (
                    <>
                      <button
                        onClick={() => {
                          onToggleStatus(resident);
                          setActiveResidentMenu(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors ${resident.ativo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        <Power className="w-4 h-4" />
                        {resident.ativo ? 'Desativar Morador' : 'Ativar Morador'}
                      </button>

                      <div className="h-px bg-zinc-100 my-1" />

                      <button
                        onClick={() => {
                          onDelete(resident);
                          setActiveResidentMenu(null);
                        }}
                        className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Excluir Morador
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <h3 className="text-xl font-bold text-zinc-900 mb-2 truncate pr-8">{resident.nome}</h3>
      
      <div className="space-y-3 mb-4">
        {/* Identificação Completa da Residência */}
        <div className="flex items-center gap-3 text-zinc-600 text-sm">
          <Home className="w-4 h-4 flex-shrink-0 text-zinc-400" />
          <p className="font-semibold text-zinc-800">
            {hasValidResidence ? (
              formatResidentAddress(resident)
            ) : (
              <span className="text-red-600 font-bold italic">Inconsistente — Residência obrigatória</span>
            )}
          </p>
        </div>

        {/* Bloco / Rua se não incorporado na unidade */}
        {(resident.block || resident.street) && (
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <p className="truncate">
              {resident.block && `Bloco ${resident.block}`}
              {resident.block && resident.street && ' • '}
              {resident.street && `Rua ${resident.street}`}
            </p>
          </div>
        )}

        {/* Status WhatsApp / Telefone */}
        {hasPhone ? (
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <Phone className="w-4 h-4 flex-shrink-0" />
            <p className="font-mono">{resident.telefone}</p>
          </div>
        ) : isPendingWhatsApp ? (
          <div className="flex items-center gap-2.5 text-amber-800 text-xs font-bold bg-amber-50 px-3 py-2 rounded-xl border border-amber-200/80">
            <Phone className="w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
            <span>Adicione o WhatsApp!</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(ResidentCard);
