import { useSearchParams } from 'react-router-dom';

export default function Retirada() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 mb-4">Retirada de Encomenda</h1>
        <p className="text-zinc-600 mb-2">Token recebido:</p>
        <div className="bg-zinc-100 rounded-xl p-4 break-all text-sm text-zinc-800">
          {token || 'Token não informado'}
        </div>
      </div>
    </div>
  );
}
