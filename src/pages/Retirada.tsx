import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type PackageData = {
  id: string;
  pickup_token: string | null;
  pickup_code: string | null;
  status: string | null;
  recipient_name_raw?: string | null;
  unit_number_raw?: string | null;
};

export default function Retirada() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [packageData, setPackageData] = useState<PackageData | null>(null);

  useEffect(() => {
    const loadPackage = async () => {
      if (!token) {
        setError('Acesso inválido ou expirado');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('packages')
        .select(`
  id,
  pickup_token,
  pickup_code,
  status,
  recipient_name_raw,
  unit_number_raw
`)
        .eq('pickup_token', token)
        .single();

      if (error || !data) {
        setError('Acesso inválido ou expirado');
        setLoading(false);
        return;
      }

      setPackageData(data);
      setLoading(false);
    };

    loadPackage();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-4">Retirada de Encomenda</h1>
          <p className="text-zinc-600">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error || !packageData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-4">Retirada de Encomenda</h1>
          <p className="text-red-600 font-medium">{error || 'Acesso inválido ou expirado'}</p>
        </div>
      </div>
    );
  }

  const statusLabel =
  packageData.status === 'delivered'
    ? 'Já retirada'
    : packageData.status === 'received'
    ? 'Disponível para retirada'
    : packageData.status === 'pending'
    ? 'Aguardando retirada'
    : 'Aguardando retirada';

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 mb-6">Retirada de Encomenda</h1>

        <div className="mb-4">
          <p className="text-sm text-zinc-500">Morador</p>
          <p className="text-lg font-semibold text-zinc-900">
            {packageData.recipient_name_raw || 'Morador'}
          </p>
        </div>

        <div className="mb-6">
          <p className="text-sm text-zinc-500">Unidade</p>
          <p className="text-base font-medium text-zinc-800">
  {packageData.recipient?.unit_number || packageData.unit_number_raw || 'Não informada'}
</p>
        </div>

        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 mb-5">
          <p className="text-sm text-emerald-700 mb-2">Código de retirada</p>
          <p className="text-6xl font-bold tracking-widest text-emerald-700">
            {packageData.pickup_code || '----'}
          </p>
        </div>

        <div className="mb-4">
          <p className="text-sm text-zinc-500">Status</p>
          <p className="text-base font-semibold text-zinc-900">{statusLabel}</p>
        </div>

        <p className="text-sm text-zinc-600">
          Apresente este código na portaria para retirar sua encomenda.
        </p>
      </div>
    </div>
  );
}
